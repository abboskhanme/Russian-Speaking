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
/// End-to-end coverage for the Administration slice (docs/07 §3.7, Faza 3.7): HTTP →
/// AdministrationService / AppSettingsService → EF Core (prod-shaped Postgres) and back. Covers:
/// <list type="bullet">
///   <item><b>freemium grant/revoke</b>: an admin flips <c>is_premium</c> via PATCH
///   /api/admin/students/{id}; the flag is persisted AND takes effect live — the student's own
///   GET /api/auth/me reflects it without re-login (role/flags read from the DB each request);</item>
///   <item><b>admin-only auth</b>: a non-admin (student) is 403, an anonymous caller is 401, on both
///   the user-management and the settings surfaces;</item>
///   <item><b>list/search</b>: the student appears when searched by a name fragment;</item>
///   <item><b>settings tri-state over HTTP</b>: on the links, omit=keep vs ""=clear vs value=store;</item>
///   <item><b>secret masking + reveal + validation</b> on the AI settings.</item>
/// </list>
/// Every seeded row / touched setting key is cleaned in a finally so the run is idempotent. No
/// setting key outside the ones under test is touched.
/// </summary>
[Collection(PerRunDatabaseFixture.CollectionName)]
public sealed class AdministrationEndpointsTests
    : IClassFixture<AdministrationEndpointsTests.AdminApiFactory>, IDisposable
{
    private readonly AdminApiFactory _factory;
    private readonly NpgsqlDataSource _dataSource;

    public AdministrationEndpointsTests(AdminApiFactory factory)
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

    // ── Admin user management: grant/revoke premium + auth + search ──────────

    [Fact]
    public async Task Admin_grants_premium_it_takes_effect_and_gate_is_admin_only()
    {
        var adminId = Guid.NewGuid();
        var studentId = Guid.NewGuid();
        const string password = "Admin!12345";
        var adminEmail = $"adm-{adminId:N}@example.test";
        var studentEmail = $"adm-s-{studentId:N}@example.test";
        var studentName = $"Dilnoza-{studentId:N}";

        var hasher = new PasswordHasher();
        await using (var ctx = NewContext())
        {
            ctx.Users.Add(NewUser(adminId, adminEmail, UserRole.Admin, hasher.Hash(password)));
            ctx.Users.Add(NewUser(studentId, studentEmail, UserRole.Student, hasher.Hash(password), studentName));
            await ctx.SaveChangesAsync();
        }

        try
        {
            var client = _factory.CreateClient();
            var adminToken = TokenFor(adminId);
            var studentToken = TokenFor(studentId);

            // Baseline: the student is not premium (their own /me reads the DB live).
            Assert.False(await MyPremiumAsync(client, studentToken));

            // ── Anonymous → 401; student (non-admin) → 403 on the admin surface ──
            Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/admin/students")).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden,
                (await Send(client, HttpMethod.Get, "/api/admin/students", studentToken)).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden,
                (await Send(client, HttpMethod.Patch, $"/api/admin/students/{studentId}", studentToken,
                    Json(new { is_premium = true }))).StatusCode);

            // ── GRANT premium (admin) → response flips + persists ──
            var grant = await Send(client, HttpMethod.Patch, $"/api/admin/students/{studentId}", adminToken,
                Json(new { is_premium = true }));
            Assert.Equal(HttpStatusCode.OK, grant.StatusCode);
            using (var doc = JsonDocument.Parse(await grant.Content.ReadAsStringAsync()))
                Assert.True(doc.RootElement.GetProperty("is_premium").GetBoolean());

            // ── ...and it TAKES EFFECT: the student's own /me now reports premium (no re-login) ──
            Assert.True(await MyPremiumAsync(client, studentToken));
            await using (var ctx = NewContext())
                Assert.True(await ctx.Users.AsNoTracking().Where(u => u.Id == studentId).Select(u => u.IsPremium).FirstAsync());

            // ── REVOKE premium → back to false everywhere ──
            var revoke = await Send(client, HttpMethod.Patch, $"/api/admin/students/{studentId}", adminToken,
                Json(new { is_premium = false }));
            Assert.Equal(HttpStatusCode.OK, revoke.StatusCode);
            Assert.False(await MyPremiumAsync(client, studentToken));

            // ── Unknown student → 404; (de)activate via the same PATCH ──
            Assert.Equal(HttpStatusCode.NotFound,
                (await Send(client, HttpMethod.Patch, $"/api/admin/students/{Guid.NewGuid()}", adminToken,
                    Json(new { is_premium = true }))).StatusCode);
            var deact = await Send(client, HttpMethod.Patch, $"/api/admin/students/{studentId}", adminToken,
                Json(new { is_active = false }));
            using (var doc = JsonDocument.Parse(await deact.Content.ReadAsStringAsync()))
                Assert.False(doc.RootElement.GetProperty("is_active").GetBoolean());
            // Reactivate so login/cleanup stay clean.
            await Send(client, HttpMethod.Patch, $"/api/admin/students/{studentId}", adminToken, Json(new { is_active = true }));

            // ── list/search: the student is found by a name fragment ──
            var search = await Send(client, HttpMethod.Get, $"/api/admin/students?search={studentName[..12]}", adminToken);
            Assert.Equal(HttpStatusCode.OK, search.StatusCode);
            using (var doc = JsonDocument.Parse(await search.Content.ReadAsStringAsync()))
                Assert.Contains(doc.RootElement.EnumerateArray(), s => s.GetProperty("id").GetGuid() == studentId);

            // ── stats is admin-only and returns counters ──
            var stats = await Send(client, HttpMethod.Get, "/api/admin/stats", adminToken);
            Assert.Equal(HttpStatusCode.OK, stats.StatusCode);
            using (var doc = JsonDocument.Parse(await stats.Content.ReadAsStringAsync()))
                Assert.True(doc.RootElement.GetProperty("students").GetInt32() >= 1);
        }
        finally
        {
            await using var ctx = NewContext();
            await ctx.Users.Where(u => u.Id == adminId || u.Id == studentId).ExecuteDeleteAsync();
        }
    }

    // ── Runtime settings: tri-state over HTTP + secret masking + public links ─

    [Fact]
    public async Task Settings_links_tristate_ai_masking_and_public_read()
    {
        var adminId = Guid.NewGuid();
        var userId = Guid.NewGuid();
        const string password = "Sett!12345";
        var adminEmail = $"set-adm-{adminId:N}@example.test";
        var userEmail = $"set-usr-{userId:N}@example.test";

        var hasher = new PasswordHasher();
        await using (var ctx = NewContext())
        {
            ctx.Users.Add(NewUser(adminId, adminEmail, UserRole.Admin, hasher.Hash(password)));
            ctx.Users.Add(NewUser(userId, userEmail, UserRole.Student, hasher.Hash(password)));
            await ctx.SaveChangesAsync();
        }
        await CleanKeysAsync("tg_support_url", "tg_channel_url", "gemini_api_key", "orthoepy_enabled");

        try
        {
            var client = _factory.CreateClient();
            var adminToken = TokenFor(adminId);
            var userToken = TokenFor(userId);

            // ── admin-only gate on settings ──
            Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/admin/settings/ai")).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden,
                (await Send(client, HttpMethod.Get, "/api/admin/settings/ai", userToken)).StatusCode);

            // ── LINKS tri-state over HTTP: set both → omit-one keeps it → "" clears it ──
            await Patch(client, adminToken, "/api/admin/settings/links",
                new { tg_support_url = "https://t.me/x", tg_channel_url = "https://t.me/c" });
            var (sup1, chan1) = await GetLinks(client, adminToken);
            Assert.Equal("https://t.me/x", sup1);
            Assert.Equal("https://t.me/c", chan1);

            await Patch(client, adminToken, "/api/admin/settings/links", new { tg_support_url = "https://t.me/y" }); // omit channel
            var (sup2, chan2) = await GetLinks(client, adminToken);
            Assert.Equal("https://t.me/y", sup2);
            Assert.Equal("https://t.me/c", chan2);                    // UNCHANGED (omit = keep)

            await Patch(client, adminToken, "/api/admin/settings/links", new { tg_support_url = "" });               // clear support
            var (sup3, chan3) = await GetLinks(client, adminToken);
            Assert.Equal("", sup3);                                   // CLEARED ("" = revert to default)
            Assert.Equal("https://t.me/c", chan3);                    // still there (distinct from support)

            // ── PUBLIC links: any active user reads them; anonymous is 401 ──
            var (pubSup, pubChan) = await GetLinks(client, userToken, "/api/settings/links");
            Assert.Equal("", pubSup);
            Assert.Equal("https://t.me/c", pubChan);
            Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/settings/links")).StatusCode);

            // ── AI settings: validation 400, secret masking, reveal, unknown-secret 404 ──
            Assert.Equal(HttpStatusCode.BadRequest,
                (await Send(client, HttpMethod.Patch, "/api/admin/settings/ai", adminToken,
                    Json(new { llm_provider = "bogus" }))).StatusCode);

            await Patch(client, adminToken, "/api/admin/settings/ai",
                new { gemini_api_key = "sk-secret-1234", orthoepy_enabled = "false" });
            var aiResp = await Send(client, HttpMethod.Get, "/api/admin/settings/ai", adminToken);
            using (var doc = JsonDocument.Parse(await aiResp.Content.ReadAsStringAsync()))
            {
                var key = doc.RootElement.GetProperty("gemini_api_key");
                Assert.True(key.GetProperty("set").GetBoolean());
                Assert.Equal("1234", key.GetProperty("hint").GetString());   // last 4 only, never the value
                Assert.False(doc.RootElement.GetProperty("orthoepy_enabled").GetBoolean());
            }

            var reveal = await Send(client, HttpMethod.Get, "/api/admin/settings/reveal/gemini_api_key", adminToken);
            Assert.Equal(HttpStatusCode.OK, reveal.StatusCode);
            using (var doc = JsonDocument.Parse(await reveal.Content.ReadAsStringAsync()))
                Assert.Equal("sk-secret-1234", doc.RootElement.GetProperty("value").GetString());

            // A known but NON-secret key, and a nonsense key, are both 404 (only secrets may be revealed).
            Assert.Equal(HttpStatusCode.NotFound,
                (await Send(client, HttpMethod.Get, "/api/admin/settings/reveal/gemini_model", adminToken)).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound,
                (await Send(client, HttpMethod.Get, "/api/admin/settings/reveal/not_a_key", adminToken)).StatusCode);
        }
        finally
        {
            await CleanKeysAsync("tg_support_url", "tg_channel_url", "gemini_api_key", "orthoepy_enabled");
            await using var ctx = NewContext();
            await ctx.Users.Where(u => u.Id == adminId || u.Id == userId).ExecuteDeleteAsync();
        }
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private async Task CleanKeysAsync(params string[] keys)
    {
        await using var ctx = NewContext();
        await ctx.AppSettings.Where(r => keys.Contains(r.Key)).ExecuteDeleteAsync();
    }

    private static async Task<bool> MyPremiumAsync(HttpClient client, string token)
    {
        var resp = await Send(client, HttpMethod.Get, "/api/auth/me", token);
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
        return doc.RootElement.GetProperty("is_premium").GetBoolean();
    }

    private static async Task<(string support, string channel)> GetLinks(
        HttpClient client, string token, string path = "/api/admin/settings/links")
    {
        var resp = await Send(client, HttpMethod.Get, path, token);
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
        return (doc.RootElement.GetProperty("tg_support_url").GetString()!,
                doc.RootElement.GetProperty("tg_channel_url").GetString()!);
    }

    private static async Task Patch(HttpClient client, string token, string path, object body)
    {
        var resp = await Send(client, HttpMethod.Patch, path, token, Json(body));
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
    }

    // Auth is phone-OTP now (no email/password login). These non-auth tests only need a bearer for a
    // seeded user, so mint the SAME access token login used to return (sub = user id) with the test secret.
    private static string TokenFor(Guid userId) =>
        new TokenService(new IdentityAuthOptions { SecretKey = AdminApiFactory.TestSecretKey })
            .CreateAccessToken(userId.ToString());

    private static Task<HttpResponseMessage> Send(
        HttpClient client, HttpMethod method, string url, string token, HttpContent? content = null)
    {
        var req = new HttpRequestMessage(method, url) { Content = content };
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client.SendAsync(req);
    }

    private static HttpContent Json(object body) => JsonContent.Create(body);

    private static User NewUser(Guid id, string email, UserRole role, string? passwordHash, string fullName = "Admin Seed") => new()
    {
        Id = id,
        Email = email,
        FullName = fullName,
        PasswordHash = passwordHash,
        Role = role,
        IsActive = true,
        IsPremium = false,
        PreferredLanguage = "uz",
        CreatedAt = DateTime.UtcNow,
        UpdatedAt = DateTime.UtcNow,
    };

    public void Dispose() => _dataSource.Dispose();

    /// <summary>Boots Govori.Api against the schema DB with a fixed test SECRET_KEY (same pattern as
    /// the other endpoint suites).</summary>
    public sealed class AdminApiFactory : WebApplicationFactory<Program>
    {
        // The per-run throwaway database (see TestDatabase) — never the shared dev one.
        public string ConnectionString { get; } = TestDatabase.ConnectionString;

        internal const string TestSecretKey =
            "administration-domain-integration-test-secret-key-do-not-use-in-prod";

        public AdminApiFactory()
        {
            Environment.SetEnvironmentVariable("SECRET_KEY", TestSecretKey);
            Environment.SetEnvironmentVariable("GOVORI_DB", ConnectionString);
        }
    }
}
