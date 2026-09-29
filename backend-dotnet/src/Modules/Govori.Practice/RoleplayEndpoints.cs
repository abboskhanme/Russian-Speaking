using System.Globalization;
using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

namespace Govori.Practice;

/// <summary>
/// The HTTP surface for F1 · Roleplay / AI Suhbat (docs/08 Faza 6.5) — the same modular-endpoint
/// pattern as <see cref="PracticeEndpoints"/>: thin routes, every decision in
/// <see cref="RoleplayService"/>.
///
/// <para>It is mounted from <c>MapPracticeEndpoints</c> rather than from the composition root. The
/// roleplay routes belong to the Practice module and have no independent lifecycle; adding a second
/// <c>Map…</c> call to <c>Program.cs</c> for them would put a decision about this module's internals
/// in a file that should only know that Practice exists.</para>
///
/// <para><b>Availability is a 200, not a status code.</b> The flag being off, no AI key being wired,
/// a spent daily budget and a closed conversation all come back as a <c>state</c> on a normal body —
/// see <c>RoleplayState</c>. Only a conversation that is missing (or someone else's) is a 404, only
/// a malformed request is a 400, and a missing or DEACTIVATED account is a 401 on every route —
/// checked against the database before anything else, so a suspended account stops spending on
/// the vendors immediately rather than when its token expires.</para>
/// </summary>
public static class RoleplayEndpoints
{
    public static IEndpointRouteBuilder MapRoleplayEndpoints(this IEndpointRouteBuilder app)
    {
        var roleplay = app.MapGroup("/api/roleplay");

        // GET /api/roleplay/scenarios — the hub grid + whether speaking is possible right now.
        roleplay.MapGet("/scenarios", async (
            ClaimsPrincipal principal, RoleplayService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(principal, out var userId))
                return Results.Unauthorized();
            var (status, response) = await svc.CatalogAsync(userId, ct);
            return status == RoleplayStatus.Unauthorized ? Results.Unauthorized() : Results.Ok(response);
        }).RequireAuthorization();

        // POST /api/roleplay/conversations { scenario_slug } — open one conversation.
        // → 200 (ready, or a blocked state), 404 (no such scenario), 400 (no slug).
        roleplay.MapPost("/conversations", async (
            Govori.Contracts.RoleplayStartRequest body, ClaimsPrincipal principal,
            RoleplayService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(principal, out var userId))
                return Results.Unauthorized();
            var (status, response) = await svc.StartAsync(userId, body?.ScenarioSlug, ct);
            return status switch
            {
                RoleplayStatus.Unauthorized => Results.Unauthorized(),
                RoleplayStatus.NotFound => Detail("Scenario not found", StatusCodes.Status404NotFound),
                RoleplayStatus.BadRequest => Detail("scenario_slug is required", StatusCodes.Status400BadRequest),
                _ => Results.Ok(response),
            };
        }).RequireAuthorization();

        // POST /api/roleplay/conversations/{id}/turns — one spoken turn
        // (multipart/form-data: audio file, optional audio_duration_sec).
        // The form is read manually, like the submit endpoint, to sidestep the antiforgery
        // middleware that form-binding minimal APIs otherwise require.
        roleplay.MapPost("/conversations/{id:guid}/turns", async (
            Guid id, HttpRequest request, ClaimsPrincipal principal,
            RoleplayService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(principal, out var userId))
                return Results.Unauthorized();
            if (!request.HasFormContentType)
                return Detail("Expected multipart/form-data", StatusCodes.Status400BadRequest);

            var form = await request.ReadFormAsync(ct);
            var file = form.Files["audio"] ?? (form.Files.Count > 0 ? form.Files[0] : null);
            if (file is null || file.Length == 0)
                return Detail("audio file is required", StatusCodes.Status400BadRequest);

            double? duration = double.TryParse(
                form["audio_duration_sec"], NumberStyles.Float, CultureInfo.InvariantCulture, out var d)
                ? d : null;

            await using var stream = file.OpenReadStream();
            var (status, response) = await svc.TurnAsync(userId, id, stream, file.FileName, duration, ct);
            return status switch
            {
                RoleplayStatus.Unauthorized => Results.Unauthorized(),
                RoleplayStatus.NotFound => Detail("Conversation not found", StatusCodes.Status404NotFound),
                RoleplayStatus.BadRequest => Detail(
                    "The recording is empty or too large.", StatusCodes.Status400BadRequest),
                _ => Results.Ok(response),
            };
        }).RequireAuthorization().DisableAntiforgery();

        // POST /api/roleplay/conversations/{id}/end — close it and return the wrap-up. Idempotent,
        // so a double-tapped "Tugatish" and a reloaded summary agree.
        roleplay.MapPost("/conversations/{id:guid}/end", async (
            Guid id, ClaimsPrincipal principal, RoleplayService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(principal, out var userId))
                return Results.Unauthorized();
            var (status, response) = await svc.EndAsync(userId, id, ct);
            return status switch
            {
                RoleplayStatus.Unauthorized => Results.Unauthorized(),
                RoleplayStatus.NotFound => Detail("Conversation not found", StatusCodes.Status404NotFound),
                _ => Results.Ok(response),
            };
        }).RequireAuthorization();

        return app;
    }

    // A valid *access* token carrying a parseable `sub`; a refresh token presented here is rejected.
    private static bool TryGetUserId(ClaimsPrincipal principal, out Guid userId)
    {
        userId = Guid.Empty;
        return principal.FindFirstValue("type") == "access"
               && Guid.TryParse(principal.FindFirstValue("sub"), out userId);
    }

    private static IResult Detail(string message, int statusCode)
        => Results.Json(new { detail = message }, statusCode: statusCode);
}
