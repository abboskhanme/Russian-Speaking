using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Govori.Identity;
using Govori.Infrastructure;
using Govori.Infrastructure.Entities;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Npgsql;

namespace Govori.IntegrationTests;

/// <summary>
/// The development-only one-tap sign-in (<see cref="DevLoginEndpoints"/>) — the behaviour, over real
/// HTTP against the real host.
///
/// <para>The absence test that matters lives in <see cref="DevLoginAbsentInProductionTests"/> and is
/// the reason this feature is allowed to exist at all. What is asserted HERE is the other half: that
/// where it IS mapped it offers exactly the three seeded demo accounts and nothing else, and that the
/// tokens it hands out are the same tokens the real login flow issues.</para>
/// </summary>
[Collection(PerRunDatabaseFixture.CollectionName)]
public sealed class DevLoginEndpointsTests : IClassFixture<DevLoginEndpointsTests.DevLoginApiFactory>, IDisposable
{
    private readonly DevLoginApiFactory _factory;
    private readonly NpgsqlDataSource _dataSource;

    public DevLoginEndpointsTests(DevLoginApiFactory factory)
    {
        _factory = factory;
        _dataSource = GovoriDataSourceFactory.Build(factory.ConnectionString);
    }

    private GovoriDbContext CreateContext()
    {
        var builder = new DbContextOptionsBuilder<GovoriDbContext>();
        builder.UseGovori(_dataSource);
        return new GovoriDbContext(builder.Options);
    }

    /// <summary>One row per demo account. Matches the JSON the endpoint answers with (snake_case).</summary>
    private sealed record DevUser(Guid Id, string Full_Name, string Role);

    /// <summary>
    /// The picker's whole reason to exist: three roles, one tap each. The per-run database starts
    /// without the demo accounts (it is built from migrations, not from the demo dump), so they are
    /// seeded here with the SAME emails the dev seed uses — which is also what proves the lookup is
    /// by email rather than by an id that differs on every database.
    /// </summary>
    [Fact]
    public async Task The_list_offers_one_account_per_role_in_a_stable_order()
    {
        var seeded = await SeedDemoAccountsAsync();

        try
        {
            var users = await _factory.CreateClient()
                .GetFromJsonAsync<List<DevUser>>("/api/auth/dev/users");

            Assert.NotNull(users);
            // Order is the contract too — buttons that swap places between machines get misclicked.
            Assert.Equal(new[] { "student", "teacher", "admin" }, users!.Select(u => u.Role));
            Assert.Equal(
                new[] { "Talaba Demo", "Ustoz Demo", "Admin Demo" },
                users.Select(u => u.Full_Name));
            // The ids are this database's ids, not any hard-coded ones.
            Assert.Equal(
                seeded.Select(s => s.Id).ToHashSet(),
                users.Select(u => u.Id).ToHashSet());
        }
        finally
        {
            await RemoveDemoAccountsAsync();
        }
    }

    /// <summary>
    /// A tap issues a REAL session: the pair comes from <c>TokenService</c>, so the access token is
    /// accepted by <c>GET /api/auth/me</c> exactly like one minted by <c>otp/verify</c>. If this ever
    /// needed its own token path, the shortcut would have become a second authentication system.
    /// </summary>
    [Fact]
    public async Task A_demo_account_gets_a_token_pair_that_the_rest_of_the_api_accepts()
    {
        var seeded = await SeedDemoAccountsAsync();
        var teacher = seeded.Single(u => u.Role == UserRole.Teacher);

        try
        {
            var client = _factory.CreateClient();

            var login = await client.PostAsJsonAsync("/api/auth/dev/login", new { user_id = teacher.Id });
            Assert.Equal(HttpStatusCode.OK, login.StatusCode);

            var tokens = await login.Content.ReadFromJsonAsync<TokenPair>();
            Assert.NotNull(tokens);
            Assert.False(string.IsNullOrWhiteSpace(tokens!.Access_Token));
            Assert.False(string.IsNullOrWhiteSpace(tokens.Refresh_Token));

            var me = new HttpRequestMessage(HttpMethod.Get, "/api/auth/me");
            me.Headers.Authorization = new AuthenticationHeaderValue("Bearer", tokens.Access_Token);
            var meResponse = await client.SendAsync(me);

            Assert.Equal(HttpStatusCode.OK, meResponse.StatusCode);
            var body = await meResponse.Content.ReadFromJsonAsync<MeShape>();
            Assert.Equal(teacher.Id, body!.Id);
            Assert.Equal("teacher", body.Role);
        }
        finally
        {
            await RemoveDemoAccountsAsync();
        }
    }

