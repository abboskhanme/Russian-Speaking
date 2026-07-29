using StackExchange.Redis;

namespace Govori.Identity.Providers;

/// <summary>
/// The short-lived "user X is in the middle of changing their number to Y" binding behind
/// <c>POST /api/auth/phone/change/request</c> → <c>/confirm</c>.
///
/// <para><b>This is NOT a second OTP system.</b> The code itself is minted, delivered and verified
/// by the existing seams exactly as it is at login — <see cref="IOtpStore"/> keyed by the NEW phone,
/// <see cref="IOtpDeliverySender"/> for delivery, and (in bot delivery) the Telegram contact-share
/// proof on top. This store holds the one fact none of them can: WHICH user asked for WHICH
/// number.</para>
///
/// <para><b>Why it must exist (security).</b> The OTP is keyed by phone, so a code alone says
/// "somebody proved they hold this number" — it does not say who asked. Without a server-side
/// user→phone binding, <c>confirm</c> would have to take the target number from the request body,
/// and then any authenticated caller who observed a live code for a number could claim that number
/// onto their OWN account. Keying by user id makes a pending change unusable by anyone but the user
/// who started it, and makes the target number unforgeable by the client.</para>
///
/// <para>Redis-backed with the OTP's own TTL: the binding must not outlive the code it belongs to.
/// A single pending change per user — asking again simply overwrites, so the last number requested
/// is the only one that can be confirmed.</para>
/// </summary>
public interface IPendingPhoneChangeStore
{
    /// <summary>Record that <paramref name="userId"/> is changing to <paramref name="newPhone"/>
    /// (already normalised), replacing any earlier pending change for that user.</summary>
    Task SetAsync(Guid userId, string newPhone, int ttlSeconds, CancellationToken ct = default);

    /// <summary>The phone <paramref name="userId"/> is currently changing to, or <c>null</c> when
    /// there is no pending change (never started, already confirmed, or expired).</summary>
    Task<string?> GetAsync(Guid userId, CancellationToken ct = default);

    /// <summary>Drop the pending change. Called once the new number is written, so a code cannot be
    /// replayed against an already-completed change.</summary>
    Task ClearAsync(Guid userId, CancellationToken ct = default);
}

/// <summary>
/// Redis-backed <see cref="IPendingPhoneChangeStore"/> (StackExchange.Redis), targeting the same
/// <c>govori-redis</c> as the OTP store.
///
/// <para>The key is derived from the USER ID and nothing else, so the binding cannot be addressed —
/// let alone redirected — by anything the client sends. The key scheme stays private to this class
/// (unlike <c>OtpRedisKeys</c>, which is shared in Platform because the Worker burns those keys
/// too): nothing outside the Identity module reads or writes this state.</para>
/// </summary>
public sealed class RedisPendingPhoneChangeStore : IPendingPhoneChangeStore
{
    private readonly IConnectionMultiplexer _redis;

    public RedisPendingPhoneChangeStore(IConnectionMultiplexer redis) => _redis = redis;

    private static RedisKey Key(Guid userId) => $"phone_change:{userId:D}";

    public async Task SetAsync(Guid userId, string newPhone, int ttlSeconds, CancellationToken ct = default)
        => await _redis.GetDatabase()
            .StringSetAsync(Key(userId), newPhone, TimeSpan.FromSeconds(ttlSeconds));

    public async Task<string?> GetAsync(Guid userId, CancellationToken ct = default)
    {
        var value = await _redis.GetDatabase().StringGetAsync(Key(userId));
        return value.IsNullOrEmpty ? null : value.ToString();
    }

    public async Task ClearAsync(Guid userId, CancellationToken ct = default)
        => await _redis.GetDatabase().KeyDeleteAsync(Key(userId));
}
