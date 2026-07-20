using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Govori.Infrastructure;
using Govori.Infrastructure.Entities;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Govori.IntegrationTests;

/// <summary>
/// Tracer bullet for the Identity vertical slice (docs/07 §7.5, Faza 3.1): proves the full PHONE +
/// OTP path HTTP → AuthService → the REAL providers (Redis OTP store + dev delivery) → EF Core →
/// the real prod-shaped Postgres → JWT and back.
///
/// Boots the real <c>Govori.Api</c> host via <see cref="WebApplicationFactory{T}"/> with the
/// DbContext pointed at the govori-net schema DB (GOVORI_TEST_DB) and a fixed test SECRET_KEY, and
/// (unlike IdentityEndpointsTests) swaps NO providers — so this exercises the real RedisOtpStore
/// and the real DevOtpDeliverySender (no Telegram token in the test env ⇒ dev delivery, which
/// accepts the fixed code 000000). Seeds one phone user through the DbContext and deletes it in a
/// finally so the run is idempotent.
/// </summary>
public sealed class AuthEndpointsTests : IClassFixture<AuthEndpointsTests.AuthApiFactory>, IDisposable
{
    private const string DevCode = "000000";

    private readonly AuthApiFactory _factory;
    private readonly NpgsqlDataSource _dataSource;

    public AuthEndpointsTests(AuthApiFactory factory)
    {
        _factory = factory;
        // Independent data source (same connection string as the host) for seed + cleanup.
        _dataSource = GovoriDataSourceFactory.Build(factory.ConnectionString);
    }

    private GovoriDbContext CreateContext()
    {
        var builder = new DbContextOptionsBuilder<GovoriDbContext>();
        builder.UseGovori(_dataSource);
        return new GovoriDbContext(builder.Options);
    }

    [Fact]
    public async Task Otp_login_then_me_round_trips_http_to_redis_to_ef_to_jwt_and_back()
    {
        var userId = Guid.NewGuid();
        var email = $"tracer-{userId:N}@example.test";
        var phone = "+99899" + Random.Shared.Next(0, 10_000_000).ToString("D7");

        await using (var ctx = CreateContext())
        {
            ctx.Users.Add(new User
            {
                Id = userId,
                Email = email,
                Phone = phone,
                FullName = "Tracer Bullet",
                PasswordHash = null,                    // phone users are passwordless
                Role = UserRole.Student,                // native PG enum
                IsActive = true,
                IsPremium = false,
                PreferredLanguage = "uz",
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow,
            });
            await ctx.SaveChangesAsync();
        }

        try
        {
            var client = _factory.CreateClient();

            // 1. POST /api/auth/otp/request → 200, code stored in the REAL Redis, dev delivery.
            var reqResp = await client.PostAsJsonAsync("/api/auth/otp/request", new { phone });
            Assert.Equal(HttpStatusCode.OK, reqResp.StatusCode);
            using (var reqDoc = JsonDocument.Parse(await reqResp.Content.ReadAsStringAsync()))
            {
                Assert.True(reqDoc.RootElement.GetProperty("ok").GetBoolean());
                Assert.Equal("dev", reqDoc.RootElement.GetProperty("delivery").GetString());
            }

            // 2. POST /api/auth/otp/verify (dev 000000) → 200 + non-empty tokens.
            var verifyResp = await client.PostAsJsonAsync("/api/auth/otp/verify", new { phone, code = DevCode });
            Assert.Equal(HttpStatusCode.OK, verifyResp.StatusCode);
            using var verifyDoc = JsonDocument.Parse(await verifyResp.Content.ReadAsStringAsync());
            var accessToken = verifyDoc.RootElement.GetProperty("access_token").GetString();
            Assert.False(string.IsNullOrEmpty(accessToken));
            Assert.False(string.IsNullOrEmpty(verifyDoc.RootElement.GetProperty("refresh_token").GetString()));
            Assert.Equal("bearer", verifyDoc.RootElement.GetProperty("token_type").GetString());

            // 3. GET /api/auth/me (Bearer) → 200 + matching id/role. Role comes from the DB read in
            //    AuthService, NOT from any claim in the token.
            var meReq = new HttpRequestMessage(HttpMethod.Get, "/api/auth/me");
            meReq.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
            var meResp = await client.SendAsync(meReq);
            Assert.Equal(HttpStatusCode.OK, meResp.StatusCode);

            using var meDoc = JsonDocument.Parse(await meResp.Content.ReadAsStringAsync());
            Assert.Equal(userId, meDoc.RootElement.GetProperty("id").GetGuid());
            Assert.Equal(email, meDoc.RootElement.GetProperty("email").GetString());
            Assert.Equal("student", meDoc.RootElement.GetProperty("role").GetString());
            Assert.True(meDoc.RootElement.GetProperty("is_active").GetBoolean());

            // 4. POST /api/auth/otp/verify (wrong code) → 401 (dev bypass is 000000 only; "111111"
            //    must fail against the real Redis-stored code).
            var wrongResp = await client.PostAsJsonAsync("/api/auth/otp/verify", new { phone, code = "111111" });
            Assert.Equal(HttpStatusCode.Unauthorized, wrongResp.StatusCode);

            // 5. GET /api/auth/me (no token) → 401.
            var anonResp = await client.GetAsync("/api/auth/me");
            Assert.Equal(HttpStatusCode.Unauthorized, anonResp.StatusCode);
        }
        finally
        {
            await using var ctx = CreateContext();
            await ctx.Users.Where(u => u.Id == userId).ExecuteDeleteAsync();
        }
    }

