using Govori.Platform.Otp;
using StackExchange.Redis;

namespace Govori.Platform.Telegram;

/// <summary>The phone + code + request id stashed behind a deep-link token.</summary>
public sealed record TelegramOtpLink(string Phone, string Code, string RequestId);

/// <summary>
/// The short-lived Redis state that bridges the phone-OTP request (API side: mints the token +
/// a <c>t.me/&lt;bot&gt;?start=&lt;token&gt;</c> deep link) and the Telegram bot poller (Worker side:
/// resolves the token, PROVES the Telegram account owns the phone, then DMs the code).
///
/// <para><b>Key scheme — Platform owns it</b> (both sides must agree exactly):</para>
/// <code>
/// otp:{phone}            the OTP code itself (written by Identity's RedisOtpStore)
/// otp_tok:{token}        hash { phone, code, request_id }   TTL = OTP TTL
/// otp_req:{request_id}   delivery-state string              TTL = OTP TTL
/// tg_pending:{tg_user_id} token this Telegram user is answering, TTL = 600 s
/// </code>
///
/// <para><b>token vs request_id.</b> The <c>token</c> is the SECRET: whoever holds it can ask the
/// bot for the code. The <c>request_id</c> is a separate opaque id that grants nothing — it maps
/// only to a state string — so it is the safe thing to put in the polling query string. Never swap
/// the two.</para>
///
/// <para>Lives in Platform (the outside-world layer, one-way from domains + hosts) precisely so BOTH
/// the API-side sender (Govori.Identity) and the Worker-side poller (Govori.Worker) can share this
/// scheme without a domain↔host reference. It is NOT the OTP verification store — verification still
/// checks <c>otp:{phone}</c> (IOtpStore, fail-closed); this only carries the code to Telegram and
/// reports what happened.</para>
/// </summary>
public interface ITelegramOtpLinkStore
{
    /// <summary>Mint an unguessable token, store <paramref name="phone"/> + <paramref name="code"/>
    /// + <paramref name="requestId"/> under it with the given TTL, and return the token to embed in
    /// the deep link.</summary>
    Task<string> CreateAsync(string phone, string code, string requestId, int ttlSeconds, CancellationToken ct = default);

    /// <summary>Resolve a start-token to its phone + code + request id, or <c>null</c> if
    /// unknown/expired. Does NOT consume the token (TTL cleans it up), so pressing Start again
    /// re-runs the flow within the window.</summary>
    Task<TelegramOtpLink?> ResolveAsync(string token, CancellationToken ct = default);

    /// <summary>Record where delivery stands for <paramref name="requestId"/>. Values are the state
    /// machine documented on <c>OtpStatusResponse</c>: <c>pending</c>, <c>awaiting_contact</c>,
    /// <c>sent</c>, <c>mismatch</c>, <c>not_own_contact</c> (absent ⇒ expired).</summary>
    Task SetStateAsync(string requestId, string state, int ttlSeconds, CancellationToken ct = default);

    /// <summary>Current delivery state, or <c>null</c> when the id is unknown or has expired.</summary>
    Task<string?> GetStateAsync(string requestId, CancellationToken ct = default);

    /// <summary>
    /// Burn the pending OTP so a failed ownership proof cannot be retried: deletes BOTH
    /// <c>otp:{phone}</c> (the code itself — verification now fails closed) and
    /// <c>otp_tok:{token}</c> (the deep link — pressing Start again resolves to nothing).
    ///
    /// <para>This is what makes a <c>mismatch</c> / <c>not_own_contact</c> real rather than
    /// cosmetic. It deletes the Identity-owned <c>otp:{phone}</c> key DIRECTLY because the Worker
    /// cannot reference Govori.Identity (host→domain edge); the key scheme documented on this
    /// interface is the contract that keeps the two in step. Identity's own equivalent primitive is
    /// <c>IOtpStore.InvalidateAsync</c>.</para>
    /// </summary>
    Task BurnAsync(string phone, string token, CancellationToken ct = default);

    /// <summary>Remember which start-token a Telegram user is currently answering, so the
    /// <c>message.contact</c> they send NEXT can be matched back to the right OTP request.</summary>
    Task SetPendingTokenAsync(long telegramUserId, string token, int ttlSeconds, CancellationToken ct = default);

    /// <summary>The token this Telegram user is answering, or <c>null</c> (a stale/unsolicited
    /// contact share — ignore it politely).</summary>
    Task<string?> GetPendingTokenAsync(long telegramUserId, CancellationToken ct = default);

    /// <summary>Forget the pending token. Called on every terminal outcome, success or refusal.</summary>
    Task ClearPendingTokenAsync(long telegramUserId, CancellationToken ct = default);
}

