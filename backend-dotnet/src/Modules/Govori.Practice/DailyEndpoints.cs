using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

namespace Govori.Practice;

/// <summary>
/// The HTTP surface for F3 · «Kunlik 5 daqiqa» (docs/08 Faza 6.3) — one route, the same
/// modular-endpoint pattern as <see cref="PracticeEndpoints"/>: thin here, every decision in
/// <see cref="DailyService"/>.
///
/// <para>Mounted from <c>MapPracticeEndpoints</c> rather than the composition root, for the reason
/// <see cref="RoleplayEndpoints"/> already gives: where a module's routes live is the module's own
/// business, and a second <c>Map…</c> call in <c>Program.cs</c> would move a decision about
/// Practice's internals into a file that should only know Practice exists.</para>
///
/// <para><b>There is no write route, and that is the design.</b> The session POINTS at surfaces
/// that already exist — <c>/task</c> for the speaking step, the drill for the correction step — so
/// answering, grading, XP and the streak all keep happening exactly where they happen today, under
/// the rate limits and the freemium gate they already carry. F3 adds no new way to spend money and
/// no second XP path (docs/08 §6.3: the task inside the session already awards; the session itself
/// awards nothing, and "done" is a state, not a prize).</para>
/// </summary>
public static class DailyEndpoints
{
    public static IEndpointRouteBuilder MapDailyEndpoints(this IEndpointRouteBuilder app)
    {
        // GET /api/daily?tz_offset=300 — today's session for the caller.
        //
        // 404 while the `daily_five_enabled` flag is off. Same contract as `/api/review/drill`: a
        // flagged-off feature has NO surface rather than an empty one, and the client reads that 404
        // as "not shipped here" and hides its entry point. An empty 200 would instead put a dead
        // card on Home in every deployment that has not turned the feature on.
        //
        // `tz_offset` is minutes to ADD to UTC to reach the student's local time. It decides which
        // DAY's session this is — the student's day, not the server's — so evening practice in
        // Tashkent is not cut in half by UTC midnight. It is clamped, never rejected: a bad value
        // costs the caller the server's day, which is not worth an error screen. When it is ABSENT
        // the day is the product day (ProductDay — Tashkent local midnight), never UTC.
        app.MapGet("/api/daily", async (
            int? tz_offset, ClaimsPrincipal principal, DailyService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(principal, out var userId))
                return Results.Unauthorized();

            // One null covers "flag off" and "no such active user", so the service is asked once and
            // the two are told apart by re-reading the flag — cheap (one indexed row), and it keeps
            // the service's return type from growing an outcome enum for a single route.
            var session = await svc.SessionAsync(userId, tz_offset, ct);
            if (session is not null) return Results.Ok(session);

            return await svc.EnabledAsync(ct)
                ? Results.Unauthorized()
                : Results.Json(new { detail = "Daily session is not enabled" }, statusCode: StatusCodes.Status404NotFound);
        }).RequireAuthorization();

        return app;
    }

    // A valid *access* token carrying a parseable `sub`; a refresh token presented here is rejected.
    // is_active is re-read from the DB in the service, never trusted from the token.
    private static bool TryGetUserId(ClaimsPrincipal principal, out Guid userId)
    {
        userId = Guid.Empty;
        return principal.FindFirstValue("type") == "access"
               && Guid.TryParse(principal.FindFirstValue("sub"), out userId);
    }
}