    /// <summary>
    /// THE limit on the blast radius. <c>dev/login</c> takes a user id, and the one thing it must
    /// never be is "sign in as whoever you name" — a real, active, non-demo account is refused just
    /// as flatly as an id that belongs to nobody.
    ///
    /// <para>The real-user case is the one worth having: an implementation that merely checked "does
    /// this id exist?" would pass every test that only tried a random GUID, and would be a complete
    /// account-takeover endpoint the day it escaped Development.</para>
    /// </summary>
    [Fact]
    public async Task An_id_outside_the_demo_set_is_refused_even_when_the_user_is_real()
    {
        var seeded = await SeedDemoAccountsAsync();
        var outsiderId = Guid.NewGuid();

        await using (var ctx = CreateContext())
        {
            ctx.Users.Add(NewUser(outsiderId, $"outsider-{outsiderId:N}@example.test", "Someone Else", UserRole.Admin));
            await ctx.SaveChangesAsync();
        }

        try
        {
            var client = _factory.CreateClient();

            var real = await client.PostAsJsonAsync("/api/auth/dev/login", new { user_id = outsiderId });
            Assert.Equal(HttpStatusCode.Forbidden, real.StatusCode);

            var nobody = await client.PostAsJsonAsync("/api/auth/dev/login", new { user_id = Guid.NewGuid() });
            Assert.Equal(HttpStatusCode.Forbidden, nobody.StatusCode);

            // And the refusal did not quietly hand over a token anyway.
            Assert.DoesNotContain("access_token", await real.Content.ReadAsStringAsync(), StringComparison.Ordinal);

            // Sanity: the demo account it DID seed still works, so the 403s above are the rule
            // biting rather than the whole endpoint being broken.
            var student = seeded.Single(u => u.Role == UserRole.Student);
            var ok = await client.PostAsJsonAsync("/api/auth/dev/login", new { user_id = student.Id });
            Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        }
        finally
        {
            await using var ctx = CreateContext();
            await ctx.Users.Where(u => u.Id == outsiderId).ExecuteDeleteAsync();
            await RemoveDemoAccountsAsync();
        }
    }

    // ── seeding ──────────────────────────────────────────────────────────────

    private static readonly (string Email, string Name, UserRole Role)[] DemoAccounts =
    {
        ("student@govori.uz", "Talaba Demo", UserRole.Student),
        ("teacher@govori.uz", "Ustoz Demo", UserRole.Teacher),
        ("admin@govori.uz", "Admin Demo", UserRole.Admin),
    };

    private async Task<List<User>> SeedDemoAccountsAsync()
    {
        // Idempotent: a previous failed run may have left them behind, and the emails are UNIQUE.
        await RemoveDemoAccountsAsync();

        var users = DemoAccounts
            .Select(a => NewUser(Guid.NewGuid(), a.Email, a.Name, a.Role))
            .ToList();

        await using var ctx = CreateContext();
        ctx.Users.AddRange(users);
        await ctx.SaveChangesAsync();
        return users;
    }

    private async Task RemoveDemoAccountsAsync()
    {
        var emails = DemoAccounts.Select(a => a.Email).ToArray();
        await using var ctx = CreateContext();
        await ctx.Users.Where(u => emails.Contains(u.Email)).ExecuteDeleteAsync();
    }

    private static User NewUser(Guid id, string email, string name, UserRole role) => new()
    {
        Id = id,
        Email = email,
        FullName = name,
        Role = role,
        IsActive = true,
        IsPremium = false,
        PreferredLanguage = "uz",
        CreatedAt = DateTime.UtcNow,
        UpdatedAt = DateTime.UtcNow,
    };

    private sealed record TokenPair(string Access_Token, string Refresh_Token, string Token_Type);

    private sealed record MeShape(Guid Id, string Role);

    public void Dispose() => _dataSource.Dispose();

    /// <summary>
    /// Boots Govori.Api against the per-run database, in the environment
    /// <see cref="WebApplicationFactory{TEntryPoint}"/> uses by default: Development. Config goes in
    /// through process-wide environment variables for the reason spelled out in
    /// <c>AuthEndpointsTests.AuthApiFactory</c> — Program.cs reads it during
    /// <c>WebApplication.CreateBuilder</c>, before WAF's own configuration can apply.
    /// </summary>
    public sealed class DevLoginApiFactory : WebApplicationFactory<Program>
    {
        public string ConnectionString { get; } = TestDatabase.ConnectionString;

        private const string TestSecretKey =
            "dev-login-integration-test-secret-key-do-not-use-in-prod";

        public DevLoginApiFactory()
        {
            Environment.SetEnvironmentVariable("SECRET_KEY", TestSecretKey);
            Environment.SetEnvironmentVariable("GOVORI_DB", ConnectionString);
        }
    }
}

