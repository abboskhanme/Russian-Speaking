using System.Security.Claims;
using Govori.Contracts;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

namespace Govori.Catalog;

/// <summary>
/// The Catalog domain's HTTP surface (docs/07 §7.2, Faza 3.2) — the student read path over
/// modules and their tasks. Follows the MODULAR-ENDPOINT PATTERN
/// established by <c>MapIdentityEndpoints</c>: a single <c>Map*Endpoints</c> extension the
/// composition root calls, keeping <c>Program.cs</c> free of per-domain route wiring.
///
/// <para>Endpoints are thin by design (§7.2 — no <c>DbContext</c> here): parse claims →
/// <see cref="CatalogService"/> → serialize. Three surfaces: the STUDENT READ PATH
/// (<c>GET /api/blocks/student</c>), the teacher/admin AUTHORING surface over modules and tasks
/// (see <see cref="MapAuthoring"/>), and the teachers' read of the OFFICIAL catalog they may assign
/// from (see <see cref="MapOfficialCatalog"/>). Topics are not part of any.</para>
///
/// <para>Path note: routes are mounted at <c>/api/blocks/...</c> with no <c>/v1</c> segment, to
/// match the sibling Identity module's <c>/api/auth</c> convention. Versioning is
/// reconciled at the gateway during cutover.</para>
/// </summary>
public static class CatalogEndpoints
{
    public static IEndpointRouteBuilder MapCatalogEndpoints(this IEndpointRouteBuilder app)
    {
        var blocks = app.MapGroup("/api/blocks");

        // GET /api/blocks/student → the student module view with the two-layer lock (sequence +
        // freemium). Requires a valid *access* token; a refresh token presented here is rejected.
        // role/is_active come from the DB, never the token — the service denies a
        // missing/inactive user (→ 401) even when the token itself is well-formed.
        blocks.MapGet("/student", async (ClaimsPrincipal principal, CatalogService svc, CancellationToken ct) =>
        {
            if (principal.FindFirstValue("type") != "access"
                || !Guid.TryParse(principal.FindFirstValue("sub"), out var userId))
            {
                return Results.Unauthorized();
            }

            var modules = await svc.GetStudentModulesAsync(userId, ct);
            return modules is null ? Results.Unauthorized() : Results.Ok(modules);
        }).RequireAuthorization();

        MapAuthoring(app);
        MapOfficialCatalog(app);
        return app;
    }

    /// <summary>
    /// <c>GET /api/catalog/official</c> — the official live catalog (public + published modules, each
    /// with its published, not-deleted tasks) for the D3 assign picker's "Rasmiy katalog" section.
    /// Teacher/admin → 200; student → 403; anonymous → 401. Read-only: every id it lists is one
    /// <c>POST /api/assignments</c> (task) or <c>POST /api/assignments/module</c> (module) accepts
    /// from ANY teacher, by the same <c>OfficialCatalog</c> definition.
    /// </summary>
    private static void MapOfficialCatalog(IEndpointRouteBuilder app)
    {
        app.MapGet("/api/catalog/official", async (ClaimsPrincipal principal, CatalogService svc, CancellationToken ct) =>
        {
            if (!TryUserId(principal, out var userId)) return Results.Unauthorized();
            return Map(await svc.ListOfficialCatalogAsync(userId, ct));
        }).RequireAuthorization();
    }

