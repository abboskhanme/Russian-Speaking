using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Govori.Api.RateLimiting;
using Govori.Contracts;
using Govori.Identity.Security;
using Govori.Infrastructure;
using Govori.Infrastructure.Entities;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Npgsql;

namespace Govori.IntegrationTests;

/// <summary>
/// Which routes carry a rate-limit policy at all.
///
/// <para><b>What this is really guarding.</b> The limits themselves are product numbers and will be
/// tuned; what must not change by accident is WHICH routes are covered. Every route asserted here
/// spends money at a vendor on each call — one Azure STT plus one grader request for the two submit
/// routes, and up to five vendor calls per press for the admin probe. Dropping a
/// <c>.RequireRateLimiting(...)</c> from one of them is a one-token edit that nothing else would
/// notice: the route keeps working, the tests keep passing, and the only symptom is an invoice.</para>
///
/// <para><b>Why it does not send 60 requests.</b> The counter lives behind
/// <see cref="IRateLimitStore"/>, so a store that reports "already way over" turns the FIRST request
/// into the rejection — which is what makes this a fast test of ATTACHMENT rather than a slow test
/// of arithmetic. Rejection also happens in middleware, before the endpoint delegate runs, so none
/// of these requests needs a real question, a real upload or an admin account; a valid access token
/// is enough to get past authorization and reach the limiter.</para>
/// </summary>
[Collection(PerRunDatabaseFixture.CollectionName)]
public sealed class RateLimitedRoutesTests
    : IClassFixture<RateLimitedRoutesTests.RateLimitApiFactory>, IDisposable
{
    private readonly RateLimitApiFactory _factory;
    private readonly NpgsqlDataSource _dataSource;

    public RateLimitedRoutesTests(RateLimitApiFactory factory)
    {
        _factory = factory;
        _dataSource = GovoriDataSourceFactory.Build(factory.ConnectionString);
    }

    private GovoriDbContext NewContext()
    {
        var b = new DbContextOptionsBuilder<GovoriDbContext>();
        b.UseGovori(_dataSource);
        return new GovoriDbContext(b.Options);
    }

    /// <summary>The money routes: each call bills a vendor, and each had no ceiling before.</summary>
    public static IEnumerable<object[]> CostlyRoutes() => new[]
    {
        new object[] { "/api/submissions" },                 // one STT + one grader call
        new object[] { "/api/placement/submit" },            // same seams, no freemium gate at all
        new object[] { "/api/admin/settings/ai/test" },      // one real call to EVERY configured backend
    };

    [Theory]
    [MemberData(nameof(CostlyRoutes))]
    public async Task A_route_that_spends_vendor_money_is_rate_limited(string route)
    {
        var (userId, client) = await SeededClient(Saturated());
        try
        {
            var response = await Post(client, route, TokenFor(userId));

            Assert.Equal(HttpStatusCode.TooManyRequests, response.StatusCode);
        }
        finally
        {
            await DeleteUser(userId);
        }
    }

    /// <summary>
    /// The rejection has to be readable by the client, not an empty body it renders as a blank
    /// screen. It uses the same <c>{ "detail": ... }</c> shape as every other error in this API, so
    /// no client needs a special case for it — and 429, never the framework's default 503, which
    /// clients read as "server down" and retry into.
    /// </summary>
    [Fact]
    public async Task The_rejection_is_a_429_carrying_the_usual_detail_shape()
    {
        var (userId, client) = await SeededClient(Saturated());
        try
        {
            var response = await Post(client, "/api/submissions", TokenFor(userId));
            Assert.Equal(HttpStatusCode.TooManyRequests, response.StatusCode);
            Assert.Equal("application/json", response.Content.Headers.ContentType?.MediaType);

            using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            var detail = doc.RootElement.GetProperty("detail").GetString();
            Assert.False(string.IsNullOrWhiteSpace(detail));
        }
        finally
        {
            await DeleteUser(userId);
        }
    }

    /// <summary>
    /// A control, so the theory above cannot pass for the wrong reason. Reading your own attempts
    /// costs a database query and nothing else; if this were 429 too, the saturated store would be
    /// rejecting everything and the test would be proving nothing about which routes are covered.
    /// </summary>
    [Fact]
    public async Task A_route_that_costs_nothing_is_not_rate_limited()
    {
        var (userId, client) = await SeededClient(Saturated());
        try
        {
            var request = new HttpRequestMessage(HttpMethod.Get, "/api/submissions");
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", TokenFor(userId));
            var response = await client.SendAsync(request);

            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        }
        finally
        {
            await DeleteUser(userId);
        }
    }

    /// <summary>
    /// FAIL-OPEN, restated at the route level. The limiter must never be the reason the app is down:
    /// a store outage ALLOWS the request. Here that means the submit reaches its handler and fails
    /// on its own terms (400 — no multipart body) rather than answering 429.
    /// </summary>
    [Fact]
    public async Task A_counter_outage_lets_the_request_through_rather_than_rejecting_it()
    {
        var (userId, client) = await SeededClient(new ThrowingRateLimitStore());
        try
        {
            var response = await Post(client, "/api/submissions", TokenFor(userId));

            Assert.NotEqual(HttpStatusCode.TooManyRequests, response.StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        }
        finally
        {
            await DeleteUser(userId);
        }
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private static IRateLimitStore Saturated() => new SaturatedRateLimitStore();

    private static Task<HttpResponseMessage> Post(HttpClient client, string route, string token)
    {
        // No body on purpose: the limiter runs in middleware, ahead of the endpoint delegate, so a
        // rejected request never gets far enough to care what was posted.
        var request = new HttpRequestMessage(HttpMethod.Post, route);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client.SendAsync(request);
    }

    private async Task<(Guid UserId, HttpClient Client)> SeededClient(IRateLimitStore store)
    {
        var userId = Guid.NewGuid();
        await using (var ctx = NewContext())
        {
            ctx.Users.Add(new User
            {
                Id = userId,
                Email = $"rl-{userId:N}@example.test",
                FullName = "Rate Limit Seed",
                PasswordHash = null,
                Role = UserRole.Student,
                IsActive = true,
                IsPremium = false,
                PreferredLanguage = "uz",
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow,
            });
            await ctx.SaveChangesAsync();
        }

        var client = _factory.WithWebHostBuilder(builder =>
            builder.ConfigureTestServices(services =>
            {
                // The host TryAdds the in-memory store, so it is already registered by the time
                // ConfigureTestServices runs — remove it before substituting.
                services.RemoveAll<IRateLimitStore>();
                services.AddSingleton(store);
            })).CreateClient();

        return (userId, client);
    }

    private async Task DeleteUser(Guid userId)
    {
        await using var ctx = NewContext();
        await ctx.Users.Where(u => u.Id == userId).ExecuteDeleteAsync();
    }

    private static string TokenFor(Guid userId) =>
        new TokenService(new IdentityAuthOptions { SecretKey = RateLimitApiFactory.TestSecretKey })
            .CreateAccessToken(userId.ToString());

    public void Dispose() => _dataSource.Dispose();

    /// <summary>A counter that reports every window as long since exhausted, so the first request on
    /// a rate-limited route is rejected.</summary>
    private sealed class SaturatedRateLimitStore : IRateLimitStore
    {
        public Task<long> HitAsync(string key, TimeSpan window, CancellationToken ct = default)
            => Task.FromResult(long.MaxValue);
    }

    /// <summary>A counter that is down. Proves the FAIL-OPEN rule at the route level.</summary>
    private sealed class ThrowingRateLimitStore : IRateLimitStore
    {
        public Task<long> HitAsync(string key, TimeSpan window, CancellationToken ct = default)
            => throw new InvalidOperationException("simulated rate-limit store outage");
    }

    /// <summary>Boots Govori.Api against the schema DB with a fixed test SECRET_KEY (same pattern as
    /// the other endpoint suites).</summary>
    public sealed class RateLimitApiFactory : WebApplicationFactory<Program>
    {
        public string ConnectionString { get; } = TestDatabase.ConnectionString;

        internal const string TestSecretKey =
            "rate-limit-integration-test-secret-key-do-not-use-in-prod";

        public RateLimitApiFactory()
        {
            Environment.SetEnvironmentVariable("SECRET_KEY", TestSecretKey);
            Environment.SetEnvironmentVariable("GOVORI_DB", ConnectionString);
        }
    }
}
