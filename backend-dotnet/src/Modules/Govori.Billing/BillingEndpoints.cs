using System.Security.Claims;
using Govori.Contracts;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

namespace Govori.Billing;

/// <summary>
/// The Billing domain's HTTP surface (docs/08 Faza 6.6). Same modular-endpoint pattern as every
/// sibling module: one <c>Map*Endpoints</c> extension the composition root calls, thin handlers that
/// parse the token's <c>sub</c>, delegate to <see cref="BillingService"/> and map the outcome.
///
/// <para>Three groups: the student surface (<c>/api/billing/…</c>), the admin tariff editor
/// (<c>/api/admin/billing/…</c>), and the provider callback
/// (<c>/api/billing/webhook/{provider}</c>) — the only anonymous route here.</para>
///
/// <para>Error bodies use the <c>{ "detail": … }</c> shape used across the API. For billing the
/// detail is a MACHINE CODE (<c>provider_not_configured</c>, <c>payments_disabled</c>) rather than a
/// sentence: the student's message has to exist in three languages and the frontend owns those, so
/// a server-side sentence would either be untranslated or duplicated.</para>
/// </summary>
public static class BillingEndpoints
{
    public static IEndpointRouteBuilder MapBillingEndpoints(this IEndpointRouteBuilder app)
    {
        MapStudent(app);
        MapWebhook(app);
        MapAdmin(app);
        return app;
    }

    // ─── Student surface ────────────────────────────────────────────────────

    private static void MapStudent(IEndpointRouteBuilder app)
    {
        var billing = app.MapGroup("/api/billing");

        // GET /api/billing/plans — the tariffs on offer.
        billing.MapGet("/plans", async (ClaimsPrincipal p, BillingService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(p, out var uid)) return Results.Unauthorized();
            return Map(await svc.ListPlansAsync(uid, ct));
        }).RequireAuthorization();

