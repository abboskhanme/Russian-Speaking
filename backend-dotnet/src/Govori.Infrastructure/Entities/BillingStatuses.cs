namespace Govori.Infrastructure.Entities;

/// <summary>
/// The values <see cref="Subscription.Status"/> may hold (docs/08 Faza 6.6).
///
/// <para>They live beside the entity rather than in <c>Govori.Contracts</c> because they are a
/// property of the STORED data — <see cref="Govori.Infrastructure.PremiumAccess"/> queries on
/// <see cref="Active"/>, and that query is the one place premium is decided. They travel to the
/// client unchanged, so the frontend's union type spells the same four words.</para>
/// </summary>
public static class SubscriptionStatuses
{
    /// <summary>Created, not paid for yet. Grants NOTHING — a pending subscription is a record of an
    /// intention, and treating it as access is exactly how an unpaid user gets premium.</summary>
    public const string Pending = "pending";

    /// <summary>Paid and inside its window. The ONLY status that grants premium.</summary>
    public const string Active = "active";

    /// <summary>Its window has passed.</summary>
    public const string Expired = "expired";

    /// <summary>Ended early. The window may still be in the future, which is why status and window
    /// are separate facts — see <see cref="Subscription"/>.</summary>
    public const string Cancelled = "cancelled";
}

/// <summary>The values <see cref="PaymentIntent.Status"/> may hold.</summary>
public static class PaymentIntentStatuses
{
    /// <summary>The row exists; no provider has been called yet.</summary>
    public const string Created = "created";

    /// <summary>Handed to the provider, awaiting their callback.</summary>
    public const string Pending = "pending";

    /// <summary>The provider confirmed the money moved. Written ONLY from a verified provider
    /// callback — never from a client request, and never by the stub adapter.</summary>
    public const string Succeeded = "succeeded";

    /// <summary>The attempt ended without money moving. Carries a
    /// <see cref="PaymentIntent.FailureReason"/> code.</summary>
    public const string Failed = "failed";

    /// <summary>Abandoned by the payer.</summary>
    public const string Cancelled = "cancelled";
}
