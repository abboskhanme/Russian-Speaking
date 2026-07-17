using System.Reflection;
using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using OpenTelemetry;
using OpenTelemetry.Exporter;
using OpenTelemetry.Metrics;
using OpenTelemetry.Resources;
using OpenTelemetry.Trace;
using Serilog;
using Serilog.Formatting.Compact;

// ── Bootstrap logger ────────────────────────────────────────────────────────
// docs/07 §7.9 (Kuzatuv) + §2.8: Serilog is the logging backbone. This throwaway
// logger captures failures that happen while the host is still being built (before
// the fully-configured logger exists). Recommended Serilog.AspNetCore pattern.
Log.Logger = new LoggerConfiguration()
    .WriteTo.Console(new RenderedCompactJsonFormatter())
    .CreateBootstrapLogger();

try
{
    var builder = WebApplication.CreateBuilder(args);

    // ── Serilog (docs/07 §7.3 "Kuzatuv: OpenTelemetry + Serilog", §7.9) ──────
    // Replaces the default logging providers with Serilog. Structured JSON to the
    // console → §7.9 "Serilog JSON + trace_id ... har qatorda". Levels/overrides
    // come from the "Serilog" section of appsettings*.json.
    builder.Host.UseSerilog((context, services, configuration) => configuration
        .ReadFrom.Configuration(context.Configuration)
        .ReadFrom.Services(services)
        .Enrich.FromLogContext()
        .WriteTo.Console(new RenderedCompactJsonFormatter()));

    // ── OpenTelemetry: tracing + metrics (docs/07 §7.3, §7.9) ───────────────
    var otel = builder.Services.AddOpenTelemetry();

    otel.ConfigureResource(resource => resource.AddService(
        serviceName: builder.Environment.ApplicationName,
        serviceVersion: Assembly.GetExecutingAssembly().GetName().Version?.ToString() ?? "0.0.0"));

    // Tracing: one continuous span across incoming HTTP → outgoing HttpClient
    // (later: → Hangfire → Azure/Gemini, §7.9).
    otel.WithTracing(tracing => tracing
        .AddAspNetCoreInstrumentation()
        .AddHttpClientInstrumentation());

    // Metrics: ASP.NET Core + HttpClient meters. Custom app meters
    // (attempt_grade_duration_seconds, ai_cost_usd_total{provider}, ... §7.9)
    // register here in Faza 2/3. Exposed via the /metrics scrape endpoint below.
    otel.WithMetrics(metrics => metrics
        .AddAspNetCoreInstrumentation()
        .AddHttpClientInstrumentation()
        .AddPrometheusExporter());

    // OTLP exporter is OPT-IN — only wired when a collector endpoint is configured,
    // so the host never hard-requires a running collector just to start.
    var otlpEndpoint = builder.Configuration["OpenTelemetry:Otlp:Endpoint"];
    if (!string.IsNullOrWhiteSpace(otlpEndpoint))
    {
        var endpoint = new Uri(otlpEndpoint);
        otel.WithTracing(t => t.AddOtlpExporter(o => o.Endpoint = endpoint));
        otel.WithMetrics(m => m.AddOtlpExporter(o => o.Endpoint = endpoint));
    }

    // ── Health checks (docs/07 §2.8) ────────────────────────────────────────
    builder.Services.AddHealthChecks()
        // Readiness probe. TODO Faza 2/3: add tagged checks for Postgres (Npgsql),
        // Redis, and MinIO/S3 here as those dependencies get wired — each tagged
        // "ready" so it participates in /health/ready below.
        .AddCheck(
            name: "ready",
            check: () => HealthCheckResult.Healthy("no external dependencies wired yet"),
            tags: new[] { "ready" });

    var app = builder.Build();

    // Request logging middleware — one structured line per request (method, path,
    // status, elapsed ms) correlated to the trace. docs/07 §7.9.
    app.UseSerilogRequestLogging();

    // Liveness (docs/07 §2.8): process is up ⇒ Healthy. Predicate '_ => false' runs
    // NO registered checks, so a slow/unready dependency never fails liveness
    // (an orchestrator must not restart a live-but-not-yet-ready process).
    app.MapHealthChecks("/health", new HealthCheckOptions { Predicate = _ => false });

    // Readiness (docs/07 §2.8): only checks tagged "ready".
    app.MapHealthChecks("/health/ready", new HealthCheckOptions
    {
        Predicate = registration => registration.Tags.Contains("ready")
    });

    // Prometheus scrape endpoint → /metrics (docs/07 §2.8, §7.9).
    app.MapPrometheusScrapingEndpoint();

    // ── Versioned API surface (docs/07 §7.3 — Minimal API endpoint groups) ──
    var api = app.MapGroup("/api");
    // Placeholder so the host is demonstrably serving. Real endpoints land per-domain.
    api.MapGet("/ping", () => Results.Ok(new { status = "ok" }));

    app.Run();
}
catch (Exception ex)
{
    Log.Fatal(ex, "Govori.Api terminated unexpectedly during startup");
}
finally
{
    Log.CloseAndFlush();
}

// Exposed so WebApplicationFactory<Program> integration tests can boot this host.
public partial class Program;