/// <summary>Redis-backed <see cref="ITelegramOtpLinkStore"/> (StackExchange.Redis), targeting the
/// same <c>govori-redis</c> the OTP store + SignalR backplane use.</summary>
public sealed class RedisTelegramOtpLinkStore : ITelegramOtpLinkStore
{
    /// <summary>TTL of <c>tg_pending:{tg_user_id}</c>. Longer than a keyboard tap needs, short
    /// enough that an abandoned prompt cannot bind a later, unrelated contact share.</summary>
    public const int PendingTokenTtlSeconds = 600;

    private readonly IConnectionMultiplexer _redis;

    public RedisTelegramOtpLinkStore(IConnectionMultiplexer redis) => _redis = redis;

    private static RedisKey TokenKey(string token) => $"otp_tok:{token}";

    private static RedisKey StateKey(string requestId) => $"otp_req:{requestId}";

    private static RedisKey PendingKey(long telegramUserId) => $"tg_pending:{telegramUserId}";

    public async Task<string> CreateAsync(string phone, string code, string requestId, int ttlSeconds, CancellationToken ct = default)
    {
        // 122-bit URL-safe token — unguessable enough for a short-lived, single-purpose deep link.
        var token = Guid.NewGuid().ToString("N");
        var db = _redis.GetDatabase();
        await db.HashSetAsync(TokenKey(token), new[]
        {
            new HashEntry("phone", phone),
            new HashEntry("code", code),
            new HashEntry("request_id", requestId),
        });
        await db.KeyExpireAsync(TokenKey(token), TimeSpan.FromSeconds(ttlSeconds));
        return token;
    }

    public async Task<TelegramOtpLink?> ResolveAsync(string token, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(token))
            return null;
        var db = _redis.GetDatabase();
        var entries = await db.HashGetAllAsync(TokenKey(token));
        if (entries.Length == 0)
            return null;

        string? phone = null, code = null, requestId = null;
        foreach (var e in entries)
        {
            if (e.Name == "phone") phone = e.Value;
            else if (e.Name == "code") code = e.Value;
            else if (e.Name == "request_id") requestId = e.Value;
        }
        // request_id is tolerated as absent so a link minted by an older build still delivers;
        // an empty id simply means nothing can poll for its state.
        return phone is null || code is null
            ? null
            : new TelegramOtpLink(phone, code, requestId ?? string.Empty);
    }

    public async Task SetStateAsync(string requestId, string state, int ttlSeconds, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(requestId))
            return; // nothing to key on — a link with no request id simply isn't pollable
        var db = _redis.GetDatabase();
        await db.StringSetAsync(StateKey(requestId), state, TimeSpan.FromSeconds(ttlSeconds));
    }

    public async Task<string?> GetStateAsync(string requestId, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(requestId))
            return null;
        var db = _redis.GetDatabase();
        var value = await db.StringGetAsync(StateKey(requestId));
        return value.IsNullOrEmpty ? null : value.ToString();
    }

    public async Task BurnAsync(string phone, string token, CancellationToken ct = default)
    {
        var db = _redis.GetDatabase();
        // Kill the code FIRST: it is the thing that would grant a session. Killing the deep link
        // first would leave a window where the token is gone but the code still verifies.
        if (!string.IsNullOrWhiteSpace(phone))
        {
            await db.KeyDeleteAsync(OtpRedisKeys.Code(phone));
            // The wrong-guess counter goes too, so a burn leaves no partial state behind for the
            // next legitimately-requested code to inherit.
            await db.KeyDeleteAsync(OtpRedisKeys.Attempts(phone));
        }
        if (!string.IsNullOrWhiteSpace(token))
            await db.KeyDeleteAsync(TokenKey(token));
    }

    public async Task SetPendingTokenAsync(long telegramUserId, string token, int ttlSeconds, CancellationToken ct = default)
    {
        var db = _redis.GetDatabase();
        await db.StringSetAsync(PendingKey(telegramUserId), token, TimeSpan.FromSeconds(ttlSeconds));
    }

    public async Task<string?> GetPendingTokenAsync(long telegramUserId, CancellationToken ct = default)
    {
        var db = _redis.GetDatabase();
        var value = await db.StringGetAsync(PendingKey(telegramUserId));
        return value.IsNullOrEmpty ? null : value.ToString();
    }

    public async Task ClearPendingTokenAsync(long telegramUserId, CancellationToken ct = default)
    {
        var db = _redis.GetDatabase();
        await db.KeyDeleteAsync(PendingKey(telegramUserId));
    }
}
