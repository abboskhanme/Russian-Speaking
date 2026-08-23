using System.Net;
using System.Text;
using System.Text.Json;
using Govori.Platform.Ai;
using Govori.Platform.Ai.Backends;
using Govori.Platform.Stt;

namespace Govori.UnitTests.Ai;

/// <summary>
/// The guardrail around scripted recognition (docs/01 F2, the phoneme drill).
///
/// <para><b>The regression these tests exist to prevent is the expensive one.</b> Two production
/// callers already hand Azure a reference text — <c>AssessmentService</c> passes the shadowing
/// target, <c>GuestService</c> passes the demo phrase — and both must keep recognising UNSCRIPTED,
/// because scripted decoding biases the recogniser toward the script and quietly repairs the exact
/// mispronunciations the product exists to surface (<c>transcript-must-stay-faithful</c>). The
/// obvious implementation of the drill — "if a reference text was supplied, script the request" —
/// would have flipped both of those paths on the day this feature landed, with no test failing and
/// no visible symptom beyond transcripts that had quietly become too good.</para>
///
/// <para>So the mode is a separate, explicit argument that defaults to unscripted, and these tests
/// assert the wire header rather than the C# call: what matters is what Azure was actually told.</para>
/// </summary>
public class ScriptedRecognitionTests
{
    private const string Reference = "мышка";

    // ─────────────────────────── the regression guard ───────────────────────────

    /// <summary>
    /// THE test. A reference text on its own must never script the request — this is the shadowing
    /// and free-practice path, and it is exactly the call <c>AssessmentService</c> makes.
    /// </summary>
    [Fact]
    public async Task A_reference_text_alone_never_scripts_the_request()
    {
        var sent = await CaptureAssessmentAsync(referenceText: Reference);

        Assert.Equal("", sent.GetProperty("ReferenceText").GetString());
        Assert.False(sent.GetProperty("EnableMiscue").GetBoolean());
    }

    /// <summary>The same guard stated for the explicit default, so that someone "tidying" the
    /// parameter away cannot make the previous test pass for the wrong reason.</summary>
    [Fact]
    public async Task The_default_mode_is_unscripted()
    {
        var sent = await CaptureAssessmentAsync(
            referenceText: Reference, mode: SttRecognitionMode.Unscripted);

        Assert.Equal("", sent.GetProperty("ReferenceText").GetString());
        Assert.False(sent.GetProperty("EnableMiscue").GetBoolean());
    }

    /// <summary>Free practice sends no reference at all; it must stay unscripted too, and must not
    /// somehow acquire a reference on the way to the vendor.</summary>
    [Fact]
    public async Task Free_practice_sends_no_reference_and_no_miscue()
    {
        var sent = await CaptureAssessmentAsync(referenceText: null);

        Assert.Equal("", sent.GetProperty("ReferenceText").GetString());
        Assert.False(sent.GetProperty("EnableMiscue").GetBoolean());
    }

    // ─────────────────────────── the drill's opt-in ───────────────────────────

    /// <summary>The drill asks for it explicitly, and only then does the target reach Azure.
    /// <c>EnableMiscue</c> rides along because against a real script it can finally tell a
    /// mispronounced word from an omitted one.</summary>
    [Fact]
    public async Task The_explicit_opt_in_scripts_the_request_and_enables_miscue()
    {
        var sent = await CaptureAssessmentAsync(
            referenceText: Reference, mode: SttRecognitionMode.Scripted);

        Assert.Equal(Reference, sent.GetProperty("ReferenceText").GetString());
        Assert.True(sent.GetProperty("EnableMiscue").GetBoolean());
    }

    /// <summary>
    /// Asking for scripted with nothing to script against falls back to unscripted rather than
    /// sending an empty <c>ReferenceText</c> with miscue ON — that combination makes Azure score
    /// every word as an omission, which would read as "the student said nothing" for a recording
    /// that was fine.
    /// </summary>
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Scripted_without_a_usable_reference_falls_back_to_unscripted(string? reference)
    {
        var sent = await CaptureAssessmentAsync(reference, SttRecognitionMode.Scripted);

        Assert.Equal("", sent.GetProperty("ReferenceText").GetString());
        Assert.False(sent.GetProperty("EnableMiscue").GetBoolean());
    }

