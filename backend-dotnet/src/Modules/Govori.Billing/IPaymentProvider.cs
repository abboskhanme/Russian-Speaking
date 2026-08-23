using Govori.Infrastructure.Entities;

namespace Govori.Billing;

/// <summary>
/// The payment-provider seam (docs/08 Faza 6.6). One adapter per provider; the rest of the module
/// knows only this interface, so wiring Payme or Click later is a registration change and nothing
/// else.
///
/// <para><b>There is exactly one implementation today</b> —
/// <see cref="UnconfiguredPaymentProvider"/> — and it never succeeds. The owner has no merchant
/// account yet, so the honest state of this system is "payments are not connected", and every
/// surface says so. A stub that pretended to take money would be worse than no payments at all: the
/// student would be told their subscription is active, would stop being asked to pay, and would find
/// out it was untrue the next time the paywall stopped them.</para>
///
/// <para><b>What a real adapter must do</b>, so the next person does not have to derive it:</para>
/// <list type="number">
///   <item><see cref="IsConfiguredAsync"/> returns true ONLY when every credential it needs is
///   present. A half-configured provider must report false and be skipped, never called.</item>
///   <item><see cref="CreatePaymentAsync"/> is given an intent row that ALREADY EXISTS in the
///   database, carrying the caller's idempotency key. The adapter must pass an idempotency token
///   derived from it to the provider where the provider supports one, so a retry at their end is
///   also a no-op.</item>
///   <item><see cref="VerifyWebhookAsync"/> must verify the SIGNATURE before anything else, and must
///   return false on any doubt. An unverified callback that is allowed to grant a subscription is a
///   self-service premium button for anyone who can reach the URL — this is the single most
///   dangerous line of code in the billing module.</item>
/// </list>
/// </summary>
public interface IPaymentProvider
{
    /// <summary>Provider name as it is stored on rows and shown to operators (<c>payme</c>,
    /// <c>click</c>, or <c>none</c>).</summary>
    string Name { get; }

    /// <summary>Whether this adapter has everything it needs to take a real payment. Async because a
    /// real adapter resolves its credentials from <c>app_settings</c>, exactly as the AI backends
    /// do, so a key pasted into the admin panel takes effect without a restart.</summary>
    Task<bool> IsConfiguredAsync(CancellationToken ct = default);

    /// <summary>
    /// Ask the provider to start a payment for an intent that is already persisted.
    ///
    /// <para>Returning <see cref="PaymentStartResult.Failure"/> is a normal outcome, not an
    /// exception: "no provider is configured" and "the provider declined" are both states the
    /// student's screen has to render, and neither is a server fault.</para>
    /// </summary>
    Task<PaymentStartResult> CreatePaymentAsync(PaymentIntent intent, CancellationToken ct = default);

    /// <summary>
    /// Verify a callback's authenticity. <paramref name="rawBody"/> is the EXACT bytes as received —
    /// signatures are computed over the raw payload, so a body that has been parsed and re-serialised
    /// can no longer be verified.
    /// </summary>
    /// <returns>The verified callback, or <c>null</c> when it does not verify. There is no third
    /// answer: anything that is not provably from the provider is discarded.</returns>
    Task<PaymentCallback?> VerifyWebhookAsync(
        string rawBody, IReadOnlyDictionary<string, string> headers, CancellationToken ct = default);
}

/// <summary>
/// What happened when a provider was asked to start a payment.
/// </summary>
/// <param name="Ok">True only when the provider accepted the request. A stub NEVER returns true.</param>
/// <param name="Status">The status to write on the intent (see <c>PaymentIntentStatuses</c>).</param>
/// <param name="Reason">Machine code explaining a failure — <c>provider_not_configured</c>,
/// <c>declined</c>, <c>provider_unreachable</c>. Null on success.</param>
/// <param name="RedirectUrl">Where to send the payer, when the provider issued a checkout URL.</param>
/// <param name="ExternalId">The provider's transaction id, when they issued one.</param>
/// <param name="RawPayload">The provider's raw response, stored verbatim for reconciliation.</param>
public sealed record PaymentStartResult(
    bool Ok,
    string Status,
    string? Reason = null,
    string? RedirectUrl = null,
    string? ExternalId = null,
    string? RawPayload = null)
{
    /// <summary>A refusal that is a normal, renderable state rather than an error.</summary>
    public static PaymentStartResult Failure(string reason, string? rawPayload = null)
        => new(false, Govori.Infrastructure.Entities.PaymentIntentStatuses.Failed, reason, RawPayload: rawPayload);
}

/// <summary>
/// A callback that has PASSED signature verification. Constructing one is an assertion that the
/// provider really sent it — nothing else in the module re-checks, so no code path may build this
/// from an unverified body.
/// </summary>
/// <param name="ExternalId">The provider's transaction id.</param>
/// <param name="IdempotencyKey">The key the intent was created with, echoed back by the provider,
/// so the callback can be matched to its intent without trusting a client-supplied id.</param>
/// <param name="Paid">Whether the money actually moved. A verified callback that says "not paid" is
/// still authentic, and still must not grant a subscription.</param>
/// <param name="RawPayload">The exact body, stored for reconciliation.</param>
public sealed record PaymentCallback(
    string ExternalId,
    string IdempotencyKey,
    bool Paid,
    string RawPayload);
