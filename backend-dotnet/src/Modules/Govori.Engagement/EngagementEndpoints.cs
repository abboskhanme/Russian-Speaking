using System.Security.Claims;
using Govori.Contracts;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

namespace Govori.Engagement;

/// <summary>
/// The Engagement domain's HTTP surface (docs/07 §3.6, Faza 3.6), ported from
/// backend/app/api/v1/{engagement,notifications}.py. Follows the MODULAR-ENDPOINT PATTERN established
/// by <c>MapIdentityEndpoints</c>/<c>MapCatalogEndpoints</c>/<c>MapPracticeEndpoints</c>/
/// <c>MapClassroomEndpoints</c>: a single <c>Map*Endpoints</c> extension the composition root calls.
///
/// <para>Endpoints are thin (§7.2 — no <c>DbContext</c> here): parse the access-token <c>sub</c> →
/// <see cref="EngagementService"/> → map the domain outcome to HTTP. All role/ownership/roster
/// decisions live in the service. Error bodies use <c>{ "detail": ... }</c> to match FastAPI.</para>
///
/// <para>Path note: Python routes are <c>/api/v1/leaderboard</c>, <c>/api/v1/review</c>,
/// <c>/api/v1/notifications…</c>; the <c>/v1</c> segment is dropped to match the sibling modules'
/// <c>/api/…</c> convention (reconciled at the gateway during cutover). The XP/streak/SRS-scheduling
/// AWARD paths (gamification.py) have no HTTP route in Python either — they run in the grading worker
/// — so they stay service methods (<see cref="EngagementService.AwardSubmissionAsync"/> etc.), not
/// endpoints.</para>
/// </summary>
public static class EngagementEndpoints
{
    public static IEndpointRouteBuilder MapEngagementEndpoints(this IEndpointRouteBuilder app)
    {
        MapLeaderboard(app);
        MapReview(app);
        MapNotifications(app);
        return app;
    }

