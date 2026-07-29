namespace Govori.Platform.Telegram;

/// <summary>
/// A proven Telegram↔phone pair: "<paramref name="TelegramUserId"/> demonstrated, by sharing its
/// OWN contact, that it owns <paramref name="Phone"/> at <paramref name="VerifiedAt"/>."
/// </summary>
public sealed record TelegramBinding(long TelegramUserId, string Phone, DateTime VerifiedAt);

/// <summary>
/// Durable store of proven Telegram↔phone pairs (Postgres table <c>telegram_bindings</c>).
///
/// <para><b>What this is NOT.</b> A binding is a SPEED CACHE that lets an already-proven pair skip
/// re-proving on the next login. It is never, on its own, an authorization decision. The invariant
/// the whole feature rests on is: <i>a code is only ever delivered to a Telegram account that has
/// PROVEN, via a contact share where <c>contact.user_id == message.from.id</c>, that it owns that
/// exact phone number.</i> A row here only records that such a proof already happened; nothing else
/// in the system may write one.</para>
///
/// <para>The interface lives in Platform so both hosts can depend on it; the EF implementation lives
/// in Govori.Infrastructure (which owns the DbContext), because Platform must NOT reference
/// Infrastructure.</para>
/// </summary>
public interface ITelegramBindingStore
{
    /// <summary>The phone this Telegram account has proven it owns, or <c>null</c> if it never has.</summary>
    Task<TelegramBinding?> GetAsync(long telegramUserId, CancellationToken ct = default);

    /// <summary>
    /// Every Telegram user id that has PROVEN ownership of <paramref name="phone"/> (queried by the
    /// indexed <c>phone</c> column). A phone may have several bound ids — e.g. the same person proved
    /// it from two Telegram accounts — so all are returned; the proactive OTP sender DMs the code to
    /// each. Empty when the phone has no binding yet (a brand-new / never-proven number). Never null.
    /// </summary>
    Task<IReadOnlyList<long>> TelegramIdsForPhoneAsync(string phone, CancellationToken ct = default);

    /// <summary>
    /// Record a fresh proof. UPSERT: re-proving ownership of a DIFFERENT phone REBINDS the Telegram
    /// account to the new number (a user who changes SIM must not be locked out, and the old pair
    /// must not survive as a stale fast path).
    /// </summary>
    Task UpsertAsync(long telegramUserId, string phone, CancellationToken ct = default);
}
