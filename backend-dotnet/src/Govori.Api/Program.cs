using System.Reflection;
using System.Text;
using System.Text.Json;
using Govori.Administration;
using Govori.Api.RateLimiting;
using Govori.Assessment;
using Govori.Catalog;
using Govori.Classroom;
using Govori.Contracts;
using Govori.Engagement;
using Govori.Guest;
using Govori.Guest.Tts;
using Govori.Identity;
using Govori.Identity.Providers;
using Govori.Identity.Security;
using Govori.Infrastructure;
using Govori.Platform.Grader;
using Govori.Platform.Storage;
using Govori.Platform.Stt;
using Govori.Platform.Telegram;
using Govori.Practice;
using Govori.Realtime;
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
    // PracticeService owns the submit flow (404→403→402 gate → store audio → pending Submission →
    // enqueue grading). The 402 freemium gate reuses Catalog's frozen CatalogService.NeedsPremiumAsync
    // (task decision 3a — single C4-characterized source of truth, no divergence).
    builder.Services.AddScoped<PracticeService>();

    // ── Assessment / grading pipeline (docs/07 §7.7, Faza 3.4) ──────────────
    // STT + Grader behind interfaces. PROD registers the REAL Azure/Whisper/Gemini ports, which are
    // TODO stubs reporting IsConfigured=false (no keys) — so the pipeline safely DEFERS (attempt stays
    // pending) until real keys + Hangfire land. Fakes are NEVER registered here; integration tests
    // swap them in via ConfigureTestServices. AssessmentService is scoped (scoped DbContext); the
    // in-process queue is a singleton that opens a fresh scope per run.
    builder.Services.AddSingleton<ISttProvider, AzureSttProvider>();        // TODO(Faza 3.4): Whisper fallback
    builder.Services.AddSingleton<IGraderProvider, GeminiGraderProvider>(); // TODO(Faza 3.4): OpenAI/Azure fallback
    builder.Services.AddScoped<AssessmentService>();
    // The durable job unit — registered unconditionally so it resolves whether or not Hangfire is on
    // (AddGovoriHangfire TryAdds the same); the Hangfire client below enqueues it per submit.
    builder.Services.AddScoped<GradingJob>();

    // ── Placement / one-time "dastlabki sinov" (owner mockup A2/A3) ──────────
    // A new student answers 3 fixed Russian questions post-register → an estimated CEFR level.
    // Stateless + storage-free: questions are hardcoded, per-answer bands are returned and discarded,
    // and the client marks "placement done" in localStorage (no schema change). Reuses the SAME
    // ISttProvider + IGraderProvider seams as grading — while those are stubbed (no keys) the band is
    // a deterministic placeholder, so the flow works end-to-end until real AI keys land (Faza 3.4).
    builder.Services.AddScoped<PlacementService>();

    // ── Real-time attempt progress (SignalR + Redis backplane, docs/08 Faza 3.10) ──
    // Registers the attempt-progress hub services + IGradingEvents (SignalRGradingEvents). The API
    // hosts the /hubs/attempts endpoint that browsers connect to; grading events reach those clients
    // in-process here and — in prod — from the Worker via the Redis backplane.
    builder.Services.AddGovoriRealtime(builder.Configuration);

    // ── Durable grading queue (Hangfire, docs/07 §7.7, Faza 3.9) ────────────
    // ON by default: the API is a Hangfire CLIENT (no server) that enqueues a GradingJob per submit
    // (replacing the in-process pipeline). Set GOVORI_HANGFIRE=false to fall back to the synchronous
    // in-process queue — the two grading integration tests do this to keep their inline assertions.
    if (builder.Configuration.GetValue("GOVORI_HANGFIRE", true))
        builder.Services.AddGovoriHangfire(builder.Configuration, runServer: false);
    else
        builder.Services.AddSingleton<IGradingQueue, InlineGradingQueue>();

    // ── Classroom / groups + assignments + gradebook (docs/07 §3.5, Faza 3.5) ──
    // ClassroomService owns teacher groups (create/join/roster), assignments (single + module) and
    // the teacher-scoped gradebook. Ported from groups.py/engagement.py/reports.py; it also carries
    // the S1 roster-filter SECURITY FIX on assignment creation (§7.8). Scoped (scoped DbContext).
    builder.Services.AddScoped<ClassroomService>();

    // ── Engagement / XP + streak + leaderboard + SRS + notifications (docs/07 §3.6, Faza 3.6) ──
    // EngagementService owns the frozen C8 XP curve (XpForBand), the daily streak (with freezes), the
    // leaderboard (SQL-side ranking), the spaced-repetition review queue and in-app notifications.
    // Ported from gamification.py (award/streak/schedule — worker-driven, no HTTP route) +
    // engagement.py/notifications.py (leaderboard/review/notifications HTTP surface). Scoped (scoped
    // DbContext).
    builder.Services.AddScoped<EngagementService>();

    // ── Administration / app settings + admin user management (docs/07 §3.7, Faza 3.7) ──
    // AppSettingsService owns the tri-state app_settings read/write (None=unchanged / ""=clear /
    // value=store) with env-var fallback, behind the process-global ~30s AppSettingsCache (SINGLETON,
    // mirroring Python's module-level cache; invalidated on every write). AdministrationService owns
    // the admin-only user surface (stats, teacher/student list-search-update-delete) and the freemium
    // is_premium grant/revoke + (de)activate. Ported from admin.py / admin_settings.py /
    // settings_public.py. Both services scoped (scoped DbContext).
    builder.Services.AddSingleton<IAppSettingsCache>(new AppSettingsCache());
    builder.Services.AddScoped<AppSettingsService>();
    builder.Services.AddScoped<AdministrationService>();

    // ── Guest / auth-less demo (docs/07 §3.8, Faza 3.8) ─────────────────────
    // GuestService owns the public "try one phrase" demo (phrase pick + the SAME Azure
    // pronunciation assessment the app uses, via the shared ISttProvider seam, + score blend + rough
    // CEFR level). Ported from guest.py; stores nothing, requires no account. TTS behind ITtsProvider
    // mirrors the STT seam — a real Azure port is a TODO stub (IsConfigured=false) so /guest/tts
    // safely returns 503 until a key lands, exactly like Python raising with no key. Scoped
    // (matches the module convention); the providers are singletons.
    builder.Services.AddSingleton<ITtsProvider, AzureTtsProvider>(); // TODO(Faza 3.4): real Azure TTS
    builder.Services.AddScoped<GuestService>();

    // ── Rate limiting (docs/07 §7.3, §3.8) ──────────────────────────────────
    // ASP.NET Core RateLimiter mirroring backend/app/core/ratelimit.py: per-user-or-IP fixed-window
    // policies (email_code / login / guest_assess / guest_tts) and — CRITICAL — FAIL-OPEN (a store
    // outage ALLOWS the request; rate limiting must never take the API down). Default counter is
    // in-memory; GOVORI_RATELIMIT_BACKEND=redis swaps in the (implemented) cross-instance store.
    builder.Services.AddGovoriRateLimiter(builder.Configuration);

    // ── Identity providers + config (docs/07 §7.5, Faza 3.1) ────────────────
    // OTP generation config — TTL/length/attempts reused as-is for phone codes.
    builder.Services.AddSingleton(new OtpOptions
    {
        CodeLength = builder.Configuration.GetValue("EMAIL_OTP_LENGTH", 6),
        TtlSeconds = builder.Configuration.GetValue("EMAIL_OTP_TTL_SEC", 600),
        MaxAttempts = builder.Configuration.GetValue("EMAIL_OTP_MAX_ATTEMPTS", 5),
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
    // via ConfigureTestServices so they never hit real Redis/Google/Telegram.
    builder.Services.AddSingleton<IOtpStore, RedisOtpStore>();      // Redis-backed, FAIL-CLOSED
    builder.Services.AddHttpClient<IGoogleTokenVerifier, GoogleTokenVerifier>(); // Google tokeninfo

    // OTP delivery (phone → Telegram). If TELEGRAM_BOT_TOKEN + TELEGRAM_BOT_USERNAME are set, use the
    // FREE-bot deep-link sender: it stashes {phone,code} behind a start-token in Redis and returns a
    // t.me/<bot>?start=<token> link (the Worker's poller DMs the code when the user presses Start).
    // Otherwise fall back to the dev stub (logs the code + accepts the fixed dev code 000000). The
    // dev bypass is impossible once a real bot is present (TelegramBotOtpSender.AcceptsDevCode=false).
    var telegramBotToken = builder.Configuration["TELEGRAM_BOT_TOKEN"];
    var telegramBotUsername = builder.Configuration["TELEGRAM_BOT_USERNAME"];
    if (!string.IsNullOrWhiteSpace(telegramBotToken) && !string.IsNullOrWhiteSpace(telegramBotUsername))
    {
        builder.Services.AddSingleton(new TelegramBotOptions { Username = telegramBotUsername });
        builder.Services.AddSingleton<ITelegramOtpLinkStore, RedisTelegramOtpLinkStore>();
        builder.Services.AddSingleton<IOtpDeliverySender, TelegramBotOtpSender>();
    }
    else
    {
        builder.Services.AddSingleton<IOtpDeliverySender, DevOtpDeliverySender>();
    }

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
            // SignalR (docs/08 Faza 3.10): the WebSocket/SSE transports can't send an Authorization
            // header, so the JWT arrives as the `access_token` query string on the hub handshake.
            // Read it there for /hubs paths; the REST API keeps using the Authorization header.
            options.Events = new JwtBearerEvents
            {
                OnMessageReceived = context =>
                {
                    var accessToken = context.Request.Query["access_token"];
                    if (!string.IsNullOrEmpty(accessToken)
                        && context.HttpContext.Request.Path.StartsWithSegments("/hubs"))
                    {
                        context.Token = accessToken;
                    }
                    return Task.CompletedTask;
                },
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

    // Rate limiter AFTER authentication so per-user keying can read the validated `sub` claim
    // (falls back to client IP for anonymous requests). Endpoints opt in with .RequireRateLimiting;
    // rejections answer 429 (docs/07 §7.3, ratelimit.py). FAIL-OPEN — see Govori.Api/RateLimiting.
    app.UseRateLimiter();

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

    // ── Placement endpoints (owner mockup "dastlabki sinov") ────────────────
    // The one-time post-register CEFR check (GET /api/placement/questions, POST /api/placement/submit,
    // POST /api/placement/complete) lives in the Assessment module's MapPlacementEndpoints extension,
    // one call per domain. All routes require auth; the flow persists nothing server-side.
    app.MapPlacementEndpoints();

    // ── Classroom endpoints (docs/07 §3.5, Faza 3.5) ────────────────────────
    // Teacher groups (/api/groups), assignments (/api/assignments) and the gradebook
    // (/api/reports/gradebook) live in the Classroom module's MapClassroomEndpoints extension,
    // one call per domain.
    app.MapClassroomEndpoints();

    // ── Engagement endpoints (docs/07 §3.6, Faza 3.6) ───────────────────────
    // The leaderboard (/api/leaderboard), SRS review queue (/api/review) and in-app notifications
    // (/api/notifications) live in the Engagement module's MapEngagementEndpoints extension, one call
    // per domain. XP/streak/SRS-scheduling AWARD paths have no HTTP route (worker-driven, like Python).
    app.MapEngagementEndpoints();

    // ── Administration endpoints (docs/07 §3.7, Faza 3.7) ───────────────────
    // Admin user management (/api/admin/{stats,teachers,students}), runtime app settings
    // (/api/admin/settings/{ai,links,reveal}) and the PUBLIC links read (/api/settings/links) live in
    // the Administration module's MapAdministrationEndpoints extension, one call per domain.
    app.MapAdministrationEndpoints();

    // ── Guest endpoints (docs/07 §3.8, Faza 3.8) ────────────────────────────
    // The auth-less demo surface (GET /api/guest/demo, POST /api/guest/assess, GET /api/guest/tts)
    // lives in the Guest module's MapGuestEndpoints extension, one call per domain. These are NOT
    // .RequireAuthorization() — they ARE rate-limited (per-IP, fail-open).
    app.MapGuestEndpoints();

    // ── Real-time attempt-progress hub (docs/08 Faza 3.10) ──────────────────
    // Clients connect with their JWT and call SubscribeToAttempt(id) to stream grading progress.
    // The hub's [Authorize] enforces the bearer; per-attempt ownership is checked inside the hub.
    app.MapHub<AttemptsHub>("/hubs/attempts");

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
