using Govori.Administration;
using Govori.Platform.Ai;
using Govori.Platform.Grader;
using Govori.Platform.Stt;
using Microsoft.Extensions.Logging.Abstractions;

namespace Govori.UnitTests.Ai;

/// <summary>
/// Pins how the provider chains enforce the GLOBAL AI budget, and the arithmetic that prices a call.
///
/// <list type="number">
///   <item><b>Closed means no vendor is contacted.</b> Paused or capped, the chain throws
///   <see cref="AiBudgetExceededException"/> before the first backend is called — the money the cap
///   exists to protect is never spent.</item>
///   <item><b>Closed looks like "not configured" to every caller.</b> <c>IsConfiguredAsync</c> answers
///   false, so placement's 503 and the roleplay/drill <c>unconfigured</c> state are what a student
///   sees — no new UX.</item>
///   <item><b>Every vendor call is recorded, failed ones too.</b> A failing vendor is usually still
///   billed; a ledger that only counted successes could not stop a retry storm.</item>
///   <item><b>The budget is re-checked before each fallback.</b> A cap reached mid-chain stops the
///   chain there instead of walking the remaining vendors.</item>
/// </list>
/// </summary>
public sealed class AiBudgetChainTests
{
    private sealed class Grader(string name, Func<GraderResult>? answer = null, Exception? throws = null) : IGraderBackend
    {
        public string Name => name;
        public int Calls { get; private set; }
        public bool IsConfigured(AiRuntimeConfig config) => true;

        public Task<GraderResult> AnalyzeAsync(GraderRequest request, AiRuntimeConfig config, CancellationToken ct)
        {
            Calls++;
            if (throws is not null) throw throws;
            return Task.FromResult(answer!());
        }
    }

    private sealed class Stt(string name, double? duration = null, Exception? throws = null) : ISttBackend
    {
        public string Name => name;
        public int Calls { get; private set; }
        public bool IsConfigured(AiRuntimeConfig config) => true;

        public Task<SttResult> TranscribeAsync(
            byte[] audio, string filename, string? referenceText, AiRuntimeConfig config, CancellationToken ct,
            SttRecognitionMode mode = SttRecognitionMode.Unscripted)
        {
            Calls++;
            if (throws is not null) throw throws;
            return Task.FromResult(new SttResult { Text = "привет", Model = name, DurationSec = duration });
        }
    }

    private sealed class Config(AiRuntimeConfig config) : IAiConfigSource
    {
        public Task<AiRuntimeConfig> GetAsync(CancellationToken ct = default) => Task.FromResult(config);
    }

    private static readonly GraderRequest Request = new() { QuestionPrompt = "q", TranscriptText = "t" };

    private static GraderResult Graded(long? input = null, long? output = null) => new()
    {
        Scores = new GraderScores(70, 70, 70, 70, 70, 70),
        Model = "m",
        InputTokens = input,
        OutputTokens = output,
    };

    private static ChainGraderProvider GraderChain(TestBudget budget, string chain, params Grader[] backends)
        => new(backends, new Config(new AiRuntimeConfig { GraderChain = chain.Split(',') }), budget,
               NullLogger<ChainGraderProvider>.Instance);

    private static ChainSttProvider SttChain(TestBudget budget, string chain, params Stt[] backends)
        => new(backends, new Config(new AiRuntimeConfig { SttChain = chain.Split(',') }), budget,
               NullLogger<ChainSttProvider>.Instance);

    // ── Rule 1 + 2 — closed: nothing is called, and it reads as unconfigured ──

    [Theory]
    [InlineData(AiBudgetBlock.Paused)]
    [InlineData(AiBudgetBlock.DailyCap)]
    [InlineData(AiBudgetBlock.MonthlyCap)]
    public async Task ClosedBudget_RefusesBeforeAnyVendorIsCalled(AiBudgetBlock block)
    {
        var budget = new TestBudget { Block = block };
        var gemini = new Grader(AiProviders.Gemini, () => Graded());
        var azure = new Stt(AiProviders.AzureSpeech);

        var g = await Assert.ThrowsAsync<AiBudgetExceededException>(
            () => GraderChain(budget, "gemini", gemini).AnalyzeAsync(Request));
        var s = await Assert.ThrowsAsync<AiBudgetExceededException>(
            () => SttChain(budget, "azure", azure).TranscribeAsync([1, 2, 3], "a.webm", null));

        Assert.Equal(block, g.Block);
        Assert.Equal(block, s.Block);
        Assert.Equal(0, gemini.Calls);
        Assert.Equal(0, azure.Calls);
        Assert.Empty(budget.Recorded);
    }

    [Fact]
    public async Task ClosedBudget_ReportsNotConfigured_OpenBudget_Configured()
    {
        var open = new TestBudget();
        var closed = new TestBudget { Block = AiBudgetBlock.Paused };

        Assert.True(await GraderChain(open, "gemini", new Grader(AiProviders.Gemini)).IsConfiguredAsync());
        Assert.True(await SttChain(open, "azure", new Stt(AiProviders.AzureSpeech)).IsConfiguredAsync());
        Assert.False(await GraderChain(closed, "gemini", new Grader(AiProviders.Gemini)).IsConfiguredAsync());
        Assert.False(await SttChain(closed, "azure", new Stt(AiProviders.AzureSpeech)).IsConfiguredAsync());
    }

    // ── Rule 3 — every call is recorded, failures included ───────────────────

