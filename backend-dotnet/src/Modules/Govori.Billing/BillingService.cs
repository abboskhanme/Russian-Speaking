using Govori.Contracts;
using Govori.Infrastructure;
using Govori.Infrastructure.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;

namespace Govori.Billing;

/// <summary>Outcome of a Billing call, mapped to HTTP by the endpoints.</summary>
public enum BillingOutcome
{
    Ok,
    Unauthorized,
    Forbidden,
    NotFound,
    BadRequest,

    /// <summary>The feature is switched off, or no provider is wired up. A 503 rather than an error:
    /// nothing is broken, the capability simply does not exist yet, and the client renders that
    /// state instead of a failure.</summary>
    Unavailable,
}

/// <summary>A Billing result: outcome + payload on success, a machine <see cref="Detail"/> code on
/// failure.</summary>
public sealed record BillingResult<T>(BillingOutcome Outcome, T? Value = default, string? Detail = null)
{
    public static BillingResult<T> Ok(T value) => new(BillingOutcome.Ok, value);
    public static BillingResult<T> Unauthorized() => new(BillingOutcome.Unauthorized);
    public static BillingResult<T> Forbidden() => new(BillingOutcome.Forbidden);
    public static BillingResult<T> NotFound() => new(BillingOutcome.NotFound);
    public static BillingResult<T> BadRequest(string detail) => new(BillingOutcome.BadRequest, default, detail);
    public static BillingResult<T> Unavailable(string detail) => new(BillingOutcome.Unavailable, default, detail);
}

/// <summary>
/// The Billing vertical slice (docs/08 Faza 6.6): tariffs, subscriptions and payment attempts.
///
/// <para><b>What this module is NOT.</b> It is not the premium rule. Premium is
/// <c>users.is_premium OR an active subscription</c> and lives in
/// <see cref="PremiumAccess"/>, which the catalog paywall reads too — so this service can never
/// disagree with the 402 gate about who has access. Nothing here writes
/// <c>users.is_premium</c>: the teacher grant is the admin surface's business and stays untouched.</para>
///
/// <para><b>The whole flow stops honestly while no provider exists.</b> Two independent gates, and
/// both must be open before an intent is even created: the <c>payments_enabled</c> flag (OFF by
/// default) and the provider actually being configured. With either shut, the caller gets a state to
/// render — never a fabricated success, never a subscription, never a receipt. See
/// <see cref="UnconfiguredPaymentProvider"/> for why there is no simulation mode.</para>
/// </summary>
public sealed class BillingService
{
    private readonly GovoriDbContext _db;
    private readonly IPaymentProvider _provider;
    private readonly IConfiguration _config;

    public BillingService(GovoriDbContext db, IPaymentProvider provider, IConfiguration config)
    {
        _db = db;
        _provider = provider;
        _config = config;
    }

    /// <summary>The flag this whole surface hangs off. OFF by default, and — unlike the roleplay
    /// flag — turning it ON is still not enough: a checkout also needs a configured provider. Two
    /// gates because they fail for different reasons and an operator must be able to tell which one
    /// is shut.</summary>
    public const string EnabledKey = "payments_enabled";

    /// <summary>Refusal codes the client renders. Codes, not sentences: the student's message is
    /// translated in the frontend, and tests assert on these.</summary>
    public const string PaymentsDisabledReason = "payments_disabled";

    private static readonly HashSet<string> TrueWords = new(StringComparer.Ordinal) { "true", "1", "yes", "on" };

    /// <summary>Longest idempotency key we will store — matches the column. A caller sending more is
    /// rejected rather than silently truncated: a truncated key can collide with another attempt's,
    /// which turns the de-duplication guard into a cause of the very bug it prevents.</summary>
    private const int MaxIdempotencyKeyLength = 80;

    /// <summary>The DATABASE name of the unique index that closes the double-charge race. Spelled
    /// here because Postgres reports the index name on the violation, and swallowing "some unique
    /// index broke" would also swallow a collision nobody predicted.</summary>
    private const string IdempotencyIndex = "uq_payment_intents_idempotency";

    // ─── Flag ───────────────────────────────────────────────────────────────

