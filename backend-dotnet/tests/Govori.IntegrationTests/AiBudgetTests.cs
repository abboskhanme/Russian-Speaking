using System.Net;
using System.Net.Http.Headers;
using System.Text;
using Govori.Administration;
using Govori.Identity.Security;
using Govori.Infrastructure;
using Govori.Infrastructure.Entities;
using Govori.Platform.Ai;
using Govori.Platform.Grader;
using Govori.Platform.Stt;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;

namespace Govori.IntegrationTests;

/// <summary>
/// The global AI budget against the real migrated <c>ai_spend_daily</c> table and the real
/// <c>app_settings</c>: cap enforcement, Tashkent day and month rollover, the kill switch, env
/// defaults, the atomic ledger under concurrency, the 80% warning — and, end to end, a paused budget
/// turning a real placement request (real chain, stub vendors) into the existing 503 without any
/// vendor being called.
///
/// <para>The ledger and the three budget settings are wiped before and after every test: the table
/// is shared by the whole run, and a leftover "paused" row would fail every grading test after it.</para>
/// </summary>
[Collection(PerRunDatabaseFixture.CollectionName)]
public sealed class AiBudgetTests : IClassFixture<AiBudgetTests.BudgetApiFactory>, IAsyncLifetime
{
    private static readonly string[] BudgetKeys = ["ai_paused", "ai_daily_cap_usd", "ai_monthly_cap_usd"];

    private readonly BudgetApiFactory _factory;
    private readonly NpgsqlDataSource _dataSource;

    public AiBudgetTests(BudgetApiFactory factory)
    {
        _factory = factory;
        _dataSource = GovoriDataSourceFactory.Build(factory.ConnectionString);
    }

    public Task InitializeAsync() => ResetAsync();

    public async Task DisposeAsync()
    {
        await ResetAsync();
        await _dataSource.DisposeAsync();
    }

    private GovoriDbContext NewContext()
    {
        var builder = new DbContextOptionsBuilder<GovoriDbContext>();
        builder.UseGovori(_dataSource);
        return new GovoriDbContext(builder.Options);
    }

    private async Task ResetAsync()
    {
        await using var ctx = NewContext();
        await ctx.AiSpendDaily.ExecuteDeleteAsync();
        await ctx.AppSettings.Where(r => BudgetKeys.Contains(r.Key)).ExecuteDeleteAsync();
    }

    private async Task SetAsync(string key, string value)
    {
        await using var ctx = NewContext();
        await ctx.AppSettings.Where(r => r.Key == key).ExecuteDeleteAsync();
        ctx.AppSettings.Add(new AppSetting { Key = key, Value = value, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow });
        await ctx.SaveChangesAsync();
    }

