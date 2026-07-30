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
/// <see cref="CatalogService"/> → serialize. This slice ships the STUDENT READ PATH only;
/// teacher/admin module &amp; task CRUD (create/update/delete, the <c>/questions</c> surface,
/// topics) is deferred to later Catalog work.</para>
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
        return app;
    }

    /// <summary>
    /// The TEACHER authoring surface (Kontent board C1 · C2 · C4 · C5) over the existing
    /// question_blocks / questions tables. Thin like the rest: parse the token's <c>sub</c> →
    /// service → map the outcome. Every ownership decision lives in the service, and a row the
    /// caller does not own answers <b>404, not 403</b>, so module/task ids cannot be probed.
    /// </summary>
    private static void MapAuthoring(IEndpointRouteBuilder app)
    {
        var blocks = app.MapGroup("/api/blocks");
        var questions = app.MapGroup("/api/questions");

        // GET /api/blocks — the caller's own modules (teacher/admin).
        blocks.MapGet("", async (ClaimsPrincipal principal, CatalogService svc, CancellationToken ct) =>
        {
            if (!TryUserId(principal, out var userId)) return Results.Unauthorized();
            return Map(await svc.ListBlocksAsync(userId, ct));
        }).RequireAuthorization();

        // POST /api/blocks — create a module → 201. Starts as a DRAFT.
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

        // PATCH /api/blocks/{id} — partial update (rename, publish↔draft, reorder).
        blocks.MapPatch("/{id:guid}", async (Guid id, UpdateBlockRequest body, ClaimsPrincipal principal, CatalogService svc, CancellationToken ct) =>
        {
            if (!TryUserId(principal, out var userId)) return Results.Unauthorized();
            return Map(await svc.UpdateBlockAsync(userId, id, body, ct));
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

        // POST /api/questions — create a task → 201. Starts as a DRAFT.
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
            CatalogOutcome.Unauthorized => Results.Unauthorized(),
            CatalogOutcome.Forbidden => Detail("Teacher role required", StatusCodes.Status403Forbidden),
            CatalogOutcome.NotFound => Detail("Not found", StatusCodes.Status404NotFound),
            CatalogOutcome.BadRequest => Detail(r.Detail ?? "Bad request", StatusCodes.Status400BadRequest),
            _ => Results.StatusCode(StatusCodes.Status500InternalServerError),
        };

    private static IResult Detail(string message, int statusCode)
        => Results.Json(new { detail = message }, statusCode: statusCode);
}