    /// <summary>Granularity stays at Phoneme in BOTH modes — it is what produces the per-position
    /// scores the drill reads, and the drill would silently lose its whole point without it.</summary>
    [Theory]
    [InlineData(SttRecognitionMode.Unscripted)]
    [InlineData(SttRecognitionMode.Scripted)]
    public async Task Phoneme_granularity_is_requested_in_both_modes(SttRecognitionMode mode)
    {
        var sent = await CaptureAssessmentAsync(Reference, mode);

        Assert.Equal("Phoneme", sent.GetProperty("Granularity").GetString());
        Assert.Equal("HundredMark", sent.GetProperty("GradingSystem").GetString());
    }

    /// <summary>
    /// The reference is authored content, so it goes through a JSON serializer rather than string
    /// interpolation. A hand-built header would break on a quote — either a 400 that looks like an
    /// outage, or content escaping into the sibling parameters.
    /// </summary>
    [Fact]
    public async Task A_reference_containing_json_metacharacters_is_still_a_valid_header()
    {
        const string awkward = "\"мышка\" \\ и";

        var sent = await CaptureAssessmentAsync(awkward, SttRecognitionMode.Scripted);

        Assert.Equal(awkward, sent.GetProperty("ReferenceText").GetString());
        Assert.True(sent.GetProperty("EnableMiscue").GetBoolean());
    }

    // ─────────────────────── ru-RU returns no phoneme NAMES ───────────────────────

    /// <summary>
    /// Measured against the live vendor on 2026-08-23: for <c>ru-RU</c> every <c>Phoneme</c> field
    /// is an empty string, in scripted mode as well as unscripted. The mapping must carry those
    /// positions through anyway — the scores are the signal, and the drill supplies the names from
    /// its own content. Dropping unnamed phonemes "because they look empty" would delete the
    /// feature.
    /// </summary>
    [Fact]
    public async Task Nameless_phonemes_keep_their_positions_and_scores()
    {
        var result = await TranscribeAsync(
            ResponseWith("""
              "Phonemes":[
                {"Phoneme":"","Offset":1,"Duration":1,"AccuracyScore":0.0},
                {"Phoneme":"","Offset":2,"Duration":1,"AccuracyScore":0.0},
                {"Phoneme":"","Offset":3,"Duration":1,"AccuracyScore":100.0}]
            """),
            Reference, SttRecognitionMode.Scripted);

        var phonemes = Assert.Single(result.Words!).Phonemes!;
        Assert.Equal(3, phonemes.Count);
        Assert.Equal(new double?[] { 0.0, 0.0, 100.0 }, phonemes.Select(p => p.Accuracy));
    }

    /// <summary>
    /// The other half of what the live probe found: when the recording does not resemble the
    /// reference at all Azure returns NO phoneme entries. That has to arrive as "no per-sound
    /// detail", not as an exception — the drill still has a word score and a transcript to work
    /// from, and losing the whole attempt over a missing decoration would be the worse bug.
    /// </summary>
    [Fact]
    public async Task A_word_with_no_phoneme_entries_transcribes_cleanly()
    {
        var result = await TranscribeAsync(
            ResponseWith("\"Phonemes\":[]"), Reference, SttRecognitionMode.Scripted);

        var word = Assert.Single(result.Words!);
        Assert.Null(word.Phonemes);
        Assert.Equal("мишка", result.Text);
    }

    /// <summary>
    /// Azure sends the word's accuracy FLATTENED onto the word — measured, the live response is
    /// <c>"Word":"мышка","Offset":…,"AccuracyScore":49.0</c> with no <c>PronunciationAssessment</c>
    /// wrapper. Reading only the nested shape (as this backend did) returned null for every word of
    /// every attempt, which is invisible until something actually displays a word score.
    /// </summary>
    [Fact]
    public async Task A_flattened_word_accuracy_is_read()
    {
        var result = await TranscribeAsync(
            ResponseWith("\"Phonemes\":[]"), Reference, SttRecognitionMode.Scripted);

        var word = Assert.Single(result.Words!);
        Assert.Equal(49.0, word.Accuracy);
    }

