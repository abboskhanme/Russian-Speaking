using System.Globalization;
using System.Security.Claims;
using Govori.Contracts;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.Routing;

namespace Govori.Drills;

/// <summary>
/// The HTTP surface for F2 · Fonema drill (docs/01) — thin routes, every decision in
/// <see cref="DrillService"/>, the same modular-endpoint pattern the other domains use.
///
/// <para><b>Availability is a 200, not a status code.</b> The flag being off, no STT key and a spent
/// daily budget all come back as a <see cref="DrillState"/> on a normal body, because the screen has
/// to say something true about each. Only a pair that does not exist is a 404, only a malformed
/// request is a 400, and a missing or DEACTIVATED account is a 401 — checked against the database
/// before the flag or a vendor, so suspending an account stops its spend at once.</para>
/// </summary>
public static class DrillEndpoints
{
    public static IEndpointRouteBuilder MapDrillEndpoints(this IEndpointRouteBuilder app)
    {
        var drills = app.MapGroup("/api/drills");

        // GET /api/drills/pairs — the hub grid + whether speaking is possible right now.
        drills.MapGet("/pairs", async (
            ClaimsPrincipal principal, DrillService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(principal, out var userId))
                return Results.Unauthorized();
            var (status, body) = await svc.CatalogAsync(userId, ct);
            return status == DrillStatus.Unauthorized ? Results.Unauthorized() : Results.Ok(body);
        }).RequireAuthorization();

        // POST /api/drills/attempts — one spoken word (multipart: audio, pair_slug, target_word).
        //
        // Rate-limited because this route SPENDS MONEY: one attempt is one Azure call, and two on a
        // miss. The daily budget in DrillService is the product ceiling; this is the abuse ceiling,
        // and they are deliberately separate — a per-user daily count cannot stop a burst, and a
        // rate limit cannot express "forty a day".
        //
        // The form is read manually, like the submit and roleplay routes, to sidestep the antiforgery
        // middleware that form-binding minimal APIs otherwise require.
        drills.MapPost("/attempts", async (
            HttpRequest request, ClaimsPrincipal principal, DrillService svc, CancellationToken ct) =>
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
            var (status, body) = await svc.AttemptAsync(
                userId, form["pair_slug"], form["target_word"], stream, file.FileName, duration, ct);

            return status switch
            {
                DrillStatus.Unauthorized => Results.Unauthorized(),
                DrillStatus.NotFound => Detail("Pair not found", StatusCodes.Status404NotFound),
                DrillStatus.BadRequest => Detail(
                    "pair_slug and a target_word from that pair are required, and the recording must "
                    + "be non-empty and under the size limit.",
                    StatusCodes.Status400BadRequest),
                _ => Results.Ok(body),
            };
        })
        .RequireAuthorization()
        .DisableAntiforgery()
        .RequireRateLimiting(RateLimitPolicyNames.DrillAttempt);

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
