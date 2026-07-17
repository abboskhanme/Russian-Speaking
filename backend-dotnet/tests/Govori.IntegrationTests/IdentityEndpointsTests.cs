using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Govori.Identity.Providers;
using Govori.Identity.Security;
using Govori.Infrastructure;
using Govori.Infrastructure.Entities;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Govori.IntegrationTests;

/// <summary>
/// Full Identity-domain (Faza 3.1) coverage over the real Govori.Api host: register-via-OTP →
/// login → refresh → me happy path, login 401/403 parity, refresh rejecting an access token,
/// Google find-or-create via a fake verifier, and OTP fail-closed when the store errors.
///
/// External providers (OTP store/sender, Google verifier) are swapped for fakes via
/// ConfigureTestServices so tests never touch Redis/Google/SMS/email. Every created/seeded
/// row is deleted in a finally so runs are idempotent.
/// </summary>
public sealed class IdentityEndpointsTests : IClassFixture<IdentityEndpointsTests.IdentityApiFactory>, IDisposable
{
    private readonly IdentityApiFactory _factory;
    private readonly NpgsqlDataSourceHolder _db;

    public IdentityEndpointsTests(IdentityApiFactory factory)
    {
        _factory = factory;
        _db = new NpgsqlDataSourceHolder(factory.ConnectionString);
    }

    // ── 1. Full happy path: request-code → verify-code → register → login → refresh → me ──
    [Fact]
    public async Task Register_via_otp_then_login_refresh_and_me_round_trip()
    {
        var store = new FakeOtpStore();
        var sender = new FakeOtpSender();
        var client = _factory.CreateClientWith(store, sender, AnyGoogle(), emailVerificationEnabled: true);

        var email = $"reg-{Guid.NewGuid():N}@example.test";
        const string password = "Register!123";

        try
        {
            // request-code → 200 { ok, expires_in }; fake sender captures the code.
            var codeResp = await client.PostAsJsonAsync("/api/auth/email/request-code", new { email });
            Assert.Equal(HttpStatusCode.OK, codeResp.StatusCode);
            using (var codeDoc = JsonDocument.Parse(await codeResp.Content.ReadAsStringAsync()))
            {
                Assert.True(codeDoc.RootElement.GetProperty("ok").GetBoolean());
                Assert.True(codeDoc.RootElement.GetProperty("expires_in").GetInt32() > 0);
            }
            var code = sender.LastCodeFor(email);
            Assert.False(string.IsNullOrEmpty(code));

            // verify-code → 200 { email_verify_token }.
            var verifyResp = await client.PostAsJsonAsync("/api/auth/email/verify-code", new { email, code });
            Assert.Equal(HttpStatusCode.OK, verifyResp.StatusCode);
            using var verifyDoc = JsonDocument.Parse(await verifyResp.Content.ReadAsStringAsync());
            var emailVerifyToken = verifyDoc.RootElement.GetProperty("email_verify_token").GetString();
            Assert.False(string.IsNullOrEmpty(emailVerifyToken));

            // register → 201 UserOut (student). Uses the verify token.
            var registerResp = await client.PostAsJsonAsync("/api/auth/register", new
            {
                email,
                password,
                full_name = "Reg Tester",
                phone = "+998901234567",
                age = 21,
                region = "Toshkent",
                district = "Yunusobod",
                email_verify_token = emailVerifyToken,
            });
            Assert.Equal(HttpStatusCode.Created, registerResp.StatusCode);
            using (var regDoc = JsonDocument.Parse(await registerResp.Content.ReadAsStringAsync()))
            {
                Assert.Equal(email, regDoc.RootElement.GetProperty("email").GetString());
                Assert.Equal("student", regDoc.RootElement.GetProperty("role").GetString());
                Assert.True(regDoc.RootElement.GetProperty("is_active").GetBoolean());
            }

            // login → 200 token pair.
            var loginResp = await client.PostAsJsonAsync("/api/auth/login", new { email, password });
            Assert.Equal(HttpStatusCode.OK, loginResp.StatusCode);
            using var loginDoc = JsonDocument.Parse(await loginResp.Content.ReadAsStringAsync());
            var refreshToken = loginDoc.RootElement.GetProperty("refresh_token").GetString();
            Assert.False(string.IsNullOrEmpty(refreshToken));

            // refresh (with a real refresh token) → 200, fresh access token.
            var refreshResp = await client.PostAsJsonAsync("/api/auth/refresh", new { refresh_token = refreshToken });
            Assert.Equal(HttpStatusCode.OK, refreshResp.StatusCode);
            using var refreshDoc = JsonDocument.Parse(await refreshResp.Content.ReadAsStringAsync());
            var accessToken = refreshDoc.RootElement.GetProperty("access_token").GetString();
            Assert.False(string.IsNullOrEmpty(accessToken));

            // me (with the refreshed access token) → 200; role from DB, not the token.
            var me = await GetMe(client, accessToken!);
            Assert.Equal(HttpStatusCode.OK, me.StatusCode);
            using var meDoc = JsonDocument.Parse(await me.Content.ReadAsStringAsync());
            Assert.Equal(email, meDoc.RootElement.GetProperty("email").GetString());
            Assert.Equal("student", meDoc.RootElement.GetProperty("role").GetString());
        }
        finally
        {
            await DeleteByEmail(email);
        }
    }

