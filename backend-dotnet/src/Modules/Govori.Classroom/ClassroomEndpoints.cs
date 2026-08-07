using System.Security.Claims;
using Govori.Contracts;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

namespace Govori.Classroom;

/// <summary>
/// The Classroom domain's HTTP surface (docs/07 §3.5, Faza 3.5) — teacher groups, assignments and
/// the gradebook. Follows the MODULAR-ENDPOINT PATTERN
/// established by <c>MapIdentityEndpoints</c>/<c>MapCatalogEndpoints</c>/<c>MapPracticeEndpoints</c>:
/// a single <c>Map*Endpoints</c> extension the composition root calls.
///
/// <para>Endpoints are thin (§7.2 — no <c>DbContext</c> here): parse the access-token <c>sub</c> →
/// <see cref="ClassroomService"/> → map the domain outcome to HTTP. All role/ownership/roster
/// decisions live in the service. Error bodies use the <c>{ "detail": ... }</c> shape used across the
/// API.</para>
///
/// <para>Path note: these routes are <c>/api/groups</c>, <c>/api/assignments</c> and
/// <c>/api/reports/gradebook</c> — no <c>/v1</c> segment, matching the sibling modules'
/// <c>/api/…</c> convention (reconciled at the gateway during cutover).</para>
/// </summary>
public static class ClassroomEndpoints
{
    public static IEndpointRouteBuilder MapClassroomEndpoints(this IEndpointRouteBuilder app)
    {
        MapGroups(app);
        MapAssignments(app);
        MapReports(app);
        return app;
    }

    private static void MapGroups(IEndpointRouteBuilder app)
    {
        var groups = app.MapGroup("/api/groups");

        // POST /api/groups — teacher creates a group (+ join code) → 201.
        groups.MapPost("", async (CreateGroupRequest body, ClaimsPrincipal principal, ClassroomService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(principal, out var userId)) return Results.Unauthorized();
            var r = await svc.CreateGroupAsync(userId, body, ct);
            return Map(r, StatusCodes.Status201Created, forbidden: "Teacher role required");
        }).RequireAuthorization();

