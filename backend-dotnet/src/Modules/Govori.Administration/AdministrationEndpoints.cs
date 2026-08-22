using System.Security.Claims;
using Govori.Contracts;
using Govori.Platform.Ai;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

namespace Govori.Administration;

/// <summary>
/// The Administration domain's HTTP surface (docs/07 §3.7, Faza 3.7). Covers three groups of
/// routes: admin user management, the runtime AI/STT settings editor, and the public read of the
/// outbound contact links. Follows the MODULAR-ENDPOINT PATTERN established by the sibling modules:
/// a single <c>Map*Endpoints</c> extension the composition root calls.
///
/// <para>Endpoints are thin (§7.2): parse the access-token <c>sub</c> → gate via
/// <see cref="AdministrationService"/> (admin-only, or any active user) → act via
/// <see cref="AdministrationService"/> or <see cref="AppSettingsService"/> → map the outcome to
/// HTTP. Error bodies use the <c>{ "detail": ... }</c> shape used across the API.</para>
///
/// <para>Routes live under <c>/api/admin/…</c> and <c>/api/settings/links</c> — unversioned, matching
/// the sibling modules' <c>/api/…</c> convention.</para>
/// </summary>
public static class AdministrationEndpoints
{
    // Accepted provider names and boolean spellings for PATCH /ai validation.
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

    // ─── Admin user management ───────────────────────────────────────────────

    private static void MapUserManagement(IEndpointRouteBuilder app)
    {
        var admin = app.MapGroup("/api/admin");

        // GET /api/admin/stats — dashboard counters.
        admin.MapGet("/stats", async (ClaimsPrincipal p, AdministrationService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(p, out var uid)) return Results.Unauthorized();
            return Map(await svc.StatsAsync(uid, ct), StatusCodes.Status200OK);
        }).RequireAuthorization();

