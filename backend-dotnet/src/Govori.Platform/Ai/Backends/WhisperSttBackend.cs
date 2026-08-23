using System.Net.Http.Headers;
using System.Text.Json;
using Govori.Platform.Stt;

namespace Govori.Platform.Ai.Backends;

/// <summary>
/// The STT fallback: OpenAI's transcription endpoint. It exists so an Azure outage costs the student
/// a pronunciation score rather than their attempt.
///
/// <para><b>Pronunciation stays <c>null</c>, and that is the whole trade.</b> Whisper transcribes; it
/// cannot assess how a sound was produced. With <c>Pronunciation = null</c> the C5 blend has no
/// PronScore to fold in and degrades to text-only — four criteria instead of five. That is a real,
/// documented loss of fidelity, accepted on purpose: a slightly less complete score is better than
/// telling a student who spoke that their attempt failed. Do not manufacture a substitute score
/// here; an invented number would be indistinguishable from a measured one in the stored transcript.</para>
///
/// <para><b>The reference text is ignored.</b> There is no scripted mode to honour and no phoneme
/// data to compare, so no <c>ReferenceMatch</c> is produced. Deriving one from the Whisper transcript
/// alone would put a shadowing on-topic verdict — the gate for XP — on a different footing depending
/// on which vendor happened to answer, which is worse than not answering the question at all.</para>
/// </summary>
public sealed class WhisperSttBackend : ISttBackend
{
    /// <summary>Named <see cref="HttpClient"/> the DI step configures. Separate from the grader's
    /// OpenAI client even though both talk to api.openai.com: an audio upload needs a longer timeout
    /// than a chat completion, and sharing one client means one of them is always wrong.</summary>
    public const string HttpClientName = "openai-whisper";

    private const string Endpoint = "https://api.openai.com/v1/audio/transcriptions";

    /// <summary>Sent as the <c>language</c> field. Pinning it stops Whisper guessing "Ukrainian" on a
    /// heavily accented beginner and returning a transcript in the wrong language's orthography.</summary>
    private const string LanguageCode = "ru";

    /// <summary>What lands in <c>transcripts.language</c>. Whisper answers with an English language
    /// NAME ("russian"), not a BCP-47 tag, so the tag we asked for is the honest thing to record.</summary>
    private const string LanguageTag = "ru-RU";

    private const int ErrorBodyChars = 600;

    private static readonly JsonSerializerOptions Json = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    private readonly IHttpClientFactory _http;

    public WhisperSttBackend(IHttpClientFactory http) => _http = http;

    public string Name => AiProviders.Whisper;

    public bool IsConfigured(AiRuntimeConfig config) => !string.IsNullOrWhiteSpace(config.OpenAiApiKey);

    /// <summary><paramref name="mode"/> is accepted and ignored: Whisper has no scripted-recognition
    /// concept and no pronunciation assessment at all, so there is nothing for it to change. A drill
    /// that falls through to this backend therefore gets a transcript and no phoneme detail — which
    /// is exactly how the drill is built to degrade.</summary>
    public async Task<SttResult> TranscribeAsync(
        byte[] audio, string filename, string? referenceText, AiRuntimeConfig config, CancellationToken ct,
        SttRecognitionMode mode = SttRecognitionMode.Unscripted)
    {
        var model = string.IsNullOrWhiteSpace(config.WhisperModel) ? "whisper-1" : config.WhisperModel.Trim();
        var verbose = SupportsVerboseJson(model);

        using var form = new MultipartFormDataContent();

        var file = new ByteArrayContent(audio);
        file.Headers.ContentType = new MediaTypeHeaderValue(MediaTypeFor(filename));
        // The endpoint routes on the file EXTENSION, not on our Content-Type guess, so the name has
        // to survive intact — an extensionless name is rejected before the audio is ever decoded.
        form.Add(file, "file", SafeFileName(filename));
        form.Add(new StringContent(model), "model");
        form.Add(new StringContent(LanguageCode), "language");
        form.Add(new StringContent(verbose ? "verbose_json" : "json"), "response_format");

        if (verbose)
        {
            // Repeated field, PHP-style brackets — that is the shape this API expects for arrays.
            form.Add(new StringContent("segment"), "timestamp_granularities[]");
            form.Add(new StringContent("word"), "timestamp_granularities[]");
        }

        using var request = new HttpRequestMessage(HttpMethod.Post, Endpoint) { Content = form };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", config.OpenAiApiKey);

        using var response = await _http.CreateClient(HttpClientName)
            .SendAsync(request, HttpCompletionOption.ResponseContentRead, ct)
            .ConfigureAwait(false);

        var body = await response.Content.ReadAsStringAsync(ct).ConfigureAwait(false);

        if (!response.IsSuccessStatusCode)
            throw new HttpRequestException(
                $"OpenAI transcription returned {(int)response.StatusCode} {response.ReasonPhrase}: {Trim(body)}");

        WhisperResponse parsed;
        try
        {
            parsed = JsonSerializer.Deserialize<WhisperResponse>(body, Json)
                     ?? throw new InvalidOperationException("OpenAI transcription returned a null JSON document.");
        }
        catch (JsonException ex)
        {
            throw new InvalidOperationException(
                $"OpenAI transcription returned unparseable JSON: {Trim(body)}", ex);
        }

        var words = MapWords(parsed);

        return new SttResult
        {
            Text = (parsed.Text ?? string.Empty).Trim(),
            Language = LanguageTag,
            Words = words,
            DurationSec = parsed.Duration ?? LastEnd(words),
            Pronunciation = null,          // see the type-level note — deliberate, not an omission
            Model = $"openai-whisper:{model}",
        };
    }

