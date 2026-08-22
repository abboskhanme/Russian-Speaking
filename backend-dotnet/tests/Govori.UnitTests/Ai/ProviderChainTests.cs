using Govori.Platform.Ai;
using Govori.Platform.Grader;
using Govori.Platform.Stt;
using Microsoft.Extensions.Logging.Abstractions;

namespace Govori.UnitTests.Ai;

/// <summary>
/// Pins the four rules the provider chain encodes (docs/08 Faza 3.4). Each one exists because the
/// obvious implementation gets it wrong in a way that is expensive and hard to see in production:
///
/// <list type="number">
///   <item><b>Skipped is not failed.</b> A backend with no key must be passed over in silence. Treat
///   it as a failure and an unconfigured Claude sitting first in the chain logs a warning on every
///   single submission — noise that trains everyone to ignore the log that also carries real vendor
///   outages.</item>
///   <item><b>A configured backend that throws falls through.</b> That is the entire point of a
///   chain; without it one vendor's bad afternoon is the app's bad afternoon.</item>
///   <item><b>Cancellation never triggers fallback.</b> A cancelled request means the caller left.
///   Retrying down the chain bills three vendors for an answer nobody will read.</item>
///   <item><b>The recorded model is the one that really ran.</b> <c>evaluations.llm_model</c> is
///   history; writing the configured name there makes it a lie precisely when a fallback ran, which
///   is exactly when someone will be reading it to find out what happened.</item>
/// </list>
///
/// No vendor is contacted: the backends here are in-memory fakes whose whole job is to be
/// unconfigured, to throw, or to answer.
/// </summary>
public sealed class ProviderChainTests
{
    // ── Fakes ───────────────────────────────────────────────────────────────

    private sealed class FakeGraderBackend : IGraderBackend
    {
        private readonly bool _configured;
        private readonly Func<GraderResult>? _answer;
        private readonly Exception? _throws;

        public FakeGraderBackend(string name, bool configured, Func<GraderResult>? answer = null, Exception? throws = null)
        {
            Name = name;
            _configured = configured;
            _answer = answer;
            _throws = throws;
        }

        public string Name { get; }
        public int Calls { get; private set; }

        public bool IsConfigured(AiRuntimeConfig config) => _configured;

        public Task<GraderResult> AnalyzeAsync(GraderRequest request, AiRuntimeConfig config, CancellationToken ct)
        {
            Calls++;
            ct.ThrowIfCancellationRequested();
            if (_throws is not null) throw _throws;
            return Task.FromResult(_answer!());
        }
    }

    private sealed class FakeSttBackend : ISttBackend
    {
        private readonly bool _configured;
        private readonly Func<SttResult>? _answer;
        private readonly Exception? _throws;

        public FakeSttBackend(string name, bool configured, Func<SttResult>? answer = null, Exception? throws = null)
        {
            Name = name;
            _configured = configured;
            _answer = answer;
            _throws = throws;
        }

        public string Name { get; }
        public int Calls { get; private set; }

        public bool IsConfigured(AiRuntimeConfig config) => _configured;

        public Task<SttResult> TranscribeAsync(
            byte[] audio, string filename, string? referenceText, AiRuntimeConfig config, CancellationToken ct)
        {
            Calls++;
            ct.ThrowIfCancellationRequested();
            if (_throws is not null) throw _throws;
            return Task.FromResult(_answer!());
        }
    }

    private sealed class StaticConfig : IAiConfigSource
    {
        private readonly AiRuntimeConfig _config;
        public StaticConfig(AiRuntimeConfig config) => _config = config;
        public Task<AiRuntimeConfig> GetAsync(CancellationToken ct = default) => Task.FromResult(_config);
    }

    private static GraderResult Result(string model) => new()
    {
        Scores = new GraderScores(70, 70, 70, 70, 70, 70),
        Model = model,
    };

    private static SttResult Transcript(string model) => new() { Text = "привет", Model = model };

    private static ChainGraderProvider Grader(string chain, params FakeGraderBackend[] backends)
        => new(backends,
               new StaticConfig(new AiRuntimeConfig { GraderChain = chain.Split(',') }),
               NullLogger<ChainGraderProvider>.Instance);

