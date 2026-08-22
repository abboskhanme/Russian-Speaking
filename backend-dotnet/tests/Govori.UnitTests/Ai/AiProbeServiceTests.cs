using Govori.Administration;
using Govori.Contracts;
using Govori.Platform.Ai;
using Govori.Platform.Grader;
using Govori.Platform.Stt;

namespace Govori.UnitTests.Ai;

/// <summary>
/// Pins what the settings screen's "does this key actually work?" button promises. The probe walks
/// the same backends the pipeline walks, so it inherits the chain's vocabulary — but it answers a
/// different question, and three of its rules are its own:
///
/// <list type="number">
///   <item><b>Skipped is not failed, and skipped is free.</b> A backend with no key is reported
///   <c>configured: false</c> and is never called. Claude ships without a key deliberately; a red
///   badge on a deliberate state teaches an admin to stop reading the badges, and a vendor call to
///   check a key nobody entered is a bill for nothing.</item>
///   <item><b>One bad key must not hide the others.</b> The whole point of the button is a picture
///   of every backend at once. If a throwing backend aborted the round, the first mistyped key would
///   leave every other card blank — the state the admin pressed the button to escape.</item>
///   <item><b>The vendor's own sentence is the payload.</b> "API key not valid" and "model not
///   found" send an admin to two different fields; a house-styled "check failed" sends them
///   nowhere.</item>
///   <item><b>The model reported is the one that answered.</b> Same reason
///   <c>evaluations.llm_model</c> records the backend that really ran: a typed model id that quietly
///   resolved to something else is exactly what this button exists to surface.</item>
///   <item><b>Cancellation is not a vendor fault.</b> The admin navigated away. Recording that as a
///   failed probe writes a lie about a vendor that did nothing wrong.</item>
/// </list>
///
/// No vendor is contacted: every backend here is an in-memory fake whose whole job is to be
/// unconfigured, to throw, or to answer.
/// </summary>
public sealed class AiProbeServiceTests
{
    // ── Fakes ───────────────────────────────────────────────────────────────

    private sealed class FakeGrader : IGraderBackend
    {
        private readonly bool _configured;
        private readonly string? _model;
        private readonly Exception? _throws;

        public FakeGrader(string name, bool configured, string? model = null, Exception? throws = null)
        {
            Name = name;
            _configured = configured;
            _model = model;
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
            return Task.FromResult(new GraderResult
            {
                Scores = new GraderScores(70, 70, 70, 70, 70, 70),
                Model = _model,
            });
        }
    }

    private sealed class FakeStt : ISttBackend
    {
        private readonly bool _configured;
        private readonly string? _model;
        private readonly Exception? _throws;

        public FakeStt(string name, bool configured, string? model = null, Exception? throws = null)
        {
            Name = name;
            _configured = configured;
            _model = model;
            _throws = throws;
        }

        public string Name { get; }
        public int Calls { get; private set; }
        public byte[]? LastAudio { get; private set; }

        public bool IsConfigured(AiRuntimeConfig config) => _configured;

        public Task<SttResult> TranscribeAsync(
            byte[] audio, string filename, string? referenceText, AiRuntimeConfig config, CancellationToken ct)
        {
            Calls++;
            LastAudio = audio;
            ct.ThrowIfCancellationRequested();
            if (_throws is not null) throw _throws;
            return Task.FromResult(new SttResult { Text = string.Empty, Model = _model });
        }
    }

    private sealed class StaticConfig : IAiConfigSource
    {
        private readonly AiRuntimeConfig _config;
        public StaticConfig(AiRuntimeConfig config) => _config = config;
        public Task<AiRuntimeConfig> GetAsync(CancellationToken ct = default) => Task.FromResult(_config);
    }

    private static AiProbeService Probe(
        string graderChain, string sttChain,
        IEnumerable<IGraderBackend>? graders = null, IEnumerable<ISttBackend>? stt = null)
        => new(graders ?? [], stt ?? [],
               new StaticConfig(new AiRuntimeConfig
               {
                   GraderChain = graderChain.Length == 0 ? [] : graderChain.Split(','),
                   SttChain = sttChain.Length == 0 ? [] : sttChain.Split(','),
               }));

    // ── Rule 1 — skipped is not failed, and skipped is free ─────────────────

    [Fact]
    public async Task UnconfiguredBackend_IsReportedSkipped_AndNeverCalled()
    {
        var claude = new FakeGrader("anthropic", configured: false);

        var result = await Probe("anthropic", "", graders: [claude]).RunAsync();

        var probe = Assert.Single(result.Results);
        Assert.Equal("anthropic", probe.Name);
        Assert.Equal("grader", probe.Kind);
        Assert.False(probe.Configured);
        Assert.Null(probe.Model);
        // No error either: nothing went wrong, so a message would invent a problem.
        Assert.Null(probe.Error);
        // The cost of the whole state: zero calls, and no elapsed time to explain.
        Assert.Equal(0, claude.Calls);
        Assert.Equal(0, probe.ElapsedMs);
    }

    // ── Rule 2 — one bad key must not hide the others ───────────────────────