    private static void MapLeaderboard(IEndpointRouteBuilder app)
    {
        // GET /api/leaderboard — ranked board (?group_id, ?period=weekly|all). engagement.py:36-172.
        app.MapGet("/api/leaderboard", async (
            Guid? group_id, string? period, ClaimsPrincipal principal, EngagementService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(principal, out var userId)) return Results.Unauthorized();
            var r = await svc.LeaderboardAsync(userId, group_id, period, ct);
            return Map(r, StatusCodes.Status200OK, forbidden: "Not a member of this group");
        }).RequireAuthorization();
    }

    private static void MapReview(IEndpointRouteBuilder app)
    {
        var review = app.MapGroup("/api/review");

        // GET /api/review — the student's due, still-open reviews. engagement.py:176-215.
        review.MapGet("", async (ClaimsPrincipal principal, EngagementService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(principal, out var userId)) return Results.Unauthorized();
            var list = await svc.MyReviewsAsync(userId, ct);
            return list is null ? Results.Unauthorized() : Results.Ok(list);
        }).RequireAuthorization();

        // POST /api/review — teacher queues review(s) for a student/group → 201. engagement.py:218-317.
        review.MapPost("", async (CreateReviewsRequest body, ClaimsPrincipal principal, EngagementService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(principal, out var userId)) return Results.Unauthorized();
            var r = await svc.CreateReviewsAsync(userId, body, ct);
            return Map(r, StatusCodes.Status201Created, notFound: "No matching questions", forbidden: "Teacher role required");
        }).RequireAuthorization();
    }

    private static void MapNotifications(IEndpointRouteBuilder app)
    {
        var notifications = app.MapGroup("/api/notifications");

        // GET /api/notifications — newest first, capped (?unread_only, ?limit). notifications.py:15-26.
        notifications.MapGet("", async (
            bool? unread_only, int? limit, ClaimsPrincipal principal, EngagementService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(principal, out var userId)) return Results.Unauthorized();
            var list = await svc.ListNotificationsAsync(userId, unread_only ?? false, limit ?? 50, ct);
            return list is null ? Results.Unauthorized() : Results.Ok(list);
        }).RequireAuthorization();

        // GET /api/notifications/unread-count. notifications.py:29-39.
        notifications.MapGet("/unread-count", async (ClaimsPrincipal principal, EngagementService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(principal, out var userId)) return Results.Unauthorized();
            var count = await svc.UnreadCountAsync(userId, ct);
            return count is null ? Results.Unauthorized() : Results.Ok(new UnreadCountResponse(count.Value));
        }).RequireAuthorization();

        // POST /api/notifications/read-all → 204. notifications.py:42-52.
        notifications.MapPost("/read-all", async (ClaimsPrincipal principal, EngagementService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(principal, out var userId)) return Results.Unauthorized();
            var ok = await svc.MarkAllReadAsync(userId, ct);
            return ok ? Results.NoContent() : Results.Unauthorized();
        }).RequireAuthorization();

        // POST /api/notifications/{id}/read → 204. notifications.py:55-65.
        notifications.MapPost("/{id:guid}/read", async (Guid id, ClaimsPrincipal principal, EngagementService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(principal, out var userId)) return Results.Unauthorized();
            var outcome = await svc.MarkReadAsync(userId, id, ct);
            return MapNoContent(outcome, notFound: "Notification not found");
        }).RequireAuthorization();

        // DELETE /api/notifications/{id} → 204. notifications.py:68-78.
        notifications.MapDelete("/{id:guid}", async (Guid id, ClaimsPrincipal principal, EngagementService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(principal, out var userId)) return Results.Unauthorized();
            var outcome = await svc.DeleteNotificationAsync(userId, id, ct);
            return MapNoContent(outcome, notFound: "Notification not found");
        }).RequireAuthorization();

        // DELETE /api/notifications → 204 (clear all). notifications.py:81-87.
        notifications.MapDelete("", async (ClaimsPrincipal principal, EngagementService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(principal, out var userId)) return Results.Unauthorized();
            var ok = await svc.ClearAllAsync(userId, ct);
            return ok ? Results.NoContent() : Results.Unauthorized();
        }).RequireAuthorization();
    }

    // A valid *access* token carrying a parseable `sub` (a refresh token is rejected, mirroring
    // deps.py:25). role/is_active are read from the DB in the service, never trusted from the token.
    private static bool TryGetUserId(ClaimsPrincipal principal, out Guid userId)
    {
        userId = Guid.Empty;
        return principal.FindFirstValue("type") == "access"
               && Guid.TryParse(principal.FindFirstValue("sub"), out userId);
    }

    // Map a service result to HTTP. `okStatus` differs per endpoint (201 create vs 200 read).
    private static IResult Map<T>(EngagementResult<T> r, int okStatus, string? notFound = null, string? forbidden = null)
        where T : class
        => r.Outcome switch
        {
            EngagementOutcome.Ok => Results.Json(r.Value, statusCode: okStatus),
            EngagementOutcome.Unauthorized => Results.Unauthorized(),
            EngagementOutcome.Forbidden => Detail(forbidden ?? "Forbidden", StatusCodes.Status403Forbidden),
            EngagementOutcome.NotFound => Detail(notFound ?? "Not found", StatusCodes.Status404NotFound),
            EngagementOutcome.BadRequest => Detail(r.Detail ?? "Bad request", StatusCodes.Status400BadRequest),
            _ => Results.StatusCode(StatusCodes.Status500InternalServerError),
        };

    // Map a payload-less outcome (mark-read / delete) to 204 or an error body.
    private static IResult MapNoContent(EngagementOutcome outcome, string? notFound = null)
        => outcome switch
        {
            EngagementOutcome.Ok => Results.NoContent(),
            EngagementOutcome.Unauthorized => Results.Unauthorized(),
            EngagementOutcome.NotFound => Detail(notFound ?? "Not found", StatusCodes.Status404NotFound),
            _ => Results.StatusCode(StatusCodes.Status500InternalServerError),
        };

    private static IResult Detail(string message, int statusCode)
        => Results.Json(new { detail = message }, statusCode: statusCode);
}