    private static ChainSttProvider Stt(string chain, params FakeSttBackend[] backends)
        => new(backends,
               new StaticConfig(new AiRuntimeConfig { SttChain = chain.Split(',') }),
               NullLogger<ChainSttProvider>.Instance);

    // ── Rule 1 — skipped is not failed ──────────────────────────────────────

    [Fact]
    public async Task UnconfiguredBackend_IsSkippedWithoutBeingCalled()
    {
        var claude = new FakeGraderBackend("anthropic", configured: false);
        var gemini = new FakeGraderBackend("gemini", configured: true, () => Result("gemini-3.1-flash-lite"));

        var result = await Grader("anthropic,gemini", claude, gemini)
            .AnalyzeAsync(new GraderRequest { QuestionPrompt = "p", TranscriptText = "t" });

        Assert.Equal(0, claude.Calls);          // never invoked — no key, no cost, no log line
        Assert.Equal(1, gemini.Calls);
        Assert.Equal("gemini-3.1-flash-lite", result.Model);
    }

    [Fact]
    public async Task IsConfiguredAsync_IsFalse_OnlyWhenNoBackendInTheChainHasAKey()
    {
        var none = Grader("anthropic,gemini",
            new FakeGraderBackend("anthropic", configured: false),
            new FakeGraderBackend("gemini", configured: false));
        var one = Grader("anthropic,gemini",
            new FakeGraderBackend("anthropic", configured: false),
            new FakeGraderBackend("gemini", configured: true, () => Result("g")));

        // This is the pipeline's DEFER guard: false means the attempt stays pending rather than
        // being burned. One configured backend anywhere in the chain is enough to proceed.
        Assert.False(await none.IsConfiguredAsync());
        Assert.True(await one.IsConfiguredAsync());
    }

    [Fact]
    public async Task NoConfiguredBackend_ThrowsNamingTheChain()
    {
        var chain = Grader("anthropic,gemini",
            new FakeGraderBackend("anthropic", configured: false),
            new FakeGraderBackend("gemini", configured: false));

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(
            () => chain.AnalyzeAsync(new GraderRequest { QuestionPrompt = "p", TranscriptText = "t" }));

        // The message carries the configured order, because "grading failed" without it sends the
        // reader to the vendor dashboards instead of to the settings screen.
        Assert.Contains("anthropic", ex.Message);
        Assert.Contains("gemini", ex.Message);
    }

    // ── Rule 2 — a configured backend that throws falls through ─────────────

    [Fact]
    public async Task ConfiguredBackendThatThrows_FallsThroughToTheNextOne()
    {
        var claude = new FakeGraderBackend("anthropic", configured: true, throws: new HttpRequestException("429"));
        var gemini = new FakeGraderBackend("gemini", configured: true, () => Result("gemini-3.1-flash-lite"));

        var result = await Grader("anthropic,gemini", claude, gemini)
            .AnalyzeAsync(new GraderRequest { QuestionPrompt = "p", TranscriptText = "t" });

        Assert.Equal(1, claude.Calls);          // it WAS tried — this is a real failure, not a skip
        Assert.Equal("gemini-3.1-flash-lite", result.Model);
    }

    [Fact]
    public async Task EveryConfiguredBackendFailing_SurfacesAllOfThem()
    {
        var chain = Grader("anthropic,gemini,openai",
            new FakeGraderBackend("anthropic", true, throws: new HttpRequestException("429")),
            new FakeGraderBackend("gemini", true, throws: new InvalidOperationException("bad json")),
            new FakeGraderBackend("openai", true, throws: new TimeoutException("slow")));

        var ex = await Assert.ThrowsAsync<AggregateException>(
            () => chain.AnalyzeAsync(new GraderRequest { QuestionPrompt = "p", TranscriptText = "t" }));

        // One vendor's rate limit and another's malformed JSON are different problems. Collapsing
        // them into a single "grading failed" is how a systemic outage gets misread as a bad model.
        Assert.Equal(3, ex.InnerExceptions.Count);
    }

    // ── Rule 3 — cancellation is never a fallback trigger ───────────────────

