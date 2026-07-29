namespace Govori.Administration;

/// <summary>
/// The ~30s in-memory cache for the resolved <c>app_settings</c> override map (docs/07 §3.7).
/// <list type="bullet">
///   <item>the LLM grader resolves config on <b>every</b> submission, so reads are cached to spare
///   the DB a query per grade;</item>
///   <item>the whole override map is cached as a single snapshot, not per-key — one load covers
///   every setting the request will ask for;</item>
///   <item>every write must <c>Invalidate()</c> so the next read re-hits the DB.</item>
/// </list>
///
/// <para><b>Process-local cache — invalidate on every write.</b> Registered as a SINGLETON, so the
/// snapshot is shared by all requests in this process and is NOT shared across processes: a write
/// invalidates only the writing instance, and other instances keep serving stale values until their
/// own TTL lapses. The abstraction (<see cref="IAppSettingsCache"/>) keeps the TTL + invalidation
/// behaviour unit-testable without waiting real seconds.</para>
///
/// <para>Timing uses <see cref="Environment.TickCount64"/>, which is monotonic — never wall-clock,
/// so an NTP step can't wrongly expire or extend the window.</para>
/// </summary>
public interface IAppSettingsCache
{
    /// <summary>Returns the cached override snapshot if one is present AND still inside the TTL.
    /// A miss (never set, or expired) returns false — the caller then reloads from the DB.</summary>
    bool TryGet(out IReadOnlyDictionary<string, string?> overrides);

    /// <summary>Store a freshly-loaded override snapshot and (re)start the TTL window.</summary>
    void Set(IReadOnlyDictionary<string, string?> overrides);

    /// <summary>Drop the snapshot so the next <see cref="TryGet"/> misses. MUST be called after
    /// every write, or admins keep reading the pre-write values for up to the full TTL.</summary>
    void Invalidate();
}

/// <inheritdoc cref="IAppSettingsCache"/>
public sealed class AppSettingsCache : IAppSettingsCache
{
    /// <summary>How long a loaded snapshot stays valid before the next read reloads it.</summary>
    public static readonly TimeSpan DefaultTtl = TimeSpan.FromSeconds(30);

    private static readonly IReadOnlyDictionary<string, string?> Empty =
        new Dictionary<string, string?>(0);

    private readonly double _ttlMs;
    private readonly object _gate = new();

    private IReadOnlyDictionary<string, string?>? _snapshot;
    // 0 = "no snapshot loaded" sentinel.
    private long _loadedAtTicks;

    public AppSettingsCache() : this(DefaultTtl) { }

    public AppSettingsCache(TimeSpan ttl) => _ttlMs = ttl.TotalMilliseconds;

    public bool TryGet(out IReadOnlyDictionary<string, string?> overrides)
    {
        lock (_gate)
        {
            // A hit needs all three: a snapshot exists, it was actually loaded, and it is inside the TTL.
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
            _loadedAtTicks = 0; // back to the "no snapshot loaded" sentinel
        }
    }
}