    // ── 2. login parity: 401 wrong password, 403 inactive (blocked) ──
    [Fact]
    public async Task Login_returns_401_for_wrong_password_and_403_for_inactive()
    {
        var client = _factory.CreateClientWith(new FakeOtpStore(), new FakeOtpSender(), AnyGoogle());
        var hasher = new PasswordHasher();

        var activeEmail = $"active-{Guid.NewGuid():N}@example.test";
        var inactiveEmail = $"inactive-{Guid.NewGuid():N}@example.test";
        const string password = "Correct!123";

        await SeedUser(activeEmail, hasher.Hash(password), UserRole.Student, isActive: true);
        await SeedUser(inactiveEmail, hasher.Hash(password), UserRole.Student, isActive: false);

        try
        {
            // wrong password on an active account → 401.
            var wrong = await client.PostAsJsonAsync("/api/auth/login", new { email = activeEmail, password = "nope" });
            Assert.Equal(HttpStatusCode.Unauthorized, wrong.StatusCode);

            // correct password but blocked account → 403.
            var blocked = await client.PostAsJsonAsync("/api/auth/login", new { email = inactiveEmail, password });
            Assert.Equal(HttpStatusCode.Forbidden, blocked.StatusCode);
            using var doc = JsonDocument.Parse(await blocked.Content.ReadAsStringAsync());
            Assert.Equal("Account is blocked", doc.RootElement.GetProperty("detail").GetString());

            // sanity: correct password on the active account still succeeds.
            var ok = await client.PostAsJsonAsync("/api/auth/login", new { email = activeEmail, password });
            Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        }
        finally
        {
            await DeleteByEmail(activeEmail);
            await DeleteByEmail(inactiveEmail);
        }
    }

    // ── 3. refresh rejects an ACCESS token (only type=refresh is accepted) ──
    [Fact]
    public async Task Refresh_rejects_an_access_token()
    {
        var client = _factory.CreateClientWith(new FakeOtpStore(), new FakeOtpSender(), AnyGoogle());
        var hasher = new PasswordHasher();
        var email = $"refresh-{Guid.NewGuid():N}@example.test";
        const string password = "Refresh!123";
        await SeedUser(email, hasher.Hash(password), UserRole.Student, isActive: true);

        try
        {
            var loginResp = await client.PostAsJsonAsync("/api/auth/login", new { email, password });
            using var loginDoc = JsonDocument.Parse(await loginResp.Content.ReadAsStringAsync());
            var accessToken = loginDoc.RootElement.GetProperty("access_token").GetString();

            // Feed the ACCESS token to /refresh → 401 (type != "refresh").
            var resp = await client.PostAsJsonAsync("/api/auth/refresh", new { refresh_token = accessToken });
            Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
            using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
            Assert.Equal("Invalid refresh token", doc.RootElement.GetProperty("detail").GetString());
        }
        finally
        {
            await DeleteByEmail(email);
        }
    }

    // ── 4. Google sign-in via the fake verifier creates then returns the same user ──
    [Fact]
    public async Task Google_sign_in_creates_then_returns_user()
    {
        var email = $"google-{Guid.NewGuid():N}@example.test";
        var google = new FakeGoogleTokenVerifier(email, sub: $"sub-{Guid.NewGuid():N}", name: "Google User");
        var client = _factory.CreateClientWith(new FakeOtpStore(), new FakeOtpSender(), google);

        try
        {
            // First call → creates the account, returns tokens.
            var first = await client.PostAsJsonAsync("/api/auth/google", new { credential = "fake-id-token" });
            Assert.Equal(HttpStatusCode.OK, first.StatusCode);
            using var firstDoc = JsonDocument.Parse(await first.Content.ReadAsStringAsync());
            var accessToken = firstDoc.RootElement.GetProperty("access_token").GetString();
            Assert.False(string.IsNullOrEmpty(accessToken));

            // me → the created student, email matches (lower-cased).
            var me = await GetMe(client, accessToken!);
            Assert.Equal(HttpStatusCode.OK, me.StatusCode);
            using var meDoc = JsonDocument.Parse(await me.Content.ReadAsStringAsync());
            Assert.Equal(email.ToLowerInvariant(), meDoc.RootElement.GetProperty("email").GetString());
            Assert.Equal("student", meDoc.RootElement.GetProperty("role").GetString());

            // Second call → returns the SAME user (login path), still 200.
            var second = await client.PostAsJsonAsync("/api/auth/google", new { credential = "fake-id-token" });
            Assert.Equal(HttpStatusCode.OK, second.StatusCode);

            // Exactly one row exists for that email.
            await using var ctx = _db.CreateContext();
            Assert.Equal(1, await ctx.Users.CountAsync(u => u.Email == email.ToLowerInvariant()));
        }
        finally
        {
            await DeleteByEmail(email.ToLowerInvariant());
        }
    }

