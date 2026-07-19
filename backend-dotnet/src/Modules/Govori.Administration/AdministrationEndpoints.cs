using System.Security.Claims;
using Govori.Contracts;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

namespace Govori.Administration;

/// <summary>
/// The Administration domain's HTTP surface (docs/07 §3.7, Faza 3.7), ported from
/// backend/app/api/v1/{admin,admin_settings,settings_public}.py. Follows the MODULAR-ENDPOINT
/// PATTERN established by the sibling modules: a single <c>Map*Endpoints</c> extension the
/// composition root calls.
///
/// <para>Endpoints are thin (§7.2): parse the access-token <c>sub</c> → gate via
/// <see cref="AdministrationService"/> (require_admin / get_current_user) → act via
/// <see cref="AdministrationService"/> or <see cref="AppSettingsService"/> → map the outcome to
/// HTTP. Error bodies use <c>{ "detail": ... }</c> to match FastAPI.</para>
///
/// <para>Path note: Python routes are <c>/api/v1/admin/…</c> and <c>/api/v1/settings/links</c>; the
/// <c>/v1</c> segment is dropped to match the sibling modules' <c>/api/…</c> convention.</para>
/// </summary>
public static class AdministrationEndpoints
{
    // admin_settings.py:30-33 — accepted provider + boolean spellings for PATCH /ai validation.
    private static readonly HashSet<string> Providers = new(StringComparer.Ordinal) { "auto", "azure", "gemini" };
    private static readonly HashSet<string> SttProviders = new(StringComparer.Ordinal) { "auto", "azure", "whisper" };
    private static readonly HashSet<string> TrueWords = new(StringComparer.Ordinal) { "true", "1", "yes", "on" };
    private static readonly HashSet<string> FalseWords = new(StringComparer.Ordinal) { "false", "0", "no", "off" };

    public static IEndpointRouteBuilder MapAdministrationEndpoints(this IEndpointRouteBuilder app)
    {
        MapUserManagement(app);
        MapSettings(app);
        return app;
    }

    // ─── Admin user management (admin.py) ────────────────────────────────────

    private static void MapUserManagement(IEndpointRouteBuilder app)
    {
        var admin = app.MapGroup("/api/admin");

        // GET /api/admin/stats — dashboard counters. admin.py:32-48.
        admin.MapGet("/stats", async (ClaimsPrincipal p, AdministrationService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(p, out var uid)) return Results.Unauthorized();
            return Map(await svc.StatsAsync(uid, ct), StatusCodes.Status200OK);
        }).RequireAuthorization();

