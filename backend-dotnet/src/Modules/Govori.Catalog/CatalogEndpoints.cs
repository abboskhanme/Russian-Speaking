using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

namespace Govori.Catalog;

/// <summary>
/// The Catalog domain's HTTP surface (docs/07 §7.2, Faza 3.2), ported from
/// backend/app/api/v1/blocks.py (student read path). Follows the MODULAR-ENDPOINT PATTERN
/// established by <c>MapIdentityEndpoints</c>: a single <c>Map*Endpoints</c> extension the
/// composition root calls, keeping <c>Program.cs</c> free of per-domain route wiring.
///
/// <para>Endpoints are thin by design (§7.2 — no <c>DbContext</c> here): parse claims →
/// <see cref="CatalogService"/> → serialize. This slice ships the STUDENT READ PATH; teacher/admin
/// module &amp; task CRUD (blocks.py POST/PATCH/DELETE, the <c>/questions</c> surface, topics) is
/// deferred to later Catalog work.</para>
///
/// <para>Path note: the Python route is <c>/api/v1/blocks/student</c>; the <c>/v1</c> segment is
/// dropped here to match the sibling Identity module's <c>/api/auth</c> convention. Versioning is
/// reconciled at the gateway during cutover.</para>
/// </summary>
public static class CatalogEndpoints
{
    public static IEndpointRouteBuilder MapCatalogEndpoints(this IEndpointRouteBuilder app)
    {
        var blocks = app.MapGroup("/api/blocks");

        // GET /api/blocks/student → the student module view with the two-layer lock (sequence +
        // freemium), ported from blocks.py:90-176. Requires a valid *access* token (a refresh
        // token is rejected, mirroring deps.py:25). role/is_active come from the DB, never the
        // token — the service denies a missing/inactive user (→ 401), like get_current_user.
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

        return app;
    }
}
