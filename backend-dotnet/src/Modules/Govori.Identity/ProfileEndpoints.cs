using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

namespace Govori.Identity;

/// <summary>
/// The Profile slice's HTTP surface — the read-only numbers behind the redesigned profile screen.
/// Follows the MODULAR-ENDPOINT PATTERN established by <c>MapIdentityEndpoints</c> /
/// <c>MapCatalogEndpoints</c> / <c>MapClassroomEndpoints</c> / <c>MapEngagementEndpoints</c>: a
/// single <c>Map*Endpoints</c> extension the composition root calls.
///
/// <para>Endpoints are thin (§7.2 — no <c>DbContext</c> here): parse the access-token <c>sub</c> →
/// <see cref="ProfileService"/> → map the outcome to HTTP. Every route is
/// <c>.RequireAuthorization()</c> and reports on the CALLING user only — none of them takes a user
/// id, by design, so there is no parameter a student could use to read someone else's numbers.</para>
///
/// <para>Routes (no <c>/v1</c> segment, matching the sibling modules' <c>/api/…</c> convention):
/// <c>GET /api/profile/stats</c>, <c>GET /api/profile/results?limit=1..50</c>,
/// <c>GET /api/profile/achievements</c>. These are NEW surface with no prior equivalent, so the
/// shared profile contract in <c>Govori.Contracts</c> is the spec.</para>
/// </summary>
public static class ProfileEndpoints
{
    public static IEndpointRouteBuilder MapProfileEndpoints(this IEndpointRouteBuilder app)
    {
        var profile = app.MapGroup("/api/profile");

        // GET /api/profile/stats — attempts / avg_band / streaks / total_practice_sec + derived level.
        profile.MapGet("/stats", async (ClaimsPrincipal principal, ProfileService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(principal, out var userId)) return Results.Unauthorized();
            var stats = await svc.StatsAsync(userId, ct);
            return stats is null ? Results.Unauthorized() : Results.Ok(stats);
        }).RequireAuthorization();

        // GET /api/profile/results?limit=1..50 (default 10) — most recent GRADED attempts, newest
        // first, each carrying its trend vs the next-older attempt. `limit` is clamped in the
        // service, so an out-of-range or absent value is normalised rather than rejected.
        profile.MapGet("/results", async (
            int? limit, ClaimsPrincipal principal, ProfileService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(principal, out var userId)) return Results.Unauthorized();
            var results = await svc.ResultsAsync(userId, limit, ct);
            return results is null ? Results.Unauthorized() : Results.Ok(results);
        }).RequireAuthorization();

        // GET /api/profile/achievements — the fixed three-badge catalogue against the user's numbers.
        profile.MapGet("/achievements", async (ClaimsPrincipal principal, ProfileService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(principal, out var userId)) return Results.Unauthorized();
            var achievements = await svc.AchievementsAsync(userId, ct);
            return achievements is null ? Results.Unauthorized() : Results.Ok(achievements);
        }).RequireAuthorization();

        return app;
    }

    // Requires a valid *access* token carrying a parseable `sub`; a refresh token is rejected here,
    // as it may only be exchanged at the refresh endpoint. is_active is re-read from the DB in the
    // service, never trusted from the token.
    private static bool TryGetUserId(ClaimsPrincipal principal, out Guid userId)
    {
        userId = Guid.Empty;
        return principal.FindFirstValue("type") == "access"
               && Guid.TryParse(principal.FindFirstValue("sub"), out userId);
    }
}
