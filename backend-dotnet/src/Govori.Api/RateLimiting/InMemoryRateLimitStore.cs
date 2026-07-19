using System.Collections.Concurrent;

namespace Govori.Api.RateLimiting;

/// <summary>
/// Process-local fixed-window counter — the DEFAULT store. Correct for a single API instance and
/// keeps the rate-limit semantics (limits + per-IP/user keying + the fail-open decision, which is
/// in <see cref="StoreBackedRateLimiter"/>) faithful to <c>ratelimit.py</c> without a Redis
/// dependency at boot.
///
/// <para>TODO(distributed, docs/07 §7.3): this counts PER-INSTANCE, so behind N replicas the
/// effective limit is N×. Set <c>GOVORI_RATELIMIT_BACKEND=redis</c> to swap in
/// <see cref="RedisRateLimitStore"/> (already implemented) for one shared cross-instance counter.
/// Kept as the default so integration tests stay isolated per host and never accumulate against a
/// shared Redis across the suite.</para>
/// </summary>
public sealed class InMemoryRateLimitStore : IRateLimitStore
{
    private readonly ConcurrentDictionary<string, Window> _windows = new();

    public Task<long> HitAsync(string key, TimeSpan window, CancellationToken ct = default)
    {
        var now = DateTime.UtcNow.Ticks;
        var w = _windows.GetOrAdd(key, _ => new Window(now + window.Ticks));
        long count;
        lock (w)
        {
            if (now >= w.ExpiresAtTicks) // window elapsed → reset (mirrors the Redis key expiring)
            {
                w.Count = 0;
                w.ExpiresAtTicks = now + window.Ticks;
            }
            count = ++w.Count;
        }
        return Task.FromResult(count);
    }

    private sealed class Window(long expiresAtTicks)
    {
        public long Count;
        public long ExpiresAtTicks = expiresAtTicks;
    }
}
