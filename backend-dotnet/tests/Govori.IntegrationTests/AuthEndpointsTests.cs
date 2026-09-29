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
/// DbContext pointed at the per-run throwaway database (see <see cref="TestDatabase"/>) and a fixed
/// test SECRET_KEY, and
/// (unlike IdentityEndpointsTests) swaps NO providers — so this exercises the real RedisOtpStore
/// and the real DevOtpDeliverySender (no Telegram token in the test env ⇒ dev delivery, which
/// accepts the fixed code 000000). Seeds one phone user through the DbContext and deletes it in a
/// finally so the run is idempotent.
/// </summary>
[Collection(PerRunDatabaseFixture.CollectionName)]
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

    [Fact]
    public async Task Concurrent_verify_of_the_same_new_phone_yields_exactly_one_account()
    {
        // Two verifies of the SAME unregistered number, in flight together — a double-tapped
        // "Tasdiqlash" produces exactly this. Both read "no such user" before either inserts, so one
        // of them meets ix_users_phone on the way in. The contract: BOTH callers get a session and
        // the database holds ONE account, because the loser resolves to a login instead of a 500
        // (AuthService.CompleteLoginAsync).
        //
        // Should the two happen to serialize, the second simply takes the ordinary login branch and
        // both assertions still hold — the test cannot fail spuriously, it can only stop exercising
        // the race it is aimed at.
        var phone = "+99895" + Random.Shared.Next(0, 10_000_000).ToString("D7");

        try
        {
            var client = _factory.CreateClient();
            var reqResp = await client.PostAsJsonAsync("/api/auth/otp/request", new { phone });
            Assert.Equal(HttpStatusCode.OK, reqResp.StatusCode);

            var body = new { phone, code = DevCode, full_name = "Poyga Tester" };
            var responses = await Task.WhenAll(
                client.PostAsJsonAsync("/api/auth/otp/verify", body),
                client.PostAsJsonAsync("/api/auth/otp/verify", body));

            foreach (var response in responses)
            {
                Assert.Equal(HttpStatusCode.OK, response.StatusCode);
                using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
                Assert.False(string.IsNullOrEmpty(
                    doc.RootElement.GetProperty("access_token").GetString()));
            }

            await using var ctx = CreateContext();
            Assert.Equal(1, await ctx.Users.CountAsync(u => u.Phone == phone));
        }
        finally
        {
            await using var ctx = CreateContext();
            await ctx.Users.Where(u => u.Phone == phone).ExecuteDeleteAsync();
        }
    }

    // ─── Per-phone OTP brakes, through HTTP and the REAL Redis store ─────────────
    //
    // Each of these sends its own X-Forwarded-For. The host has no proxy in front of it, so that
    // header is simply the rate-limit partition (RateLimitIdentity reads its last hop), and a private
    // one keeps the per-IP email_code limit (5/600, shared by every anonymous request in this class)
    // from answering 429 in place of the brake under test. The two are told apart by body as well.

    private const string CooldownDetail = "Kod yaqinda yuborilgan. Birozdan so'ng qayta urinib ko'ring.";
    private const string LockedDetail = "Juda ko'p noto'g'ri urinish. Keyinroq qayta urinib ko'ring.";

    private static Task<HttpResponseMessage> PostFrom(HttpClient client, string forwardedFor, string url, object body)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, url) { Content = JsonContent.Create(body) };
        request.Headers.Add("X-Forwarded-For", forwardedFor);
        return client.SendAsync(request);
    }

    [Fact]
    public async Task A_second_code_inside_the_cooldown_is_429_alike_for_registered_and_unregistered_phones()
    {
        var userId = Guid.NewGuid();
        var registered = "+99893" + Random.Shared.Next(0, 10_000_000).ToString("D7");
        var unregistered = "+99894" + Random.Shared.Next(0, 10_000_000).ToString("D7");

        await using (var ctx = CreateContext())
        {
            ctx.Users.Add(new User
            {
                Id = userId, Email = $"cooldown-{userId:N}@example.test", Phone = registered, FullName = "Cooldown",
                Role = UserRole.Student, IsActive = true, IsPremium = false, PreferredLanguage = "uz",
                CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow,
            });
            await ctx.SaveChangesAsync();
        }

        try
        {
            var client = _factory.CreateClient();
            const string from = "198.51.100.11";
            var bodies = new List<string>();

            foreach (var phone in new[] { registered, unregistered })
            {
                Assert.Equal(HttpStatusCode.OK,
                    (await PostFrom(client, from, "/api/auth/otp/request", new { phone })).StatusCode);

                var again = await PostFrom(client, from, "/api/auth/otp/request", new { phone });
                Assert.Equal(HttpStatusCode.TooManyRequests, again.StatusCode);
                var retryAfter = again.Headers.RetryAfter?.Delta;
                Assert.NotNull(retryAfter);
                Assert.InRange(retryAfter!.Value, TimeSpan.FromSeconds(1), TimeSpan.FromSeconds(60));

                var body = await again.Content.ReadAsStringAsync();
                using (var doc = JsonDocument.Parse(body))
                    Assert.Equal(CooldownDetail, doc.RootElement.GetProperty("detail").GetString());
                bodies.Add(body);
            }

            // "Never reveal whether the phone has an account": the refusal is byte-for-byte the same.
            Assert.Equal(bodies[0], bodies[1]);
        }
        finally
        {
            await using var ctx = CreateContext();
            await ctx.Users.Where(u => u.Id == userId).ExecuteDeleteAsync();
        }
    }

    [Fact]
    public async Task A_locked_out_phone_is_429_on_verify_even_with_a_live_code()
    {
        var phone = "+99895" + Random.Shared.Next(0, 10_000_000).ToString("D7");
        var redisOptions = StackExchange.Redis.ConfigurationOptions.Parse(
            Environment.GetEnvironmentVariable("GOVORI_REDIS") ?? "govori-redis:6379");
        redisOptions.AbortOnConnectFail = false;
        await using var redis = await StackExchange.Redis.ConnectionMultiplexer.ConnectAsync(redisOptions);
        var db = redis.GetDatabase();

        try
        {
            var client = _factory.CreateClient();
            const string from = "198.51.100.12";

            // A live code exists…
            Assert.Equal(HttpStatusCode.OK,
                (await PostFrom(client, from, "/api/auth/otp/request", new { phone })).StatusCode);
            // …but this phone already spent its 10 wrong guesses in the current window.
            await db.StringSetAsync(Govori.Platform.Otp.OtpRedisKeys.Failures(phone), 10, TimeSpan.FromHours(1));

            // Not the dev bypass code, so the real store decides.
            var response = await PostFrom(client, from, "/api/auth/otp/verify", new { phone, code = "123456" });

            Assert.Equal(HttpStatusCode.TooManyRequests, response.StatusCode);
            Assert.InRange(response.Headers.RetryAfter!.Delta!.Value, TimeSpan.FromSeconds(1), TimeSpan.FromHours(1));
            using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            Assert.Equal(LockedDetail, doc.RootElement.GetProperty("detail").GetString());
        }
        finally
        {
            await db.KeyDeleteAsync(new StackExchange.Redis.RedisKey[]
            {
                Govori.Platform.Otp.OtpRedisKeys.Code(phone), Govori.Platform.Otp.OtpRedisKeys.Attempts(phone),
                Govori.Platform.Otp.OtpRedisKeys.RequestCooldown(phone), Govori.Platform.Otp.OtpRedisKeys.Failures(phone),
            });
        }
    }

    [Fact]
    public async Task A_phone_change_inside_the_new_numbers_cooldown_is_429()
    {
        // Same code key as login, so the same cooldown — and it is checked BEFORE the pending change
        // is written, so the refused request leaves nothing behind.
        var userId = Guid.NewGuid();
        var newPhone = "+99891" + Random.Shared.Next(0, 10_000_000).ToString("D7");

        await using (var ctx = CreateContext())
        {
            ctx.Users.Add(new User
            {
                Id = userId, Email = $"phonechange-{userId:N}@example.test", FullName = "Phone Change",
                Role = UserRole.Student, IsActive = true, IsPremium = false, PreferredLanguage = "uz",
                CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow,
            });
            await ctx.SaveChangesAsync();
        }

        try
        {
            var client = _factory.CreateClient();
            var token = new Govori.Identity.Security.TokenService(
                    new Govori.Identity.Security.IdentityAuthOptions { SecretKey = AuthApiFactory.TestSecretKey })
                .CreateAccessToken(userId.ToString());

            async Task<HttpResponseMessage> RequestChange()
            {
                var request = new HttpRequestMessage(HttpMethod.Post, "/api/auth/phone/change/request")
                {
                    Content = JsonContent.Create(new { new_phone = newPhone }),
                };
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
                return await client.SendAsync(request);
            }

            Assert.Equal(HttpStatusCode.OK, (await RequestChange()).StatusCode);

            var again = await RequestChange();
            Assert.Equal(HttpStatusCode.TooManyRequests, again.StatusCode);
            Assert.NotNull(again.Headers.RetryAfter?.Delta);
        }
        finally
        {
            await using var ctx = CreateContext();
            await ctx.Users.Where(u => u.Id == userId).ExecuteDeleteAsync();
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
        // The per-run throwaway database (see TestDatabase) — never the shared dev one.
        public string ConnectionString { get; } = TestDatabase.ConnectionString;

        internal const string TestSecretKey =
            "tracer-bullet-integration-test-secret-key-do-not-use-in-prod";

        public AuthApiFactory()
        {
            Environment.SetEnvironmentVariable("SECRET_KEY", TestSecretKey);
            Environment.SetEnvironmentVariable("GOVORI_DB", ConnectionString);
        }
    }
}
