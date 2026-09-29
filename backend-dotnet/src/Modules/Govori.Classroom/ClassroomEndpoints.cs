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
/// <para>Path note: these routes are <c>/api/groups</c>, <c>/api/assignments</c>,
/// <c>/api/reports/…</c> and <c>/api/classroom/students</c> — no <c>/v1</c> segment, matching the
/// sibling modules' <c>/api/…</c> convention (reconciled at the gateway during cutover).</para>
/// </summary>
public static class ClassroomEndpoints
{
    public static IEndpointRouteBuilder MapClassroomEndpoints(this IEndpointRouteBuilder app)
    {
        MapGroups(app);
        MapAssignments(app);
        MapReports(app);
        MapStudents(app);
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

        // ── Owner management. Same rule on every route: 401 anonymous/inactive, 403 student,
        // 404 for a group the caller does not own (never 403 — ids cannot be probed), admin any. ──

        // PATCH /api/groups/{id} { name?, level? } → 200 GroupResponse. 400 { detail, code }:
        // name_required / name_too_long / level_not_supported.
        groups.MapPatch("/{id:guid}", async (Guid id, UpdateGroupRequest body, ClaimsPrincipal principal, ClassroomService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(principal, out var userId)) return Results.Unauthorized();
            var r = await svc.UpdateGroupAsync(userId, id, body, ct);
            return Map(r, StatusCodes.Status200OK, notFound: "Group not found", forbidden: "Teacher role required");
        }).RequireAuthorization();

        // POST /api/groups/{id}/regenerate-code → 200 GroupResponse carrying the NEW join code; the
        // old one stops working immediately.
        groups.MapPost("/{id:guid}/regenerate-code", async (Guid id, ClaimsPrincipal principal, ClassroomService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(principal, out var userId)) return Results.Unauthorized();
            var r = await svc.RegenerateCodeAsync(userId, id, ct);
            return Map(r, StatusCodes.Status200OK, notFound: "Group not found", forbidden: "Teacher role required");
        }).RequireAuthorization();

        // DELETE /api/groups/{id}/members/{studentId} → 204. 404 also when the student is not a
        // member. Their answers stay; their unanswered assignments from this group go.
        groups.MapDelete("/{id:guid}/members/{studentId:guid}", async (Guid id, Guid studentId, ClaimsPrincipal principal, ClassroomService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(principal, out var userId)) return Results.Unauthorized();
            var outcome = await svc.RemoveMemberAsync(userId, id, studentId, ct);
            return MapNoContent(outcome, notFound: "Member not found", forbidden: "Teacher role required");
        }).RequireAuthorization();

        // DELETE /api/groups/{id} → 204. Memberships, join requests and unanswered assignments go;
        // submissions, grades and answered assignments survive (see DeleteGroupAsync).
        groups.MapDelete("/{id:guid}", async (Guid id, ClaimsPrincipal principal, ClassroomService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(principal, out var userId)) return Results.Unauthorized();
            var outcome = await svc.DeleteGroupAsync(userId, id, ct);
            return MapNoContent(outcome, notFound: "Group not found", forbidden: "Teacher role required");
        }).RequireAuthorization();
    }

    private static void MapAssignments(IEndpointRouteBuilder app)
    {
        var assignments = app.MapGroup("/api/assignments");

        // POST /api/assignments — assign a task to students/a group → 201 listing only the rows
        // created (students who still owe the task are skipped). S1 roster fix in the service.
        // 404 missing/deleted/not-theirs; 400 { detail, code: "question_not_published" }.
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

        // ── Taking work back / moving deadlines: 401 anonymous/inactive, 403 student, 404 for an
        // assignment or group that is not the caller's (never 403), admin any. ──

        // DELETE /api/assignments/{id} → 204. The student's answers and grades survive.
        assignments.MapDelete("/{id:guid}", async (Guid id, ClaimsPrincipal principal, ClassroomService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(principal, out var userId)) return Results.Unauthorized();
            var outcome = await svc.DeleteAssignmentAsync(userId, id, ct);
            return MapNoContent(outcome, notFound: "Assignment not found", forbidden: "Teacher role required");
        }).RequireAuthorization();

        // POST /api/assignments/cancel { question_id, group_id } → 200 { cancelled }. Idempotent.
        assignments.MapPost("/cancel", async (CancelGroupAssignmentsRequest body, ClaimsPrincipal principal, ClassroomService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(principal, out var userId)) return Results.Unauthorized();
            var r = await svc.CancelGroupAssignmentsAsync(userId, body, ct);
            return Map(r, StatusCodes.Status200OK, notFound: "Group not found", forbidden: "Teacher role required");
        }).RequireAuthorization();

        // PATCH /api/assignments/group { question_id, group_id, due_at } → 200 { updated }.
        // due_at: ISO-8601 or null (no deadline); absent → 400 due_at_required, past → 400 due_in_past.
        assignments.MapPatch("/group", async (UpdateGroupAssignmentsRequest body, ClaimsPrincipal principal, ClassroomService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(principal, out var userId)) return Results.Unauthorized();
            var r = await svc.UpdateGroupAssignmentsDueAsync(userId, body, ct);
            return Map(r, StatusCodes.Status200OK, notFound: "Group not found", forbidden: "Teacher role required");
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

    private static void MapStudents(IEndpointRouteBuilder app)
    {
        // /api/classroom/students — one roster student, as their teacher sees them. A teacher reaches
        // only a student in one of their own groups (404 otherwise — never 403); admin any student;
        // a student caller 403; anonymous 401.
        var students = app.MapGroup("/api/classroom/students");

        // GET /api/classroom/students/{id} → 200 ClassroomStudentResponse (the A6 header).
        students.MapGet("/{id:guid}", async (Guid id, ClaimsPrincipal principal, ClassroomService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(principal, out var userId)) return Results.Unauthorized();
            var r = await svc.StudentAsync(userId, id, ct);
            return Map(r, StatusCodes.Status200OK, notFound: "Student not found", forbidden: "Teacher role required");
        }).RequireAuthorization();

        // PATCH /api/classroom/students/{id}/premium { is_premium } → 200 { id, is_premium, has_premium }.
        // 400 is_premium_required when the field is missing.
        students.MapPatch("/{id:guid}/premium", async (Guid id, SetStudentPremiumRequest body, ClaimsPrincipal principal, ClassroomService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(principal, out var userId)) return Results.Unauthorized();
            var r = await svc.SetStudentPremiumAsync(userId, id, body, ct);
            return Map(r, StatusCodes.Status200OK, notFound: "Student not found", forbidden: "Teacher role required");
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
            // A CodedErrorResponse { detail, code } when the service named a ClassroomErrorCodes
            // value; the older 400s have none and keep their exact { detail } body.
            ClassroomOutcome.BadRequest => r.Code is null
                ? Detail(r.Detail ?? "Bad request", StatusCodes.Status400BadRequest)
                : Results.Json(new CodedErrorResponse(r.Detail ?? "Bad request", r.Code),
                    statusCode: StatusCodes.Status400BadRequest),
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
