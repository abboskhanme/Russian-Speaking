using Govori.Administration;
using Govori.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Npgsql;

namespace Govori.IntegrationTests;

/// <summary>
/// The KEY deliverable for the Administration slice (docs/07 §3.7): the app_settings <b>tri-state</b>
/// (None=unchanged / ""=clear→default / value=store) and the <b>~30s cache</b> (reads cache; writes
/// invalidate). Faithful port of <c>backend/app/services/app_settings.py</c>.
///
/// <para>Driven at the SERVICE level against the real prod-shaped Postgres, with fresh DbContexts per
/// operation (mirroring Python's fresh <c>SessionLocal()</c> per read) sharing ONE process-global
/// <see cref="AppSettingsCache"/> (mirroring Python's module-level cache). This proves the cache
/// contract deterministically without waiting real seconds — a direct DB write behind the service's
/// back is NOT observed until the cache is invalidated.</para>
///
/// <para>The two keys used are cleaned before and after, and the pre-existing <c>stt_provider</c> row
/// is never touched, so the run is idempotent.</para>
/// </summary>
public sealed class AppSettingsServiceTests : IDisposable
{
    private const string LlmKey = "llm_provider";      // has an env default in this test's config
    private const string LinkKey = "tg_support_url";   // no env default → falls back to ""

    private readonly NpgsqlDataSource _dataSource;
    private readonly IConfiguration _config;

    public AppSettingsServiceTests()
    {
        var cs = Environment.GetEnvironmentVariable("GOVORI_TEST_DB")
                 ?? GovoriDataSourceFactory.DefaultConnectionString;
        _dataSource = GovoriDataSourceFactory.Build(cs);
        // Env default for llm_provider (Python resolves it from Settings.LLM_PROVIDER).
        _config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["LLM_PROVIDER"] = "auto" })
            .Build();
    }

    private GovoriDbContext NewContext()
    {
        var b = new DbContextOptionsBuilder<GovoriDbContext>();
        b.UseGovori(_dataSource);
        return new GovoriDbContext(b.Options);
    }

    // A fresh service (fresh DbContext) over the SHARED cache — the real DI shape (scoped service,
    // singleton cache), and the faithful analogue of Python's per-op session + module-global cache.
    private AppSettingsService NewService(IAppSettingsCache cache)
        => new(NewContext(), cache, _config);

    [Fact]
    public async Task Tristate_and_cache_full_contract()
    {
        var cache = new AppSettingsCache();   // real 30s TTL
        await CleanAsync();
        try
        {
            // ── (1) UNSET → env default (llm) / "" when no env default (link) ──
            Assert.Equal("auto", await NewService(cache).GetAsync(LlmKey));
            Assert.Equal("", await NewService(cache).GetAsync(LinkKey));

            // ── (2) SET value → value ──
            await NewService(cache).SetManyAsync(new Dictionary<string, string?> { [LlmKey] = "gemini" });
            Assert.Equal("gemini", await NewService(cache).GetAsync(LlmKey));

            // ── (3) SET null → UNCHANGED (the "keep the existing secret" branch) ──
            await NewService(cache).SetManyAsync(new Dictionary<string, string?> { [LlmKey] = null });
            Assert.Equal("gemini", await NewService(cache).GetAsync(LlmKey));   // still "gemini"

            // ── (4) SET "" → CLEAR override → revert to env default (DISTINCT from the null case) ──
            await NewService(cache).SetManyAsync(new Dictionary<string, string?> { [LlmKey] = "" });
            Assert.Equal("auto", await NewService(cache).GetAsync(LlmKey));     // back to env default
            // Proof at the data layer: the row is actually gone (not stored as an empty string).
            await using (var ctx = NewContext())
                Assert.False(await ctx.AppSettings.AsNoTracking().AnyAsync(r => r.Key == LlmKey));

            // ── CACHE: a read caches; a direct DB write behind the service's back is NOT seen ──
            await NewService(cache).SetManyAsync(new Dictionary<string, string?> { [LinkKey] = "https://t.me/A" });
            Assert.Equal("https://t.me/A", await NewService(cache).GetAsync(LinkKey));   // populates the cache

            await using (var ctx = NewContext())   // mutate the row directly, bypassing SetManyAsync/Invalidate
            {
                var row = await ctx.AppSettings.FirstAsync(r => r.Key == LinkKey);
                row.Value = "https://t.me/B";
                await ctx.SaveChangesAsync();
            }
            // Still the cached value — proves reads are served from the ~30s cache, not the DB.
            Assert.Equal("https://t.me/A", await NewService(cache).GetAsync(LinkKey));

            // ── CACHE: invalidation makes the next read observe committed DB state ──
            cache.Invalidate();
            Assert.Equal("https://t.me/B", await NewService(cache).GetAsync(LinkKey));

            // A write ALSO invalidates (SetManyAsync calls Invalidate) — the new value is seen at once.
            await NewService(cache).SetManyAsync(new Dictionary<string, string?> { [LinkKey] = "https://t.me/C" });
            Assert.Equal("https://t.me/C", await NewService(cache).GetAsync(LinkKey));
        }
        finally
        {
            await CleanAsync();
        }
    }

    [Fact]
    public void Cache_abstraction_caches_invalidates_and_expires()
    {
        var cache = new AppSettingsCache(TimeSpan.FromMilliseconds(150));
        var snap = new Dictionary<string, string?> { ["k"] = "v" };

        Assert.False(cache.TryGet(out _));                 // empty → miss

        cache.Set(snap);
        Assert.True(cache.TryGet(out var got));            // set → hit
        Assert.Equal("v", got["k"]);

        cache.Invalidate();
        Assert.False(cache.TryGet(out _));                 // invalidated → miss

        cache.Set(snap);
        Assert.True(cache.TryGet(out _));                  // hit within TTL
        Thread.Sleep(250);
        Assert.False(cache.TryGet(out _));                 // TTL elapsed → miss
    }

    private async Task CleanAsync()
    {
        await using var ctx = NewContext();
        await ctx.AppSettings.Where(r => r.Key == LlmKey || r.Key == LinkKey).ExecuteDeleteAsync();
    }

    public void Dispose() => _dataSource.Dispose();
}