    [Fact]
    public async Task AThrowingBackend_DoesNotStopTheRound()
    {
        var broken = new FakeGrader("gemini", configured: true, throws: new InvalidOperationException("API key not valid"));
        var working = new FakeGrader("openai", configured: true, model: "gpt-4o-mini");
        var parked = new FakeGrader("anthropic", configured: false);

        var result = await Probe("gemini,openai,anthropic", "", graders: [broken, working, parked]).RunAsync();

        // All three are reported, in the chain's order — the picture is the product.
        Assert.Equal(["gemini", "openai", "anthropic"], result.Results.Select(r => r.Name));
        Assert.Equal(1, working.Calls);

        var failed = result.Results[0];
        Assert.True(failed.Configured);
        Assert.False(failed.Ok);
        Assert.Null(failed.Model);

        var ok = result.Results[1];
        Assert.True(ok.Ok);
        Assert.Equal("gpt-4o-mini", ok.Model);
    }

    // ── Rule 3 — the vendor's own sentence is the payload ───────────────────

    [Fact]
    public async Task AFailure_CarriesTheVendorsOwnMessage_Trimmed()
    {
        // Vendors return newline-wrapped JSON blobs; this lands in a UI, so it arrives on one line
        // and bounded — but the words the admin acts on must survive intact at the front.
        var noisy = new FakeGrader(
            "gemini", configured: true,
            throws: new InvalidOperationException("API key not valid.\nPlease pass a valid API key. " + new string('x', 400)));

        var result = await Probe("gemini", "", graders: [noisy]).RunAsync();

        var probe = Assert.Single(result.Results);
        Assert.NotNull(probe.Error);
        Assert.StartsWith("API key not valid. Please pass a valid API key.", probe.Error);
        Assert.DoesNotContain('\n', probe.Error);
        Assert.True(probe.Error!.Length <= 301, $"error was {probe.Error.Length} chars");
    }

    // ── Rule 4 — the model reported is the one that answered ───────────────

    [Fact]
    public async Task ASuccess_ReportsTheModelTheBackendReturned_NotTheConfiguredName()
    {
        // The configured id and the served id differ on purpose: an alias resolving elsewhere is
        // precisely the silent mistake this button exists to make visible.
        var grader = new FakeGrader("gemini", configured: true, model: "gemini-3.1-flash-lite-002");
        var stt = new FakeStt("azure", configured: true, model: "azure-speech-ru-RU");

        var result = await Probe("gemini", "azure", graders: [grader], stt: [stt]).RunAsync();

        Assert.Equal("gemini-3.1-flash-lite-002", result.Results.Single(r => r.Kind == "grader").Model);
        Assert.Equal("azure-speech-ru-RU", result.Results.Single(r => r.Kind == "stt").Model);
    }

    // ── Rule 5 — cancellation is not a vendor fault ────────────────────────

    [Fact]
    public async Task Cancellation_Propagates_AndIsNotReportedAsAFailedProbe()
    {
        var grader = new FakeGrader("gemini", configured: true, model: "gemini");
        using var cts = new CancellationTokenSource();
        await cts.CancelAsync();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(
            () => Probe("gemini", "", graders: [grader]).RunAsync(cts.Token));
    }

    // ── The walk: configured backends outside the chain are still probed ───

    [Fact]
    public async Task ABackendMissingFromTheChain_IsStillProbed()
    {
        // Otherwise an admin who reorders the chain loses the ability to check the key of the
        // backend they just took out — which is the moment they most want to know it still works.
        var inChain = new FakeGrader("gemini", configured: true, model: "gemini");
        var outOfChain = new FakeGrader("openai", configured: true, model: "gpt-4o-mini");

        var result = await Probe("gemini", "", graders: [inChain, outOfChain]).RunAsync();

        Assert.Equal(["gemini", "openai"], result.Results.Select(r => r.Name));
        Assert.All(result.Results, r => Assert.True(r.Ok));
    }

    [Fact]
    public async Task AChainNameWithNoBackend_IsIgnoredRatherThanReported()
    {
        // A name left behind by a newer build, or a typo in the chain field. The chain itself skips
        // it, so a card for a backend that does not exist would describe nothing.
        var real = new FakeGrader("gemini", configured: true, model: "gemini");

        var result = await Probe("nosuchvendor,gemini", "", graders: [real]).RunAsync();

        Assert.Equal(["gemini"], result.Results.Select(r => r.Name));
    }

    // ── The STT probe sends real, decodable audio ──────────────────────────

    [Fact]
    public async Task TheSttProbe_SendsAOneSecond16kHzMonoWav()
    {
        // Silence, but a VALID RIFF/WAVE file: the question is whether the credentials, headers and
        // content type are accepted, and a malformed body would fail for a reason that has nothing
        // to do with the key. Already 16 kHz mono so the transcode step short-circuits and no ffmpeg
        // process is spawned to test a key.
        var stt = new FakeStt("azure", configured: true, model: "azure");

        await Probe("", "azure", stt: [stt]).RunAsync();

        var wav = Assert.IsType<byte[]>(stt.LastAudio);
        Assert.Equal("RIFF"u8.ToArray(), wav[..4]);
        Assert.Equal("WAVE"u8.ToArray(), wav[8..12]);
        Assert.Equal(1, BitConverter.ToInt16(wav, 22));          // channels
        Assert.Equal(16000, BitConverter.ToInt32(wav, 24));      // sample rate
        Assert.Equal(16, BitConverter.ToInt16(wav, 34));         // bits per sample
        Assert.Equal(44 + 16000 * 2, wav.Length);                // header + one second
    }
}