    /// <summary>The nested shape still wins where a vendor revision sends it, so an endpoint
    /// upgrade cannot quietly swap which number is reported.</summary>
    [Fact]
    public async Task A_nested_word_accuracy_still_takes_precedence()
    {
        var body = """
            {"RecognitionStatus":"Success","NBest":[{"Lexical":"мишка","Words":[
              {"Word":"мышка","AccuracyScore":49.0,
               "PronunciationAssessment":{"AccuracyScore":88.0,"ErrorType":"Mispronunciation"}}]}]}
            """;

        var result = await TranscribeAsync(body, Reference, SttRecognitionMode.Scripted);

        var word = Assert.Single(result.Words!);
        Assert.Equal(88.0, word.Accuracy);
        Assert.Equal("Mispronunciation", word.ErrorType);
    }

    // ─────────────────────────── harness ───────────────────────────

    /// <summary>Sends one request through the real backend and hands back the decoded
    /// <c>Pronunciation-Assessment</c> header — the thing Azure actually receives.</summary>
    private static async Task<JsonElement> CaptureAssessmentAsync(
        string? referenceText, SttRecognitionMode mode = SttRecognitionMode.Unscripted)
    {
        var handler = new CapturingHandler(ResponseWith("\"Phonemes\":[]"));
        await Run(handler, referenceText, mode);

        var header = Assert.Single(handler.Request!.Headers.GetValues("Pronunciation-Assessment"));
        var json = Encoding.UTF8.GetString(Convert.FromBase64String(header));
        return JsonDocument.Parse(json).RootElement.Clone();
    }

    private static async Task<SttResult> TranscribeAsync(
        string body, string? referenceText, SttRecognitionMode mode)
        => await Run(new CapturingHandler(body), referenceText, mode);

    private static Task<SttResult> Run(
        CapturingHandler handler, string? referenceText, SttRecognitionMode mode)
    {
        var backend = new AzureSpeechSttBackend(new StubFactory(handler));
        var config = new AiRuntimeConfig
        {
            AzureSpeechKey = "test-key",
            AzureSpeechRegion = "test-region",
        };

        // A real 16 kHz mono PCM WAV, so AudioTranscode short-circuits instead of shelling out to
        // ffmpeg — this suite is about the header, not about audio conversion.
        return backend.TranscribeAsync(
            SilentWav(), "drill.wav", referenceText, config, CancellationToken.None, mode);
    }

    private static string ResponseWith(string phonemes) =>
        $$"""
        {"RecognitionStatus":"Success","Duration":11700000,
         "NBest":[{"Lexical":"мишка","AccuracyScore":49.0,
           "Words":[{"Word":"мышка","Offset":1300000,"Duration":5900000,"AccuracyScore":49.0,
             {{phonemes}}}]}]}
        """;

    private sealed class StubFactory : IHttpClientFactory
    {
        private readonly HttpMessageHandler _handler;
        public StubFactory(HttpMessageHandler handler) => _handler = handler;
        public HttpClient CreateClient(string name) => new(_handler, disposeHandler: false);
    }

    private sealed class CapturingHandler : HttpMessageHandler
    {
        private readonly string _body;
        public CapturingHandler(string body) => _body = body;

        public HttpRequestMessage? Request { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Request = request;
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(_body, Encoding.UTF8, "application/json"),
            });
        }
    }

    /// <summary>One second of 16 kHz mono silence, already in the shape Azure accepts.</summary>
    private static byte[] SilentWav()
    {
        const int rate = 16000, bits = 16, channels = 1;
        const int dataBytes = rate * channels * (bits / 8);

        using var ms = new MemoryStream();
        using var w = new BinaryWriter(ms);
        w.Write("RIFF"u8.ToArray());
        w.Write(36 + dataBytes);
        w.Write("WAVE"u8.ToArray());
        w.Write("fmt "u8.ToArray());
        w.Write(16);
        w.Write((short)1);
        w.Write((short)channels);
        w.Write(rate);
        w.Write(rate * channels * (bits / 8));
        w.Write((short)(channels * (bits / 8)));
        w.Write((short)bits);
        w.Write("data"u8.ToArray());
        w.Write(dataBytes);
        w.Write(new byte[dataBytes]);
        w.Flush();
        return ms.ToArray();
    }
}
