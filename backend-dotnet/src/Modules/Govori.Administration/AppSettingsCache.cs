namespace Govori.Administration;

/// <summary>
/// The ~30s in-memory cache for the resolved <c>app_settings</c> override map (docs/07 §3.7).
/// Faithful port of the module-global cache in <c>backend/app/services/app_settings.py</c>
/// (<c>_cache</c>/<c>_cache_at</c>/<c>_CACHE_TTL = 30.0</c>, lines 79-107):
/// <list type="bullet">
///   <item>the LLM grader resolves config on <b>every</b> submission, so reads are cached to spare
///   the DB a query per grade;</item>
///   <item>the whole override dict is cached under a single snapshot (Python caches
///   <c>{row.key: row.value}</c> in one go), not per-key;</item>
///   <item>a write <c>Invalidate()</c>s so the next read re-hits the DB — exactly Python's
///   <c>set_many → invalidate()</c>.</item>
/// </list>
///
/// <para>Registered as a SINGLETON so the snapshot is process-global, mirroring Python's
/// module-level cache shared across requests. The abstraction (<see cref="IAppSettingsCache"/>)
/// keeps the TTL + invalidation behaviour unit-testable without waiting real seconds — the task
/// sanctioned "IMemoryCache or a small cache abstraction".</para>
///
/// <para>Timing uses <see cref="Environment.TickCount64"/> (monotonic, like Python's
/// <c>time.monotonic()</c>) — never wall-clock, so an NTP step can't wrongly expire or extend the
/// window.</para>
/// </summary>
public interface IAppSettingsCache
{
    /// <summary>Returns the cached override snapshot if one is present AND still inside the TTL.
    /// A miss (never set, or expired) returns false — the caller then reloads from the DB.</summary>
    bool TryGet(out IReadOnlyDictionary<string, string?> overrides);

    /// <summary>Store a freshly-loaded override snapshot and (re)start the TTL window.</summary>
    void Set(IReadOnlyDictionary<string, string?> overrides);

    /// <summary>Drop the snapshot so the next <see cref="TryGet"/> misses. Called after every write
    /// (Python's <c>invalidate()</c>).</summary>
    void Invalidate();
}

/// <inheritdoc cref="IAppSettingsCache"/>
public sealed class AppSettingsCache : IAppSettingsCache
{
    /// <summary>Python's <c>_CACHE_TTL = 30.0</c> seconds.</summary>
    public static readonly TimeSpan DefaultTtl = TimeSpan.FromSeconds(30);

    private static readonly IReadOnlyDictionary<string, string?> Empty =
        new Dictionary<string, string?>(0);

    private readonly double _ttlMs;
    private readonly object _gate = new();

    private IReadOnlyDictionary<string, string?>? _snapshot;
    // 0 = "no snapshot loaded" sentinel (mirrors Python's `_cache_at = 0.0`).
    private long _loadedAtTicks;

    public AppSettingsCache() : this(DefaultTtl) { }

    public AppSettingsCache(TimeSpan ttl) => _ttlMs = ttl.TotalMilliseconds;

    public bool TryGet(out IReadOnlyDictionary<string, string?> overrides)
    {
        lock (_gate)
        {
            // Python: `if _cache_at and now - _cache_at < _CACHE_TTL: return _cache`.
            if (_snapshot is not null
                && _loadedAtTicks != 0
                && Environment.TickCount64 - _loadedAtTicks < _ttlMs)
            {
                overrides = _snapshot;
                return true;
            }
        }
        overrides = Empty;
        return false;
    }

    public void Set(IReadOnlyDictionary<string, string?> overrides)
    {
        lock (_gate)
        {
            _snapshot = overrides;
            var now = Environment.TickCount64;
            // Keep 0 reserved as the "empty" sentinel on the astronomically-rare boot-tick == 0.
            _loadedAtTicks = now == 0 ? 1 : now;
        }
    }

    public void Invalidate()
    {
        lock (_gate)
        {
            _snapshot = null;
            _loadedAtTicks = 0; // Python: `_cache_at = 0.0`
        }
    }
}
