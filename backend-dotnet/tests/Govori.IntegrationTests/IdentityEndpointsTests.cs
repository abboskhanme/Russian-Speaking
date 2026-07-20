using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Govori.Identity.Providers;
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
/// Full Identity-domain (Faza 3.1) coverage over the real Govori.Api host for the PHONE + OTP auth
/// flow (product decision: login by phone, OTP over Telegram, no email/password): otp/request →
/// otp/verify login for an existing seeded phone → me; otp/verify register for a new phone + name;
/// wrong code → 401; new phone without a name → needs_registration; inactive → 403; refresh
/// rejecting an access token; Google find-or-create; and OTP fail-closed when the store errors.
///
/// External providers (OTP store + delivery, Google verifier) are swapped for fakes via
/// ConfigureTestServices so tests never touch Redis/Google/Telegram. The dev delivery fake accepts
/// the fixed code 000000. Every created/seeded row is deleted in a finally so runs are idempotent.
/// </summary>
public sealed class IdentityEndpointsTests : IClassFixture<IdentityEndpointsTests.IdentityApiFactory>, IDisposable
{
    private const string DevCode = "000000";

    private readonly IdentityApiFactory _factory;
    private readonly NpgsqlDataSourceHolder _db;

    public IdentityEndpointsTests(IdentityApiFactory factory)
    {
        _factory = factory;
        _db = new NpgsqlDataSourceHolder(factory.ConnectionString);
    }

    // ── 1. Existing phone: otp/request → otp/verify (dev 000000) → tokens → me ──
    [Fact]
    public async Task Otp_login_for_existing_phone_then_me_round_trip()
    {
        var client = _factory.CreateClientWith(new FakeOtpStore(), new FakeOtpDeliverySender(), AnyGoogle());
        var phone = NewPhone();
        var email = $"login-{Guid.NewGuid():N}@example.test";
        await SeedUser(email, phone, UserRole.Student, isActive: true);

        try
        {
            // request → 200 { ok, delivery: "dev", expires_in, dev_hint: "000000" }
            var reqResp = await client.PostAsJsonAsync("/api/auth/otp/request", new { phone });
            Assert.Equal(HttpStatusCode.OK, reqResp.StatusCode);
            using (var reqDoc = JsonDocument.Parse(await reqResp.Content.ReadAsStringAsync()))
            {
                Assert.True(reqDoc.RootElement.GetProperty("ok").GetBoolean());
                Assert.Equal("dev", reqDoc.RootElement.GetProperty("delivery").GetString());
                Assert.True(reqDoc.RootElement.GetProperty("expires_in").GetInt32() > 0);
                Assert.Equal(DevCode, reqDoc.RootElement.GetProperty("dev_hint").GetString());
            }

            // verify with the dev code → 200 token pair (LOGIN, not register — no full_name needed).
            var verifyResp = await client.PostAsJsonAsync("/api/auth/otp/verify", new { phone, code = DevCode });
            Assert.Equal(HttpStatusCode.OK, verifyResp.StatusCode);
            using var verifyDoc = JsonDocument.Parse(await verifyResp.Content.ReadAsStringAsync());
            var accessToken = verifyDoc.RootElement.GetProperty("access_token").GetString();
            Assert.False(string.IsNullOrEmpty(accessToken));
            Assert.False(string.IsNullOrEmpty(verifyDoc.RootElement.GetProperty("refresh_token").GetString()));

            // me → 200, the seeded student (role from DB, not the token).
            var me = await GetMe(client, accessToken!);
            Assert.Equal(HttpStatusCode.OK, me.StatusCode);
            using var meDoc = JsonDocument.Parse(await me.Content.ReadAsStringAsync());
            Assert.Equal(email, meDoc.RootElement.GetProperty("email").GetString());
            Assert.Equal("student", meDoc.RootElement.GetProperty("role").GetString());
        }
        finally
        {
            await DeleteByPhone(phone);
        }
    }

    // ── 2. New phone + full_name → registers a passwordless student, issues tokens ──
    [Fact]
    public async Task Otp_verify_new_phone_with_full_name_registers_and_issues_tokens()
    {
        var client = _factory.CreateClientWith(new FakeOtpStore(), new FakeOtpDeliverySender(), AnyGoogle());
        var phone = NewPhone();

        try
        {
            await client.PostAsJsonAsync("/api/auth/otp/request", new { phone });

            var verifyResp = await client.PostAsJsonAsync(
                "/api/auth/otp/verify", new { phone, code = DevCode, full_name = "Yangi Foydalanuvchi" });
            Assert.Equal(HttpStatusCode.OK, verifyResp.StatusCode);
            using var verifyDoc = JsonDocument.Parse(await verifyResp.Content.ReadAsStringAsync());
            var accessToken = verifyDoc.RootElement.GetProperty("access_token").GetString();
            Assert.False(string.IsNullOrEmpty(accessToken));

            // me → the created student; email is the derived {phone}@govori.uz placeholder.
            var me = await GetMe(client, accessToken!);
            Assert.Equal(HttpStatusCode.OK, me.StatusCode);
            using var meDoc = JsonDocument.Parse(await me.Content.ReadAsStringAsync());
            Assert.Equal($"{phone}@govori.uz", meDoc.RootElement.GetProperty("email").GetString());
            Assert.Equal("Yangi Foydalanuvchi", meDoc.RootElement.GetProperty("full_name").GetString());
            Assert.Equal("student", meDoc.RootElement.GetProperty("role").GetString());

            // The row is real, passwordless (password_hash NULL), phone-matched.
            await using var ctx = _db.CreateContext();
            var created = await ctx.Users.SingleAsync(u => u.Phone == phone);
            Assert.Null(created.PasswordHash);
            Assert.True(created.IsActive);
        }
        finally
        {
            await DeleteByPhone(phone);
        }
    }

