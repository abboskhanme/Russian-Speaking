using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using StackExchange.Redis;

namespace Govori.Administration;

/// <summary>
/// Makes a settings write visible to <b>every</b> process, immediately.
///
/// <para><b>The problem this exists to solve.</b> <see cref="AppSettingsCache"/> is a
/// process-local ~30s snapshot, and it is invalidated only in the process that performed the write.
/// The admin panel writes through the <b>API</b>; grading runs in the <b>Worker</b>. So pasting a
/// vendor key and pressing save left the Worker grading against the previous configuration for up
/// to thirty seconds — and, worse, a key that was cleared kept working for that window. The panel
/// said one thing and the pipeline did another, with no error anywhere to explain the gap.</para>
///
/// <para>Thirty seconds sounds harmless until you watch someone use it: they save a key, submit a
/// recording to check it worked, get the old behaviour, and conclude the panel is broken. This
/// closes that window to a network hop.</para>
///
/// <para><b>Redis pub/sub, not a shared cache.</b> The snapshot itself stays process-local — it is
/// hot-path state read on every submission, and moving it to Redis would trade a rare staleness
/// window for a network round-trip per grade. Only the <i>invalidation</i> travels: one tiny message
/// per write, and each process reloads from its own DB connection on the next read.</para>
///
/// <para><b>Redis is optional, and its absence is not an error.</b> Unit and integration runs, and
/// any single-process deployment, have nothing to coordinate. When no multiplexer is registered or
/// the connection is down, this degrades to exactly the previous behaviour — TTL-only — which was
/// correct, merely slower. It must never take the host down: a settings write failing because a
/// cache hint could not be broadcast would be a far worse bug than the staleness it prevents.</para>
/// </summary>
public interface IAppSettingsBroadcast
{
    /// <summary>Tell every process (including this one) to drop its snapshot. Best-effort: a failure
    /// is logged and swallowed, because the write itself has already succeeded and the TTL will
    /// catch up regardless.</summary>
    Task PublishAsync(CancellationToken ct = default);
}

/// <summary>The no-Redis case: invalidate locally and stop there. Registered when no
/// <see cref="IConnectionMultiplexer"/> is available, so callers never branch on configuration.</summary>
public sealed class LocalAppSettingsBroadcast : IAppSettingsBroadcast
{
    private readonly IAppSettingsCache _cache;

    public LocalAppSettingsBroadcast(IAppSettingsCache cache) => _cache = cache;

    public Task PublishAsync(CancellationToken ct = default)
    {
        _cache.Invalidate();
        return Task.CompletedTask;
    }
}

/// <inheritdoc cref="IAppSettingsBroadcast"/>
public sealed class RedisAppSettingsBroadcast : IAppSettingsBroadcast
{
    /// <summary>The channel name is a wire contract between running processes — an API and a Worker
    /// on different versions must still agree on it. Renaming it silently reintroduces the staleness
    /// this class removes, so change it only alongside a deliberate rollout.</summary>
    public const string Channel = "govori:app-settings:invalidate";

    private readonly IConnectionMultiplexer _redis;
    private readonly IAppSettingsCache _cache;
    private readonly ILogger<RedisAppSettingsBroadcast> _logger;

    public RedisAppSettingsBroadcast(
        IConnectionMultiplexer redis, IAppSettingsCache cache, ILogger<RedisAppSettingsBroadcast> logger)
    {
        _redis = redis;
        _cache = cache;
        _logger = logger;
    }

    public async Task PublishAsync(CancellationToken ct = default)
    {
        // Local first, and unconditionally. The publisher must not depend on its own broadcast
        // coming back to it: if Redis is down, the process that just wrote the value would
        // otherwise keep serving the value it just replaced — the most confusing possible outcome,
        // because it is the one the admin is looking straight at.
        _cache.Invalidate();

        try
        {
            await _redis.GetSubscriber()
                .PublishAsync(RedisChannel.Literal(Channel), RedisValue.EmptyString)
                .WaitAsync(ct);
        }
        catch (Exception ex)
        {
            // Swallowed on purpose — see the type-level note. The write succeeded; the worst case
            // is the pre-existing TTL behaviour.
            _logger.LogWarning(ex, "could not broadcast the app-settings invalidation; falling back to the TTL");
        }
    }
}

/// <summary>
/// Subscribes this process to the invalidation channel for the lifetime of the host.
///
/// <para>Runs as a hosted service rather than lazily on first read, because the point is to react
/// to a write that happened <i>elsewhere</i>: a process that only subscribes once someone asks it
/// for a setting would miss every message until then.</para>
/// </summary>
public sealed class AppSettingsInvalidationListener : BackgroundService
{
    private readonly IConnectionMultiplexer _redis;
    private readonly IAppSettingsCache _cache;
    private readonly ILogger<AppSettingsInvalidationListener> _logger;

    public AppSettingsInvalidationListener(
        IConnectionMultiplexer redis, IAppSettingsCache cache, ILogger<AppSettingsInvalidationListener> logger)
    {
        _redis = redis;
        _cache = cache;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            await _redis.GetSubscriber().SubscribeAsync(
                RedisChannel.Literal(RedisAppSettingsBroadcast.Channel),
                (_, _) => _cache.Invalidate());

            _logger.LogInformation(
                "listening for app-settings invalidations on {Channel}", RedisAppSettingsBroadcast.Channel);
        }
        catch (Exception ex)
        {
            // A host that refuses to start because a cache hint is unavailable is a worse outcome
            // than a host that is occasionally 30s stale. Log it loudly and carry on.
            _logger.LogWarning(
                ex, "could not subscribe to app-settings invalidations; this process will rely on the TTL alone");
            return;
        }

        // StackExchange.Redis owns the subscription; this task just parks until shutdown so the
        // handler stays registered.
        try
        {
            await Task.Delay(Timeout.Infinite, stoppingToken);
        }
        catch (OperationCanceledException)
        {
            // Normal shutdown.
        }
    }
}