        // GET /api/groups/mine — the current user's joined groups. MUST precede the /{id:guid}
        // route so "mine" is never captured as an id (it also fails the guid constraint).
        groups.MapGet("/mine", async (ClaimsPrincipal principal, ClassroomService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(principal, out var userId)) return Results.Unauthorized();
            var list = await svc.MyGroupsAsync(userId, ct);
            return list is null ? Results.Unauthorized() : Results.Ok(list);
        }).RequireAuthorization();

        // POST /api/groups/join — current user joins by code → 200.
        groups.MapPost("/join", async (JoinGroupRequest body, ClaimsPrincipal principal, ClassroomService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(principal, out var userId)) return Results.Unauthorized();
            var r = await svc.JoinGroupAsync(userId, body, ct);
            return Map(r, StatusCodes.Status200OK, notFound: "Invalid group code");
        }).RequireAuthorization();

        // POST /api/groups/leave — the CURRENT USER leaves their group → 204 (404 if in none). New
        // surface, backs the profile screen's "Guruhdan chiqish". Body-less and id-less on purpose:
        // the service deletes only the caller's own GroupMember rows, so no caller can remove
        // anyone else. Literal path, so registration order vs /{id:guid} is irrelevant.
        groups.MapPost("/leave", async (ClaimsPrincipal principal, ClassroomService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(principal, out var userId)) return Results.Unauthorized();
            var outcome = await svc.LeaveGroupAsync(userId, ct);
            return MapNoContent(outcome, notFound: "Not a member of any group");
        }).RequireAuthorization();

        // GET /api/groups/requests — pending join requests across the caller's OWN groups
        // (teacher/admin). Literal path, registered before /{id:guid} for readability; "requests"
        // fails the guid constraint anyway so the order is not load-bearing.
        groups.MapGet("/requests", async (ClaimsPrincipal principal, ClassroomService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(principal, out var userId)) return Results.Unauthorized();
            var r = await svc.ListJoinRequestsAsync(userId, ct);
            return Map(r, StatusCodes.Status200OK, forbidden: "Teacher role required");
        }).RequireAuthorization();

        // GET /api/groups/requests/mine — the CALLER's own pending requests. Lets the student's Home
        // say "waiting for approval" instead of rendering the join form as if nothing happened.
        groups.MapGet("/requests/mine", async (ClaimsPrincipal principal, ClassroomService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(principal, out var userId)) return Results.Unauthorized();
            var list = await svc.MyJoinRequestsAsync(userId, ct);
            return list is null ? Results.Unauthorized() : Results.Ok(list);
        }).RequireAuthorization();

        // POST /api/groups/requests/{id}/approve — accept a student into the group → 204.
        // 404 when the request is missing, already decided, OR belongs to another teacher's group:
        // never leaks that someone else's request exists.
        groups.MapPost("/requests/{id:guid}/approve", async (Guid id, ClaimsPrincipal principal, ClassroomService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(principal, out var userId)) return Results.Unauthorized();
            var outcome = await svc.DecideJoinRequestAsync(userId, id, approve: true, ct);
            return MapNoContent(outcome, notFound: "Join request not found", forbidden: "Teacher role required");
        }).RequireAuthorization();

        // POST /api/groups/requests/{id}/reject — decline → 204. Same 404 rule as approve.
        groups.MapPost("/requests/{id:guid}/reject", async (Guid id, ClaimsPrincipal principal, ClassroomService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(principal, out var userId)) return Results.Unauthorized();
            var outcome = await svc.DecideJoinRequestAsync(userId, id, approve: false, ct);
            return MapNoContent(outcome, notFound: "Join request not found", forbidden: "Teacher role required");
        }).RequireAuthorization();

        // GET /api/groups — teacher's own groups (?teacher_id for admin).
        groups.MapGet("", async (Guid? teacher_id, ClaimsPrincipal principal, ClassroomService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(principal, out var userId)) return Results.Unauthorized();
            var r = await svc.ListGroupsAsync(userId, teacher_id, ct);
            return Map(r, StatusCodes.Status200OK, forbidden: "Teacher role required");
        }).RequireAuthorization();

        // GET /api/groups/{id} — group detail with roster (owner/admin).
        groups.MapGet("/{id:guid}", async (Guid id, ClaimsPrincipal principal, ClassroomService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(principal, out var userId)) return Results.Unauthorized();
            var r = await svc.GroupDetailAsync(userId, id, ct);
            return Map(r, StatusCodes.Status200OK, notFound: "Group not found", forbidden: "Teacher role required");
        }).RequireAuthorization();
    }

    private static void MapAssignments(IEndpointRouteBuilder app)
    {
        var assignments = app.MapGroup("/api/assignments");

        // POST /api/assignments — assign a task to students/a group → 201 (S1 roster fix in service).
        assignments.MapPost("", async (CreateAssignmentRequest body, ClaimsPrincipal principal, ClassroomService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(principal, out var userId)) return Results.Unauthorized();
            var r = await svc.CreateAssignmentsAsync(userId, body, ct);
            return Map(r, StatusCodes.Status201Created, notFound: "Question not found", forbidden: "Teacher role required");
        }).RequireAuthorization();

        // POST /api/assignments/module — assign a whole module → 201.
        assignments.MapPost("/module", async (CreateModuleAssignmentRequest body, ClaimsPrincipal principal, ClassroomService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(principal, out var userId)) return Results.Unauthorized();
            var r = await svc.CreateModuleAssignmentsAsync(userId, body, ct);
            return Map(r, StatusCodes.Status201Created, notFound: "Module not found", forbidden: "Teacher role required");
        }).RequireAuthorization();

        // GET /api/assignments/mine — the current user's own assignments.
        // Registered before the collection GET is irrelevant (distinct literal path), but kept adjacent.
        assignments.MapGet("/mine", async (ClaimsPrincipal principal, ClassroomService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(principal, out var userId)) return Results.Unauthorized();
            var list = await svc.ListAssignmentsStudentAsync(userId, ct);
            return list is null ? Results.Unauthorized() : Results.Ok(list);
        }).RequireAuthorization();

        // GET /api/assignments — the teacher's own assignments (admin: all).
        assignments.MapGet("", async (ClaimsPrincipal principal, ClassroomService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(principal, out var userId)) return Results.Unauthorized();
            var r = await svc.ListAssignmentsTeacherAsync(userId, ct);
            return Map(r, StatusCodes.Status200OK, forbidden: "Teacher role required");
        }).RequireAuthorization();
    }

    private static void MapReports(IEndpointRouteBuilder app)
    {
        var reports = app.MapGroup("/api/reports");

        // GET /api/reports/gradebook — teacher/admin gradebook (?group_id).
        reports.MapGet("/gradebook", async (Guid? group_id, ClaimsPrincipal principal, ClassroomService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(principal, out var userId)) return Results.Unauthorized();
            var r = await svc.GradebookAsync(userId, group_id, ct);
            return Map(r, StatusCodes.Status200OK, forbidden: "Teacher or admin role required");
        }).RequireAuthorization();

        // GET /api/reports/insights — the Analitika · Insaytlar composite (?group_id). Same scoping
        // as the gradebook; a group the caller does not own simply yields empty counts rather than a
        // 404, because the answer "you teach nobody in there" leaks nothing about that group.
        reports.MapGet("/insights", async (Guid? group_id, ClaimsPrincipal principal, ClassroomService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(principal, out var userId)) return Results.Unauthorized();
            var r = await svc.InsightsAsync(userId, group_id, ct);
            return Map(r, StatusCodes.Status200OK, forbidden: "Teacher or admin role required");
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

    // Map a service outcome to HTTP. `okStatus` differs per endpoint (201 create vs 200 read).
    private static IResult Map<T>(ClassroomResult<T> r, int okStatus, string? notFound = null, string? forbidden = null)
        where T : class
        => r.Outcome switch
        {
            ClassroomOutcome.Ok => Results.Json(r.Value, statusCode: okStatus),
            ClassroomOutcome.Unauthorized => Results.Unauthorized(),
            ClassroomOutcome.Forbidden => Detail(forbidden ?? "Forbidden", StatusCodes.Status403Forbidden),
            ClassroomOutcome.NotFound => Detail(notFound ?? "Not found", StatusCodes.Status404NotFound),
            ClassroomOutcome.BadRequest => Detail(r.Detail ?? "Bad request", StatusCodes.Status400BadRequest),
            _ => Results.StatusCode(StatusCodes.Status500InternalServerError),
        };

    // Same mapping for the payload-less writes: success is 204 No Content, not a body.
    private static IResult MapNoContent(ClassroomOutcome outcome, string? notFound = null, string? forbidden = null)
        => outcome switch
        {
            ClassroomOutcome.Ok => Results.NoContent(),
            ClassroomOutcome.Unauthorized => Results.Unauthorized(),
            ClassroomOutcome.Forbidden => Detail(forbidden ?? "Forbidden", StatusCodes.Status403Forbidden),
            ClassroomOutcome.NotFound => Detail(notFound ?? "Not found", StatusCodes.Status404NotFound),
            _ => Results.StatusCode(StatusCodes.Status500InternalServerError),
        };

    private static IResult Detail(string message, int statusCode)
        => Results.Json(new { detail = message }, statusCode: statusCode);
}