    // ── 3. New phone WITHOUT a name → 200 { needs_registration: true } (no row created) ──
    [Fact]
    public async Task Otp_verify_new_phone_without_name_returns_needs_registration()
    {
        var client = _factory.CreateClientWith(new FakeOtpStore(), new FakeOtpDeliverySender(), AnyGoogle());
        var phone = NewPhone();

        try
        {
            await client.PostAsJsonAsync("/api/auth/otp/request", new { phone });

            var verifyResp = await client.PostAsJsonAsync("/api/auth/otp/verify", new { phone, code = DevCode });
            Assert.Equal(HttpStatusCode.OK, verifyResp.StatusCode);
            using var doc = JsonDocument.Parse(await verifyResp.Content.ReadAsStringAsync());
            Assert.True(doc.RootElement.GetProperty("needs_registration").GetBoolean());
            Assert.False(doc.RootElement.TryGetProperty("access_token", out _)); // NOT tokens

            // No account was created for that phone.
            await using var ctx = _db.CreateContext();
            Assert.Equal(0, await ctx.Users.CountAsync(u => u.Phone == phone));
        }
        finally
        {
            await DeleteByPhone(phone); // no-op if nothing created; keeps the run idempotent
        }
    }

    // ── 4. Wrong code → 401 (the dev bypass is 000000; anything else must fail against the store) ──
    [Fact]
    public async Task Otp_verify_wrong_code_returns_401()
    {
        var client = _factory.CreateClientWith(new FakeOtpStore(), new FakeOtpDeliverySender(), AnyGoogle());
        var phone = NewPhone();
        var email = $"wrong-{Guid.NewGuid():N}@example.test";
        await SeedUser(email, phone, UserRole.Student, isActive: true);

        try
        {
            await client.PostAsJsonAsync("/api/auth/otp/request", new { phone }); // FakeOtpStore stores "123456"

            // "111111" is neither the dev bypass nor the stored code → 401.
            var resp = await client.PostAsJsonAsync("/api/auth/otp/verify", new { phone, code = "111111" });
            Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
        }
        finally
        {
            await DeleteByPhone(phone);
        }
    }

    // ── 5. Inactive (blocked) account → 403 even with a valid code ──
    [Fact]
    public async Task Otp_verify_returns_403_for_a_blocked_account()
    {
        var client = _factory.CreateClientWith(new FakeOtpStore(), new FakeOtpDeliverySender(), AnyGoogle());
        var phone = NewPhone();
        var email = $"blocked-{Guid.NewGuid():N}@example.test";
        await SeedUser(email, phone, UserRole.Student, isActive: false);

        try
        {
            await client.PostAsJsonAsync("/api/auth/otp/request", new { phone });

            var resp = await client.PostAsJsonAsync("/api/auth/otp/verify", new { phone, code = DevCode });
            Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
            using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
            Assert.Equal("Account is blocked", doc.RootElement.GetProperty("detail").GetString());
        }
        finally
        {
            await DeleteByPhone(phone);
        }
    }

    // ── 6. refresh rejects an ACCESS token (only type=refresh is accepted) ──
    [Fact]
    public async Task Refresh_rejects_an_access_token()
    {
        var client = _factory.CreateClientWith(new FakeOtpStore(), new FakeOtpDeliverySender(), AnyGoogle());
        var phone = NewPhone();
        var email = $"refresh-{Guid.NewGuid():N}@example.test";
        await SeedUser(email, phone, UserRole.Student, isActive: true);

        try
        {
            await client.PostAsJsonAsync("/api/auth/otp/request", new { phone });
            var verifyResp = await client.PostAsJsonAsync("/api/auth/otp/verify", new { phone, code = DevCode });
            using var verifyDoc = JsonDocument.Parse(await verifyResp.Content.ReadAsStringAsync());
            var accessToken = verifyDoc.RootElement.GetProperty("access_token").GetString();

            // Feed the ACCESS token to /refresh → 401 (type != "refresh").
            var resp = await client.PostAsJsonAsync("/api/auth/refresh", new { refresh_token = accessToken });
            Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
            using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
            Assert.Equal("Invalid refresh token", doc.RootElement.GetProperty("detail").GetString());
        }
        finally
        {
            await DeleteByPhone(phone);
        }
    }