    [Fact]
    public async Task EveryVendorCall_IsRecorded_FailedOnesAtTheAssumedSize()
    {
        var budget = new TestBudget();
        var broken = new Grader(AiProviders.Anthropic, throws: new InvalidOperationException("429"));
        var working = new Grader(AiProviders.OpenAi, () => Graded(input: 2_000, output: 500));

        await GraderChain(budget, "anthropic,openai", broken, working).AnalyzeAsync(Request);

        var rows = budget.Recorded.ToArray();
        Assert.Equal(2, rows.Length);

        Assert.Equal((AiProviders.Anthropic, AiOperations.Grader, false), (rows[0].Provider, rows[0].Operation, rows[0].Succeeded));
        Assert.Equal(AiCostEstimator.AssumedInputTokens, rows[0].InputTokens);
        Assert.True(rows[0].CostUsd > 0, "a failed call must still cost something");

        Assert.Equal((AiProviders.OpenAi, true, 2_000L, 500L), (rows[1].Provider, rows[1].Succeeded, rows[1].InputTokens, rows[1].OutputTokens));
        // gpt-4o-mini defaults: $0.15 / $0.60 per million.
        Assert.Equal((2_000 * 0.15m + 500 * 0.60m) / 1_000_000m, rows[1].CostUsd);
    }

    [Fact]
    public async Task SttCall_IsRecordedPerAudioSecond()
    {
        var budget = new TestBudget();
        await SttChain(budget, "azure", new Stt(AiProviders.AzureSpeech, duration: 36))
            .TranscribeAsync(new byte[1000], "a.webm", null);

        var row = Assert.Single(budget.Recorded);
        Assert.Equal(AiOperations.Stt, row.Operation);
        Assert.Equal(36, row.AudioSeconds);
        Assert.Equal(36 * (1.00m / 3600m), row.CostUsd);       // $1 per audio hour
    }

    // ── Rule 4 — re-checked before every fallback ─────────────────────────────

    [Fact]
    public async Task CapReachedMidChain_StopsBeforeTheFallbackVendor()
    {
        var budget = new TestBudget { CloseAfterChecks = 1 };
        var broken = new Grader(AiProviders.Anthropic, throws: new InvalidOperationException("500"));
        var fallback = new Grader(AiProviders.Gemini, () => Graded());

        await Assert.ThrowsAsync<AiBudgetExceededException>(
            () => GraderChain(budget, "anthropic,gemini", broken, fallback).AnalyzeAsync(Request));

        Assert.Equal(1, broken.Calls);
        Assert.Equal(0, fallback.Calls);
        Assert.Single(budget.Recorded);                         // the failed call that did happen
    }

    // ── Pricing arithmetic ────────────────────────────────────────────────────

    [Fact]
    public void WavLength_IsMeasuredExactly_FromItsHeader()
    {
        // 16 kHz mono 16-bit → 32,000 bytes per second; 2.5 s of data.
        var wav = new byte[44 + 80_000];
        "RIFF"u8.CopyTo(wav);
        "WAVE"u8.CopyTo(wav.AsSpan(8));
        BitConverter.GetBytes(32_000).CopyTo(wav, 28);

        Assert.Equal(2.5, AiCostEstimator.AudioSeconds(wav, reported: 1.0));
    }

    [Fact]
    public void CompressedAudio_UsesTheReportedDuration_ElseAConservativeByteEstimate()
    {
        var webm = new byte[40_000];
        Assert.Equal(7.2, AiCostEstimator.AudioSeconds(webm, reported: 7.2));
        Assert.Equal(10, AiCostEstimator.AudioSeconds(webm, reported: null));      // 40 kB at 4 kB/s
        Assert.Equal(AiCostEstimator.MaxEstimatedSeconds,
            AiCostEstimator.AudioSeconds(new byte[100_000_000], reported: null));   // one bad upload cannot close the cap
        Assert.Equal(1, AiCostEstimator.AudioSeconds([1], reported: null));        // never zero
    }

    [Fact]
    public void Stt_RoundsUpToWholeSeconds_AndPricesUnknownBackendsAtTheDearestRate()
    {
        var p = new AiPriceTable();
        Assert.Equal(2 * (p.AzureSttPerHour / 3600m), AiCostEstimator.Stt(AiProviders.AzureSpeech, 1.2, p));
        Assert.Equal(60 * (p.WhisperPerMinute / 60m), AiCostEstimator.Stt(AiProviders.Whisper, 60, p));
        Assert.True(AiCostEstimator.Stt("someday-vendor", 60, p) >= AiCostEstimator.Stt(AiProviders.AzureSpeech, 60, p));
        Assert.True(AiCostEstimator.Grader("someday-vendor", 1000, 1000, p).Cost
                    >= AiCostEstimator.Grader(AiProviders.Anthropic, 1000, 1000, p).Cost);
    }

    [Theory]
    [InlineData("12.5", false, "12.5")]
    [InlineData(" 3 ", false, "3")]
    [InlineData("0", false, null)]        // a cap of zero is not a cap — the kill switch is
    [InlineData("0", true, "0")]          // …but a zero unit PRICE is a legal (free-tier) price
    [InlineData("-1", false, null)]
    [InlineData("abc", false, null)]
    [InlineData("12,5", false, null)]     // invariant culture only: "12,5" is not twelve and a half
    [InlineData("1000001", false, null)]  // no "unlimited" in disguise
    [InlineData("", false, null)]
    public void ParseUsd_AcceptsOnlyPlausibleDollarAmounts(string raw, bool allowZero, string? expected)
        => Assert.Equal(expected is null ? null : decimal.Parse(expected, System.Globalization.CultureInfo.InvariantCulture),
                        AiBudgetSettings.ParseUsd(raw, allowZero));
}