    [Fact]
    public async Task CancelledRequest_DoesNotTryTheRestOfTheChain()
    {
        var claude = new FakeGraderBackend("anthropic", configured: true, () => Result("claude-opus-5"));
        var gemini = new FakeGraderBackend("gemini", configured: true, () => Result("gemini-3.1-flash-lite"));
        using var cts = new CancellationTokenSource();
        cts.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(
            () => Grader("anthropic,gemini", claude, gemini)
                .AnalyzeAsync(new GraderRequest { QuestionPrompt = "p", TranscriptText = "t" }, cts.Token));

        // The caller has gone. Falling through here would bill a second vendor for an answer that
        // is already unreachable.
        Assert.Equal(0, gemini.Calls);
    }

    /// <summary>
    /// A VENDOR TIMEOUT IS A FAILURE, NOT A CANCELLATION — and the two are one keyword apart.
    ///
    /// <para><c>HttpClient.Timeout</c> does not throw <see cref="TimeoutException"/>. It throws
    /// <see cref="TaskCanceledException"/>, which derives from
    /// <see cref="OperationCanceledException"/> — the exact type the rule above rethrows without
    /// falling back. What separates them is the <c>when (ct.IsCancellationRequested)</c> filter on
    /// that catch: the caller's token is NOT cancelled when a timeout fires, so the filter declines
    /// and the generic handler moves to the next backend.</para>
    ///
    /// <para>Delete that filter — an entirely reasonable-looking simplification — and every vendor
    /// timeout silently aborts the whole attempt instead of failing over. The student's answer comes
    /// back ungraded, the log says "cancelled", and the second backend that would have answered is
    /// never called. The existing <see cref="TimeoutException"/> case above would still pass, and so
    /// would the cancellation case, which is why this needs its own test.</para>
    /// </summary>
    [Fact]
    public async Task VendorTimeout_FallsThroughToTheNextBackend_BecauseItIsNotACallerCancellation()
    {
        // Exactly what HttpClient raises when its Timeout elapses.
        var timedOut = new TaskCanceledException("The request was canceled due to the configured HttpClient.Timeout",
            new TimeoutException());

        var claude = new FakeGraderBackend("anthropic", configured: true, throws: timedOut);
        var gemini = new FakeGraderBackend("gemini", configured: true, () => Result("gemini-3.1-flash-lite"));

        // No cancellation token — the caller is still very much waiting.
        var result = await Grader("anthropic,gemini", claude, gemini)
            .AnalyzeAsync(new GraderRequest { QuestionPrompt = "p", TranscriptText = "t" });

        Assert.Equal(1, claude.Calls);
        Assert.Equal(1, gemini.Calls);                       // the fallback actually ran
        Assert.Equal("gemini-3.1-flash-lite", result.Model);
    }

    /// <summary>The same distinction on the STT chain, which is where the missing timeouts actually
    /// were. Falling through costs the pronunciation score; NOT falling through costs the attempt.</summary>
    [Fact]
    public async Task SttVendorTimeout_FallsThroughToTheNextBackend()
    {
        var timedOut = new TaskCanceledException("timeout", new TimeoutException());

        var azure = new FakeSttBackend("azure_speech", configured: true, throws: timedOut);
        var whisper = new FakeSttBackend("whisper", configured: true, () => Transcript("whisper-1"));

        var result = await Stt("azure_speech,whisper", azure, whisper)
            .TranscribeAsync(new byte[] { 1, 2, 3 }, "a.webm", referenceText: null);

        Assert.Equal(1, azure.Calls);
        Assert.Equal(1, whisper.Calls);
        Assert.Equal("whisper-1", result.Model);
    }

    // ── Rule 4 — record the model that actually ran ─────────────────────────

    [Fact]
    public async Task ServedModel_IsTheBackendsOwn_NotTheConfiguredFirstChoice()
    {
        var result = await Grader("anthropic,gemini",
                new FakeGraderBackend("anthropic", true, throws: new HttpRequestException("down")),
                new FakeGraderBackend("gemini", true, () => Result("gemini-3.1-flash-lite")))
            .AnalyzeAsync(new GraderRequest { QuestionPrompt = "p", TranscriptText = "t" });

        // Claude is first in the chain and the admin's configured choice — and it did not grade this
        // answer. evaluations.llm_model must say so.
        Assert.Equal("gemini-3.1-flash-lite", result.Model);
        Assert.NotEqual("claude-opus-5", result.Model);
    }

