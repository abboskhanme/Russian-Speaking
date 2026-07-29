using StackExchange.Redis;

namespace Govori.Api.RateLimiting;

/// <summary>
/// Redis-backed fixed-window counter: <c>INCR key</c>, and on the FIRST hit of a window
/// (<c>count == 1</c>) set <c>EXPIRE key window</c> — so the window is anchored to the first request
/// and never slides. Shared across all API instances, so N replicas enforce ONE limit (the distributed
/// case docs/07 §7.3 calls for).
///
/// <para>Reuses the process-wide <see cref="IConnectionMultiplexer"/> already registered for the OTP
/// store. On a Redis outage the StackExchange calls throw <see cref="RedisException"/>; this store
/// deliberately lets that propagate — <see cref="StoreBackedRateLimiter"/> catches it and ALLOWS the
/// request (fail-open). Opt in with <c>GOVORI_RATELIMIT_BACKEND=redis</c>.</para>
/// </summary>
public sealed class RedisRateLimitStore : IRateLimitStore
{
    private readonly IConnectionMultiplexer _redis;

    public RedisRateLimitStore(IConnectionMultiplexer redis) => _redis = redis;

    public async Task<long> HitAsync(string key, TimeSpan window, CancellationToken ct = default)
    {
        var db = _redis.GetDatabase();
        var count = await db.StringIncrementAsync(key);        // INCR
        if (count == 1)
            await db.KeyExpireAsync(key, window);              // EXPIRE on the first hit only
        return count;
    }
}
