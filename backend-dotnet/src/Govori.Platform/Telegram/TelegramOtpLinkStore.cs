using StackExchange.Redis;

namespace Govori.Platform.Telegram;

/// <summary>The phone + code stashed behind a deep-link token.</summary>
public sealed record TelegramOtpLink(string Phone, string Code);

/// <summary>
/// Short-lived Redis mapping <c>otp_tok:{token} → { phone, code }</c> that bridges the phone-OTP
/// request (which mints the token + a <c>t.me/&lt;bot&gt;?start=&lt;token&gt;</c> deep link) and the
/// Telegram bot poller (which, when the user presses Start, resolves the token and DMs the code).
///
/// <para>Lives in Platform (the outside-world layer, one-way from domains + hosts) precisely so BOTH
/// the API-side sender (Govori.Identity) and the Worker-side poller (Govori.Worker) can share the
/// key scheme without a domain↔host reference. It is NOT the OTP verification store — verification
/// still checks <c>otp:{phone}</c> (IOtpStore, fail-closed); this only carries the code to Telegram.</para>
/// </summary>
public interface ITelegramOtpLinkStore
{
    /// <summary>Mint an unguessable token, store <paramref name="phone"/> + <paramref name="code"/>
    /// under it with the given TTL, and return the token to embed in the deep link.</summary>
    Task<string> CreateAsync(string phone, string code, int ttlSeconds, CancellationToken ct = default);

    /// <summary>Resolve a start-token to its phone + code, or <c>null</c> if unknown/expired. Does
    /// NOT consume the token (TTL cleans it up), so pressing Start again re-sends within the window.</summary>
    Task<TelegramOtpLink?> ResolveAsync(string token, CancellationToken ct = default);
}

/// <summary>Redis-backed <see cref="ITelegramOtpLinkStore"/> (StackExchange.Redis), targeting the
/// same <c>govori-redis</c> the OTP store + SignalR backplane use.</summary>
public sealed class RedisTelegramOtpLinkStore : ITelegramOtpLinkStore
{
    private readonly IConnectionMultiplexer _redis;

    public RedisTelegramOtpLinkStore(IConnectionMultiplexer redis) => _redis = redis;

    private static RedisKey Key(string token) => $"otp_tok:{token}";

    public async Task<string> CreateAsync(string phone, string code, int ttlSeconds, CancellationToken ct = default)
    {
        // 122-bit URL-safe token — unguessable enough for a short-lived, single-purpose deep link.
        var token = Guid.NewGuid().ToString("N");
        var db = _redis.GetDatabase();
        await db.HashSetAsync(Key(token), new[]
        {
            new HashEntry("phone", phone),
            new HashEntry("code", code),
        });
        await db.KeyExpireAsync(Key(token), TimeSpan.FromSeconds(ttlSeconds));
        return token;
    }

    public async Task<TelegramOtpLink?> ResolveAsync(string token, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(token))
            return null;
        var db = _redis.GetDatabase();
        var entries = await db.HashGetAllAsync(Key(token));
        if (entries.Length == 0)
            return null;

        string? phone = null, code = null;
        foreach (var e in entries)
        {
            if (e.Name == "phone") phone = e.Value;
            else if (e.Name == "code") code = e.Value;
        }
        return phone is null || code is null ? null : new TelegramOtpLink(phone, code);
    }
}
