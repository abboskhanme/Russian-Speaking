using System.Net;
using Govori.Api.Health;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Diagnostics.HealthChecks;

namespace Govori.IntegrationTests;

/// <summary>
/// Liveness and readiness answer DIFFERENT questions, and conflating them restarts healthy
/// containers.
///
/// <para><c>/health</c> asks "is this process alive?" and must run NO dependency checks. If a
/// Postgres failover could turn it red, an orchestrator would kill an API that is perfectly capable
/// of serving the moment the database returns — turning a brief dependency wobble into a restart
/// storm, at exactly the moment the system is least able to absorb one. <c>/health/ready</c> asks
/// "can this instance serve a request right now?", which it cannot without Postgres, Redis or object
/// storage, so those it does check.</para>
///
/// <para>The split is enforced by a one-character difference — <c>Predicate = _ =&gt; false</c> on
/// liveness versus a tag filter on readiness — so the test injects a dependency that is definitely
/// broken and asserts the two endpoints disagree about it. Without an injected failure the test
/// would pass on a healthy machine no matter which predicate was used, and prove nothing.</para>
/// </summary>
[Collection(PerRunDatabaseFixture.CollectionName)]
public sealed class HealthEndpointsTests : IClassFixture<HealthEndpointsTests.HealthApiFactory>
{
    private readonly HealthApiFactory _factory;

    public HealthEndpointsTests(HealthApiFactory factory) => _factory = factory;

    /// <summary>A client whose host carries one extra readiness check that always fails — standing in
    /// for Postgres being down, without taking Postgres down.</summary>
    private HttpClient ClientWithABrokenDependency() =>
        _factory.WithWebHostBuilder(builder =>
            builder.ConfigureTestServices(services =>
                services.AddHealthChecks().AddCheck(
                    "simulated-outage",
                    () => HealthCheckResult.Unhealthy("simulated dependency outage"),
                    tags: new[] { ReadinessChecks.ReadyTag }))).CreateClient();

    [Fact]
    public async Task Liveness_stays_green_while_a_dependency_is_down()
    {
        var response = await ClientWithABrokenDependency().GetAsync("/health");

        // The process is up, so it is alive. Anything else here is a restart loop waiting to happen.
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("Healthy", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Readiness_goes_red_when_a_dependency_is_down()
    {
        var response = await ClientWithABrokenDependency().GetAsync("/health/ready");

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        Assert.Equal("Unhealthy", await response.Content.ReadAsStringAsync());
    }

    /// <summary>
    /// The failing check's description must NOT reach the caller. Health endpoints are commonly the
    /// least-protected route on a host, and a probe's description is where a connection string or a
    /// vendor error message lives. The default writer emits the status word only; this is what would
    /// catch someone "improving" it into a detailed JSON writer.
    /// </summary>
    [Fact]
    public async Task A_failing_probe_does_not_describe_itself_to_the_caller()
    {
        var body = await (await ClientWithABrokenDependency().GetAsync("/health/ready"))
            .Content.ReadAsStringAsync();

        Assert.DoesNotContain("simulated dependency outage", body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("Host=", body, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// The real probes, against the real dependencies this suite already runs on: the per-run
    /// Postgres, the govori-net Redis and MinIO. Green here means the checks are wired to something
    /// that actually answers — the previous implementation returned Healthy while probing nothing,
    /// and would have passed this test just as well, which is why the injected-failure cases above
    /// carry the real weight.
    /// </summary>
    [Fact]
    public async Task Readiness_is_green_against_the_real_dependencies()
    {
        var response = await _factory.CreateClient().GetAsync("/health/ready");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    public sealed class HealthApiFactory : WebApplicationFactory<Program>
    {
        public string ConnectionString { get; } = TestDatabase.ConnectionString;

        internal const string TestSecretKey =
            "health-endpoints-integration-test-secret-key-do-not-use-in-prod";

        public HealthApiFactory()
        {
            Environment.SetEnvironmentVariable("SECRET_KEY", TestSecretKey);
            Environment.SetEnvironmentVariable("GOVORI_DB", ConnectionString);
        }
    }
}
