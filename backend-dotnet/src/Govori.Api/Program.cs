using System.Reflection;
using System.Text;
using System.Text.Json;
using Govori.Catalog;
using Govori.Identity;
using Govori.Identity.Providers;
using Govori.Identity.Security;
using Govori.Infrastructure;
using Govori.Platform.Storage;
using Govori.Practice;
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
using StackExchange.Redis;

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

    // ── Catalog / student read path (docs/07 §7.2, Faza 3.2) ────────────────
    // FreeTasksPerModule ← FREE_TASKS_PER_MODULE (Python config.py:35, default 3): the positional
    // freemium threshold for official public modules. CatalogService owns the two-layer lock.
    builder.Services.AddSingleton(new CatalogOptions
    {
        FreeTasksPerModule = builder.Configuration.GetValue("FREE_TASKS_PER_MODULE", 3),
    });
    builder.Services.AddScoped<CatalogService>();

    // ── Platform.Storage (docs/07 §7.2 — S3/MinIO object storage) ───────────
    // StorageOptions binds from the prod S3_* env keys (config.py:38-43), falling back to the
    // integration-test keys (GOVORI_S3_*) so the same host works in the govori-net test env.
    // PublicUrl defaults to the internal endpoint: presigned URLs must be signed for the host the
    // consumer reaches (in-network tests reach MinIO at the same host — see StorageOptions docs).
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

    // ── Practice / attempt-submit path (docs/07 §7.2, Faza 3.3) ─────────────
    // PracticeService owns the submit flow (404→403→402 gate → store audio → pending Submission).
    // The 402 freemium gate reuses Catalog's frozen CatalogService.NeedsPremiumAsync (task decision
    // 3a — single C4-characterized source of truth, no divergence).
    builder.Services.AddScoped<PracticeService>();

    // ── Identity providers + config (docs/07 §7.5, Faza 3.1) ────────────────
    // OTP / email-verification config — mirrors Python EMAIL_OTP_* + email_enabled.
    builder.Services.AddSingleton(new OtpOptions
    {
        CodeLength = builder.Configuration.GetValue("EMAIL_OTP_LENGTH", 6),
        TtlSeconds = builder.Configuration.GetValue("EMAIL_OTP_TTL_SEC", 600),
        MaxAttempts = builder.Configuration.GetValue("EMAIL_OTP_MAX_ATTEMPTS", 5),
        // Python derives email_enabled from SMTP config; SMTP isn't wired here yet, so this
        // is an explicit flag (default false → sign-up works without email verification).
        EmailVerificationEnabled = builder.Configuration.GetValue("EMAIL_VERIFICATION_ENABLED", false),
    });
    builder.Services.AddSingleton(new GoogleAuthOptions
    {
        ClientId = builder.Configuration["GOOGLE_CLIENT_ID"] ?? string.Empty,
    });

    // Redis (StackExchange.Redis) for OTP storage. LAZY factory — connects on first use, so
    // host boot never hard-requires Redis (tests swap a fake IOtpStore and never resolve
    // this). AbortOnConnectFail=false survives a transient blip instead of latching dead.
    var redisConfiguration = builder.Configuration["GOVORI_REDIS"] ?? "govori-redis:6379";
    builder.Services.AddSingleton<IConnectionMultiplexer>(_ =>
    {
        var options = ConfigurationOptions.Parse(redisConfiguration);
        options.AbortOnConnectFail = false;
        return ConnectionMultiplexer.Connect(options);
    });

    // External providers behind interfaces — real impls here; integration tests swap fakes
    // via ConfigureTestServices so they never hit real Redis/Google/SMS/email.
    builder.Services.AddSingleton<IOtpStore, RedisOtpStore>();      // Redis-backed, FAIL-CLOSED
    builder.Services.AddSingleton<IOtpSender, LoggingOtpSender>();  // TODO: real SMTP/SMS provider
    builder.Services.AddHttpClient<IGoogleTokenVerifier, GoogleTokenVerifier>(); // Google tokeninfo

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
    // The whole auth surface (login, register, refresh, logout, me, OTP request/verify,
    // Google, config) lives in the Identity module's MapIdentityEndpoints extension. This is
    // the MODULAR-ENDPOINT PATTERN every future domain (Catalog, Practice, …) copies — the
    // composition root wires one call per domain, no inline route bodies here.
    app.MapIdentityEndpoints();

    // ── Catalog endpoints (docs/07 §7.2, Faza 3.2) ──────────────────────────
    // The student read path (GET /api/blocks/student — the two-layer sequence+freemium lock)
    // lives in the Catalog module's MapCatalogEndpoints extension, one call per domain.
    app.MapCatalogEndpoints();

    // ── Practice endpoints (docs/07 §7.2, Faza 3.3) ─────────────────────────
    // The student attempt/submit surface (POST /api/submissions — the 402 freemium gate + audio
    // store + pending Submission; list + attempt detail) lives in the Practice module's
    // MapPracticeEndpoints extension, one call per domain.
    app.MapPracticeEndpoints();

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