    /// <summary>
    /// Whether payments are switched on: an <c>app_settings</c> override wins, else the
    /// <c>PAYMENTS_ENABLED</c> environment default, else FALSE.
    ///
    /// <para>The few lines of <c>AppSettingsService</c> repeated here are deliberate, for the reason
    /// <c>RoleplayService.LimitsAsync</c> gives: that class lives in <c>Govori.Administration</c>
    /// and Billing→Administration is a cross-domain edge the ArchTests refuse. Reading the same row
    /// through the shared DbContext keeps the mechanism identical — same table, same admin panel,
    /// same precedence — without opening a boundary for one key.</para>
    /// </summary>
    public async Task<bool> PaymentsEnabledAsync(CancellationToken ct = default)
    {
        var stored = await _db.AppSettings
            .AsNoTracking()
            .Where(s => s.Key == EnabledKey)
            .Select(s => s.Value)
            .FirstOrDefaultAsync(ct);

        // An override counts only when it is non-empty, so a cleared row falls through to the env
        // default instead of blanking the setting — AppSettingsService's rule.
        var raw = !string.IsNullOrWhiteSpace(stored)
            ? stored!.Trim()
            : (_config[EnabledKey.ToUpperInvariant()] ?? string.Empty).Trim();

        return raw.Length > 0 && TrueWords.Contains(raw.ToLowerInvariant());
    }

    // ─── Student surface ────────────────────────────────────────────────────

    /// <summary>GET /api/billing/plans — the tariffs on offer, cheapest-first by the admin's order.
    /// Only ACTIVE plans: a retired tariff still exists (subscriptions point at it) but must never
    /// be sold again.</summary>
    public async Task<BillingResult<IReadOnlyList<PlanResponse>>> ListPlansAsync(
        Guid userId, CancellationToken ct = default)
    {
        var user = await ActiveUserAsync(userId, ct);
        if (user is null) return BillingResult<IReadOnlyList<PlanResponse>>.Unauthorized();

        var plans = await _db.Plans.AsNoTracking()
            .Where(p => p.IsActive)
            .OrderBy(p => p.SortOrder).ThenBy(p => p.PriceMinor)
            .ToListAsync(ct);

        return BillingResult<IReadOnlyList<PlanResponse>>.Ok(plans.Select(Out).ToList());
    }

    /// <summary>
    /// GET /api/billing/subscription — everything the profile and the premium screen need in one
    /// call: the resolved premium boolean, WHERE it comes from, the subscription window if there is
    /// one, and the two gate states.
    ///
    /// <para><c>IsPremium</c> comes from <see cref="PremiumAccess"/> — the same call the 402 gate
    /// makes — so this screen cannot claim access the paywall will refuse.</para>
    /// </summary>
    public async Task<BillingResult<SubscriptionStatusResponse>> GetStatusAsync(
        Guid userId, CancellationToken ct = default)
    {
        var user = await ActiveUserAsync(userId, ct);
        if (user is null) return BillingResult<SubscriptionStatusResponse>.Unauthorized();

        var now = DateTime.UtcNow;
        var subscription = await PremiumAccess.CurrentSubscriptionAsync(_db, userId, now, ct);
        var subscriptionActive = subscription is not null
                                 && subscription.Status == SubscriptionStatuses.Active
                                 && subscription.StartsAt <= now
                                 && (subscription.EndsAt is null || subscription.EndsAt > now);

        // The teacher grant is reported FIRST when both are true. It is the one the student's
        // teacher can explain, and it is the one that does not lapse.
        var source = user.IsPremium ? "teacher" : subscriptionActive ? "subscription" : "none";

        return BillingResult<SubscriptionStatusResponse>.Ok(new SubscriptionStatusResponse(
            IsPremium: user.IsPremium || subscriptionActive,
            Source: source,
            Status: subscription?.Status ?? "none",
            Plan: subscription?.Plan is { } plan ? Out(plan) : null,
            StartsAt: subscription?.StartsAt,
            EndsAt: subscription?.EndsAt,
            PaymentsEnabled: await PaymentsEnabledAsync(ct),
            ProviderConfigured: await _provider.IsConfiguredAsync(ct),
            Provider: _provider.Name));
    }