    /// <summary>A budget service on its own context, a zero-TTL settings cache (every read sees the
    /// DB) and the given clock / environment.</summary>
    private AiBudgetService Budget(
        GovoriDbContext ctx, TimeProvider clock, IDictionary<string, string?>? env = null, ILogger<AiBudgetService>? logger = null)
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(env ?? new Dictionary<string, string?>()).Build();
        var settings = new AppSettingsService(ctx, new AppSettingsCache(TimeSpan.Zero), config);
        return new AiBudgetService(ctx, settings, logger ?? NullLogger<AiBudgetService>.Instance, clock);
    }

    private static AiUsage Spend(decimal usd) => new(AiProviders.Gemini, AiOperations.Grader, true, usd);

    // 2031-03-14 12:00 in Tashkent — far from any real "today" a parallel run could be writing.
    private static readonly DateTimeOffset Midday = new(2031, 3, 14, 7, 0, 0, TimeSpan.Zero);

    // ── Caps ──────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Daily_cap_closes_the_budget_once_recorded_spend_reaches_it()
    {
        await SetAsync("ai_daily_cap_usd", "1.00");
        var clock = new Clock(Midday);
        await using var ctx = NewContext();
        var budget = Budget(ctx, clock);

        await budget.RecordAsync(Spend(0.60m));
        Assert.True((await budget.CheckAsync()).IsOpen);
        await budget.RecordAsync(Spend(0.40m));                       // exactly the cap
        Assert.Equal(AiBudgetBlock.DailyCap, (await budget.CheckAsync()).Block);
    }

    [Fact]
    public async Task Monthly_cap_closes_the_budget_and_wins_over_the_daily_one()
    {
        await SetAsync("ai_daily_cap_usd", "5");
        await SetAsync("ai_monthly_cap_usd", "8");
        var clock = new Clock(Midday);
        await using var ctx = NewContext();
        var budget = Budget(ctx, clock);

        await budget.RecordAsync(Spend(4m));
        clock.Now = Midday.AddDays(1);
        await budget.RecordAsync(Spend(4.5m));                        // month 8.5 ≥ 8, today 4.5 < 5
        Assert.Equal(AiBudgetBlock.MonthlyCap, (await budget.CheckAsync()).Block);

        await budget.RecordAsync(Spend(1m));                          // today 5.5 ≥ 5 as well
        Assert.Equal(AiBudgetBlock.MonthlyCap, (await budget.CheckAsync()).Block);
    }

    // ── Rollover ─────────────────────────────────────────────────────────────

    [Fact]
    public async Task The_day_rolls_over_at_Tashkent_midnight_and_the_month_on_the_first()
    {
        await SetAsync("ai_daily_cap_usd", "1");
        await SetAsync("ai_monthly_cap_usd", "3");

        // 2031-03-31 18:59Z = 23:59 on the 31st in Tashkent.
        var clock = new Clock(new DateTimeOffset(2031, 3, 31, 18, 59, 0, TimeSpan.Zero));
        await using var ctx = NewContext();
        var budget = Budget(ctx, clock);

        await budget.RecordAsync(Spend(1.5m));
        await budget.RecordAsync(Spend(1m));
        Assert.Equal(AiBudgetBlock.DailyCap, (await budget.CheckAsync()).Block);

        // 19:00Z is midnight in Tashkent: a new product day AND (here) a new month — both reopen.
        // At UTC midnight, five hours later, nothing would have changed.
        clock.Now = new DateTimeOffset(2031, 3, 31, 19, 0, 0, TimeSpan.Zero);
        Assert.True((await budget.CheckAsync()).IsOpen);
        var status = await budget.StatusAsync();
        Assert.Equal(new DateOnly(2031, 4, 1), status.Day);
        Assert.Equal(0, status.SpentTodayUsd);
        Assert.Equal(0, status.SpentMonthUsd);

        // Within a month, yesterday's spend leaves the daily total but stays in the monthly one.
        for (var day = 0; day < 3; day++)
        {
            await budget.RecordAsync(Spend(0.9m));
            Assert.True((await budget.CheckAsync()).IsOpen);          // today 0.9 < 1; month ≤ 2.7 < 3
            clock.Now = clock.Now.AddDays(1);
        }
        await budget.RecordAsync(Spend(0.4m));                        // today 0.4, month 3.1 ≥ 3
        Assert.Equal(AiBudgetBlock.MonthlyCap, (await budget.CheckAsync()).Block);
    }

    // ── Kill switch and defaults ─────────────────────────────────────────────

    [Fact]
    public async Task The_kill_switch_closes_the_budget_with_nothing_spent_and_reopens_when_cleared()
    {
        await using var ctx = NewContext();
        var budget = Budget(ctx, new Clock(Midday));

        await SetAsync("ai_paused", "true");
        Assert.Equal(AiBudgetBlock.Paused, (await budget.CheckAsync()).Block);
        Assert.Equal("paused", (await budget.StatusAsync()).State);

        await ResetAsync();
        Assert.True((await budget.CheckAsync()).IsOpen);
    }

    [Fact]
    public async Task Unset_caps_use_the_documented_defaults_env_overrides_them_and_garbage_is_never_unlimited()
    {
        await using var ctx = NewContext();
        var clock = new Clock(Midday);

        var unset = await Budget(ctx, clock).LimitsAsync();
        Assert.Equal((false, AiBudgetSettings.DefaultDailyCapUsd, AiBudgetSettings.DefaultMonthlyCapUsd), unset);

        var env = await Budget(ctx, clock, new Dictionary<string, string?>
        {
            ["AI_DAILY_CAP_USD"] = "3.5", ["AI_MONTHLY_CAP_USD"] = "70", ["AI_PAUSED"] = "true",
        }).LimitsAsync();
        Assert.Equal((true, 3.5m, 70m), env);

        var garbage = await Budget(ctx, clock, new Dictionary<string, string?>
        {
            ["AI_DAILY_CAP_USD"] = "unlimited", ["AI_MONTHLY_CAP_USD"] = "0",
        }).LimitsAsync();
        Assert.Equal((false, AiBudgetSettings.DefaultDailyCapUsd, AiBudgetSettings.DefaultMonthlyCapUsd), garbage);

        // The admin's DB override wins over the environment.
        await SetAsync("ai_daily_cap_usd", "2");
        var overridden = await Budget(ctx, clock, new Dictionary<string, string?> { ["AI_DAILY_CAP_USD"] = "3.5" }).LimitsAsync();
        Assert.Equal(2m, overridden.DailyCap);
    }

    // ── The ledger ───────────────────────────────────────────────────────────

    [Fact]
    public async Task Concurrent_writers_never_lose_an_increment()
    {
        var clock = new Clock(Midday);
        const int writers = 40;

        await Task.WhenAll(Enumerable.Range(0, writers).Select(async i =>
        {
            await using var ctx = NewContext();
            await Budget(ctx, clock).RecordAsync(new AiUsage(
                AiProviders.AzureSpeech, AiOperations.Stt, Succeeded: i % 4 != 0, 0.0125m, AudioSeconds: 45));
        }));

        await using var read = NewContext();
        var row = await read.AiSpendDaily.AsNoTracking().SingleAsync();
        Assert.Equal(new DateOnly(2031, 3, 14), row.Day);
        Assert.Equal(writers, row.Calls);
        Assert.Equal(writers / 4, row.FailedCalls);
        Assert.Equal(writers * 0.0125m, row.CostUsd);
        Assert.Equal(writers * 45m, row.AudioSeconds);
    }

    [Fact]
    public async Task Crossing_80_percent_and_100_percent_of_a_cap_logs_a_warning_once_each()
    {
        await SetAsync("ai_daily_cap_usd", "1");
        var logger = new CapturingLogger();
        await using var ctx = NewContext();
        var budget = Budget(ctx, new Clock(Midday), logger: logger);

        await budget.RecordAsync(Spend(0.5m));
        Assert.Empty(logger.Warnings);
        await budget.RecordAsync(Spend(0.35m));                      // 0.85 — crosses 80%
        await budget.RecordAsync(Spend(0.05m));                      // 0.90 — already past, silent
        await budget.RecordAsync(Spend(0.2m));                       // 1.10 — crosses 100%

        Assert.Equal(2, logger.Warnings.Count(w => w.Contains("daily")));
        Assert.Contains(logger.Warnings, w => w.Contains("80%"));
        Assert.Contains(logger.Warnings, w => w.Contains("cap reached"));
    }

    [Fact]
    public async Task Status_reports_spend_against_caps_with_a_per_backend_breakdown()
    {
        await SetAsync("ai_daily_cap_usd", "0.5");
        var clock = new Clock(Midday);
        await using var ctx = NewContext();
        var budget = Budget(ctx, clock);

        await budget.RecordAsync(new AiUsage(AiProviders.AzureSpeech, AiOperations.Stt, true, 0.01m, AudioSeconds: 36));
        await budget.RecordAsync(new AiUsage(AiProviders.Anthropic, AiOperations.Grader, false, 0.0525m, InputTokens: 3000, OutputTokens: 1500));
        clock.Now = Midday.AddDays(1);
        await budget.RecordAsync(new AiUsage(AiProviders.Anthropic, AiOperations.Grader, true, 0.5m));

        var status = await budget.StatusAsync();
        Assert.Equal("daily_cap", status.State);
        Assert.Equal(0.5, status.SpentTodayUsd, 6);
        Assert.Equal(0.5625, status.SpentMonthUsd, 6);
        Assert.Equal(0.5, status.DailyCapUsd);

        var claude = status.Month[0];                                   // dearest first
        Assert.Equal((AiProviders.Anthropic, AiOperations.Grader, 2, 1), (claude.Provider, claude.Operation, claude.Calls, claude.FailedCalls));
        Assert.Equal(0.5525, claude.CostUsd, 6);
        Assert.Equal(AiProviders.AzureSpeech, status.Month[1].Provider);
    }

    // ── End to end: the real chain refuses before any vendor is contacted ────

    [Fact]
    public async Task Paused_AI_turns_a_real_placement_request_into_the_existing_503_without_calling_a_vendor()
    {
        var stt = new StubStt();
        var grader = new StubGrader();
        await using var host = _factory.WithRealChain(stt, grader);
        var client = host.CreateClient();
        var token = TokenFor(Guid.NewGuid());
        void Invalidate() => host.Services.GetRequiredService<IAppSettingsCache>().Invalidate();

        await SetAsync("ai_paused", "true");
        Invalidate();

        var paused = await SubmitPlacementAsync(client, token);
        Assert.Equal(HttpStatusCode.ServiceUnavailable, paused.StatusCode);
        Assert.Contains("placement_unavailable", await paused.Content.ReadAsStringAsync());
        Assert.Equal(0, stt.Calls);
        Assert.Equal(0, grader.Calls);

        await ResetAsync();
        Invalidate();

        var open = await SubmitPlacementAsync(client, token);
        Assert.Equal(HttpStatusCode.OK, open.StatusCode);
        Assert.Equal((1, 1), (stt.Calls, grader.Calls));

        // Both vendor calls landed in the ledger, priced: Azure per audio second, Gemini per token.
        await using var ctx = NewContext();
        var rows = await ctx.AiSpendDaily.AsNoTracking().OrderBy(r => r.Operation).ToListAsync();
        Assert.Equal(2, rows.Count);
        Assert.Equal((AiProviders.Gemini, AiOperations.Grader, 1, 1200L, 300L),
            (rows[0].Provider, rows[0].Operation, rows[0].Calls, rows[0].InputTokens, rows[0].OutputTokens));
        Assert.Equal((AiProviders.AzureSpeech, AiOperations.Stt, 1), (rows[1].Provider, rows[1].Operation, rows[1].Calls));
        Assert.All(rows, r => Assert.True(r.CostUsd > 0));
    }

    private static Task<HttpResponseMessage> SubmitPlacementAsync(HttpClient client, string token)
    {
        var form = new MultipartFormDataContent { { new StringContent("0"), "question_index" } };
        var audio = new ByteArrayContent(Encoding.UTF8.GetBytes($"fake-webm-audio-{Guid.NewGuid():N}"));
        audio.Headers.ContentType = new MediaTypeHeaderValue("audio/webm");
        form.Add(audio, "audio", "answer.webm");
        var req = new HttpRequestMessage(HttpMethod.Post, "/api/placement/submit") { Content = form };
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client.SendAsync(req);
    }

    private static string TokenFor(Guid userId) =>
        new TokenService(new IdentityAuthOptions { SecretKey = BudgetApiFactory.TestSecretKey })
            .CreateAccessToken(userId.ToString());

    // ── fakes ────────────────────────────────────────────────────────────────

    private sealed class Clock(DateTimeOffset now) : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = now;
        public override DateTimeOffset GetUtcNow() => Now;
    }

    private sealed class CapturingLogger : ILogger<AiBudgetService>
    {
        public List<string> Warnings { get; } = new();
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel logLevel) => true;
        public void Log<TState>(LogLevel level, EventId id, TState state, Exception? ex, Func<TState, Exception?, string> formatter)
        {
            if (level == LogLevel.Warning) lock (Warnings) Warnings.Add(formatter(state, ex));
        }
    }

    /// <summary>Stands in for Azure: always configured, never leaves the process.</summary>
    private sealed class StubStt : ISttBackend
    {
        private int _calls;
        public int Calls => Volatile.Read(ref _calls);
        public string Name => AiProviders.AzureSpeech;
        public bool IsConfigured(AiRuntimeConfig config) => true;

        public Task<SttResult> TranscribeAsync(
            byte[] audio, string filename, string? referenceText, AiRuntimeConfig config, CancellationToken ct,
            SttRecognitionMode mode = SttRecognitionMode.Unscripted)
        {
            Interlocked.Increment(ref _calls);
            return Task.FromResult(new SttResult
            {
                Text = "меня зовут алишер", Model = "stub-azure", DurationSec = 12,
                Pronunciation = new SttPronunciation { Pronunciation = 70 },
            });
        }
    }

    /// <summary>Stands in for Gemini, reporting token usage like the real one does.</summary>
    private sealed class StubGrader : IGraderBackend
    {
        private int _calls;
        public int Calls => Volatile.Read(ref _calls);
        public string Name => AiProviders.Gemini;
        public bool IsConfigured(AiRuntimeConfig config) => true;

        public Task<GraderResult> AnalyzeAsync(GraderRequest request, AiRuntimeConfig config, CancellationToken ct)
        {
            Interlocked.Increment(ref _calls);
            return Task.FromResult(new GraderResult
            {
                Scores = new GraderScores(80, 80, 80, 80, 80, 80),
                Model = "stub-gemini",
                InputTokens = 1200,
                OutputTokens = 300,
            });
        }
    }

    /// <summary>Boots Govori.Api; <see cref="WithRealChain"/> keeps the REAL chain providers and
    /// budget and only replaces the vendor backends behind them.</summary>
    public sealed class BudgetApiFactory : WebApplicationFactory<Program>
    {
        public string ConnectionString { get; } = TestDatabase.ConnectionString;

        internal const string TestSecretKey =
            "ai-budget-integration-test-secret-key-do-not-use-in-prod";

        public BudgetApiFactory()
        {
            Environment.SetEnvironmentVariable("SECRET_KEY", TestSecretKey);
            Environment.SetEnvironmentVariable("GOVORI_DB", ConnectionString);
        }

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseSetting("GOVORI_HANGFIRE", "false");
            builder.UseSetting("GOVORI_SIGNALR_BACKPLANE", "false");
        }

        internal WebApplicationFactory<Program> WithRealChain(ISttBackend stt, IGraderBackend grader)
            => WithWebHostBuilder(b => b.ConfigureTestServices(services =>
            {
                services.RemoveAll<ISttBackend>();
                services.AddSingleton(stt);
                services.RemoveAll<IGraderBackend>();
                services.AddSingleton(grader);
            }));
    }
}
