using System.Linq;
using System.Text.Json;
using Govori.Assessment;
using Govori.Contracts;
using Govori.Infrastructure;
using Hangfire;
using Hangfire.PostgreSql;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using StackExchange.Redis;

namespace Govori.Realtime;

/// <summary>
/// Composition-root wiring shared by <c>Govori.Api</c> (enqueues + hosts the hub endpoint) and
/// <c>Govori.Worker</c> (runs the Hangfire server + publishes events). Keeps the Hangfire and
/// SignalR setup — storage, backplane, retry policy, job registration — in ONE place so the two
/// hosts cannot drift apart (docs/07 §7.3, §7.7; docs/08 Faza 3.9/3.10).
/// </summary>
public static class RealtimeServiceCollectionExtensions
{
    /// <summary>
    /// SignalR + the attempt-progress <see cref="IGradingEvents"/> implementation. The hub speaks
    /// snake_case JSON, matching the REST wire shape clients already parse; the Redis backplane
    /// (govori-redis) is ON by default so a Worker-side publish reaches API-side clients, and can be
    /// turned off (<c>GOVORI_SIGNALR_BACKPLANE=false</c>) for a single-process host such as an
    /// integration test where in-memory delivery is enough.
    /// </summary>
    public static IServiceCollection AddGovoriRealtime(this IServiceCollection services, IConfiguration config)
    {
        var signalr = services
            .AddSignalR()
            .AddJsonProtocol(o => o.PayloadSerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower);

        if (config.GetValue("GOVORI_SIGNALR_BACKPLANE", true))
        {
            var redis = config["GOVORI_REDIS"] ?? "govori-redis:6379";
            signalr.AddStackExchangeRedis(options =>
            {
                var parsed = ConfigurationOptions.Parse(redis);
                parsed.AbortOnConnectFail = false;   // survive a transient blip instead of latching dead
                options.Configuration = parsed;
                options.Configuration.ChannelPrefix = RedisChannel.Literal("govori-signalr");
            });
        }

        // The pipeline emits progress through this seam; the real impl fans out over the hub.
        services.AddSingleton<IGradingEvents, SignalRGradingEvents>();
        return services;
    }

    /// <summary>
    /// Hangfire (Postgres storage) + the durable grading queue. The <paramref name="runServer"/>
    /// host (Govori.Worker) also starts the processing server and registers the bounded automatic
    /// retry policy; the API is a client that only enqueues. Hangfire creates and owns its OWN
    /// <c>hangfire</c> schema — that is the ONLY schema it may touch. The application's own tables
    /// belong to EF Core migrations and Hangfire must never create, alter or drop them.
    /// </summary>
    public static IServiceCollection AddGovoriHangfire(
        this IServiceCollection services, IConfiguration config, bool runServer)
    {
        var connectionString = HangfireConnectionString(config);

        services.AddHangfire(cfg => cfg
            .SetDataCompatibilityLevel(CompatibilityLevel.Version_180)
            .UseSimpleAssemblyNameTypeSerializer()
            .UseRecommendedSerializerSettings()
            .UsePostgreSqlStorage(
                c => c.UseNpgsqlConnection(connectionString),
                new PostgreSqlStorageOptions
                {
                    // ADDITIVE: a dedicated schema keeps every Hangfire table out of `public`.
                    SchemaName = "hangfire",
                    PrepareSchemaIfNecessary = true,
                }));

        services.TryAddScoped<GradingJob>();
        services.AddSingleton<IGradingQueue, HangfireGradingQueue>();

        if (runServer)
        {
            // Bound Hangfire's automatic retry to 3 attempts, with LATE acknowledgement semantics:
            // a job is only settled once it completes, so a crashed worker's job is re-queued.
            // Safe because the pipeline is idempotent (resume-from-transcript + Evaluation
            // DELETE-then-INSERT). Replace the default 10-attempt policy — done once, in the single
            // Worker process, so the static filter collection isn't mutated from a shared test host.
            foreach (var existing in GlobalJobFilters.Filters
                         .Where(f => f.Instance is AutomaticRetryAttribute).ToList())
                GlobalJobFilters.Filters.Remove(existing.Instance);
            GlobalJobFilters.Filters.Add(new AutomaticRetryAttribute
            {
                Attempts = 3,
                OnAttemptsExceeded = AttemptsExceededAction.Fail,
            });

            services.AddHangfireServer();
        }

        return services;
    }

    /// <summary>
    /// Register the recurring maintenance schedule (docs/07 §7.7): stuck-submission recovery every
    /// 5 min, orphan-upload and test-submission cleanup hourly. The job ids are stable identifiers —
    /// renaming one orphans the existing schedule row rather than updating it.
    /// Call on the built Worker host only (the destructive jobs are
    /// additionally guarded by <see cref="MaintenanceOptions.Enabled"/>).
    /// </summary>
    public static void AddGovoriRecurringJobs(this IServiceProvider services)
    {
        var manager = services.GetRequiredService<IRecurringJobManager>();

        manager.AddOrUpdate<MaintenanceJobs>(
            "fail-stuck-submissions",
            job => job.FailStuckSubmissionsAsync(CancellationToken.None),
            "*/5 * * * *");                                   // every 5 minutes

        manager.AddOrUpdate<MaintenanceJobs>(
            "cleanup-orphan-uploads",
            job => job.CleanupOrphanUploadsAsync(CancellationToken.None),
            Cron.Hourly());                                   // hourly

        manager.AddOrUpdate<MaintenanceJobs>(
            "cleanup-test-submissions",
            job => job.CleanupTestSubmissionsAsync(CancellationToken.None),
            Cron.Hourly());                                   // hourly

        manager.AddOrUpdate<MaintenanceJobs>(
            "purge-expired-audio",
            job => job.PurgeExpiredAudioAsync(CancellationToken.None),
            Cron.Daily());                                    // daily — reclaim answer audio >90 days
    }

    // Hangfire storage uses the SAME Postgres as EF Core — resolved exactly like GovoriDbContext
    // (Program.cs): ConnectionStrings:Govori → GOVORI_DB → the govori-net default.
    private static string HangfireConnectionString(IConfiguration config) =>
        config.GetConnectionString("Govori")
        ?? config["GOVORI_DB"]
        ?? GovoriDataSourceFactory.DefaultConnectionString;
}
