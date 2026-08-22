using System.Net;
using System.Text.Json;
using Govori.Api.Startup;
using Microsoft.AspNetCore.Mvc.Testing;

namespace Govori.IntegrationTests;

/// <summary>
/// The response headers the API sets, and — just as deliberately — the ones it does not.
///
/// <para>deploy/nginx already sets HSTS, X-Frame-Options, Referrer-Policy and Permissions-Policy at
/// the server level, and the <c>/api/</c> location inherits them. Repeating them here would emit two
/// values for one header, and where the two disagree a browser may honour neither. So the split is
/// itself a decision worth a test: the "must be absent" cases below are what would catch someone
/// helpfully re-adding <c>X-Frame-Options: DENY</c> next to nginx's <c>SAMEORIGIN</c>.</para>
/// </summary>
[Collection(PerRunDatabaseFixture.CollectionName)]
public sealed class SecurityHeadersTests : IClassFixture<SecurityHeadersTests.HeadersApiFactory>
{
    private readonly HeadersApiFactory _factory;

    public SecurityHeadersTests(HeadersApiFactory factory) => _factory = factory;

    /// <summary>Headers this layer owns, because nginx cannot express them without breaking the SPA.</summary>
    public static IEnumerable<object[]> OwnedHeaders() => new[]
    {
        new object[] { "Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'" },
        new object[] { "X-Content-Type-Options", "nosniff" },
    };

    /// <summary>Headers nginx owns. Setting them here too is the actual failure mode.</summary>
    public static IEnumerable<object[]> NginxOwnedHeaders() => new[]
    {
        new object[] { "Strict-Transport-Security" },
        new object[] { "X-Frame-Options" },
        new object[] { "Referrer-Policy" },
        new object[] { "Permissions-Policy" },
    };

    [Theory]
    [MemberData(nameof(OwnedHeaders))]
    public async Task The_api_sets_the_headers_it_owns(string header, string expected)
    {
        var response = await _factory.CreateClient().GetAsync("/api/ping");

        Assert.True(response.Headers.TryGetValues(header, out var values), $"{header} is missing");
        Assert.Equal(expected, Assert.Single(values!));
    }

    [Theory]
    [MemberData(nameof(NginxOwnedHeaders))]
    public async Task The_api_leaves_the_headers_nginx_owns_alone(string header)
    {
        var response = await _factory.CreateClient().GetAsync("/api/ping");

        Assert.False(
            response.Headers.Contains(header),
            $"{header} is set by nginx at the server level and inherited by /api/. Setting it here "
            + "too emits two values for one header, and where they disagree a browser may honour "
            + "neither. Pick one owner — see Startup/SecurityHeaders.cs.");
    }

    /// <summary>
    /// An error response is the one most likely to be rendered somewhere unexpected, so the headers
    /// have to survive the paths that do not reach an endpoint handler at all — here, the
    /// authorization middleware short-circuiting with a 401.
    /// </summary>
    [Fact]
    public async Task The_headers_survive_a_short_circuited_error_response()
    {
        var response = await _factory.CreateClient().GetAsync("/api/auth/me");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Contains("nosniff", response.Headers.GetValues("X-Content-Type-Options"));
        Assert.True(response.Headers.Contains("Content-Security-Policy"));
    }

    // ── the unhandled-exception body ─────────────────────────────────────────

    /// <summary>
    /// What a client is told when something fails in a way no endpoint anticipated. Driven as a pure
    /// function rather than by forcing a 500 through the pipeline, because in Development — which is
    /// what WebApplicationFactory boots — the framework's developer exception page deliberately wins,
    /// and booting a Production host would mean poisoning a process-wide environment variable that
    /// every other suite in this assembly reads.
    /// </summary>
    [Fact]
    public void The_failure_body_says_nothing_about_the_failure()
    {
        var body = ApiProblem.Body("0af7651916cd43dd8448eb211c80319c");

        using var doc = JsonDocument.Parse(body);
        Assert.False(string.IsNullOrWhiteSpace(doc.RootElement.GetProperty("detail").GetString()));
        Assert.Equal("0af7651916cd43dd8448eb211c80319c", doc.RootElement.GetProperty("trace_id").GetString());

        // The exception type alone separates "database is down" from "the vendor rejected our key",
        // and neither is a client's business.
        foreach (var leak in new[] { "Exception", "   at ", "Npgsql", "Stack", "Inner" })
            Assert.DoesNotContain(leak, body, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>It uses the same shape as every other error in this API, so no client needs a special
    /// case for the worst day of the deploy.</summary>
    [Fact]
    public void The_failure_body_uses_the_same_detail_shape_as_every_other_error()
    {
        using var doc = JsonDocument.Parse(ApiProblem.Body(traceId: null));

        Assert.True(doc.RootElement.TryGetProperty("detail", out _));
        // No ambient trace: the key is omitted rather than null, so a client never renders an empty
        // "reference:" to a user.
        Assert.False(doc.RootElement.TryGetProperty("trace_id", out _));
    }

    public sealed class HeadersApiFactory : WebApplicationFactory<Program>
    {
        public string ConnectionString { get; } = TestDatabase.ConnectionString;

        internal const string TestSecretKey =
            "security-headers-integration-test-secret-key-do-not-use-in-prod";

        public HeadersApiFactory()
        {
            Environment.SetEnvironmentVariable("SECRET_KEY", TestSecretKey);
            Environment.SetEnvironmentVariable("GOVORI_DB", ConnectionString);
        }
    }
}
