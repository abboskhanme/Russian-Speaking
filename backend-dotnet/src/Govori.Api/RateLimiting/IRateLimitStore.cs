namespace Govori.Api.RateLimiting;

/// <summary>
/// The fixed-window counter behind the rate limiter — a faithful seam over
/// <c>backend/app/core/ratelimit.py</c>'s Redis <c>INCR</c> + <c>EXPIRE</c>. One implementation is
/// process-local (<see cref="InMemoryRateLimitStore"/>, the default), one is Redis-backed and
/// cross-instance (<see cref="RedisRateLimitStore"/>).
///
/// <para><b>FAIL-OPEN is NOT this seam's job.</b> A store MAY throw when its backend is unavailable
/// (exactly as Redis raises <c>RedisError</c>). The fail-open decision — "on a store error, ALLOW
/// the request" — lives in <see cref="StoreBackedRateLimiter"/>, which catches and permits. Keeping
/// the throw here lets an integration test inject a throwing store to prove fail-open end-to-end.</para>
/// </summary>
public interface IRateLimitStore
{
    /// <summary>
    /// Count one hit against <paramref name="key"/> in a fixed window of <paramref name="window"/>
    /// and return the post-increment count (1 on the first hit of a new window). Mirrors
    /// ratelimit.py:47-49: <c>count = INCR(key); if count == 1: EXPIRE(key, window)</c>. Throws if
    /// the backing store is unavailable.
    /// </summary>
    Task<long> HitAsync(string key, TimeSpan window, CancellationToken ct = default);
}