    // ── 7. Google sign-in via the fake verifier creates then returns the same user ──
    [Fact]
    public async Task Google_sign_in_creates_then_returns_user()
    {
        var email = $"google-{Guid.NewGuid():N}@example.test";
        var google = new FakeGoogleTokenVerifier(email, sub: $"sub-{Guid.NewGuid():N}", name: "Google User");
        var client = _factory.CreateClientWith(new FakeOtpStore(), new FakeOtpDeliverySender(), google);

        try
        {
            var first = await client.PostAsJsonAsync("/api/auth/google", new { credential = "fake-id-token" });
            Assert.Equal(HttpStatusCode.OK, first.StatusCode);
            using var firstDoc = JsonDocument.Parse(await first.Content.ReadAsStringAsync());
            var accessToken = firstDoc.RootElement.GetProperty("access_token").GetString();
            Assert.False(string.IsNullOrEmpty(accessToken));

            var me = await GetMe(client, accessToken!);
            Assert.Equal(HttpStatusCode.OK, me.StatusCode);
            using var meDoc = JsonDocument.Parse(await me.Content.ReadAsStringAsync());
            Assert.Equal(email.ToLowerInvariant(), meDoc.RootElement.GetProperty("email").GetString());
            Assert.Equal("student", meDoc.RootElement.GetProperty("role").GetString());

            // Second call → returns the SAME user (login path), still 200; exactly one row exists.
            var second = await client.PostAsJsonAsync("/api/auth/google", new { credential = "fake-id-token" });
            Assert.Equal(HttpStatusCode.OK, second.StatusCode);

            await using var ctx = _db.CreateContext();
            Assert.Equal(1, await ctx.Users.CountAsync(u => u.Email == email.ToLowerInvariant()));
        }
        finally
        {
            await DeleteByEmail(email.ToLowerInvariant());
        }
    }

    // ── 8. OTP fail-closed: a broken store denies verification (401), never approves/500s ──
    [Fact]
    public async Task Otp_verify_is_fail_closed_when_the_store_errors()
    {
        // Non-dev code ("123456") so the dev bypass can't mask the store failure.
        var client = _factory.CreateClientWith(new ThrowingOtpStore(), new FakeOtpDeliverySender(), AnyGoogle());
        var phone = NewPhone();

        var resp = await client.PostAsJsonAsync("/api/auth/otp/verify", new { phone, code = "123456" });

        // Denied (401) — NOT a 500 crash and NOT a 200 pass.
        Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
    }

    // ── helpers ──
    private static FakeGoogleTokenVerifier AnyGoogle() => new("unused@example.test", sub: "unused");

    // A fresh, valid +998 phone unlikely to collide with the seeded fixtures (which use 90/91 codes).
    private static string NewPhone() => "+99899" + Random.Shared.Next(0, 10_000_000).ToString("D7");

    private static async Task<HttpResponseMessage> GetMe(HttpClient client, string accessToken)
    {
        var req = new HttpRequestMessage(HttpMethod.Get, "/api/auth/me");
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        return await client.SendAsync(req);
    }

    private async Task SeedUser(string email, string phone, UserRole role, bool isActive)
    {
        await using var ctx = _db.CreateContext();
        ctx.Users.Add(new User
        {
            Id = Guid.NewGuid(),
            Email = email,
            Phone = phone,
            FullName = "Seed User",
            PasswordHash = null,        // phone users are passwordless
            Role = role,
            IsActive = isActive,
            IsPremium = false,
            PreferredLanguage = "uz",
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
        });
        await ctx.SaveChangesAsync();
    }

    private async Task DeleteByPhone(string phone)
    {
        await using var ctx = _db.CreateContext();
        await ctx.Users.Where(u => u.Phone == phone).ExecuteDeleteAsync();
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
    /// Boots Govori.Api against the schema DB with a fixed test SECRET_KEY, then swaps the external
    /// providers (OTP store + delivery, Google verifier) for fakes via ConfigureTestServices, which
    /// runs AFTER the app's own registrations so the fakes win. SECRET_KEY + the connection string
    /// go through env vars because Program.cs reads them at CreateBuilder, before the test host
    /// config applies.
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
            IOtpDeliverySender otpDelivery,
            IGoogleTokenVerifier googleVerifier)
        {
            return WithWebHostBuilder(builder =>
                builder.ConfigureTestServices(services =>
                {
                    services.RemoveAll<IOtpStore>();
                    services.AddSingleton(otpStore);
                    services.RemoveAll<IOtpDeliverySender>();
                    services.AddSingleton(otpDelivery);
                    services.RemoveAll<IGoogleTokenVerifier>();
                    services.AddSingleton(googleVerifier);
                })).CreateClient();
        }
    }
}
