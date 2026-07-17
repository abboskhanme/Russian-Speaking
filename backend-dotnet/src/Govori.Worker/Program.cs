using Govori.Worker;
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
    // Make Serilog the sole logging provider so output is clean structured JSON.
    builder.Logging.ClearProviders();
    builder.Services.AddSerilog((services, configuration) => configuration
        .ReadFrom.Configuration(builder.Configuration)
        .ReadFrom.Services(services)
        .Enrich.FromLogContext()
        .WriteTo.Console(new RenderedCompactJsonFormatter()));

    // ── Background work ─────────────────────────────────────────────────────
    // TODO Faza 2/3 (docs/07 §7.3, §7.7): register the Hangfire server here once
    // Postgres is wired — this host becomes the grading pipeline (ex-Celery):
    //     builder.Services.AddHangfire(cfg => cfg.UsePostgreSqlStorage(connString));
    //     builder.Services.AddHangfireServer();
    // Also add OpenTelemetry tracing/metrics for the pipeline (docs/07 §7.9) at that
    // point. Until then the BackgroundService below just emits a heartbeat so the
    // host is observably alive.
    builder.Services.AddHostedService<Worker>();

    var host = builder.Build();
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
