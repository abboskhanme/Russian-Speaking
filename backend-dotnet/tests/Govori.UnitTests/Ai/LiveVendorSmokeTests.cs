using Govori.Platform.Ai;
using Govori.Platform.Ai.Backends;
using Govori.Platform.Grader;
using Microsoft.Extensions.DependencyInjection;

namespace Govori.UnitTests.Ai;

/// <summary>
/// Opt-in smoke test that calls the REAL vendors (docs/08 Faza 3.4, step 7).
///
/// <para>Everything else about the chain is proven against fakes, which is the right default: a
/// suite that needs the internet and a billing account is a suite that stops being run. But fakes
/// cannot catch the failures that only exist on the wire — a header the vendor rejects, a schema
/// dialect it refuses, a model id that has moved. Those are precisely the failures that would
/// otherwise be discovered by a student submitting a recording.</para>
///
/// <para><b>Skipped unless <c>GOVORI_LIVE_AI=1</c>.</b> It is skipped rather than quietly passing:
/// a green test that did nothing is worse than a missing one, because it is read as evidence.</para>
///
/// <para>Run it with the keys from <c>.env</c> in the environment. It sends one short, invented
/// Russian sentence — no student data ever leaves this machine through here.</para>
/// </summary>
public sealed class LiveVendorSmokeTests
{
    /// <summary>A <see cref="FactAttribute"/> that reports itself as skipped, with the reason, when
    /// the opt-in flag is absent.</summary>
    private sealed class LiveAiFactAttribute : FactAttribute
    {
        public LiveAiFactAttribute()
        {
            if (Environment.GetEnvironmentVariable("GOVORI_LIVE_AI") != "1")
                Skip = "live vendor call — set GOVORI_LIVE_AI=1 and supply the vendor keys to run";
        }
    }

    // A sentence a real A1 learner might produce: one clear agreement error ("я идёт"), so a working
    // grader has something specific to find and a broken one has nowhere to hide.
    private const string Transcript = "меня зовут Алишер, я идёт в школа каждый день";

    private static AiRuntimeConfig ConfigFromEnvironment() => new()
    {
        GraderChain = AiProviders.DefaultGraderChain,
        SttChain = AiProviders.DefaultSttChain,
        AnthropicApiKey = Environment.GetEnvironmentVariable("ANTHROPIC_API_KEY"),
        AnthropicModel = Environment.GetEnvironmentVariable("ANTHROPIC_MODEL") ?? AiProviders.DefaultAnthropicModel,
        GeminiApiKey = Environment.GetEnvironmentVariable("GEMINI_API_KEY"),
        GeminiModel = Environment.GetEnvironmentVariable("GEMINI_MODEL") ?? "gemini-3.1-flash-lite",
        OpenAiApiKey = Environment.GetEnvironmentVariable("OPENAI_API_KEY"),
        OpenAiGraderModel = Environment.GetEnvironmentVariable("OPENAI_GRADER_MODEL") ?? "gpt-4o-mini",
        AzureSpeechKey = Environment.GetEnvironmentVariable("AZURE_SPEECH_KEY"),
        AzureSpeechRegion = Environment.GetEnvironmentVariable("AZURE_SPEECH_REGION"),
    };

    private static IHttpClientFactory HttpFactory()
        => new ServiceCollection().AddHttpClient().BuildServiceProvider().GetRequiredService<IHttpClientFactory>();

    private static GraderRequest Request() => new()
    {
        QuestionPrompt = "Расскажите о себе: как вас зовут и что вы делаете каждый день?",
        TranscriptText = Transcript,
        Level = "A1",
        Topic = "Знакомство",
    };

    [LiveAiFact]
    public async Task EveryConfiguredGraderBackend_ReturnsAUsableResult()
    {
        var config = ConfigFromEnvironment();
        var http = HttpFactory();

        IGraderBackend[] backends =
        [
            new AnthropicGraderBackend(http),
            new GeminiGraderBackend(http),
            new OpenAiGraderBackend(http),
        ];

        var ran = new List<string>();
        var failures = new List<string>();

        foreach (var backend in backends)
        {
            if (!backend.IsConfigured(config))
                continue;                       // no key — the chain would skip it too

            try
            {
                var result = await backend.AnalyzeAsync(Request(), config, CancellationToken.None);

                // The assertions are about SHAPE, not about the grade. Model judgement varies run to
                // run; what must hold is that the vendor round-trip produced something the pipeline
                // can persist and the C5 blend can score. Pinning a specific band here would make
                // this test flap on every model update.
                Assert.InRange(result.Scores.Overall, 0, 100);
                Assert.InRange(result.Scores.Grammar, 0, 100);
                Assert.False(string.IsNullOrWhiteSpace(result.Model));
                Assert.False(string.IsNullOrWhiteSpace(result.Summary));

                ran.Add($"{backend.Name} → {result.Model} (overall {result.Scores.Overall:0})");
            }
            catch (Exception ex)
            {
                failures.Add($"{backend.Name}: {ex.GetType().Name}: {ex.Message}");
            }
        }

        // Printed either way — the point of a smoke run is to SEE what answered.
        foreach (var line in ran) Console.WriteLine($"  served: {line}");
        foreach (var line in failures) Console.WriteLine($"  FAILED: {line}");

        Assert.True(ran.Count > 0, "no grader backend is configured — set at least one vendor key");
        Assert.True(failures.Count == 0, string.Join("\n", failures));
    }