    /// <summary>
    /// POST /api/billing/checkout — start a purchase.
    ///
    /// <para><b>Order of operations, and why.</b> Both gates are checked BEFORE any row is written:
    /// an intent that could never have been paid is noise in the table an operator has to read past.
    /// Only then is the intent persisted — before the provider is called, so a provider that accepts
    /// the payment and then times out on us still has a row to reconcile against.</para>
    ///
    /// <para><b>Idempotency.</b> The key is stored on the row under a UNIQUE index. A retry carrying
    /// the same key returns the EXISTING intent unchanged instead of creating a second one, and the
    /// race two concurrent retries create is settled by the database, not by a read-then-write in
    /// this method — see the catch on <see cref="DbUpdateException"/>.</para>
    /// </summary>
    public async Task<BillingResult<CheckoutResponse>> CheckoutAsync(
        Guid userId, CheckoutRequest body, CancellationToken ct = default)
    {
        var user = await ActiveUserAsync(userId, ct);
        if (user is null) return BillingResult<CheckoutResponse>.Unauthorized();

        if (!await PaymentsEnabledAsync(ct))
            return BillingResult<CheckoutResponse>.Unavailable(PaymentsDisabledReason);

        // The flag being on is not enough. Without this second check a deployment that switched the
        // flag on before the merchant account arrived would offer a purchase that cannot complete.
        if (!await _provider.IsConfiguredAsync(ct))
            return BillingResult<CheckoutResponse>.Unavailable(UnconfiguredPaymentProvider.NotConfiguredReason);

        var plan = await _db.Plans.FirstOrDefaultAsync(p => p.Id == body.PlanId && p.IsActive, ct);
        if (plan is null) return BillingResult<CheckoutResponse>.NotFound();

        var key = (body.IdempotencyKey ?? string.Empty).Trim();
        if (key.Length == 0)
            // A server-minted key de-duplicates nothing — only a client that resends the SAME key
            // gets protection. It is minted anyway so the column is never empty and a client that
            // has not been updated yet still gets a well-formed row.
            key = Guid.NewGuid().ToString("N");
        if (key.Length > MaxIdempotencyKeyLength)
            return BillingResult<CheckoutResponse>.BadRequest("idempotency_key is too long");

        var existing = await _db.PaymentIntents
            .FirstOrDefaultAsync(i => i.UserId == userId && i.IdempotencyKey == key, ct);
        if (existing is not null)
            return BillingResult<CheckoutResponse>.Ok(Out(existing, null));

        var now = DateTime.UtcNow;
        var intent = new PaymentIntent
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            PlanId = plan.Id,
            // Copied from the plan, not joined at read time: the amount charged must be the amount
            // that was displayed, even after someone edits the price.
            AmountMinor = plan.PriceMinor,
            Currency = plan.Currency,
            Status = PaymentIntentStatuses.Created,
            Provider = _provider.Name,
            IdempotencyKey = key,
            CreatedAt = now,
            UpdatedAt = now,
        };
        _db.PaymentIntents.Add(intent);

        try
        {
            await _db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException ex) when (DbErrors.IsUniqueViolation(ex, IdempotencyIndex))
        {
            // Two concurrent requests with the same key: the unique index rejected this one. The row
            // that won is the answer — returning it is what makes a double-tapped button one payment
            // instead of two. The `existing` read above cannot cover this: both requests pass it
            // before either writes, which is exactly why the guard is a constraint and not an `if`.
            _db.Entry(intent).State = EntityState.Detached;
            var winner = await ConflictingIntentAsync(userId, key, ct);
            if (winner is null) throw;              // violation on some other key — not ours to swallow
            return BillingResult<CheckoutResponse>.Ok(Out(winner, null));
        }

        var started = await _provider.CreatePaymentAsync(intent, ct);