        // GET /api/admin/teachers[?search] — teacher list. admin.py:57-70.
        admin.MapGet("/teachers", async (string? search, ClaimsPrincipal p, AdministrationService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(p, out var uid)) return Results.Unauthorized();
            return Map(await svc.ListTeachersAsync(uid, search, ct), StatusCodes.Status200OK);
        }).RequireAuthorization();

        // PATCH /api/admin/teachers/{id} — edit a teacher (full_name/is_active). admin.py:93-114.
        admin.MapPatch("/teachers/{id:guid}", async (Guid id, TeacherUpdateRequest body, ClaimsPrincipal p, AdministrationService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(p, out var uid)) return Results.Unauthorized();
            return Map(await svc.UpdateTeacherAsync(uid, id, body, ct), StatusCodes.Status200OK, notFound: "Teacher not found");
        }).RequireAuthorization();

        // DELETE /api/admin/teachers/{id} — 204. admin.py:117-127.
        admin.MapDelete("/teachers/{id:guid}", async (Guid id, ClaimsPrincipal p, AdministrationService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(p, out var uid)) return Results.Unauthorized();
            return MapNoContent(await svc.DeleteTeacherAsync(uid, id, ct), notFound: "Teacher not found");
        }).RequireAuthorization();

        // GET /api/admin/students[?search] — student list. admin.py:137-150.
        admin.MapGet("/students", async (string? search, ClaimsPrincipal p, AdministrationService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(p, out var uid)) return Results.Unauthorized();
            return Map(await svc.ListStudentsAsync(uid, search, ct), StatusCodes.Status200OK);
        }).RequireAuthorization();

        // PATCH /api/admin/students/{id} — edit a student. The freemium is_premium grant/revoke and
        // account (de)activation both flow through here. admin.py:173-196.
        admin.MapPatch("/students/{id:guid}", async (Guid id, StudentUpdateRequest body, ClaimsPrincipal p, AdministrationService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(p, out var uid)) return Results.Unauthorized();
            return Map(await svc.UpdateStudentAsync(uid, id, body, ct), StatusCodes.Status200OK, notFound: "Student not found");
        }).RequireAuthorization();

        // DELETE /api/admin/students/{id} — 204. admin.py:199-209.
        admin.MapDelete("/students/{id:guid}", async (Guid id, ClaimsPrincipal p, AdministrationService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(p, out var uid)) return Results.Unauthorized();
            return MapNoContent(await svc.DeleteStudentAsync(uid, id, ct), notFound: "Student not found");
        }).RequireAuthorization();
    }

    // ─── Runtime app settings (admin_settings.py + settings_public.py) ───────

    private static void MapSettings(IEndpointRouteBuilder app)
    {
        var settings = app.MapGroup("/api/admin/settings");

        // GET /api/admin/settings/ai — masked AI/STT config. admin_settings.py:82-84.
        settings.MapGet("/ai", async (ClaimsPrincipal p, AdministrationService admin, AppSettingsService svc, CancellationToken ct) =>
        {
            var (uid, deny) = await AdminGate(p, admin, ct);
            return deny ?? Results.Ok(await svc.GetAiSettingsAsync(ct));
        }).RequireAuthorization();

        // PATCH /api/admin/settings/ai — tri-state upsert with provider/orthoepy validation.
        // admin_settings.py:87-113.
        settings.MapPatch("/ai", async (AiSettingsUpdate body, ClaimsPrincipal p, AdministrationService admin, AppSettingsService svc, CancellationToken ct) =>
        {
            var (uid, deny) = await AdminGate(p, admin, ct);
            if (deny is not null) return deny;

            var vals = new Dictionary<string, string?>();
            Add(vals, "llm_provider", body.LlmProvider);
            Add(vals, "gemini_model", body.GeminiModel);
            Add(vals, "gemini_api_key", body.GeminiApiKey);
            Add(vals, "orthoepy_enabled", body.OrthoepyEnabled);
            Add(vals, "azure_openai_endpoint", body.AzureOpenaiEndpoint);
            Add(vals, "azure_openai_api_key", body.AzureOpenaiApiKey);
            Add(vals, "azure_openai_deployment", body.AzureOpenaiDeployment);
            Add(vals, "azure_openai_api_version", body.AzureOpenaiApiVersion);
            Add(vals, "stt_provider", body.SttProvider);
            Add(vals, "azure_speech_region", body.AzureSpeechRegion);
            Add(vals, "whisper_model", body.WhisperModel);
            Add(vals, "azure_speech_key", body.AzureSpeechKey);
            Add(vals, "openai_api_key", body.OpenaiApiKey);

            // Validation mirrors admin_settings.py:94-111 (only for fields actually present).
            if (vals.TryGetValue("llm_provider", out var lp) && lp is not null && !Providers.Contains(lp))
                return Detail($"llm_provider must be one of {string.Join(", ", Providers.Order())}", StatusCodes.Status400BadRequest);
            if (vals.TryGetValue("stt_provider", out var sp) && sp is not null && !SttProviders.Contains(sp))
                return Detail($"stt_provider must be one of {string.Join(", ", SttProviders.Order())}", StatusCodes.Status400BadRequest);
            if (vals.TryGetValue("orthoepy_enabled", out var oe) && oe is not null && oe.Length > 0)
            {
                var norm = oe.Trim().ToLowerInvariant();
                if (!TrueWords.Contains(norm) && !FalseWords.Contains(norm))
                    return Detail("orthoepy_enabled must be 'true' or 'false'", StatusCodes.Status400BadRequest);
                vals["orthoepy_enabled"] = TrueWords.Contains(norm) ? "true" : "false";
            }

            await svc.SetManyAsync(vals, ct);
            return Results.Ok(await svc.GetAiSettingsAsync(ct));
        }).RequireAuthorization();

        // GET /api/admin/settings/reveal/{key} — raw secret value, known secret keys only.
        // admin_settings.py:145-151.
        settings.MapGet("/reveal/{key}", async (string key, ClaimsPrincipal p, AdministrationService admin, AppSettingsService svc, CancellationToken ct) =>
        {
            var (uid, deny) = await AdminGate(p, admin, ct);
            if (deny is not null) return deny;
            if (!AppSettingsService.SecretKeys.Contains(key))
                return Detail("Unknown secret key", StatusCodes.Status404NotFound);
            return Results.Ok(new RevealResponse(key, await svc.GetAsync(key, ct: ct)));
        }).RequireAuthorization();

        // GET /api/admin/settings/links — resolved outbound links (admin). admin_settings.py:154-156.
        settings.MapGet("/links", async (ClaimsPrincipal p, AdministrationService admin, AppSettingsService svc, CancellationToken ct) =>
        {
            var (uid, deny) = await AdminGate(p, admin, ct);
            return deny ?? Results.Ok(await svc.ResolveLinksAsync(ct));
        }).RequireAuthorization();

        // PATCH /api/admin/settings/links — tri-state upsert of the links. admin_settings.py:159-166.
        settings.MapPatch("/links", async (LinksUpdate body, ClaimsPrincipal p, AdministrationService admin, AppSettingsService svc, CancellationToken ct) =>
        {
            var (uid, deny) = await AdminGate(p, admin, ct);
            if (deny is not null) return deny;

            var vals = new Dictionary<string, string?>();
            Add(vals, "tg_support_url", body.TgSupportUrl);
            Add(vals, "tg_channel_url", body.TgChannelUrl);
            await svc.SetManyAsync(vals, ct);
            return Results.Ok(await svc.ResolveLinksAsync(ct));
        }).RequireAuthorization();

        // GET /api/settings/links — PUBLIC (any active user) read of the links. settings_public.py:15-17.
        app.MapGet("/api/settings/links", async (ClaimsPrincipal p, AdministrationService admin, AppSettingsService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(p, out var uid)) return Results.Unauthorized();
            if (await admin.CheckActiveUserAsync(uid, ct) != AdminOutcome.Ok) return Results.Unauthorized();
            return Results.Ok(await svc.ResolveLinksAsync(ct));
        }).RequireAuthorization();
    }

    // ─── Shared plumbing ─────────────────────────────────────────────────────

    // Only include a setting when the client actually sent it (non-null). Null = "omitted" =
    // leave unchanged; "" is kept (→ SetManyAsync clears the override). This is the tri-state's
    // transport half — see AppSettingsService.SetManyAsync.
    private static void Add(Dictionary<string, string?> vals, string key, string? value)
    {
        if (value is not null) vals[key] = value;
    }

    // A valid *access* token carrying a parseable `sub` (a refresh token is rejected, deps.py:25).
    private static bool TryGetUserId(ClaimsPrincipal principal, out Guid userId)
    {
        userId = Guid.Empty;
        return principal.FindFirstValue("type") == "access"
               && Guid.TryParse(principal.FindFirstValue("sub"), out userId);
    }

    // Resolve the admin gate for the settings endpoints: 401 (bad token / inactive) or 403 (non-admin)
    // as an IResult to short-circuit, else the user id to proceed.
    private static async Task<(Guid uid, IResult? deny)> AdminGate(
        ClaimsPrincipal principal, AdministrationService admin, CancellationToken ct)
    {
        if (!TryGetUserId(principal, out var uid))
            return (Guid.Empty, Results.Unauthorized());
        return await admin.CheckAdminAsync(uid, ct) switch
        {
            AdminOutcome.Ok => (uid, null),
            AdminOutcome.Forbidden => (uid, Detail("Admin role required", StatusCodes.Status403Forbidden)),
            _ => (uid, Results.Unauthorized()),
        };
    }

    private static IResult Map<T>(AdminResult<T> r, int okStatus, string? notFound = null)
        => r.Outcome switch
        {
            AdminOutcome.Ok => Results.Json(r.Value, statusCode: okStatus),
            AdminOutcome.Unauthorized => Results.Unauthorized(),
            AdminOutcome.Forbidden => Detail("Admin role required", StatusCodes.Status403Forbidden),
            AdminOutcome.NotFound => Detail(notFound ?? "Not found", StatusCodes.Status404NotFound),
            _ => Results.StatusCode(StatusCodes.Status500InternalServerError),
        };

    private static IResult MapNoContent(AdminResult<Unit> r, string? notFound = null)
        => r.Outcome switch
        {
            AdminOutcome.Ok => Results.NoContent(),
            AdminOutcome.Unauthorized => Results.Unauthorized(),
            AdminOutcome.Forbidden => Detail("Admin role required", StatusCodes.Status403Forbidden),
            AdminOutcome.NotFound => Detail(notFound ?? "Not found", StatusCodes.Status404NotFound),
            _ => Results.StatusCode(StatusCodes.Status500InternalServerError),
        };

    private static IResult Detail(string message, int statusCode)
        => Results.Json(new { detail = message }, statusCode: statusCode);
}
