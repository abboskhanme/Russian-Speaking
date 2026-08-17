using System.Security.Claims;
using Govori.Contracts;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

namespace Govori.Engagement;

/// <summary>
/// The Engagement domain's HTTP surface (docs/07 §3.6, Faza 3.6) — the leaderboard, the spaced-
/// repetition review queue (plus its flagged F5 replay drill) and in-app notifications. Follows the
/// MODULAR-ENDPOINT PATTERN established
/// by <c>MapIdentityEndpoints</c>/<c>MapCatalogEndpoints</c>/<c>MapPracticeEndpoints</c>/
/// <c>MapClassroomEndpoints</c>: a single <c>Map*Endpoints</c> extension the composition root calls.
///
/// <para>Endpoints are thin (§7.2 — no <c>DbContext</c> here): parse the access-token <c>sub</c> →
/// <see cref="EngagementService"/> → map the domain outcome to HTTP. All role/ownership/roster
/// decisions live in the service. Error bodies use the <c>{ "detail": ... }</c> shape used across the
/// API.</para>
///
/// <para>Path note: these routes are <c>/api/leaderboard</c>, <c>/api/review</c> and
/// <c>/api/notifications…</c> — no <c>/v1</c> segment, matching the sibling modules'
/// <c>/api/…</c> convention (reconciled at the gateway during cutover). The XP/streak/SRS-scheduling
/// AWARD paths have no HTTP route at all — they run in the grading worker — so they stay service
/// methods (<see cref="EngagementService.AwardSubmissionAsync"/> etc.), not endpoints.</para>
/// </summary>
public static class EngagementEndpoints
{
    public static IEndpointRouteBuilder MapEngagementEndpoints(this IEndpointRouteBuilder app)
    {
        MapLeaderboard(app);
        MapProgress(app);
        MapReview(app);
        MapNotifications(app);
        return app;
    }

    private static void MapProgress(IEndpointRouteBuilder app)
    {
        var progress = app.MapGroup("/api/progress");

        // GET /api/progress/skills — the caller's own skill breakdown + derived level + band trend.
        progress.MapGet("/skills", async (ClaimsPrincipal principal, EngagementService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(principal, out var userId)) return Results.Unauthorized();
            var r = await svc.SkillsAsync(userId, ct);
            return r is null ? Results.Unauthorized() : Results.Ok(r);
        }).RequireAuthorization();

        // GET /api/progress/leaderboard?period=weekly|monthly|all — the caller's ranking summary.
        progress.MapGet("/leaderboard", async (
            string? period, ClaimsPrincipal principal, EngagementService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(principal, out var userId)) return Results.Unauthorized();
            var r = await svc.LeaderboardSummaryAsync(userId, period, ct);
            return Map(r, StatusCodes.Status200OK, forbidden: "Leaderboard is for students");
        }).RequireAuthorization();
    }

    private static void MapLeaderboard(IEndpointRouteBuilder app)
    {
        // GET /api/leaderboard — ranked board (?group_id, ?period=weekly|all).
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

        // GET /api/review — the student's due, still-open reviews.
        review.MapGet("", async (ClaimsPrincipal principal, EngagementService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(principal, out var userId)) return Results.Unauthorized();
            var list = await svc.MyReviewsAsync(userId, ct);
            return list is null ? Results.Unauthorized() : Results.Ok(list);
        }).RequireAuthorization();

        // POST /api/review — teacher queues review(s) for a student/group → 201.
        review.MapPost("", async (CreateReviewsRequest body, ClaimsPrincipal principal, EngagementService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(principal, out var userId)) return Results.Unauthorized();
            var r = await svc.CreateReviewsAsync(userId, body, ct);
            return Map(r, StatusCodes.Status201Created, notFound: "No matching questions", forbidden: "Teacher role required");
        }).RequireAuthorization();

        // GET /api/review/drill — one xato-replay session (docs/08 Faza 6.1). 404 while the
        // `review_drill_enabled` flag is off: the two write/read routes below are the whole feature,
        // and a flagged-off feature has no surface rather than an empty one. The client reads that
        // 404 as "not shipped here" and hides its entry point.
        review.MapGet("/drill", async (ClaimsPrincipal principal, EngagementService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(principal, out var userId)) return Results.Unauthorized();
            var r = await svc.DrillAsync(userId, ct);
            return Map(r, StatusCodes.Status200OK, notFound: "Review drill is not enabled");
        }).RequireAuthorization();

        // POST /api/review/{id}/answer — the student's verdict on one replay ("good" | "again"),
        // which moves the item along the SRS ladder → 200 with its new state.
        review.MapPost("/{id:guid}/answer", async (
            Guid id, ReviewAnswerRequest body, ClaimsPrincipal principal, EngagementService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(principal, out var userId)) return Results.Unauthorized();
            var r = await svc.AnswerReviewAsync(userId, id, body, ct);
            return Map(r, StatusCodes.Status200OK, notFound: "Review item not found");
        }).RequireAuthorization();
    }

    private static void MapNotifications(IEndpointRouteBuilder app)
    {
        var notifications = app.MapGroup("/api/notifications");

        // GET /api/notifications — newest first, capped (?unread_only, ?limit).
        notifications.MapGet("", async (
            bool? unread_only, int? limit, ClaimsPrincipal principal, EngagementService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(principal, out var userId)) return Results.Unauthorized();
            var list = await svc.ListNotificationsAsync(userId, unread_only ?? false, limit ?? 50, ct);
            return list is null ? Results.Unauthorized() : Results.Ok(list);
        }).RequireAuthorization();

        // GET /api/notifications/unread-count — how many of the user's notifications are unread.
        notifications.MapGet("/unread-count", async (ClaimsPrincipal principal, EngagementService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(principal, out var userId)) return Results.Unauthorized();
            var count = await svc.UnreadCountAsync(userId, ct);
            return count is null ? Results.Unauthorized() : Results.Ok(new UnreadCountResponse(count.Value));
        }).RequireAuthorization();

        // POST /api/notifications/read-all → 204.
        notifications.MapPost("/read-all", async (ClaimsPrincipal principal, EngagementService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(principal, out var userId)) return Results.Unauthorized();
            var ok = await svc.MarkAllReadAsync(userId, ct);
            return ok ? Results.NoContent() : Results.Unauthorized();
        }).RequireAuthorization();

        // POST /api/notifications/{id}/read → 204.
        notifications.MapPost("/{id:guid}/read", async (Guid id, ClaimsPrincipal principal, EngagementService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(principal, out var userId)) return Results.Unauthorized();
            var outcome = await svc.MarkReadAsync(userId, id, ct);
            return MapNoContent(outcome, notFound: "Notification not found");
        }).RequireAuthorization();

        // DELETE /api/notifications/{id} → 204.
        notifications.MapDelete("/{id:guid}", async (Guid id, ClaimsPrincipal principal, EngagementService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(principal, out var userId)) return Results.Unauthorized();
            var outcome = await svc.DeleteNotificationAsync(userId, id, ct);
            return MapNoContent(outcome, notFound: "Notification not found");
        }).RequireAuthorization();

        // DELETE /api/notifications → 204 (clear all).
        notifications.MapDelete("", async (ClaimsPrincipal principal, EngagementService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(principal, out var userId)) return Results.Unauthorized();
            var ok = await svc.ClearAllAsync(userId, ct);
            return ok ? Results.NoContent() : Results.Unauthorized();
        }).RequireAuthorization();
    }

    // A valid *access* token carrying a parseable `sub`; a refresh token is deliberately rejected
    // here. role/is_active are read from the DB in the service, never trusted from the token.
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
