using Govori.Administration;
using Govori.Assessment;
using Govori.Infrastructure;
using Govori.Platform.Ai;
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

    // ── Runtime settings (docs/07 §3.7) ─────────────────────────────────────
    // The Worker reads the same app_settings the admin panel writes — the provider chain, the keys,
    // the models. It never writes them, but it must resolve them through the SAME service so the
    // tri-state rules and the ~30s cache have one implementation rather than two that drift.
    // The cache is a process-local singleton, so a key pasted in the API's process would normally
    // not be visible here until this process's own TTL lapsed. The invalidation listener
    // registered further down closes that window to a network hop.
    builder.Services.AddSingleton<IAppSettingsCache>(new AppSettingsCache());
    builder.Services.AddScoped<AppSettingsService>();

    // ── Grading pipeline (docs/07 §7.7, Faza 3.4) ───────────────────────────
    // The SAME registration the API uses, so the two hosts can never disagree about which provider
    // graded an attempt. IAiConfigSource is supplied here rather than inside AddGovoriAi because
    // its implementation lives in a domain module, which Platform must not reference.
    builder.Services.AddGovoriAi();
    builder.Services.AddScoped<IAiConfigSource, AiConfigSource>();
    // The global AI budget (kill switch + daily/monthly caps). The chain providers refuse every
    // vendor call while it is closed and record each call's estimated cost in ai_spend_daily —
    // registered in BOTH hosts so grading in the Worker is bounded by the same ledger as the API.
    builder.Services.AddScoped<AiBudgetService>();
    builder.Services.AddScoped<IAiBudget>(sp => sp.GetRequiredService<AiBudgetService>());
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
    // Redis is registered UNCONDITIONALLY, not inside the Telegram branch it used to live in.
    // Two things need it now, and only one of them is about Telegram: the settings-invalidation
    // listener below has to run whether or not a bot token exists, or the Worker goes back to
    // grading on configuration that is up to 30s out of date.
    // AbortOnConnectFail=false so a transient blip does not latch the connection dead.
    var redisConfiguration = builder.Configuration["GOVORI_REDIS"] ?? "govori-redis:6379";
    builder.Services.AddSingleton<IConnectionMultiplexer>(_ =>
    {
        var options = ConfigurationOptions.Parse(redisConfiguration);
        options.AbortOnConnectFail = false;
        return ConnectionMultiplexer.Connect(options);
    });

    // The Worker never writes settings — it only needs to hear that someone else did. The
    // broadcast is registered anyway so the service graph matches the API's exactly; a host that
    // resolves a different object for the same interface is how the two drift apart.
    builder.Services.AddSingleton<IAppSettingsBroadcast, RedisAppSettingsBroadcast>();
    builder.Services.AddHostedService<AppSettingsInvalidationListener>();

    if (!string.IsNullOrWhiteSpace(telegramBotToken))
    {
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
