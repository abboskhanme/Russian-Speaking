using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using Govori.Identity.Security;
using Govori.Infrastructure;
using Govori.Infrastructure.Entities;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Govori.IntegrationTests;

/// <summary>
/// <c>GET /api/auth/me</c> carries the <c>features</c> block the SPA hides switched-off entry
/// points with (instead of probing <c>/api/daily</c> / <c>/api/review/drill</c> for a 404). These
/// tests pin the wire names, the OFF defaults, and that each block follows its own
/// <c>app_settings</c> key — the same rows the admin panel edits and the feature routes enforce.
/// </summary>
[Collection(PerRunDatabaseFixture.CollectionName)]
public sealed class MeFeaturesTests
    : IClassFixture<DailyEndpointsTests.DailyApiFactory>, IDisposable
{
    private static readonly string[] FlagKeys =
    [
        "roleplay_enabled", "daily_five_enabled", "review_drill_enabled", "phoneme_drill_enabled", "payments_enabled",
    ];

    private readonly DailyEndpointsTests.DailyApiFactory _factory;
    private readonly NpgsqlDataSource _dataSource;

    public MeFeaturesTests(DailyEndpointsTests.DailyApiFactory factory)
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

    [Fact]
    public async Task Me_reports_every_feature_off_by_default_and_ai_available()
    {
        var id = await SeedStudentAsync();
        try
        {
            await ClearFlagsAsync();
            var features = await FeaturesAsync(id);

            Assert.False(features.GetProperty("roleplay").GetBoolean());
            Assert.False(features.GetProperty("daily_five").GetBoolean());
            Assert.False(features.GetProperty("review_drill").GetBoolean());
            Assert.False(features.GetProperty("phoneme_drill").GetBoolean());
            Assert.False(features.GetProperty("payments").GetBoolean());
            Assert.True(features.GetProperty("ai_available").GetBoolean());
        }
        finally
        {
            await CleanupAsync(id);
        }
    }

    [Theory]
    [InlineData("roleplay_enabled", "roleplay")]
    [InlineData("daily_five_enabled", "daily_five")]
    [InlineData("review_drill_enabled", "review_drill")]
    [InlineData("phoneme_drill_enabled", "phoneme_drill")]
    [InlineData("payments_enabled", "payments")]
    public async Task Each_feature_follows_its_own_app_setting(string key, string wire)
    {
        var id = await SeedStudentAsync();
        try
        {
            await ClearFlagsAsync();
            await SetFlagAsync(key, "true");
            var features = await FeaturesAsync(id);

            Assert.True(features.GetProperty(wire).GetBoolean(), $"{wire} should be on with {key}=true");
            // Only that one: a flag leaking into a neighbour would advertise a feature that 404s.
            foreach (var other in features.EnumerateObject().Where(p => p.Name != wire && p.Name != "ai_available"))
                Assert.False(other.Value.GetBoolean(), $"{other.Name} must stay off when only {key} is on");
        }
        finally
        {
            await ClearFlagsAsync();
            await CleanupAsync(id);
        }
    }

    [Fact]
    public async Task Profile_patch_answer_carries_features_too()
    {
        // The client adopts the PATCH answer as its user object; one without `features` would
        // silently hide every switched-on feature until the next reload.
        var id = await SeedStudentAsync();
        try
        {
            await ClearFlagsAsync();
            await SetFlagAsync("roleplay_enabled", "true");
            var client = _factory.CreateClient();
            var req = new HttpRequestMessage(HttpMethod.Patch, "/api/auth/me")
            {
                Content = new StringContent("{\"region\":\"Toshkent\"}", System.Text.Encoding.UTF8, "application/json"),
            };
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", TokenFor(id));
            var resp = await client.SendAsync(req);
            var body = await resp.Content.ReadAsStringAsync();
            Assert.True(resp.StatusCode == HttpStatusCode.OK, body);
            using var doc = JsonDocument.Parse(body);
            Assert.True(doc.RootElement.GetProperty("features").GetProperty("roleplay").GetBoolean());
        }
        finally
        {
            await ClearFlagsAsync();
            await CleanupAsync(id);
        }
    }

    /* ── helpers ─────────────────────────────────────────────────────────── */

    private async Task<JsonElement> FeaturesAsync(Guid id)
    {
        var client = _factory.CreateClient();
        var req = new HttpRequestMessage(HttpMethod.Get, "/api/auth/me");
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", TokenFor(id));
        var resp = await client.SendAsync(req);
        var body = await resp.Content.ReadAsStringAsync();
        Assert.True(resp.StatusCode == HttpStatusCode.OK, $"GET /api/auth/me → {(int)resp.StatusCode}: {body}");
        using var doc = JsonDocument.Parse(body);
        return doc.RootElement.GetProperty("features").Clone();
    }

    private static string TokenFor(Guid userId) =>
        new TokenService(new IdentityAuthOptions { SecretKey = DailyEndpointsTests.DailyApiFactory.TestSecretKey })
            .CreateAccessToken(userId.ToString());

    private async Task<Guid> SeedStudentAsync()
    {
        var id = Guid.NewGuid();
        await using var ctx = CreateContext();
        ctx.Users.Add(new User
        {
            Id = id,
            Email = $"features-{id:N}@example.test",
            FullName = "Features Seed",
            Role = UserRole.Student,
            IsActive = true,
            IsPremium = false,
            PreferredLanguage = "uz",
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
        });
        await ctx.SaveChangesAsync();
        return id;
    }

    private async Task SetFlagAsync(string key, string value)
    {
        await using var ctx = CreateContext();
        ctx.AppSettings.Add(new AppSetting
        {
            Key = key,
            Value = value,
            IsSecret = false,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
        });
        await ctx.SaveChangesAsync();
    }

    // app_settings rows are GLOBAL — cleared so the next class in the run sees the defaults.
    private async Task ClearFlagsAsync()
    {
        await using var ctx = CreateContext();
        await ctx.AppSettings.Where(s => FlagKeys.Contains(s.Key)).ExecuteDeleteAsync();
    }

    private async Task CleanupAsync(Guid id)
    {
        await using var ctx = CreateContext();
        await ctx.Users.Where(u => u.Id == id).ExecuteDeleteAsync();
    }

    public void Dispose() => _dataSource.Dispose();
}
