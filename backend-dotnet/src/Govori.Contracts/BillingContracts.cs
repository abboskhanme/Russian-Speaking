namespace Govori.Contracts;

/// <summary>
/// One tariff as a client sees it (docs/08 Faza 6.6).
///
/// <para><b>The price crosses the wire as MINOR units</b> (<paramref name="PriceMinor"/>, tiyin) and
/// as a whole number. The frontend divides by 100 once, at the moment it formats — the value itself
/// never becomes a float, because a price that has been through a float is a price that can be
/// wrong by a tiyin, and money is the one number where that is not acceptable.
/// <paramref name="Currency"/> travels with it so the formatter never has to assume so'm.</para>
/// </summary>
public sealed record PlanResponse(
    Guid Id,
    string Code,
    string Name,
    string? Description,
    long PriceMinor,
    string Currency,
    int DurationDays,
    bool IsActive,
    int SortOrder);

/// <summary>Admin create/update of a tariff. Every field is optional on update; an absent field is
/// left alone (same partial-update contract the rest of the admin surface uses).</summary>
public sealed record PlanUpsertRequest(
    string? Code = null,
    string? Name = null,
    string? Description = null,
    long? PriceMinor = null,
    string? Currency = null,
    int? DurationDays = null,
    bool? IsActive = null,
    int? SortOrder = null);

/// <summary>
/// The caller's own billing state — one request that answers everything the profile and the
/// premium screen need.
/// </summary>
/// <param name="IsPremium">The resolved answer, from the single source
/// (<c>Govori.Infrastructure.PremiumAccess</c>): a teacher grant OR an active subscription. This is
/// the SAME boolean the 402 gate uses, so the screen can never disagree with the paywall.</param>
/// <param name="Source"><c>teacher</c> (granted), <c>subscription</c> (paid), or <c>none</c>.
/// The distinction is shown to the student because "your teacher gave you premium" and "you are
/// paying for premium" are different facts about their account.</param>
/// <param name="Status">The subscription row's status, or <c>none</c> when there has never been
/// one. A lapsed subscription still reports here, so the screen can say when it ended.</param>
/// <param name="PaymentsEnabled">The <c>payments_enabled</c> flag. OFF by default.</param>
/// <param name="ProviderConfigured">Whether a payment provider is actually wired up. FALSE while
/// the adapter is a stub — and when it is false the UI must say so plainly instead of offering a
/// purchase that cannot happen.</param>
public sealed record SubscriptionStatusResponse(
    bool IsPremium,
    string Source,
    string Status,
    PlanResponse? Plan,
    DateTime? StartsAt,
    DateTime? EndsAt,
    bool PaymentsEnabled,
    bool ProviderConfigured,
    string Provider);

/// <summary>
/// Start a purchase.
/// </summary>
/// <param name="PlanId">Which tariff.</param>
/// <param name="IdempotencyKey">Caller-minted de-duplication key. Optional on the wire: when it is
/// absent the server mints one, which protects nothing — the point of the key is that a RETRY
/// carries the SAME one. Clients are expected to mint it once per purchase attempt and resend it
/// verbatim.</param>
public sealed record CheckoutRequest(Guid PlanId, string? IdempotencyKey = null);

/// <summary>
/// The result of a purchase attempt.
/// </summary>
/// <param name="Status">The intent's status. While no provider is configured this is
/// <c>failed</c> — never <c>succeeded</c>, never <c>pending</c>.</param>
/// <param name="Reason">Machine code for a non-success (<c>provider_not_configured</c>,
/// <c>payments_disabled</c>, …). The message the student reads is translated client-side from this
/// code, so the server never has to guess their language.</param>
/// <param name="RedirectUrl">Where to send the payer, once a real adapter produces one. Always
/// null in the stub.</param>
public sealed record CheckoutResponse(
    Guid IntentId,
    string Status,
    string Provider,
    long AmountMinor,
    string Currency,
    string? Reason,
    string? RedirectUrl);

/// <summary>One subscription row for the admin's read-only view of who holds what.</summary>
/// <param name="TeacherGranted">The user's <c>is_premium</c> flag, shown beside the subscription so
/// an admin can see WHY someone has premium — the two routes are independent and both are real.</param>
public sealed record AdminSubscriptionResponse(
    Guid Id,
    Guid UserId,
    string UserName,
    string? UserEmail,
    string PlanCode,
    string PlanName,
    string Status,
    DateTime StartsAt,
    DateTime? EndsAt,
    string? Provider,
    bool TeacherGranted);