    [LiveAiFact]
    public async Task ChainPicksTheFirstConfiguredBackend_AndReportsTheModelThatRan()
    {
        var config = ConfigFromEnvironment();
        var http = HttpFactory();

        IGraderBackend[] backends =
        [
            new AnthropicGraderBackend(http),
            new GeminiGraderBackend(http),
            new OpenAiGraderBackend(http),
        ];

        var chain = new ChainGraderProvider(
            backends,
            new StaticAiConfig(config),
            Microsoft.Extensions.Logging.Abstractions.NullLogger<ChainGraderProvider>.Instance);

        Assert.True(await chain.IsConfiguredAsync(CancellationToken.None),
            "the chain reports no usable backend — grading would defer forever");

        var result = await chain.AnalyzeAsync(Request(), CancellationToken.None);
        Console.WriteLine($"  chain served by: {result.Model}");

        Assert.False(string.IsNullOrWhiteSpace(result.Model));
        Assert.InRange(result.Scores.LevelOverall, 0, 100);
    }

    [LiveAiFact]
    public async Task AzureSpeech_AcceptsTheRequestWeActuallySend()
    {
        var config = ConfigFromEnvironment();
        var backend = new AzureSpeechSttBackend(HttpFactory());

        if (!backend.IsConfigured(config))
        {
            Console.WriteLine("  skipped: no AZURE_SPEECH_KEY/REGION");
            return;
        }

        // Two seconds of silence, written as a 16 kHz mono 16-bit WAV so AudioTranscode's header
        // sniff short-circuits and no ffmpeg binary is needed inside the SDK image.
        //
        // Azure will recognise nothing, and that is fine: what is under test here is the part that
        // fails silently in production — the subscription-key header, the base64
        // Pronunciation-Assessment header, and the `codecs=audio/pcm` content type, which the
        // validating HttpClient setter rejects outright and which therefore has to be attached the
        // awkward way. A 401 or 400 here is a real bug; an empty transcript is the expected answer.
        var result = await backend.TranscribeAsync(
            SilentWav(seconds: 2), "smoke.wav", referenceText: null, config, CancellationToken.None);

        Console.WriteLine($"  azure accepted the request; transcript=\"{result.Text}\" model={result.Model}");
        Assert.NotNull(result.Text);            // empty is correct for silence; null would be a mapping bug
        Assert.False(string.IsNullOrWhiteSpace(result.Model));
    }

    /// <summary>A valid 16 kHz mono 16-bit PCM WAV of pure silence.</summary>
    private static byte[] SilentWav(int seconds)
    {
        const int rate = 16000, bits = 16, channels = 1;
        var dataBytes = rate * seconds * channels * (bits / 8);

        using var ms = new MemoryStream();
        using var w = new BinaryWriter(ms);
        w.Write("RIFF"u8.ToArray());
        w.Write(36 + dataBytes);
        w.Write("WAVE"u8.ToArray());
        w.Write("fmt "u8.ToArray());
        w.Write(16);                                        // PCM chunk size
        w.Write((short)1);                                  // PCM
        w.Write((short)channels);
        w.Write(rate);
        w.Write(rate * channels * (bits / 8));              // byte rate
        w.Write((short)(channels * (bits / 8)));            // block align
        w.Write((short)bits);
        w.Write("data"u8.ToArray());
        w.Write(dataBytes);
        w.Write(new byte[dataBytes]);
        w.Flush();
        return ms.ToArray();
    }

    private sealed class StaticAiConfig : IAiConfigSource
    {
        private readonly AiRuntimeConfig _config;
        public StaticAiConfig(AiRuntimeConfig config) => _config = config;
        public Task<AiRuntimeConfig> GetAsync(CancellationToken ct = default) => Task.FromResult(_config);
    }
}
