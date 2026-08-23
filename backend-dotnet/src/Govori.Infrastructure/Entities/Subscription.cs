using System;

namespace Govori.Infrastructure.Entities;

/// <summary>
/// One student's hold on a <see cref="Plan"/> for a window of time (docs/08 Faza 6.6 — the
/// <c>subscriptions</c> table).
///
/// <para><b>This table ADDS to <c>users.is_premium</c>; it does not replace it.</b> The teacher-grant
/// path is the freemium model the product actually runs on today, and it keeps working untouched.
/// Premium is therefore <c>users.is_premium OR an active row here</c> — a rule with exactly one
/// implementation, <see cref="Govori.Infrastructure.PremiumAccess"/>, which is what both the catalog
/// paywall and the billing surface read. Two copies of that rule is how a paying student gets a 402.</para>
///
/// <para><b>The window is stored, not derived.</b> <see cref="EndsAt"/> is computed once from the
/// plan's duration at purchase and then frozen, so editing a plan later cannot retroactively move
/// the end date of something already sold. <see cref="Status"/> is a separate fact from the window
/// because a subscription can be cancelled mid-window (status cancelled, <c>ends_at</c> still in the
/// future) and because an expired row must remain visibly distinct from one that never started.</para>
/// </summary>
public partial class Subscription
{
    public Guid Id { get; set; }

    public Guid UserId { get; set; }

    public Guid PlanId { get; set; }

    /// <summary>One of <see cref="Govori.Contracts"/>-free literals kept in
    /// <c>SubscriptionStatuses</c>: <c>pending</c> · <c>active</c> · <c>expired</c> ·
    /// <c>cancelled</c>. A plain string rather than a PG enum: the three enums this schema already
    /// has each needed a coordinated ADO-layer mapping (docs/07 §7.4 trap #1), and a fourth one buys
    /// nothing here — nothing joins or sorts on this value.</summary>
    public string Status { get; set; } = null!;

    public DateTime StartsAt { get; set; }

    /// <summary>End of the paid window. <c>null</c> means open-ended, which only a manually granted
    /// subscription ever is — a purchased one always has a computed end.</summary>
    public DateTime? EndsAt { get; set; }

    /// <summary>Which payment provider produced this subscription (<c>payme</c>, <c>click</c>), or
    /// <c>manual</c> for an owner-granted one. Null while no provider has been involved yet.</summary>
    public string? Provider { get; set; }

    /// <summary>The provider's own id for the underlying transaction/subscription. Kept so a
    /// reconciliation against the provider's dashboard has something to match on — without it, a
    /// disputed charge has no thread back to a row here.</summary>
    public string? ExternalId { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }

    public virtual Plan Plan { get; set; } = null!;

    public virtual User User { get; set; } = null!;
}
