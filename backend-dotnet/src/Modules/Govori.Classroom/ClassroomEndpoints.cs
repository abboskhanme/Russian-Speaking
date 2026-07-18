using System.Security.Claims;
using Govori.Contracts;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

namespace Govori.Classroom;

/// <summary>
/// The Classroom domain's HTTP surface (docs/07 §3.5, Faza 3.5), ported from
/// backend/app/api/v1/{groups,engagement,reports}.py. Follows the MODULAR-ENDPOINT PATTERN
/// established by <c>MapIdentityEndpoints</c>/<c>MapCatalogEndpoints</c>/<c>MapPracticeEndpoints</c>:
/// a single <c>Map*Endpoints</c> extension the composition root calls.
///
/// <para>Endpoints are thin (§7.2 — no <c>DbContext</c> here): parse the access-token <c>sub</c> →
/// <see cref="ClassroomService"/> → map the domain outcome to HTTP. All role/ownership/roster
/// decisions live in the service. Error bodies use <c>{ "detail": ... }</c> to match FastAPI.</para>
///
/// <para>Path note: Python routes are <c>/api/v1/groups</c>, <c>/api/v1/assignments</c>,
/// <c>/api/v1/reports/gradebook</c>; the <c>/v1</c> segment is dropped to match the sibling modules'
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

        // POST /api/groups — teacher creates a group (+ join code) → 201. groups.py:101-111.
        groups.MapPost("", async (CreateGroupRequest body, ClaimsPrincipal principal, ClassroomService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(principal, out var userId)) return Results.Unauthorized();
            var r = await svc.CreateGroupAsync(userId, body, ct);
            return Map(r, StatusCodes.Status201Created, forbidden: "Teacher role required");
        }).RequireAuthorization();

        // GET /api/groups/mine — the current user's joined groups. groups.py:150-157. MUST precede
        // the /{id:guid} route so "mine" is never captured as an id (it also fails the guid constraint).
        groups.MapGet("/mine", async (ClaimsPrincipal principal, ClassroomService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(principal, out var userId)) return Results.Unauthorized();
            var list = await svc.MyGroupsAsync(userId, ct);
            return list is null ? Results.Unauthorized() : Results.Ok(list);
        }).RequireAuthorization();

        // POST /api/groups/join — current user joins by code → 200. groups.py:187-197.
        groups.MapPost("/join", async (JoinGroupRequest body, ClaimsPrincipal principal, ClassroomService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(principal, out var userId)) return Results.Unauthorized();
            var r = await svc.JoinGroupAsync(userId, body, ct);
            return Map(r, StatusCodes.Status200OK, notFound: "Invalid group code");
        }).RequireAuthorization();

        // GET /api/groups — teacher's own groups (?teacher_id for admin). groups.py:135-147.
        groups.MapGet("", async (Guid? teacher_id, ClaimsPrincipal principal, ClassroomService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(principal, out var userId)) return Results.Unauthorized();
            var r = await svc.ListGroupsAsync(userId, teacher_id, ct);
            return Map(r, StatusCodes.Status200OK, forbidden: "Teacher role required");
        }).RequireAuthorization();

        // GET /api/groups/{id} — group detail with roster (owner/admin). groups.py:200-209.
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
        // engagement.py:380-429.
        assignments.MapPost("", async (CreateAssignmentRequest body, ClaimsPrincipal principal, ClassroomService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(principal, out var userId)) return Results.Unauthorized();
            var r = await svc.CreateAssignmentsAsync(userId, body, ct);
            return Map(r, StatusCodes.Status201Created, notFound: "Question not found", forbidden: "Teacher role required");
        }).RequireAuthorization();

        // POST /api/assignments/module — assign a whole module → 201. engagement.py:443-506.
        assignments.MapPost("/module", async (CreateModuleAssignmentRequest body, ClaimsPrincipal principal, ClassroomService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(principal, out var userId)) return Results.Unauthorized();
            var r = await svc.CreateModuleAssignmentsAsync(userId, body, ct);
            return Map(r, StatusCodes.Status201Created, notFound: "Module not found", forbidden: "Teacher role required");
        }).RequireAuthorization();

        // GET /api/assignments/mine — the current user's own assignments. engagement.py:521-529.
        // Registered before the collection GET is irrelevant (distinct literal path), but kept adjacent.
        assignments.MapGet("/mine", async (ClaimsPrincipal principal, ClassroomService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(principal, out var userId)) return Results.Unauthorized();
            var list = await svc.ListAssignmentsStudentAsync(userId, ct);
            return list is null ? Results.Unauthorized() : Results.Ok(list);
        }).RequireAuthorization();

        // GET /api/assignments — the teacher's own assignments (admin: all). engagement.py:509-518.
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

        // GET /api/reports/gradebook — teacher/admin gradebook (?group_id). reports.py:76-82.
        reports.MapGet("/gradebook", async (Guid? group_id, ClaimsPrincipal principal, ClassroomService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(principal, out var userId)) return Results.Unauthorized();
            var r = await svc.GradebookAsync(userId, group_id, ct);
            return Map(r, StatusCodes.Status200OK, forbidden: "Teacher or admin role required");
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

    private static IResult Detail(string message, int statusCode)
        => Results.Json(new { detail = message }, statusCode: statusCode);
}
