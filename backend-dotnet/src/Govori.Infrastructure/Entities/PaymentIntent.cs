using System;

namespace Govori.Infrastructure.Entities;

/// <summary>
/// One attempt to pay for a <see cref="Plan"/> (docs/08 Faza 6.6 — the <c>payment_intents</c> table):
/// who tried, for what, how much, through which provider, and what came back.
///
/// <para><b>Why "intent" and not "payment".</b> The row is written BEFORE the provider is called and
/// survives every outcome, including the ones where no money moved. A table called <c>payments</c>
/// invites rows to be written only on success, and then the failures — the ones an operator actually
/// has to investigate — exist nowhere.</para>
///
/// <para><b><see cref="IdempotencyKey"/> is here from the first commit, not deferred.</b> It is
/// unique per user, so a retried request (a double-tapped button, a client that resends after a
/// timeout, a provider that redelivers) resolves to the SAME row instead of a second charge. Adding
/// this later would mean shipping a window in which the bug it prevents is "two payments taken for
/// one purchase", which is not a defect anyone gets to fix afterwards — the money is already gone.</para>
///
/// <para><b><see cref="ProviderPayload"/> holds the provider's raw answer</b> so a dispute can be
/// settled against what the provider actually said rather than against our summary of it. It must
/// never be written with anything the provider did not send, and never with card data — no provider
/// integration here handles a PAN, and if one ever appears in this column it is a defect, not a
/// feature.</para>
/// </summary>
public partial class PaymentIntent
{
    public Guid Id { get; set; }

    public Guid UserId { get; set; }

    public Guid PlanId { get; set; }

    /// <summary>Amount in MINOR units (tiyin), copied from the plan at creation time. Copied, not
    /// joined: the amount charged must be the amount that was displayed, even after the plan's price
    /// changes.</summary>
    public long AmountMinor { get; set; }

    /// <summary>ISO-4217 code, copied from the plan for the same reason as the amount.</summary>
    public string Currency { get; set; } = null!;

    /// <summary><c>created</c> · <c>pending</c> · <c>succeeded</c> · <c>failed</c> ·
    /// <c>cancelled</c> (see <c>PaymentIntentStatuses</c>). While no provider is configured an intent
    /// never leaves <c>failed</c> — see <c>UnconfiguredPaymentProvider</c>.</summary>
    public string Status { get; set; } = null!;

    /// <summary>Which adapter was asked to take the money (<c>payme</c>, <c>click</c>, or
    /// <c>none</c> while none is configured).</summary>
    public string Provider { get; set; } = null!;

    /// <summary>The provider's transaction id, once there is one.</summary>
    public string? ExternalId { get; set; }

    /// <summary>Caller-supplied de-duplication key, unique per user. See the type remarks.</summary>
    public string IdempotencyKey { get; set; } = null!;

    /// <summary>The provider's raw response, as JSON. Null until a provider answers.</summary>
    public string? ProviderPayload { get; set; }

    /// <summary>Short machine reason for a non-success (<c>provider_not_configured</c>,
    /// <c>declined</c>, …). Deliberately a code and not a sentence: this is read by operators and
    /// matched by tests, while the message a student sees is translated in the frontend.</summary>
    public string? FailureReason { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }

    public virtual Plan Plan { get; set; } = null!;

    public virtual User User { get; set; } = null!;
}