    /// <summary>
    /// Per-word timings when the API gave them, otherwise one entry per SEGMENT.
    ///
    /// <para><c>Accuracy</c> is left <c>null</c> throughout: Whisper reports no confidence per word,
    /// and the segment-level <c>avg_logprob</c> is a decoder statistic, not a measure of how well the
    /// learner pronounced anything. Mapping it into the accuracy field would put a plausible-looking
    /// number where the UI shows pronunciation feedback.</para>
    ///
    /// <para>The segment fallback stores a whole phrase in <c>Word</c>. That is coarse but honest —
    /// the timings are real — whereas splitting the phrase and spreading the span evenly across its
    /// words would invent timings that were never measured.</para>
    /// </summary>
    private static IReadOnlyList<SttWord>? MapWords(WhisperResponse parsed)
    {
        if (parsed.Words is { Count: > 0 })
            return parsed.Words
                .Select(w => new SttWord { Word = w.Word, Start = w.Start, End = w.End })
                .ToList();

        if (parsed.Segments is { Count: > 0 })
            return parsed.Segments
                .Select(s => new SttWord { Word = s.Text?.Trim(), Start = s.Start, End = s.End })
                .ToList();

        return null;
    }

    private static double? LastEnd(IReadOnlyList<SttWord>? words)
    {
        double? last = null;
        if (words is not null)
            foreach (var word in words)
                if (word.End is { } end && (last is null || end > last))
                    last = end;
        return last;
    }

    /// <summary>Only the whisper-family models accept <c>verbose_json</c>; the newer
    /// <c>gpt-4o-transcribe</c> line rejects it with a 400. An admin who pins one of those in the
    /// settings screen should lose the word timings, not the transcript.</summary>
    private static bool SupportsVerboseJson(string model)
        => model.Contains("whisper", StringComparison.OrdinalIgnoreCase);

    /// <summary>The upload needs a filename with a recognised extension. Attempt filenames are
    /// generated server-side, but a stored blob key can arrive here bare, so an extensionless name
    /// gets the extension the recorder actually produces.</summary>
    private static string SafeFileName(string filename)
    {
        var name = Path.GetFileName(filename ?? string.Empty).Trim();
        return string.IsNullOrEmpty(Path.GetExtension(name)) ? "audio.webm" : name;
    }

    private static string MediaTypeFor(string filename)
        => Path.GetExtension(filename ?? string.Empty).ToLowerInvariant() switch
        {
            ".wav" => "audio/wav",
            ".mp3" => "audio/mpeg",
            ".m4a" or ".mp4" => "audio/mp4",
            ".ogg" or ".oga" => "audio/ogg",
            ".flac" => "audio/flac",
            _ => "audio/webm",
        };

    private static string Trim(string body)
    {
        var trimmed = body.Trim();
        if (trimmed.Length == 0)
            return "(empty body)";
        return trimmed.Length <= ErrorBodyChars ? trimmed : trimmed[..ErrorBodyChars] + "…";
    }

    // ─────────────────────────── wire shapes ───────────────────────────
    // `verbose_json`; `words` only appears with timestamp_granularities[]=word, and neither array is
    // present on the plain `json` fallback.

    private sealed record WhisperResponse
    {
        public string? Text { get; init; }
        public double? Duration { get; init; }
        public IReadOnlyList<WhisperWord>? Words { get; init; }
        public IReadOnlyList<WhisperSegment>? Segments { get; init; }
    }

    private sealed record WhisperWord
    {
        public string? Word { get; init; }
        public double? Start { get; init; }
        public double? End { get; init; }
    }

    private sealed record WhisperSegment
    {
        public string? Text { get; init; }
        public double? Start { get; init; }
        public double? End { get; init; }
    }
}