        // GET /api/admin/teachers[?search] — teacher list, each with its question count.
        admin.MapGet("/teachers", async (string? search, ClaimsPrincipal p, AdministrationService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(p, out var uid)) return Results.Unauthorized();
            return Map(await svc.ListTeachersAsync(uid, search, ct), StatusCodes.Status200OK);
        }).RequireAuthorization();

        // PATCH /api/admin/teachers/{id} — edit a teacher (full_name/is_active).
        admin.MapPatch("/teachers/{id:guid}", async (Guid id, TeacherUpdateRequest body, ClaimsPrincipal p, AdministrationService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(p, out var uid)) return Results.Unauthorized();
            return Map(await svc.UpdateTeacherAsync(uid, id, body, ct), StatusCodes.Status200OK, notFound: "Teacher not found");
        }).RequireAuthorization();

        // DELETE /api/admin/teachers/{id} — 204 on success, no body.
        admin.MapDelete("/teachers/{id:guid}", async (Guid id, ClaimsPrincipal p, AdministrationService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(p, out var uid)) return Results.Unauthorized();
            return MapNoContent(await svc.DeleteTeacherAsync(uid, id, ct), notFound: "Teacher not found");
        }).RequireAuthorization();

        // GET /api/admin/students[?search] — student list, each with its submission count.
        admin.MapGet("/students", async (string? search, ClaimsPrincipal p, AdministrationService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(p, out var uid)) return Results.Unauthorized();
            return Map(await svc.ListStudentsAsync(uid, search, ct), StatusCodes.Status200OK);
        }).RequireAuthorization();

        // PATCH /api/admin/students/{id} — edit a student. The freemium is_premium grant/revoke and
        // account (de)activation both flow through here.
        admin.MapPatch("/students/{id:guid}", async (Guid id, StudentUpdateRequest body, ClaimsPrincipal p, AdministrationService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(p, out var uid)) return Results.Unauthorized();
            return Map(await svc.UpdateStudentAsync(uid, id, body, ct), StatusCodes.Status200OK, notFound: "Student not found");
        }).RequireAuthorization();

        // DELETE /api/admin/students/{id} — 204 on success, no body.
        admin.MapDelete("/students/{id:guid}", async (Guid id, ClaimsPrincipal p, AdministrationService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(p, out var uid)) return Results.Unauthorized();
            return MapNoContent(await svc.DeleteStudentAsync(uid, id, ct), notFound: "Student not found");
        }).RequireAuthorization();
    }

    // ─── Runtime app settings (admin editor + public links read) ─────────────

    private static void MapSettings(IEndpointRouteBuilder app)
    {
        var settings = app.MapGroup("/api/admin/settings");

        // GET /api/admin/settings/ai — AI/STT config; secrets come back masked, never in full.
        settings.MapGet("/ai", async (ClaimsPrincipal p, AdministrationService admin, AppSettingsService svc, CancellationToken ct) =>
        {
            var (uid, deny) = await AdminGate(p, admin, ct);
            return deny ?? Results.Ok(await svc.GetAiSettingsAsync(ct));
        }).RequireAuthorization();

        // PATCH /api/admin/settings/ai — tri-state upsert with provider/orthoepy validation.
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
            Add(vals, "openai_grader_model", body.OpenaiGraderModel);
            Add(vals, "azure_speech_key", body.AzureSpeechKey);
            Add(vals, "openai_api_key", body.OpenaiApiKey);
            // Provider chain + Claude (Faza 3.4). The chains are wire values an admin has edited,
            // so they are stored verbatim after normalisation and validated below.
            Add(vals, "grader_chain", body.GraderChain);
            Add(vals, "stt_chain", body.SttChain);
            Add(vals, "anthropic_api_key", body.AnthropicApiKey);
            Add(vals, "anthropic_model", body.AnthropicModel);

            // Validate only the fields the client actually sent — an omitted field is not an error.
            // A chain is normalised through the same parser the runtime uses, so what the admin
            // sees stored is exactly the order that will run — no drift between the two.
            foreach (var (key, known) in new[]
                     {
                         ("grader_chain", AiProviders.DefaultGraderChain),
                         ("stt_chain", AiProviders.DefaultSttChain),
                     })
            {
                if (!vals.TryGetValue(key, out var raw) || raw is null || raw.Length == 0)
                    continue;   // "" clears the override back to the default chain — legal.

                var parsed = AiProviders.ParseChain(raw, Array.Empty<string>());
                var unknown = parsed.Where(n => !known.Contains(n)).ToArray();
                if (unknown.Length > 0)
                    return Detail(
                        $"{key} names no such backend: {string.Join(", ", unknown)}. " +
                        $"Known: {string.Join(", ", known)}",
                        StatusCodes.Status400BadRequest);

                vals[key] = string.Join(',', parsed);
            }

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

        // POST /api/admin/settings/ai/test — probe every backend with one real call each.
        //
        // POST, not GET: it has side effects at the vendor (a billed request) and must never be
        // fired by a link preview, a retry, or a browser prefetch.
        //
        // RATE LIMIT admin_probe (10/hour, per user, FAIL-OPEN). One press makes a REAL call to
        // every configured backend, so it is billed at up to five vendors per press. Admin-only, so
        // this is not about abuse — it is about a double-clicked button, a retried request, or a
        // settings screen left reloading turning a key check into a bill.
        settings.MapPost("/ai/test", async (ClaimsPrincipal p, AdministrationService admin, AiProbeService probe, CancellationToken ct) =>
        {
            var (uid, deny) = await AdminGate(p, admin, ct);
            return deny ?? Results.Ok(await probe.RunAsync(ct));
        }).RequireAuthorization().RequireRateLimiting(RateLimitPolicyNames.AdminProbe);

        // GET /api/admin/settings/features — the Faza 6 switches (docs/08 Faza 6).
        settings.MapGet("/features", async (ClaimsPrincipal p, AdministrationService admin, AppSettingsService svc, CancellationToken ct) =>
        {
            var (uid, deny) = await AdminGate(p, admin, ct);
            return deny ?? Results.Ok(await svc.GetFeatureFlagsAsync(ct));
        }).RequireAuthorization();

        // PATCH /api/admin/settings/features — same tri-state upsert as the AI settings.
        //
        // A separate route rather than more fields on /ai: these decide whether a SURFACE exists,
        // not how the AI behaves, and a feature switch buried in a screen called "AI sozlamalari"
        // is a switch nobody finds.
        settings.MapPatch("/features", async (FeatureFlagsUpdate body, ClaimsPrincipal p, AdministrationService admin, AppSettingsService svc, CancellationToken ct) =>
        {
            var (uid, deny) = await AdminGate(p, admin, ct);
            if (deny is not null) return deny;

            var vals = new Dictionary<string, string?>();
            Add(vals, "review_drill_enabled", body.ReviewDrillEnabled);
            Add(vals, "roleplay_enabled", body.RoleplayEnabled);
            Add(vals, "roleplay_max_turns", body.RoleplayMaxTurns);
            Add(vals, "roleplay_daily_turns", body.RoleplayDailyTurns);

            foreach (var key in new[] { "review_drill_enabled", "roleplay_enabled" })
            {
                if (!vals.TryGetValue(key, out var v) || v is null || v.Length == 0)
                    continue;                       // "" clears the override — legal, not a value
                var norm = v.Trim().ToLowerInvariant();
                if (!TrueWords.Contains(norm) && !FalseWords.Contains(norm))
                    return Detail($"{key} must be 'true' or 'false'", StatusCodes.Status400BadRequest);
                vals[key] = TrueWords.Contains(norm) ? "true" : "false";
            }

            // Bounds are validated HERE as well as clamped on read. Clamping alone would accept
            // `roleplay_daily_turns = 100000`, store it, and then silently show 500 back — an admin
            // would reasonably conclude the field is broken rather than that they exceeded a limit.
            foreach (var (key, min, max) in new[] { ("roleplay_max_turns", 1, 20), ("roleplay_daily_turns", 1, 500) })
            {
                if (!vals.TryGetValue(key, out var v) || v is null || v.Length == 0)
                    continue;
                if (!int.TryParse(v.Trim(), out var n) || n < min || n > max)
                    return Detail($"{key} must be a whole number between {min} and {max}", StatusCodes.Status400BadRequest);
                vals[key] = n.ToString();
            }

            await svc.SetManyAsync(vals, ct);
            return Results.Ok(await svc.GetFeatureFlagsAsync(ct));
        }).RequireAuthorization();

        // GET /api/admin/settings/reveal/{key} — the raw secret value, for the admin's "show" button.
        // Restricted to the known secret keys so this can't be used to dump arbitrary settings.
        settings.MapGet("/reveal/{key}", async (string key, ClaimsPrincipal p, AdministrationService admin, AppSettingsService svc, CancellationToken ct) =>
        {
            var (uid, deny) = await AdminGate(p, admin, ct);
            if (deny is not null) return deny;
            if (!AppSettingsService.SecretKeys.Contains(key))
                return Detail("Unknown secret key", StatusCodes.Status404NotFound);
            return Results.Ok(new RevealResponse(key, await svc.GetAsync(key, ct: ct)));
        }).RequireAuthorization();

        // GET /api/admin/settings/links — resolved outbound links (admin view).
        settings.MapGet("/links", async (ClaimsPrincipal p, AdministrationService admin, AppSettingsService svc, CancellationToken ct) =>
        {
            var (uid, deny) = await AdminGate(p, admin, ct);
            return deny ?? Results.Ok(await svc.ResolveLinksAsync(ct));
        }).RequireAuthorization();

        // PATCH /api/admin/settings/links — tri-state upsert of the links.
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

        // GET /api/settings/links — PUBLIC read of the links: any active user, no admin role needed.
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

    // Requires a valid *access* token carrying a parseable `sub`. A refresh token is rejected here:
    // it may only be exchanged at the refresh endpoint, never used to call a protected route.
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
