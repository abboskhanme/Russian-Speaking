using Govori.Platform.Storage;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Npgsql;
using StackExchange.Redis;

namespace Govori.Api.Health;

/// <summary>
/// The three dependency probes behind <c>GET /health/ready</c> (docs/07 §2.8).
///
/// <para><b>Readiness and liveness answer different questions, and conflating them restarts healthy
/// containers.</b> <c>/health</c> asks "is this process alive?" and runs NO checks — a Postgres
/// failover would otherwise make an orchestrator kill an API that is perfectly capable of serving
/// the moment the database returns. <c>/health/ready</c> asks "can this instance serve a request
/// right now?", which it cannot without Postgres (every endpoint reads it), Redis (OTP storage is
/// fail-CLOSED, so a Redis outage means nobody can log in) or object storage (a submit that cannot
/// store its audio is a lost answer). Those three are therefore the checks, and the checks are
/// exactly the dependencies a request needs — not every service the process happens to know about.</para>
///
/// <para><b>Every probe is bounded.</b> A readiness endpoint that hangs is worse than one that says
/// "not ready": a load balancer waiting on a response keeps the instance in rotation. Each probe
/// gets its own deadline (<see cref="ProbeTimeout"/>) and turns a timeout into Unhealthy rather than
/// letting it propagate.</para>
///
/// <para>Failure descriptions stay server-side: the health endpoint's default response writer emits
/// only the status word, so a connection string or a vendor error never reaches the caller — the
/// detail lands in the logs, where the operator is.</para>
/// </summary>
public static class ReadinessChecks
{
    /// <summary>The tag <c>/health/ready</c> filters on. Liveness runs nothing, so it is unaffected.</summary>
    public const string ReadyTag = "ready";

    /// <summary>
    /// Per-probe deadline. Short on purpose: a dependency that needs more than three seconds to
    /// answer a trivial round-trip is not one this instance can serve a request against, so calling
    /// it "not ready" is the honest answer rather than a premature one.
    /// </summary>
    public static readonly TimeSpan ProbeTimeout = TimeSpan.FromSeconds(3);

    /// <summary>
    /// Register the readiness probes. Each resolves its dependency LAZILY, from the health-check
    /// context's own scope, so a missing or slow-to-construct client is reported as Unhealthy
    /// instead of taking the host down at startup — the whole point of a readiness probe.
    /// </summary>
    public static IHealthChecksBuilder AddGovoriReadinessChecks(this IHealthChecksBuilder builder)
    {
        builder.AddTypeActivatedCheck<PostgresReadinessCheck>(
            "postgres", failureStatus: HealthStatus.Unhealthy, tags: new[] { ReadyTag });
        builder.AddTypeActivatedCheck<RedisReadinessCheck>(
            "redis", failureStatus: HealthStatus.Unhealthy, tags: new[] { ReadyTag });
        builder.AddTypeActivatedCheck<ObjectStorageReadinessCheck>(
            "object-storage", failureStatus: HealthStatus.Unhealthy, tags: new[] { ReadyTag });
        return builder;
    }

    /// <summary>
    /// Run <paramref name="probe"/> under a deadline and collapse every failure — including the
    /// deadline itself — into an Unhealthy result. A health check that throws is reported as
    /// Unhealthy by the framework anyway, but with the exception's full text; catching here keeps the
    /// description to one line so the log stays readable when a dependency is flapping.
    /// </summary>
    internal static async Task<HealthCheckResult> BoundedAsync(
        string dependency, Func<CancellationToken, Task> probe, CancellationToken ct)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct);
        deadline.CancelAfter(ProbeTimeout);
        try
        {
            await probe(deadline.Token);
            return HealthCheckResult.Healthy();
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            // The CALLER gave up (client disconnected / host shutting down). Not a dependency fault,
            // but there is no one left to tell — report unhealthy and let the request end.
            return HealthCheckResult.Unhealthy($"{dependency}: probe cancelled");
        }
        catch (OperationCanceledException)
        {
            return HealthCheckResult.Unhealthy(
                $"{dependency}: did not answer within {ProbeTimeout.TotalSeconds:0}s");
        }
        catch (Exception ex)
        {
            return HealthCheckResult.Unhealthy($"{dependency}: {ex.GetType().Name}: {ex.Message}");
        }
    }
}

/// <summary>Postgres reachability: open a pooled connection and run the cheapest possible statement.
/// Uses the <see cref="NpgsqlDataSource"/> the hosts already register, so the probe exercises the
/// SAME pool the application uses — a probe on a private connection can be green while the
/// application's pool is exhausted.</summary>
public sealed class PostgresReadinessCheck : IHealthCheck
{
    private readonly NpgsqlDataSource _dataSource;

    public PostgresReadinessCheck(NpgsqlDataSource dataSource) => _dataSource = dataSource;

    public Task<HealthCheckResult> CheckHealthAsync(
        HealthCheckContext context, CancellationToken cancellationToken = default)
        => ReadinessChecks.BoundedAsync("postgres", async ct =>
        {
            await using var command = _dataSource.CreateCommand("SELECT 1");
            await command.ExecuteScalarAsync(ct);
        }, cancellationToken);
}

/// <summary>Redis reachability. PING rather than a read: it is the one command that is answered by a
/// server in any state a client can still use, and it allocates nothing.</summary>
public sealed class RedisReadinessCheck : IHealthCheck
{
    private readonly IConnectionMultiplexer _redis;

    public RedisReadinessCheck(IConnectionMultiplexer redis) => _redis = redis;

    public Task<HealthCheckResult> CheckHealthAsync(
        HealthCheckContext context, CancellationToken cancellationToken = default)
        => ReadinessChecks.BoundedAsync("redis", async _ =>
        {
            // AbortOnConnectFail=false (see the composition roots) means the multiplexer is handed
            // out even while the server is unreachable, so "we have a client" proves nothing — the
            // round-trip is the check.
            await _redis.GetDatabase().PingAsync();
        }, cancellationToken);
}

/// <summary>Object-storage reachability. A HEAD on a key that is not expected to exist is enough: a
/// clean "no such object" answer proves credentials, endpoint and bucket routing all work, and
/// costs no transfer. Only a transport or auth failure throws, which is precisely what this asks.</summary>
public sealed class ObjectStorageReadinessCheck : IHealthCheck
{
    /// <summary>A key deliberately outside every real prefix (answers/, avatars/, media/) so this can
    /// never collide with a stored object and change what the probe means.</summary>
    private const string ProbeKey = "health/readiness-probe";

    private readonly IObjectStorage _storage;

    public ObjectStorageReadinessCheck(IObjectStorage storage) => _storage = storage;

    public Task<HealthCheckResult> CheckHealthAsync(
        HealthCheckContext context, CancellationToken cancellationToken = default)
        => ReadinessChecks.BoundedAsync("object-storage", async ct =>
        {
            await _storage.ExistsAsync(ProbeKey, ct);
        }, cancellationToken);
}