    // ── 5. OTP fail-closed: a broken store denies verification (400), never approves ──
    [Fact]
    public async Task Otp_verify_is_fail_closed_when_the_store_errors()
    {
        var client = _factory.CreateClientWith(new ThrowingOtpStore(), new FakeOtpSender(), AnyGoogle(), emailVerificationEnabled: true);
        var email = $"failclosed-{Guid.NewGuid():N}@example.test";

        var resp = await client.PostAsJsonAsync("/api/auth/email/verify-code", new { email, code = "123456" });

        // Denied (400) — NOT a 500 crash and NOT a 200 pass.
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    // ── helpers ──
    private static FakeGoogleTokenVerifier AnyGoogle() => new("unused@example.test", sub: "unused");

    private static async Task<HttpResponseMessage> GetMe(HttpClient client, string accessToken)
    {
        var req = new HttpRequestMessage(HttpMethod.Get, "/api/auth/me");
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        return await client.SendAsync(req);
    }

    private async Task SeedUser(string email, string passwordHash, UserRole role, bool isActive)
    {
        await using var ctx = _db.CreateContext();
        ctx.Users.Add(new User
        {
            Id = Guid.NewGuid(),
            Email = email,
            FullName = "Seed User",
            PasswordHash = passwordHash,
            Role = role,
            IsActive = isActive,
            IsPremium = false,
            PreferredLanguage = "uz",
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
        });
        await ctx.SaveChangesAsync();
    }

    private async Task DeleteByEmail(string email)
    {
        await using var ctx = _db.CreateContext();
        await ctx.Users.Where(u => u.Email == email).ExecuteDeleteAsync();
    }

    public void Dispose() => _db.Dispose();

    /// <summary>Owns an independent Npgsql data source for seed + cleanup, so tests read/write
    /// the same schema DB the host uses.</summary>
    private sealed class NpgsqlDataSourceHolder : IDisposable
    {
        private readonly Npgsql.NpgsqlDataSource _dataSource;

        public NpgsqlDataSourceHolder(string connectionString)
            => _dataSource = GovoriDataSourceFactory.Build(connectionString);

        public GovoriDbContext CreateContext()
        {
            var builder = new DbContextOptionsBuilder<GovoriDbContext>();
            builder.UseGovori(_dataSource);
            return new GovoriDbContext(builder.Options);
        }

        public void Dispose() => _dataSource.Dispose();
    }

    /// <summary>
    /// Boots Govori.Api against the schema DB with a fixed test SECRET_KEY, then swaps the
    /// external providers (OTP store/sender, Google verifier) for fakes and can force
    /// email-verification on — all via ConfigureTestServices, which runs AFTER the app's own
    /// registrations so the fakes win. SECRET_KEY + the connection string go through env vars
    /// because Program.cs reads them at CreateBuilder, before the test host config applies.
    /// </summary>
    public sealed class IdentityApiFactory : WebApplicationFactory<Program>
    {
        public string ConnectionString { get; } =
            Environment.GetEnvironmentVariable("GOVORI_TEST_DB")
            ?? GovoriDataSourceFactory.DefaultConnectionString;

        private const string TestSecretKey =
            "identity-domain-integration-test-secret-key-do-not-use-in-prod";

        public IdentityApiFactory()
        {
            Environment.SetEnvironmentVariable("SECRET_KEY", TestSecretKey);
            Environment.SetEnvironmentVariable("GOVORI_DB", ConnectionString);
        }

        /// <summary>A client whose host uses the supplied provider fakes. Each call builds an
        /// isolated host via WithWebHostBuilder so tests don't share provider state.</summary>
        public HttpClient CreateClientWith(
            IOtpStore otpStore,
            IOtpSender otpSender,
            IGoogleTokenVerifier googleVerifier,
            bool emailVerificationEnabled = false)
        {
            return WithWebHostBuilder(builder =>
                builder.ConfigureTestServices(services =>
                {
                    services.RemoveAll<IOtpStore>();
                    services.AddSingleton(otpStore);
                    services.RemoveAll<IOtpSender>();
                    services.AddSingleton(otpSender);
                    services.RemoveAll<IGoogleTokenVerifier>();
                    services.AddSingleton(googleVerifier);

                    services.RemoveAll<OtpOptions>();
                    services.AddSingleton(new OtpOptions { EmailVerificationEnabled = emailVerificationEnabled });
                })).CreateClient();
        }
    }
}
