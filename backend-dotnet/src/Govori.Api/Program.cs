using System.Reflection;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using Govori.Contracts;
using Govori.Identity;
using Govori.Identity.Security;
using Govori.Infrastructure;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Microsoft.IdentityModel.Tokens;
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

    // ── Identity / Auth vertical slice (docs/07 §7.5, Faza 3.1) ─────────────
    // Auth options mirror the Python Settings (backend/app/core/config.py): SecretKey
    // ← SECRET_KEY; expiries default to the Python values (30 min / 7 d / 20 min).
    var authOptions = new IdentityAuthOptions
    {
        SecretKey = builder.Configuration["SECRET_KEY"]
            ?? throw new InvalidOperationException("SECRET_KEY is not configured"),
        AccessTokenExpireMinutes = builder.Configuration.GetValue("ACCESS_TOKEN_EXPIRE_MINUTES", 30),
        RefreshTokenExpireDays = builder.Configuration.GetValue("REFRESH_TOKEN_EXPIRE_DAYS", 7),
        EmailVerifyTokenExpireMinutes = builder.Configuration.GetValue("EMAIL_VERIFY_TOKEN_EXPIRE_MINUTES", 20),
    };
    builder.Services.AddSingleton(authOptions);

    // GovoriDbContext through the enum-aware data source factory (docs/07 §7.4 — the ONLY
    // sanctioned wiring; a plain UseNpgsql would silently map the PG enums to int).
    var govoriConnectionString =
        builder.Configuration.GetConnectionString("Govori")
        ?? builder.Configuration["GOVORI_DB"]
        ?? GovoriDataSourceFactory.DefaultConnectionString;
    var govoriDataSource = GovoriDataSourceFactory.Build(govoriConnectionString);
    builder.Services.AddSingleton(govoriDataSource);
    builder.Services.AddDbContext<GovoriDbContext>(options => options.UseGovori(govoriDataSource));

    builder.Services.AddSingleton<PasswordHasher>();
    builder.Services.AddSingleton<TokenService>();
    builder.Services.AddScoped<AuthService>();

    // JSON: snake_case in/out to match the Python API shape (access_token, full_name, ...).
    builder.Services.ConfigureHttpJsonOptions(o =>
        o.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower);

    // JWT bearer (docs/07 §7.5). The token carries NO role/is_active — only sub/type/iat/exp;
    // role + is_active are read from the DB on every request (see AuthService.GetMeAsync).
    // Signing key = RAW UTF-8 bytes of SecretKey (python-jose does not base64-decode).
    // MapInboundClaims=false keeps `sub`/`type` verbatim (not the SOAP ClaimTypes URIs).
    builder.Services
        .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
        .AddJwtBearer(options =>
        {
            options.MapInboundClaims = false;
            options.TokenValidationParameters = new TokenValidationParameters
            {
                IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(authOptions.SecretKey)),
                ValidateIssuerSigningKey = true,
                ValidateIssuer = false,
                ValidateAudience = false,
                ValidateLifetime = true,
                ClockSkew = TimeSpan.Zero,
            };
        });
    builder.Services.AddAuthorization();

    var app = builder.Build();

    // Request logging middleware — one structured line per request (method, path,
    // status, elapsed ms) correlated to the trace. docs/07 §7.9.
    app.UseSerilogRequestLogging();

    // Auth pipeline (docs/07 §7.5) — must sit before the endpoints so
    // .RequireAuthorization() is enforced on protected routes.
    app.UseAuthentication();
    app.UseAuthorization();

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

    // ── Identity endpoints (docs/07 §7.5, Faza 3.1) ─────────────────────────
    // Thin by design (§7.2): parse → AuthService → serialize. All logic in AuthService.
    var auth = api.MapGroup("/auth");

    // POST /api/auth/login → 200 TokenResponse, or 401 on ANY failure. Never leak which of
    // email/password was wrong — single message, mirroring Python's "Incorrect email or password".
    auth.MapPost("/login", async (LoginRequest request, AuthService authService, CancellationToken ct) =>
    {
        var tokens = await authService.LoginAsync(request.Email, request.Password, ct);
        return tokens is null
            ? Results.Json(new { detail = "Incorrect email or password" }, statusCode: StatusCodes.Status401Unauthorized)
            : Results.Ok(tokens);
    });

    // GET /api/auth/me → the authenticated user. role/is_active come from the DB, never the
    // token (§7.5). Requires a valid *access* token (a refresh token is rejected, per deps.py).
    auth.MapGet("/me", async (ClaimsPrincipal principal, AuthService authService, CancellationToken ct) =>
    {
        if (principal.FindFirstValue("type") != "access"
            || !Guid.TryParse(principal.FindFirstValue("sub"), out var userId))
        {
            return Results.Unauthorized();
        }

        var me = await authService.GetMeAsync(userId, ct);
        return me is null ? Results.Unauthorized() : Results.Ok(me);
    }).RequireAuthorization();

    app.Run();
}
// WebApplicationFactory<Program> captures the built host by throwing an internal
// StopTheHostException from app.Run(); it MUST propagate for the test host to boot,
// so it is excluded here. All other startup failures are still logged as Fatal.
catch (Exception ex) when (ex.GetType().Name != "StopTheHostException")
{
    Log.Fatal(ex, "Govori.Api terminated unexpectedly during startup");
}
finally
{
    Log.CloseAndFlush();
}

// Exposed so WebApplicationFactory<Program> integration tests can boot this host.
public partial class Program;