        intent.Status = started.Status;
        intent.ExternalId = started.ExternalId;
        intent.ProviderPayload = started.RawPayload;
        intent.FailureReason = started.Reason;
        intent.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);

        // NOTE: no subscription is created here, on ANY path. A subscription is granted only by a
        // verified provider callback (WebhookAsync) — the point at which the money is known to have
        // moved. Granting it on a started checkout is how a system hands out premium for free.
        return BillingResult<CheckoutResponse>.Ok(Out(intent, started.RedirectUrl));
    }

    // ─── Provider callback ──────────────────────────────────────────────────

    /// <summary>
    /// POST /api/billing/webhook/{provider} — a payment provider telling us something happened.
    ///
    /// <para><b>Verification is the entire endpoint.</b> The body is handed to the adapter as raw
    /// bytes and, unless the adapter returns a verified callback, NOTHING happens: no row is read,
    /// no subscription is granted, and the caller gets a flat rejection. While
    /// <see cref="UnconfiguredPaymentProvider"/> is the adapter that means every callback is
    /// rejected — which is correct, because there is no shared secret with which anything could be
    /// verified, and an endpoint that grants premium on an unverified POST is a self-service premium
    /// button.</para>
    ///
    /// <para>The rejection is deliberately uninformative. A caller probing this endpoint learns only
    /// that their callback did not verify — not whether the provider name was right, whether an
    /// intent with that id exists, or how far through the checks they got.</para>
    /// </summary>
    public async Task<BillingResult<bool>> HandleWebhookAsync(
        string providerName, string rawBody, IReadOnlyDictionary<string, string> headers,
        CancellationToken ct = default)
    {
        // A callback addressed to a provider we do not serve is rejected with the same answer as one
        // that fails its signature. Distinguishing them would confirm which providers are wired up.
        if (!string.Equals(providerName, _provider.Name, StringComparison.OrdinalIgnoreCase))
            return BillingResult<bool>.Forbidden();

        var callback = await _provider.VerifyWebhookAsync(rawBody, headers, ct);
        if (callback is null)
            return BillingResult<bool>.Forbidden();

        // By PRIMARY KEY, never by idempotency key: that key is unique only per user, so matching on
        // it could settle one person's payment against another person's intent.
        var intent = await _db.PaymentIntents
            .FirstOrDefaultAsync(i => i.Id == callback.IntentId, ct);
        if (intent is null)
            return BillingResult<bool>.Forbidden();

        var now = DateTime.UtcNow;
        intent.ExternalId = callback.ExternalId;
        intent.ProviderPayload = callback.RawPayload;
        intent.UpdatedAt = now;

        if (!callback.Paid)
        {
            // Authentic, and still not a payment. A verified "declined" is a normal callback.
            intent.Status = PaymentIntentStatuses.Failed;
            intent.FailureReason = "declined";
            await _db.SaveChangesAsync(ct);
            return BillingResult<bool>.Ok(false);
        }

        // Replay protection: a provider that redelivers a callback it thinks we missed must not
        // extend the subscription a second time.
        if (intent.Status == PaymentIntentStatuses.Succeeded)
            return BillingResult<bool>.Ok(true);

        intent.Status = PaymentIntentStatuses.Succeeded;
        intent.FailureReason = null;

        var plan = await _db.Plans.FirstAsync(p => p.Id == intent.PlanId, ct);
        _db.Subscriptions.Add(new Subscription
        {
            Id = Guid.NewGuid(),
            UserId = intent.UserId,
            PlanId = plan.Id,
            Status = SubscriptionStatuses.Active,
            StartsAt = now,
            // Frozen at purchase from the plan's duration AS IT IS NOW. Editing the plan later must
            // not move the end date of something already sold.
            EndsAt = now.AddDays(plan.DurationDays),
            Provider = intent.Provider,
            ExternalId = callback.ExternalId,
            CreatedAt = now,
            UpdatedAt = now,
        });

        await _db.SaveChangesAsync(ct);
        return BillingResult<bool>.Ok(true);
    }

    // ─── Admin surface ──────────────────────────────────────────────────────

    /// <summary>GET /api/admin/billing/plans — every tariff including retired ones.</summary>
    public async Task<BillingResult<IReadOnlyList<PlanResponse>>> AdminListPlansAsync(
        Guid adminId, CancellationToken ct = default)
    {
        var deny = await AdminGateAsync<IReadOnlyList<PlanResponse>>(adminId, ct);
        if (deny is not null) return deny;

        var plans = await _db.Plans.AsNoTracking()
            .OrderBy(p => p.SortOrder).ThenBy(p => p.PriceMinor)
            .ToListAsync(ct);
        return BillingResult<IReadOnlyList<PlanResponse>>.Ok(plans.Select(Out).ToList());
    }

    /// <summary>POST /api/admin/billing/plans — create a tariff.</summary>
    public async Task<BillingResult<PlanResponse>> CreatePlanAsync(
        Guid adminId, PlanUpsertRequest body, CancellationToken ct = default)
    {
        var deny = await AdminGateAsync<PlanResponse>(adminId, ct);
        if (deny is not null) return deny;

        var code = (body.Code ?? string.Empty).Trim().ToLowerInvariant();
        var name = (body.Name ?? string.Empty).Trim();
        if (code.Length == 0) return BillingResult<PlanResponse>.BadRequest("code is required");
        if (name.Length == 0) return BillingResult<PlanResponse>.BadRequest("name is required");

        var invalid = ValidatePrice(body.PriceMinor ?? 0, body.DurationDays ?? 0);
        if (invalid is not null) return BillingResult<PlanResponse>.BadRequest(invalid);

        if (await _db.Plans.AnyAsync(p => p.Code == code, ct))
            return BillingResult<PlanResponse>.BadRequest("A plan with this code already exists");

        var now = DateTime.UtcNow;
        var plan = new Plan
        {
            Id = Guid.NewGuid(),
            Code = code,
            Name = name,
            Description = Trimmed(body.Description),
            PriceMinor = body.PriceMinor ?? 0,
            Currency = NormaliseCurrency(body.Currency),
            DurationDays = body.DurationDays ?? 30,
            IsActive = body.IsActive ?? true,
            SortOrder = body.SortOrder ?? 0,
            CreatedAt = now,
            UpdatedAt = now,
        };
        _db.Plans.Add(plan);
        await _db.SaveChangesAsync(ct);

        return BillingResult<PlanResponse>.Ok(Out(plan));
    }

    /// <summary>PATCH /api/admin/billing/plans/{id} — partial update; absent fields are left alone.</summary>
    public async Task<BillingResult<PlanResponse>> UpdatePlanAsync(
        Guid adminId, Guid planId, PlanUpsertRequest body, CancellationToken ct = default)
    {
        var deny = await AdminGateAsync<PlanResponse>(adminId, ct);
        if (deny is not null) return deny;

        var plan = await _db.Plans.FirstOrDefaultAsync(p => p.Id == planId, ct);
        if (plan is null) return BillingResult<PlanResponse>.NotFound();

        if (body.Code is not null)
        {
            var code = body.Code.Trim().ToLowerInvariant();
            if (code.Length == 0) return BillingResult<PlanResponse>.BadRequest("code cannot be blank");
            if (code != plan.Code && await _db.Plans.AnyAsync(p => p.Code == code, ct))
                return BillingResult<PlanResponse>.BadRequest("A plan with this code already exists");
            plan.Code = code;
        }
        if (body.Name is not null)
        {
            var name = body.Name.Trim();
            if (name.Length == 0) return BillingResult<PlanResponse>.BadRequest("name cannot be blank");
            plan.Name = name;
        }
        if (body.Description is not null) plan.Description = Trimmed(body.Description);

        var invalid = ValidatePrice(body.PriceMinor ?? plan.PriceMinor, body.DurationDays ?? plan.DurationDays);
        if (invalid is not null) return BillingResult<PlanResponse>.BadRequest(invalid);

        if (body.PriceMinor is not null) plan.PriceMinor = body.PriceMinor.Value;
        if (body.Currency is not null) plan.Currency = NormaliseCurrency(body.Currency);
        if (body.DurationDays is not null) plan.DurationDays = body.DurationDays.Value;
        if (body.IsActive is not null) plan.IsActive = body.IsActive.Value;
        if (body.SortOrder is not null) plan.SortOrder = body.SortOrder.Value;
        plan.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync(ct);
        return BillingResult<PlanResponse>.Ok(Out(plan));
    }

    /// <summary>
    /// DELETE /api/admin/billing/plans/{id} — remove a tariff nothing has been sold under.
    ///
    /// <para>A plan with any subscription or payment attempt against it is REFUSED, not
    /// soft-deleted: those rows say what a person bought and for how much, and a delete would leave
    /// them unable to answer that. The admin screen offers "faolsizlantirish" for that case, which
    /// is what retiring a price actually means.</para>
    /// </summary>
    public async Task<BillingResult<bool>> DeletePlanAsync(
        Guid adminId, Guid planId, CancellationToken ct = default)
    {
        var deny = await AdminGateAsync<bool>(adminId, ct);
        if (deny is not null) return deny;

        var plan = await _db.Plans.FirstOrDefaultAsync(p => p.Id == planId, ct);
        if (plan is null) return BillingResult<bool>.NotFound();

        if (await _db.Subscriptions.AnyAsync(s => s.PlanId == planId, ct)
            || await _db.PaymentIntents.AnyAsync(i => i.PlanId == planId, ct))
            return BillingResult<bool>.BadRequest("plan_in_use");

        _db.Plans.Remove(plan);
        await _db.SaveChangesAsync(ct);
        return BillingResult<bool>.Ok(true);
    }

    /// <summary>GET /api/admin/billing/subscriptions — who holds what, newest first. Read-only: an
    /// admin grants premium through the existing <c>is_premium</c> switch on the student, which is
    /// deliberately a different, visible act from "this person paid".</summary>
    public async Task<BillingResult<IReadOnlyList<AdminSubscriptionResponse>>> AdminListSubscriptionsAsync(
        Guid adminId, int limit = 100, CancellationToken ct = default)
    {
        var deny = await AdminGateAsync<IReadOnlyList<AdminSubscriptionResponse>>(adminId, ct);
        if (deny is not null) return deny;

        var rows = await _db.Subscriptions.AsNoTracking()
            .Include(s => s.Plan)
            .Include(s => s.User)
            .OrderByDescending(s => s.CreatedAt)
            .Take(Math.Clamp(limit, 1, 500))
            .ToListAsync(ct);

        return BillingResult<IReadOnlyList<AdminSubscriptionResponse>>.Ok(rows
            .Select(s => new AdminSubscriptionResponse(
                Id: s.Id,
                UserId: s.UserId,
                UserName: s.User.FullName,
                UserEmail: s.User.Email,
                PlanCode: s.Plan.Code,
                PlanName: s.Plan.Name,
                Status: s.Status,
                StartsAt: s.StartsAt,
                EndsAt: s.EndsAt,
                Provider: s.Provider,
                TeacherGranted: s.User.IsPremium))
            .ToList());
    }

    // ─── Helpers ────────────────────────────────────────────────────────────

    // Did another request win the unique index with this key? Used to turn a constraint violation
    // into the winning row rather than a 500.
    private async Task<PaymentIntent?> ConflictingIntentAsync(Guid userId, string key, CancellationToken ct)
        => await _db.PaymentIntents.AsNoTracking()
            .FirstOrDefaultAsync(i => i.UserId == userId && i.IdempotencyKey == key, ct);

    private static string? ValidatePrice(long priceMinor, int durationDays)
    {
        // A negative price would be a payout, which nothing here can perform.
        if (priceMinor < 0) return "price_minor cannot be negative";
        // One year is not a policy limit, it is a typo guard: a plan of 36500 days is someone who
        // meant months, and it would grant a century of premium for one payment.
        if (durationDays is < 1 or > 366) return "duration_days must be between 1 and 366";
        return null;
    }

    private static string NormaliseCurrency(string? raw)
    {
        var code = (raw ?? string.Empty).Trim().ToUpperInvariant();
        return code.Length == 3 ? code : "UZS";
    }

    private static string? Trimmed(string? s)
    {
        if (s is null) return null;
        var t = s.Trim();
        return t.Length == 0 ? null : t;
    }

    private async Task<User?> ActiveUserAsync(Guid userId, CancellationToken ct)
    {
        var u = await _db.Users.FirstOrDefaultAsync(x => x.Id == userId, ct);
        return u is null || !u.IsActive ? null : u;
    }

    // 401 for a missing/inactive account, 403 for a real user who is not an admin — the same split
    // the Administration module uses, so the client's handling of both is unchanged.
    private async Task<BillingResult<T>?> AdminGateAsync<T>(Guid userId, CancellationToken ct)
    {
        var user = await ActiveUserAsync(userId, ct);
        if (user is null) return BillingResult<T>.Unauthorized();
        return user.Role == UserRole.Admin ? null : BillingResult<T>.Forbidden();
    }

    private static PlanResponse Out(Plan p)
        => new(p.Id, p.Code, p.Name, p.Description, p.PriceMinor, p.Currency, p.DurationDays, p.IsActive, p.SortOrder);

    private static CheckoutResponse Out(PaymentIntent i, string? redirectUrl)
        => new(i.Id, i.Status, i.Provider, i.AmountMinor, i.Currency, i.FailureReason, redirectUrl);
}
