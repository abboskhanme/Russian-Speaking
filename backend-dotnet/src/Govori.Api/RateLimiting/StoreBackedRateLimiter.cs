using System.Threading.RateLimiting;

namespace Govori.Api.RateLimiting;

/// <summary>
/// A <see cref="RateLimiter"/> whose window state lives in an <see cref="IRateLimitStore"/> (in
/// memory or Redis), NOT in the limiter object. This is the faithful port of
/// <c>backend/app/core/ratelimit.py</c>'s per-request check and the home of the CRITICAL
/// <b>fail-open</b> rule: it counts one hit and rejects only when the count exceeds the limit, and
/// <b>if the store throws (backend unavailable) it ALLOWS the request</b> — mirroring
/// <c>except RedisError: return</c> (ratelimit.py:50-52). Rate limiting must never take the API down
/// — the exact OPPOSITE of the OTP store, which is fail-CLOSED.
///
/// <para>Because all state is in the store, this limiter is cheap and stateless: the partitioned
/// limiter may dispose and recreate it per key without losing counts (the store keeps them).</para>
/// </summary>
internal sealed class StoreBackedRateLimiter : RateLimiter
{
    private readonly IRateLimitStore _store;
    private readonly string _key;      // full counter key: "rl:{scope}:{identity}"
    private readonly int _limit;       // max requests per window
    private readonly TimeSpan _window;

    public StoreBackedRateLimiter(IRateLimitStore store, string key, int limit, TimeSpan window)
    {
        _store = store;
        _key = key;
        _limit = limit;
        _window = window;
    }

    // Positive so the partitioned limiter can reap idle partitions; safe because counts live in the
    // store, so a reaped-then-recreated limiter resumes the same window.
    public override TimeSpan? IdleDuration => _window;

    public override RateLimiterStatistics? GetStatistics() => null;

    protected override async ValueTask<RateLimitLease> AcquireAsyncCore(
        int permitCount, CancellationToken cancellationToken)
    {
        try
        {
            var count = await _store.HitAsync(_key, _window, cancellationToken);
            return count <= _limit ? RateLimitLeases.Acquired : RateLimitLeases.Rejected;
        }
        catch
        {
            return RateLimitLeases.Acquired; // FAIL OPEN — ratelimit.py:52
        }
    }

    // The RateLimiter middleware uses this SYNCHRONOUS fast-path as its primary check, so it must
    // enforce (not no-op). The in-memory store completes synchronously; the opt-in Redis store is
    // awaited here (blocking is acceptable on the opt-in distributed path). Any store error → ALLOW
    // (FAIL OPEN — ratelimit.py:52), the same rule as the async path.
    protected override RateLimitLease AttemptAcquireCore(int permitCount)
    {
        try
        {
            var hit = _store.HitAsync(_key, _window, CancellationToken.None);
            var count = hit.IsCompletedSuccessfully ? hit.Result : hit.GetAwaiter().GetResult();
            return count <= _limit ? RateLimitLeases.Acquired : RateLimitLeases.Rejected;
        }
        catch
        {
            return RateLimitLeases.Acquired; // FAIL OPEN — ratelimit.py:52
        }
    }
}

/// <summary>Shared immutable leases — an acquired (allow) and a rejected (429) outcome. Immutable
/// with a no-op <c>Dispose</c>, so single static instances are safe to reuse across requests.</summary>
internal static class RateLimitLeases
{
    public static readonly RateLimitLease Acquired = new SimpleLease(true);
    public static readonly RateLimitLease Rejected = new SimpleLease(false);

    private sealed class SimpleLease(bool acquired) : RateLimitLease
    {
        public override bool IsAcquired { get; } = acquired;
        public override IEnumerable<string> MetadataNames => Array.Empty<string>();
        public override bool TryGetMetadata(string metadataName, out object? metadata)
        {
            metadata = null;
            return false;
        }
    }
}