        // GET /api/billing/subscription — the caller's own premium state, from the single source.
        billing.MapGet("/subscription", async (ClaimsPrincipal p, BillingService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(p, out var uid)) return Results.Unauthorized();
            return Map(await svc.GetStatusAsync(uid, ct));
        }).RequireAuthorization();

        // POST /api/billing/checkout — start a purchase.
        //
        // Rate-limited because every hit writes a row and, once a real adapter exists, opens a
        // transaction at a provider. The idempotency key collapses a RETRY of one attempt; the limit
        // caps someone minting a fresh key each time, which the key cannot.
        billing.MapPost("/checkout", async (CheckoutRequest body, ClaimsPrincipal p, BillingService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(p, out var uid)) return Results.Unauthorized();
            return Map(await svc.CheckoutAsync(uid, body, ct), notFound: "plan_not_found");
        }).RequireAuthorization().RequireRateLimiting(RateLimitPolicyNames.BillingCheckout);
    }

    // ─── Provider callback ──────────────────────────────────────────────────

    private static void MapWebhook(IEndpointRouteBuilder app)
    {
        // POST /api/billing/webhook/{provider} — anonymous by necessity: a payment provider calls
        // it, and a provider holds no user token.
        //
        // ⚠ THE SIGNATURE CHECK IS THE ONLY THING BETWEEN THIS ROUTE AND FREE PREMIUM FOR ANYONE.
        // The body is read as RAW TEXT and passed through unparsed, because a signature is computed
        // over the exact bytes and a body that has been deserialised and re-serialised can no longer
        // be verified. While the stub adapter is in place every callback is rejected — there is no
        // shared secret, and "no secret" must resolve to "verify fails", never to "skip the check".
        app.MapPost("/api/billing/webhook/{provider}", async (
            string provider, HttpRequest request, BillingService svc, CancellationToken ct) =>
        {
            using var reader = new StreamReader(request.Body);
            var rawBody = await reader.ReadToEndAsync(ct);

            var headers = request.Headers.ToDictionary(
                h => h.Key, h => h.Value.ToString(), StringComparer.OrdinalIgnoreCase);

            var result = await svc.HandleWebhookAsync(provider, rawBody, headers, ct);

            // One answer for every rejection — a wrong provider name, a bad signature and an unknown
            // intent are indistinguishable from outside, so this cannot be used to probe which
            // providers are wired up or which payments exist.
            return result.Outcome == BillingOutcome.Ok
                ? Results.Ok(new { accepted = result.Value })
                : Detail("webhook_rejected", StatusCodes.Status403Forbidden);
        }).AllowAnonymous().RequireRateLimiting(RateLimitPolicyNames.BillingWebhook).DisableAntiforgery();
    }

    // ─── Admin tariff editor ────────────────────────────────────────────────

    private static void MapAdmin(IEndpointRouteBuilder app)
    {
        var admin = app.MapGroup("/api/admin/billing");

        // GET /api/admin/billing/plans — every tariff, retired ones included.
        admin.MapGet("/plans", async (ClaimsPrincipal p, BillingService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(p, out var uid)) return Results.Unauthorized();
            return Map(await svc.AdminListPlansAsync(uid, ct));
        }).RequireAuthorization();

        // POST /api/admin/billing/plans — create a tariff.
        admin.MapPost("/plans", async (PlanUpsertRequest body, ClaimsPrincipal p, BillingService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(p, out var uid)) return Results.Unauthorized();
            return Map(await svc.CreatePlanAsync(uid, body, ct), okStatus: StatusCodes.Status201Created);
        }).RequireAuthorization();

        // PATCH /api/admin/billing/plans/{id} — partial update.
        admin.MapPatch("/plans/{id:guid}", async (Guid id, PlanUpsertRequest body, ClaimsPrincipal p, BillingService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(p, out var uid)) return Results.Unauthorized();
            return Map(await svc.UpdatePlanAsync(uid, id, body, ct), notFound: "plan_not_found");
        }).RequireAuthorization();

        // DELETE /api/admin/billing/plans/{id} — 204, and refused when anything was sold under it.
        admin.MapDelete("/plans/{id:guid}", async (Guid id, ClaimsPrincipal p, BillingService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(p, out var uid)) return Results.Unauthorized();
            var result = await svc.DeletePlanAsync(uid, id, ct);
            return result.Outcome == BillingOutcome.Ok
                ? Results.NoContent()
                : Map(result, notFound: "plan_not_found");
        }).RequireAuthorization();

        // GET /api/admin/billing/subscriptions — who holds what, newest first.
        admin.MapGet("/subscriptions", async (int? limit, ClaimsPrincipal p, BillingService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(p, out var uid)) return Results.Unauthorized();
            return Map(await svc.AdminListSubscriptionsAsync(uid, limit ?? 100, ct));
        }).RequireAuthorization();
    }

    // ─── Shared plumbing ────────────────────────────────────────────────────

    // Requires a valid *access* token carrying a parseable `sub`. A refresh token is rejected here:
    // it may only be exchanged at the refresh endpoint, never used to call a protected route.
    private static bool TryGetUserId(ClaimsPrincipal principal, out Guid userId)
    {
        userId = Guid.Empty;
        return principal.FindFirstValue("type") == "access"
               && Guid.TryParse(principal.FindFirstValue("sub"), out userId);
    }

    private static IResult Map<T>(
        BillingResult<T> r, int okStatus = StatusCodes.Status200OK, string? notFound = null)
        => r.Outcome switch
        {
            BillingOutcome.Ok => Results.Json(r.Value, statusCode: okStatus),
            BillingOutcome.Unauthorized => Results.Unauthorized(),
            BillingOutcome.Forbidden => Detail("admin_required", StatusCodes.Status403Forbidden),
            BillingOutcome.NotFound => Detail(notFound ?? "not_found", StatusCodes.Status404NotFound),
            BillingOutcome.BadRequest => Detail(r.Detail ?? "bad_request", StatusCodes.Status400BadRequest),
            // 503, not 400: the request was fine, the capability does not exist yet. The client
            // renders this as a state ("to'lov tizimi hali ulanmagan"), not as a failure.
            BillingOutcome.Unavailable => Detail(r.Detail ?? "unavailable", StatusCodes.Status503ServiceUnavailable),
            _ => Results.StatusCode(StatusCodes.Status500InternalServerError),
        };

    private static IResult Detail(string detail, int status)
        => Results.Json(new { detail }, statusCode: status);
}