    /// <summary>
    /// The TEACHER authoring surface (Kontent board C1 · C2 · C4 · C5) over the existing
    /// question_blocks / questions tables. Thin like the rest: parse the token's <c>sub</c> →
    /// service → map the outcome. Every ownership decision lives in the service, and a row the
    /// caller does not own answers <b>404, not 403</b>, so module/task ids cannot be probed. An admin
    /// is the exception that owns everything: they see and edit every module, and only they can make
    /// one an official <c>public</c> module.
    /// </summary>
    private static void MapAuthoring(IEndpointRouteBuilder app)
    {
        var blocks = app.MapGroup("/api/blocks");
        var questions = app.MapGroup("/api/questions");

        // GET /api/blocks — the caller's own modules (teacher); EVERY module with its owner_name (admin).
        blocks.MapGet("", async (ClaimsPrincipal principal, CatalogService svc, CancellationToken ct) =>
        {
            if (!TryUserId(principal, out var userId)) return Results.Unauthorized();
            return Map(await svc.ListBlocksAsync(userId, ct));
        }).RequireAuthorization();

        // POST /api/blocks — create a module → 201. Starts as a DRAFT. visibility "public" is
        // admin-only: a teacher gets 403 public_requires_admin.
        blocks.MapPost("", async (CreateBlockRequest body, ClaimsPrincipal principal, CatalogService svc, CancellationToken ct) =>
        {
            if (!TryUserId(principal, out var userId)) return Results.Unauthorized();
            return Map(await svc.CreateBlockAsync(userId, body, ct), StatusCodes.Status201Created);
        }).RequireAuthorization();

        // GET /api/blocks/{id} — module + its ordered tasks (the C4 editor).
        blocks.MapGet("/{id:guid}", async (Guid id, ClaimsPrincipal principal, CatalogService svc, CancellationToken ct) =>
        {
            if (!TryUserId(principal, out var userId)) return Results.Unauthorized();
            return Map(await svc.GetBlockAsync(userId, id, ct));
        }).RequireAuthorization();

        // PATCH /api/blocks/{id} — partial update (rename, publish↔draft, reorder, visibility).
        // Publishing a draft module publishes its draft tasks in the same save; visibility "public"
        // is admin-only (403 public_requires_admin for a teacher).
        blocks.MapPatch("/{id:guid}", async (Guid id, UpdateBlockRequest body, ClaimsPrincipal principal, CatalogService svc, CancellationToken ct) =>
        {
            if (!TryUserId(principal, out var userId)) return Results.Unauthorized();
            return Map(await svc.UpdateBlockAsync(userId, id, body, ct));
        }).RequireAuthorization();

        // DELETE /api/blocks/{id} → 204. The module's tasks are SOFT-deleted (student history keeps
        // pointing at them) and the module row itself is removed. Owner or admin; another teacher
        // gets 404.
        blocks.MapDelete("/{id:guid}", async (Guid id, ClaimsPrincipal principal, CatalogService svc, CancellationToken ct) =>
        {
            if (!TryUserId(principal, out var userId)) return Results.Unauthorized();
            return MapNoContent(await svc.DeleteBlockAsync(userId, id, ct));
        }).RequireAuthorization();

        // GET /api/questions (?q= search, ?block_id, ?unassigned, ?limit=1..200) — the Vazifalar
        // tab and C5's library picker. `unassigned=true` is what the picker offers, so a task
        // cannot be attached to two modules at once.
        questions.MapGet("", async (
            string? q, Guid? block_id, bool? unassigned, int? limit,
            ClaimsPrincipal principal, CatalogService svc, CancellationToken ct) =>
        {
            if (!TryUserId(principal, out var userId)) return Results.Unauthorized();
            return Map(await svc.ListQuestionsAsync(userId, q, block_id, unassigned == true, limit ?? 100, ct));
        }).RequireAuthorization();

        // POST /api/questions — create a task → 201. Inside a module it inherits the module's
        // is_published; otherwise it starts as a DRAFT.
        questions.MapPost("", async (CreateQuestionRequest body, ClaimsPrincipal principal, CatalogService svc, CancellationToken ct) =>
        {
            if (!TryUserId(principal, out var userId)) return Results.Unauthorized();
            return Map(await svc.CreateQuestionAsync(userId, body, ct), StatusCodes.Status201Created);
        }).RequireAuthorization();

        // PATCH /api/questions/{id} — partial update; `detach_block: true` removes the module link.
        questions.MapPatch("/{id:guid}", async (Guid id, UpdateQuestionRequest body, ClaimsPrincipal principal, CatalogService svc, CancellationToken ct) =>
        {
            if (!TryUserId(principal, out var userId)) return Results.Unauthorized();
            return Map(await svc.UpdateQuestionAsync(userId, id, body, ct));
        }).RequireAuthorization();

        // DELETE /api/questions/{id} → 204. SOFT delete: the row stays so submissions, evaluations and
        // assignments that point at it keep working; it disappears from every catalog listing.
        // Owner or admin; another teacher gets 404, and so does a task that is already deleted.
        questions.MapDelete("/{id:guid}", async (Guid id, ClaimsPrincipal principal, CatalogService svc, CancellationToken ct) =>
        {
            if (!TryUserId(principal, out var userId)) return Results.Unauthorized();
            return MapNoContent(await svc.DeleteQuestionAsync(userId, id, ct));
        }).RequireAuthorization();

        // POST /api/questions/{id}/media — set/replace the task's image or short video
        // (multipart/form-data, field "media"). → 200 the updated task with a fresh `media_url`;
        // 400 on a rejected upload (wrong type / empty / over 25 MB, each with its own {detail});
        // 404 when the task is missing or belongs to another teacher — never 403, so ids stay
        // unprobeable.
        //
        // The form is read MANUALLY rather than via IFormFile binding, to sidestep the antiforgery
        // middleware that form-binding minimal APIs require — the same pattern POST /api/submissions
        // and POST /api/auth/me/avatar already use. Every validation rule lives in the service and is
        // applied server-side; nothing about the file is trusted from the client, including its name.
        questions.MapPost("/{id:guid}/media", async (
            Guid id, HttpRequest request, ClaimsPrincipal principal, CatalogService svc, CancellationToken ct) =>
        {
            if (!TryUserId(principal, out var userId)) return Results.Unauthorized();
            if (!request.HasFormContentType)
                return Detail("Expected multipart/form-data", StatusCodes.Status400BadRequest);

            var form = await request.ReadFormAsync(ct);
            var file = form.Files["media"] ?? (form.Files.Count > 0 ? form.Files[0] : null);
            if (file is null)
                return Detail("media file is required", StatusCodes.Status400BadRequest);

            await using var stream = file.OpenReadStream();
            return Map(await svc.SetQuestionMediaAsync(userId, id, stream, file.ContentType, file.Length, ct));
        }).RequireAuthorization().DisableAntiforgery();

        // DELETE /api/questions/{id}/media — clear the task's media → 200 the updated task
        // (`media_url` now null). Idempotent: a task with no media is still a 200.
        questions.MapDelete("/{id:guid}/media", async (
            Guid id, ClaimsPrincipal principal, CatalogService svc, CancellationToken ct) =>
        {
            if (!TryUserId(principal, out var userId)) return Results.Unauthorized();
            return Map(await svc.RemoveQuestionMediaAsync(userId, id, ct));
        }).RequireAuthorization();
    }