    [Fact]
    public async Task Register_then_patch_me_persists_region_district_address()
    {
        // A brand-new phone (no seeded user) — verify with a full_name REGISTERS the account in
        // one shot, then PATCH /me writes the "Manzil" fields and GET /me reflects them.
        var phone = "+99897" + Random.Shared.Next(0, 10_000_000).ToString("D7");

        try
        {
            var client = _factory.CreateClient();

            // 1. Request + verify (dev 000000) WITH a name → 200 TokenPair (register branch).
            var reqResp = await client.PostAsJsonAsync("/api/auth/otp/request", new { phone });
            Assert.Equal(HttpStatusCode.OK, reqResp.StatusCode);

            var verifyResp = await client.PostAsJsonAsync(
                "/api/auth/otp/verify", new { phone, code = DevCode, full_name = "Manzil Tester" });
            Assert.Equal(HttpStatusCode.OK, verifyResp.StatusCode);
            using var verifyDoc = JsonDocument.Parse(await verifyResp.Content.ReadAsStringAsync());
            var accessToken = verifyDoc.RootElement.GetProperty("access_token").GetString();
            Assert.False(string.IsNullOrEmpty(accessToken));

            // 2. PATCH /api/auth/me with the address fields → 200 + echoed in the MeResponse.
            var patchReq = new HttpRequestMessage(HttpMethod.Patch, "/api/auth/me")
            {
                Content = JsonContent.Create(new
                {
                    region = "Toshkent shahri",
                    district = "Yunusobod tumani",
                    address = "Amir Temur ko'chasi, 12-uy, 34-xonadon",
                }),
            };
            patchReq.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
            var patchResp = await client.SendAsync(patchReq);
            Assert.Equal(HttpStatusCode.OK, patchResp.StatusCode);
            using (var patchDoc = JsonDocument.Parse(await patchResp.Content.ReadAsStringAsync()))
            {
                Assert.Equal("Toshkent shahri", patchDoc.RootElement.GetProperty("region").GetString());
                Assert.Equal("Yunusobod tumani", patchDoc.RootElement.GetProperty("district").GetString());
                Assert.Equal("Amir Temur ko'chasi, 12-uy, 34-xonadon",
                    patchDoc.RootElement.GetProperty("address").GetString());
            }

            // 3. GET /api/auth/me (Bearer) → the persisted address fields survive a fresh read.
            var meReq = new HttpRequestMessage(HttpMethod.Get, "/api/auth/me");
            meReq.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
            var meResp = await client.SendAsync(meReq);
            Assert.Equal(HttpStatusCode.OK, meResp.StatusCode);
            using var meDoc = JsonDocument.Parse(await meResp.Content.ReadAsStringAsync());
            Assert.Equal("Toshkent shahri", meDoc.RootElement.GetProperty("region").GetString());
            Assert.Equal("Yunusobod tumani", meDoc.RootElement.GetProperty("district").GetString());
            Assert.Equal("Amir Temur ko'chasi, 12-uy, 34-xonadon",
                meDoc.RootElement.GetProperty("address").GetString());
        }
        finally
        {
            await using var ctx = CreateContext();
            await ctx.Users.Where(u => u.Phone == phone).ExecuteDeleteAsync();
        }
    }

    public void Dispose() => _dataSource.Dispose();

    /// <summary>
    /// Boots Govori.Api against the schema DB with a fixed test SECRET_KEY.
    ///
    /// Config is injected via environment variables, NOT WAF's ConfigureAppConfiguration:
    /// Program.cs reads SECRET_KEY + the connection string during WebApplication.CreateBuilder
    /// (top-level statements), which is BEFORE WAF's ConfigureAppConfiguration is applied.
    /// CreateBuilder folds env vars into configuration at creation time, so the environment
    /// is the one source that is visible early enough.
    /// </summary>
    public sealed class AuthApiFactory : WebApplicationFactory<Program>
    {
        public string ConnectionString { get; } =
            Environment.GetEnvironmentVariable("GOVORI_TEST_DB")
            ?? GovoriDataSourceFactory.DefaultConnectionString;

        private const string TestSecretKey =
            "tracer-bullet-integration-test-secret-key-do-not-use-in-prod";

        public AuthApiFactory()
        {
            Environment.SetEnvironmentVariable("SECRET_KEY", TestSecretKey);
            Environment.SetEnvironmentVariable("GOVORI_DB", ConnectionString);
        }
    }
}