    // ── Order, and tolerating a settings row a newer build wrote ────────────

    [Fact]
    public async Task ChainIsTriedInTheAdminsOrder_NotRegistrationOrder()
    {
        // Registration order deliberately differs from the chain order: DI enumerates in the order
        // services were added, and the chain must ignore that entirely.
        var gemini = new FakeGraderBackend("gemini", true, () => Result("gemini"));
        var claude = new FakeGraderBackend("anthropic", true, () => Result("claude-opus-5"));

        var result = await Grader("anthropic,gemini", gemini, claude)
            .AnalyzeAsync(new GraderRequest { QuestionPrompt = "p", TranscriptText = "t" });

        Assert.Equal("claude-opus-5", result.Model);
        Assert.Equal(0, gemini.Calls);
    }

    [Fact]
    public async Task UnknownBackendNameInTheChain_IsIgnoredRatherThanFatal()
    {
        // A settings row written by a newer build must not break an older one — that is a rollback
        // turning into an outage.
        var result = await Grader("some-future-vendor,gemini",
                new FakeGraderBackend("gemini", true, () => Result("gemini-3.1-flash-lite")))
            .AnalyzeAsync(new GraderRequest { QuestionPrompt = "p", TranscriptText = "t" });

        Assert.Equal("gemini-3.1-flash-lite", result.Model);
    }

    // ── The STT chain: same rules, one deliberately lossy consequence ───────

    [Fact]
    public async Task SttFallbackToWhisper_LosesPronunciationRatherThanFailingTheAttempt()
    {
        var azure = new FakeSttBackend("azure", configured: true, throws: new HttpRequestException("503"));
        var whisper = new FakeSttBackend("whisper", configured: true, () => Transcript("whisper-1"));

        var result = await Stt("azure,whisper", azure, whisper)
            .TranscribeAsync(new byte[] { 1, 2, 3 }, "a.webm", referenceText: null);

        // Only Azure returns a pronunciation assessment, so this fallback degrades the band from
        // five criteria to four. That is the intended trade: a student who spoke gets a score.
        Assert.Equal("whisper-1", result.Model);
        Assert.Null(result.Pronunciation);
    }

    [Fact]
    public async Task SttChain_SkipsUnconfiguredBackendsToo()
    {
        var azure = new FakeSttBackend("azure", configured: false);
        var whisper = new FakeSttBackend("whisper", configured: true, () => Transcript("whisper-1"));

        var result = await Stt("azure,whisper", azure, whisper)
            .TranscribeAsync(new byte[] { 1 }, "a.webm", referenceText: null);

        Assert.Equal(0, azure.Calls);
        Assert.Equal("whisper-1", result.Model);
    }

    // ── ParseChain: the small function every stored order goes through ──────

    [Theory]
    [InlineData("anthropic,gemini", new[] { "anthropic", "gemini" })]
    [InlineData(" anthropic , GEMINI ", new[] { "anthropic", "gemini" })]   // trimmed + lower-cased
    [InlineData("gemini,gemini,anthropic", new[] { "gemini", "anthropic" })] // de-duped, order kept
    [InlineData("anthropic,,gemini", new[] { "anthropic", "gemini" })]       // blanks dropped
    public void ParseChain_NormalisesWithoutReordering(string stored, string[] expected)
        => Assert.Equal(expected, AiProviders.ParseChain(stored, Array.Empty<string>()));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(",,")]
    public void ParseChain_EmptyInput_MeansTheDefault_NotNoProvidersAtAll(string? stored)
    {
        // The distinction matters: "cleared setting" must fall back to the default order. Reading it
        // as an empty chain would silently disable grading for everyone.
        Assert.Equal(AiProviders.DefaultGraderChain, AiProviders.ParseChain(stored, AiProviders.DefaultGraderChain));
    }
}