    /// <summary>A valid ACCESS token carrying a parseable `sub`; a refresh token is rejected.</summary>
    private static bool TryUserId(ClaimsPrincipal principal, out Guid userId)
    {
        userId = Guid.Empty;
        return principal.FindFirstValue("type") == "access"
               && Guid.TryParse(principal.FindFirstValue("sub"), out userId);
    }

    private static IResult Map<T>(CatalogResult<T> r, int okStatus = StatusCodes.Status200OK)
        => r.Outcome switch
        {
            CatalogOutcome.Ok => Results.Json(r.Value, statusCode: okStatus),
            _ => Failure(r),
        };

    // 204 for the deletes: success has no body; every failure maps exactly as Map does.
    private static IResult MapNoContent<T>(CatalogResult<T> r)
        => r.Outcome == CatalogOutcome.Ok ? Results.NoContent() : Failure(r);

    // A Forbidden that carries a code (e.g. public_requires_admin) is a caller who IS a teacher but
    // asked for something only an admin may do — so it must not say "Teacher role required".
    private static IResult Failure<T>(CatalogResult<T> r)
        => r.Outcome switch
        {
            CatalogOutcome.Unauthorized => Results.Unauthorized(),
            CatalogOutcome.Forbidden when r.Code is not null => Results.Json(
                new CodedErrorResponse(r.Detail ?? "Forbidden", r.Code), statusCode: StatusCodes.Status403Forbidden),
            CatalogOutcome.Forbidden => Detail("Teacher role required", StatusCodes.Status403Forbidden),
            CatalogOutcome.NotFound => Detail("Not found", StatusCodes.Status404NotFound),
            CatalogOutcome.BadRequest => Detail(r.Detail ?? "Bad request", StatusCodes.Status400BadRequest),
            _ => Results.StatusCode(StatusCodes.Status500InternalServerError),
        };

    private static IResult Detail(string message, int statusCode)
        => Results.Json(new { detail = message }, statusCode: statusCode);
}
