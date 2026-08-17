using Govori.Administration;
using Govori.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Npgsql;

namespace Govori.IntegrationTests;

/// <summary>
/// The KEY deliverable for the Administration slice (docs/07 §3.7): the app_settings <b>tri-state</b>
/// (None=unchanged / ""=clear→default / value=store) and the <b>~30s cache</b> (reads cache; writes
/// invalidate).
///
/// <para>Driven at the SERVICE level against the real prod-shaped Postgres, with a fresh DbContext per
/// operation (the scoped-service shape) all sharing ONE <see cref="AppSettingsCache"/> (the singleton
/// shape). That cache is PROCESS-LOCAL, which these tests pin down: a direct DB write made behind the
/// service's back is NOT observed until the cache is invalidated.</para>
///
/// <para>A write made through the service is a different matter: since the invalidation broadcast
/// landed it reaches every process at once, and
/// <see cref="Write_through_the_broadcast_is_visible_to_another_process_immediately"/> is what holds
/// that to account.</para>
///
/// <para>The two keys used are cleaned before and after, and no other setting key is touched, so the
/// run is idempotent even when re-run against a database that already has settings in it.</para>
/// </summary>
[Collection(PerRunDatabaseFixture.CollectionName)]
public sealed class AppSettingsServiceTests : IDisposable
{
    private const string LlmKey = "llm_provider";      // has an env default in this test's config
    private const string LinkKey = "tg_support_url";   // no env default → falls back to ""

    private readonly NpgsqlDataSource _dataSource;
    private readonly IConfiguration _config;

    public AppSettingsServiceTests()
    {
        // The per-run throwaway database (see TestDatabase) — never the shared dev one.
        var cs = TestDatabase.ConnectionString;
        _dataSource = GovoriDataSourceFactory.Build(cs);
        // Env default for llm_provider: with no DB row, the service falls back to LLM_PROVIDER.
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

    // A fresh service (fresh DbContext) over the SHARED cache — the real DI shape: scoped service,
    // singleton process-local cache.
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

    /// <summary>
    /// Two caches stand in for two PROCESSES — the API that writes and the Worker that grades.
    ///
    /// <para>This is the regression test for a bug that was invisible from inside either process:
    /// the admin pastes a key, the API invalidates its own snapshot, and the Worker keeps grading
    /// against the previous configuration until its own TTL lapses. Nothing errors. The admin
    /// submits a recording to check the new key, gets the old behaviour, and concludes the panel
    /// does not work.</para>
    ///
    /// <para>The fan-out below is what Redis pub/sub does in production. No Redis here on purpose:
    /// the contract being pinned is that <c>SetManyAsync</c> goes through the broadcast at all,
    /// rather than reaching only for its own cache — which is exactly what it used to do.</para>
    /// </summary>
    private sealed class FanOutBroadcast : IAppSettingsBroadcast
    {
        private readonly IAppSettingsCache[] _caches;
        public FanOutBroadcast(params IAppSettingsCache[] caches) => _caches = caches;

        public Task PublishAsync(CancellationToken ct = default)
        {
            foreach (var c in _caches) c.Invalidate();
            return Task.CompletedTask;
        }
    }

    [Fact]
    public async Task Write_through_the_broadcast_is_visible_to_another_process_immediately()
    {
        var writerCache = new AppSettingsCache();   // "the API"
        var readerCache = new AppSettingsCache();   // "the Worker"
        var broadcast = new FanOutBroadcast(writerCache, readerCache);

        await CleanAsync();
        try
        {
            // Warm the reader so it holds a real pre-write snapshot. Without this the test would
            // pass on an empty cache and prove nothing.
            Assert.Equal(string.Empty, await NewService(readerCache).GetAsync(LinkKey));

            await new AppSettingsService(NewContext(), writerCache, _config, broadcast)
                .SetManyAsync(new Dictionary<string, string?> { [LinkKey] = "https://t.me/after" });

            // No sleep, no TTL: the reader must see it now. With the pre-broadcast code this line
            // returned "" for up to thirty seconds.
            Assert.Equal("https://t.me/after", await NewService(readerCache).GetAsync(LinkKey));
        }
        finally
        {
            await CleanAsync();
        }
    }

    [Fact]
    public async Task Without_a_broadcast_the_writer_still_invalidates_itself()
    {
        // The degraded path — no Redis registered, or an older composition root. It must be no
        // worse than the behaviour that existed before, never worse than it.
        var cache = new AppSettingsCache();
        await CleanAsync();
        try
        {
            Assert.Equal(string.Empty, await NewService(cache).GetAsync(LinkKey));

            await NewService(cache).SetManyAsync(
                new Dictionary<string, string?> { [LinkKey] = "https://t.me/local" });

            Assert.Equal("https://t.me/local", await NewService(cache).GetAsync(LinkKey));
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
