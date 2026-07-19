using Govori.Assessment;
using Govori.Infrastructure;
using Govori.Platform.Grader;
using Govori.Platform.Storage;
using Govori.Platform.Stt;
using Govori.Realtime;
using Microsoft.EntityFrameworkCore;
using Serilog;
using Serilog.Formatting.Compact;

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

    // ── Real-time (SignalR + Redis backplane) ───────────────────────────────
    // The Worker doesn't accept hub connections; it registers SignalR + IGradingEvents so the pipeline
    // can PUBLISH progress that reaches the API's connected clients over the govori-redis backplane.
    builder.Services.AddGovoriRealtime(builder.Configuration);

    // ── Hangfire server + durable grading queue (docs/07 §7.7, Faza 3.9) ────
    builder.Services.AddGovoriHangfire(builder.Configuration, runServer: true);

    // ── Recurring maintenance jobs (the Celery beat port) ───────────────────
    // Destructive cleanup runs ONLY here (this is the Hangfire host): enable the guard.
    builder.Services.AddSingleton(new MaintenanceOptions { Enabled = true });
    builder.Services.AddScoped<MaintenanceJobs>();

    // Liveness heartbeat so the host is observably alive alongside the Hangfire server.
    builder.Services.AddHostedService<Govori.Worker.Worker>();

    var host = builder.Build();

    // Register the recurring schedule (stuck reset / orphan cleanup / test cleanup) on the Hangfire
    // storage — same job ids + cadence as Python's beat_schedule.
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
