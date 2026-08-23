using Govori.Infrastructure.Entities;

namespace Govori.Billing;

/// <summary>
/// The only <see cref="IPaymentProvider"/> that exists today: one that cannot take money and says so
/// (docs/08 Faza 6.6 — owner decision of 2026-08-23, "merchant hisobi hozircha yo'q").
///
/// <para><b>It refuses in every direction, and that is the whole design.</b>
/// <see cref="IsConfiguredAsync"/> is false, <see cref="CreatePaymentAsync"/> returns a failure with
/// the code <c>provider_not_configured</c>, and <see cref="VerifyWebhookAsync"/> returns null for
/// every input including a well-formed one. There is deliberately no "simulate success" switch, not
/// even one behind an environment variable: the moment such a switch exists, a misconfigured
/// deployment can tell a real student their payment went through.</para>
///
/// <para><b>Why the webhook rejects unconditionally.</b> A stub that accepted callbacks would be a
/// public endpoint that grants premium to anyone who posts the right JSON. There is no signature to
/// check because there is no shared secret, and "no secret" resolves to "verify nothing" only if you
/// write it that way — here it resolves to "verify fails".</para>
///
/// <para><b>What replacing this needs — the list the owner takes to the provider:</b></para>
/// <list type="bullet">
///   <item><b>Payme (paycom.uz)</b> — a merchant account, then: <c>MERCHANT_ID</c> (cashbox id),
///   the <c>KEY</c> (the cashbox password used for the Basic auth on incoming Merchant API calls),
///   the TEST cashbox credentials, and the callback URL to register with them
///   (<c>https://govorim.uz/api/billing/webhook/payme</c>). Payme calls US: the adapter implements
///   their Merchant API methods (<c>CheckPerformTransaction</c>, <c>CreateTransaction</c>,
///   <c>PerformTransaction</c>, <c>CancelTransaction</c>, <c>CheckTransaction</c>) and authenticates
///   every one of them against that key before doing anything. Amounts are in TIYIN, which is why
///   this module stores minor units.</item>
///   <item><b>Click (click.uz)</b> — a merchant account, then: <c>SERVICE_ID</c>,
///   <c>MERCHANT_ID</c>, <c>MERCHANT_USER_ID</c>, the <c>SECRET_KEY</c>, and the two callback URLs
///   to register (<c>/api/billing/webhook/click</c> serving both Prepare and Complete). Click signs
///   its callbacks with an MD5 over a fixed field order plus the secret key; the adapter must
///   recompute and compare that before acting. Amounts are in so'm with a decimal part here, so the
///   adapter converts at its own boundary and stores tiyin.</item>
///   <item>For both: a TEST/sandbox merchant while integrating, and a static outbound IP if the
///   provider allowlists callers.</item>
/// </list>
/// </summary>
public sealed class UnconfiguredPaymentProvider : IPaymentProvider
{
    /// <summary>The name stored on intents while nothing is wired up. Not "payme" or "click" — a row
    /// must never claim it was handled by a provider that was never called.</summary>
    public const string ProviderName = "none";

    /// <summary>The machine code every refusal from here carries. The frontend translates it into
    /// "To'lov tizimi hali ulanmagan"; tests assert on the code, not on the sentence.</summary>
    public const string NotConfiguredReason = "provider_not_configured";

    public string Name => ProviderName;

    public Task<bool> IsConfiguredAsync(CancellationToken ct = default) => Task.FromResult(false);

    public Task<PaymentStartResult> CreatePaymentAsync(PaymentIntent intent, CancellationToken ct = default)
        => Task.FromResult(PaymentStartResult.Failure(NotConfiguredReason));

    public Task<PaymentCallback?> VerifyWebhookAsync(
        string rawBody, IReadOnlyDictionary<string, string> headers, CancellationToken ct = default)
        => Task.FromResult<PaymentCallback?>(null);
}
