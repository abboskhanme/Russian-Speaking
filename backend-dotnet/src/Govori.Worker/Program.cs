using Govori.Assessment;
using Govori.Infrastructure;
using Govori.Platform.Grader;
using Govori.Platform.Storage;
using Govori.Platform.Stt;
using Govori.Platform.Telegram;
using Govori.Realtime;
using Govori.Worker;
using Microsoft.EntityFrameworkCore;
using Serilog;
using Serilog.Formatting.Compact;
using StackExchange.Redis;

// ── Bootstrap logger ────────────────────────────────────────────────────────
// docs/07 §7.9 — the Worker uses the same Serilog JSON style as Govori.Api. This
// throwaway logger captures failures during host construction.
Log.Logger = new LoggerConfiguration()
    .WriteTo.Console(new RenderedCompactJsonFormatter())
    .CreateBootstrapLogger();

try
{
    var builder = Host.CreateApplicationBuilder(args);

    // ── Serilog (docs/07 §7.3 "Kuzatuv", §7.9) ──────────────────────────────
    builder.Logging.ClearProviders();
    builder.Services.AddSerilog((services, configuration) => configuration
        .ReadFrom.Configuration(builder.Configuration)
        .ReadFrom.Services(services)
        .Enrich.FromLogContext()
        .WriteTo.Console(new RenderedCompactJsonFormatter()));

    // ── GovoriDbContext (docs/07 §7.4 — the enum-aware data source, same as Govori.Api) ──
    var connectionString =
        builder.Configuration.GetConnectionString("Govori")
        ?? builder.Configuration["GOVORI_DB"]
        ?? GovoriDataSourceFactory.DefaultConnectionString;
    var dataSource = GovoriDataSourceFactory.Build(connectionString);
    builder.Services.AddSingleton(dataSource);
    builder.Services.AddDbContext<GovoriDbContext>(options => options.UseGovori(dataSource));

    // ── Platform.Storage (S3/MinIO — same resolution as Govori.Api) ─────────
    var s3Endpoint = builder.Configuration["S3_ENDPOINT_URL"]
        ?? builder.Configuration["GOVORI_S3_ENDPOINT"]
        ?? "http://govori-minio:9000";
    builder.Services.AddSingleton(new StorageOptions
    {
        Endpoint = s3Endpoint,
        PublicUrl = builder.Configuration["S3_PUBLIC_URL"]
            ?? builder.Configuration["GOVORI_S3_ENDPOINT"]
            ?? s3Endpoint,
        AccessKey = builder.Configuration["S3_ACCESS_KEY"]
            ?? builder.Configuration["GOVORI_S3_ACCESS_KEY"] ?? "minioadmin",
        SecretKey = builder.Configuration["S3_SECRET_KEY"]
            ?? builder.Configuration["GOVORI_S3_SECRET_KEY"] ?? "minioadmin",
        Bucket = builder.Configuration["S3_BUCKET"]
            ?? builder.Configuration["GOVORI_S3_BUCKET"] ?? "govori-audio",
        Region = builder.Configuration["S3_REGION"] ?? "us-east-1",
    });
    builder.Services.AddSingleton<IObjectStorage>(sp =>
        new MinioObjectStorage(sp.GetRequiredService<StorageOptions>()));

    // ── Grading pipeline (docs/07 §7.7) ─────────────────────────────────────
    // Same real provider stubs as the API (IsConfigured=false → the pipeline DEFERS until keys land).
    builder.Services.AddSingleton<ISttProvider, AzureSttProvider>();
    builder.Services.AddSingleton<IGraderProvider, GeminiGraderProvider>();
    builder.Services.AddScoped<AssessmentService>();

    // XP/streak award for a graded submission (Stage 6 gamification). GradingJob resolves
    // IGradingRewarder (Govori.Contracts) after grading; the impl lives in the Engagement module.
    builder.Services.AddScoped<Govori.Engagement.EngagementService>();
    builder.Services.AddScoped<Govori.Contracts.IGradingRewarder, Govori.Engagement.SubmissionRewarder>();

    // ── Real-time (SignalR + Redis backplane) ───────────────────────────────
    // The Worker doesn't accept hub connections; it registers SignalR + IGradingEvents so the pipeline
    // can PUBLISH progress that reaches the API's connected clients over the govori-redis backplane.
    builder.Services.AddGovoriRealtime(builder.Configuration);

    // ── Hangfire server + durable grading queue (docs/07 §7.7, Faza 3.9) ────
    builder.Services.AddGovoriHangfire(builder.Configuration, runServer: true);

    // ── Recurring maintenance jobs ──────────────────────────────────────────
    // Destructive cleanup runs ONLY on this Hangfire host. Enabled by default; GOVORI_MAINTENANCE=false
    // registers the schedule but no-ops the work (used to verify Hangfire's additive schema against a
    // live DB without touching data).
    builder.Services.AddSingleton(new MaintenanceOptions
    {
        Enabled = builder.Configuration.GetValue("GOVORI_MAINTENANCE", true),
    });
    builder.Services.AddScoped<MaintenanceJobs>();

    // Liveness heartbeat so the host is observably alive alongside the Hangfire server.
    builder.Services.AddHostedService<Govori.Worker.Worker>();

    // ── Telegram bot OTP poller (phone-OTP delivery, docs/08) ───────────────
    // Registered ONLY when TELEGRAM_BOT_TOKEN is set (dev stacks have none → the API's dev delivery
    // stub + fixed code 000000 cover local testing). Long-polls getUpdates; on "/start <token>" it
    // resolves the deep-link token in Redis (shared with the API sender) and DMs the code.
    var telegramBotToken = builder.Configuration["TELEGRAM_BOT_TOKEN"];
    if (!string.IsNullOrWhiteSpace(telegramBotToken))
    {
        var redisConfiguration = builder.Configuration["GOVORI_REDIS"] ?? "govori-redis:6379";
        builder.Services.AddSingleton<IConnectionMultiplexer>(_ =>
        {
            var options = ConfigurationOptions.Parse(redisConfiguration);
            options.AbortOnConnectFail = false;
            return ConnectionMultiplexer.Connect(options);
        });
        builder.Services.AddSingleton<ITelegramOtpLinkStore, RedisTelegramOtpLinkStore>();
        // Proven Telegram↔phone pairs (docs/08). Singleton is safe: EfTelegramBindingStore opens its
        // own scope per call, so no DbContext is captured by the singleton poller.
        builder.Services.AddSingleton<ITelegramBindingStore, Govori.Infrastructure.Telegram.EfTelegramBindingStore>();
        builder.Services.AddHttpClient();
        builder.Services.AddSingleton(new TelegramBotPollerOptions(telegramBotToken));
        builder.Services.AddHostedService<TelegramBotPoller>();
    }

    var host = builder.Build();

    // Register the recurring schedule (stuck reset / orphan cleanup / test cleanup) on the Hangfire
    // storage. Idempotent: re-running updates the existing schedule rows in place.
    host.Services.AddGovoriRecurringJobs();

    host.Run();
}
catch (Exception ex)
{
    Log.Fatal(ex, "Govori.Worker terminated unexpectedly during startup");
}
finally
{
    Log.CloseAndFlush();
}
