using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Govori.Identity.Security;
using Govori.Infrastructure;
using Govori.Infrastructure.Entities;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Govori.IntegrationTests;

/// <summary>
/// Tracer bullet for the Identity vertical slice (docs/07 §7.5, Faza 3.1): proves the full
/// path HTTP → AuthService → EF Core → the real prod-shaped Postgres → JWT and back.
///
/// Boots the real <c>Govori.Api</c> host via <see cref="WebApplicationFactory{T}"/> with the
/// DbContext pointed at the govori-net schema DB (GOVORI_TEST_DB) and a fixed test SECRET_KEY.
/// Seeds one user through the DbContext and deletes it in a finally so the run is idempotent.
/// </summary>
public sealed class AuthEndpointsTests : IClassFixture<AuthEndpointsTests.AuthApiFactory>, IDisposable
{
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
    public async Task Login_then_me_round_trips_http_to_ef_to_jwt_and_back()
    {
        var userId = Guid.NewGuid();
        var email = $"tracer-{userId:N}@example.test";
        const string password = "Tracer!123";
        var hasher = new PasswordHasher();

        await using (var ctx = CreateContext())
        {
            ctx.Users.Add(new User
            {
                Id = userId,
                Email = email,
                FullName = "Tracer Bullet",
                PasswordHash = hasher.Hash(password),   // bcrypt $2b$12$…, read back by AuthService
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

            // 1. POST /api/auth/login (correct creds) → 200 + non-empty access_token.
            var loginResp = await client.PostAsJsonAsync(
                "/api/auth/login", new { email, password });
            Assert.Equal(HttpStatusCode.OK, loginResp.StatusCode);

            using var loginDoc = JsonDocument.Parse(await loginResp.Content.ReadAsStringAsync());
            var accessToken = loginDoc.RootElement.GetProperty("access_token").GetString();
            Assert.False(string.IsNullOrEmpty(accessToken));
            Assert.False(string.IsNullOrEmpty(
                loginDoc.RootElement.GetProperty("refresh_token").GetString()));
            Assert.Equal("bearer", loginDoc.RootElement.GetProperty("token_type").GetString());

            // 2. GET /api/auth/me (Bearer) → 200 + matching email/role. Role comes from the
            //    DB read in AuthService, NOT from any claim in the token.
            var meReq = new HttpRequestMessage(HttpMethod.Get, "/api/auth/me");
            meReq.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
            var meResp = await client.SendAsync(meReq);
            Assert.Equal(HttpStatusCode.OK, meResp.StatusCode);

            using var meDoc = JsonDocument.Parse(await meResp.Content.ReadAsStringAsync());
            Assert.Equal(userId, meDoc.RootElement.GetProperty("id").GetGuid());
            Assert.Equal(email, meDoc.RootElement.GetProperty("email").GetString());
            Assert.Equal("student", meDoc.RootElement.GetProperty("role").GetString());
            Assert.True(meDoc.RootElement.GetProperty("is_active").GetBoolean());

            // 3. POST /api/auth/login (wrong password) → 401 (no leak of which field was wrong).
            var wrongResp = await client.PostAsJsonAsync(
                "/api/auth/login", new { email, password = "not-the-password" });
            Assert.Equal(HttpStatusCode.Unauthorized, wrongResp.StatusCode);

            // 4. GET /api/auth/me (no token) → 401.
            var anonResp = await client.GetAsync("/api/auth/me");
            Assert.Equal(HttpStatusCode.Unauthorized, anonResp.StatusCode);
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
