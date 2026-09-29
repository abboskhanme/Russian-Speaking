using System.Collections.Concurrent;

namespace Govori.Api.RateLimiting;

/// <summary>
/// Process-local fixed-window counter — the in-code DEFAULT store, used when
/// <c>GOVORI_RATELIMIT_BACKEND</c> is unset. Keeps the full rate-limit semantics (limits +
/// per-IP/user keying + the fail-open decision, which lives in <see cref="StoreBackedRateLimiter"/>)
/// without requiring a Redis dependency at boot.
///
/// <para>It counts PER-INSTANCE, so behind N replicas the effective limit would be N×. That is why
/// the deployed stacks do not use it: both compose files (and both env examples) set
/// <c>GOVORI_RATELIMIT_BACKEND=redis</c>, which swaps in <see cref="RedisRateLimitStore"/> — one
/// shared cross-instance counter. It stays the default for the hosts that set nothing, i.e. the
/// integration tests, so each test host stays isolated and never accumulates counts against a shared
/// Redis across the suite.</para>
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