/// <summary>
/// THE test this feature had to earn: in Production the one-tap login is not refused, it is
/// <b>absent</b>.
///
/// <para><b>Why 404 and not 403 is the assertion.</b> A 403 means the route exists and something
/// inside the handler said no — one refactor, one misread condition, one "temporarily" relaxed check
/// away from being a working credential-free login. A 404 means the router has no entry for that
/// path, because <see cref="DevLoginEndpoints.MapDevLoginEndpoints"/> never registered one. There is
/// no code left to get wrong.</para>
///
/// <para><b>Why this is a second host.</b> The environment is decided when the host is built, so
/// asking "what does Production serve?" cannot be done by reconfiguring the Development host — it
/// needs a host that was built as Production. That costs one of the internal service providers EF
/// Core allows per process (the budget is shared across this whole assembly — see the note in
/// <c>BillingEndpointsTests</c>), which is why it is ONE host answering both routes rather than one
/// per route, and why it lives in its own class so its fixture is disposed as soon as it is done.</para>
///
/// <para><b>The insecure-production override is set on purpose.</b> This test is about the ROUTER,
/// not about <c>ProductionSecrets</c> — which has its own tests, including the one asserting that a
/// Production host on which the dev login WOULD be registered refuses to start. Booting this host
/// with real-looking Telegram and S3 credentials would leak those into every later host in the
/// process (a token in <c>TELEGRAM_BOT_TOKEN</c> swaps dev OTP delivery for the real bot — the exact
/// failure docs/09 warns about), so the override is both the smaller and the safer lever.</para>
/// </summary>
[Collection(PerRunDatabaseFixture.CollectionName)]
public sealed class DevLoginAbsentInProductionTests
    : IClassFixture<DevLoginAbsentInProductionTests.ProductionApiFactory>
{
    private readonly ProductionApiFactory _factory;

    public DevLoginAbsentInProductionTests(ProductionApiFactory factory) => _factory = factory;

    [Fact]
    public async Task The_dev_login_routes_do_not_exist_in_production()
    {
        var client = _factory.CreateClient();

        var list = await client.GetAsync("/api/auth/dev/users");
        Assert.Equal(HttpStatusCode.NotFound, list.StatusCode);

        var login = await client.PostAsJsonAsync("/api/auth/dev/login", new { user_id = Guid.NewGuid() });
        Assert.Equal(HttpStatusCode.NotFound, login.StatusCode);
    }

    /// <summary>
    /// The anti-vacuity half, and it carries real weight here: these two routes are
    /// <c>ExcludeFromDescription</c>'d, so the OpenAPI contract gate never sees them and this test is
    /// the ONLY thing standing behind "they are not in production". A 404 proves nothing on its own —
    /// a host that failed to boot, a host that is secretly Development, or a client with a base path
    /// that misses everything would all produce one.
    ///
    /// <para>So three things are asserted about the SAME host that answered the 404s above: it is
    /// serving (a real route answers 200), its environment really is Production (read straight off
    /// the host's <see cref="IHostEnvironment"/>, not inferred), and the dev-login predicate says
    /// "off" for it.</para>
    /// </summary>
    [Fact]
    public async Task The_host_that_answered_404_is_a_live_production_host()
    {
        var response = await _factory.CreateClient().GetAsync("/api/ping");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var environment = _factory.Services.GetRequiredService<IHostEnvironment>();
        Assert.Equal(Environments.Production, environment.EnvironmentName);
        Assert.True(environment.IsProduction());
        Assert.False(DevLoginEndpoints.IsEnabled(environment));
    }

    /// <summary>
    /// Boots Govori.Api as PRODUCTION. Every environment variable it sets is restored on dispose:
    /// they are process-wide, this assembly's other hosts read the same names, and the collections
    /// run serially — so a value left behind here would surface as somebody else's failure.
    /// </summary>
    public sealed class ProductionApiFactory : WebApplicationFactory<Program>
    {
        private const string TestSecretKey =
            "dev-login-production-absence-test-secret-key-do-not-use-in-prod";

        private readonly Dictionary<string, string?> _restore = new(StringComparer.Ordinal);

        public ProductionApiFactory()
        {
            Set("SECRET_KEY", TestSecretKey);
            Set("GOVORI_DB", TestDatabase.ConnectionString);
            // The host is Production and its secrets are a test's secrets; see the class remarks.
            Set(Govori.Api.Startup.ProductionSecrets.OverrideKey, "true");
        }

        protected override void ConfigureWebHost(IWebHostBuilder builder)
            => builder.UseEnvironment(Environments.Production);

        private void Set(string key, string? value)
        {
            _restore[key] = Environment.GetEnvironmentVariable(key);
            Environment.SetEnvironmentVariable(key, value);
        }

        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
            if (!disposing) return;
            foreach (var (key, value) in _restore)
                Environment.SetEnvironmentVariable(key, value);
            _restore.Clear();
        }
    }
}
