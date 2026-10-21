using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Govori.Platform.Stt;

namespace Govori.Platform.Ai.Backends;

/// <summary>
/// The primary STT backend: Azure AI Speech short-audio recognition with pronunciation assessment.
/// It is first in the chain because it is the ONLY backend that returns a pronunciation score, and
/// pronunciation is a fifth of the grade (docs/07 §7.7, the C5 blend).
///
/// <para><b>Recognition is UNSCRIPTED by default — including shadowing.</b> The
/// <c>Pronunciation-Assessment</c> header below carries an EMPTY <c>ReferenceText</c> and
/// <c>EnableMiscue: false</c>. Handing Azure the target sentence would make the recogniser "hear"
/// that sentence: it biases decoding toward the script and quietly repairs exactly the mispronounced
/// and missing words this app exists to show the learner. The reference is compared afterwards, in
/// our own code (<see cref="ComputeReferenceMatch"/>).</para>
///
/// <para><b>The ONE exception is an explicit opt-in:</b> a caller passing
/// <see cref="SttRecognitionMode.Scripted"/> — today only the phoneme drill (docs/01 F2), where the
/// learner was handed one specific word and asked to say exactly that. Note carefully that the
/// switch is the MODE, never the presence of <paramref name="referenceText"/>: shadowing passes a
/// reference and must stay unscripted. See
/// <see cref="SttRecognitionMode"/> for why that distinction is written into the type system rather
/// than left to a convention.</para>
///
/// <para><b>The transcript is read from <c>Lexical</c>, never <c>Display</c>.</b> <c>Display</c> is
/// the post-processed form — punctuation restored, capitalisation applied, inverse text
/// normalisation run. Every one of those steps erases evidence of what the student actually said.
/// The whole product promise is a faithful transcript; this one field assignment is where it is kept
/// or lost.</para>
///
/// <para>Uses the REST endpoint rather than the Speech SDK deliberately: the SDK is a native-binary
/// dependency (it is why the images carry <c>libasound2</c>/<c>libssl3</c>) whose streaming session
/// model buys nothing for a request that already has the whole recording in memory. REST is one
/// POST, one response, and one place to look when it fails.</para>
/// </summary>
public sealed class AzureSpeechSttBackend : ISttBackend
{
    /// <summary>Named <see cref="HttpClient"/> the DI step configures (timeout, retry policy). Using
    /// a name rather than the default client keeps Azure's timeout independent of the grader
    /// vendors' — a slow LLM must not shorten the window an upload gets.</summary>
    public const string HttpClientName = "azure-speech";

    /// <summary>Recognition language. Fixed rather than configurable: the whole product is Russian
    /// for Uzbek speakers, and the pronunciation scores are only comparable across attempts if every
    /// attempt was assessed against the same language model.</summary>
    private const string Language = "ru-RU";

    /// <summary>Azure reports every offset and duration in 100-nanosecond ticks; the transcript
    /// stores seconds.</summary>
    private const double TicksPerSecond = 10_000_000d;

    /// <summary>Only this much of an error body reaches the exception message. Azure's failures are
    /// short JSON objects, but a misrouted request can return a full HTML error page, and a log line
    /// the size of a web page is a log line nobody reads.</summary>
    private const int ErrorBodyChars = 600;

    /// <summary>
    /// The assessment parameters, sent base64-encoded in the <c>Pronunciation-Assessment</c> header.
    ///
    /// <para><c>ReferenceText</c> is EMPTY on purpose — see the type-level note. <c>EnableMiscue</c>
    /// is <c>false</c> for the same reason: miscue detection only means anything against a script,
    /// and switching it on would require supplying one. <c>Granularity: Phoneme</c> is what produces
    /// the per-sound accuracy the learner sees on a word; <c>EnableProsodyAssessment</c> adds the
    /// intonation/stress score, which for Russian is not a nicety — stress placement changes meaning.</para>
    ///
    /// <para><b>Measured 2026-08-23:</b> Azure ignores <c>EnableProsodyAssessment</c> for
    /// <c>ru-RU</c> — no <c>ProsodyScore</c>, and no <c>PronunciationAssessment</c> aggregate at all,
    /// in either recognition mode. Prosody is documented as <c>en-US</c>-only. The flag is left on
    /// because it costs nothing and starts working the day Azure ships Russian support; nothing here
    /// may assume the field arrives.</para>
    /// </summary>
    private const string AssessmentParameters =
        """{"ReferenceText":"","GradingSystem":"HundredMark","Granularity":"Phoneme","EnableMiscue":false,"EnableProsodyAssessment":true}""";

    private static readonly string AssessmentHeader =
        Convert.ToBase64String(Encoding.UTF8.GetBytes(AssessmentParameters));

    /// <summary>
    /// The SCRIPTED variant — used only when a caller explicitly passes
    /// <see cref="SttRecognitionMode.Scripted"/>, which today is the phoneme drill alone.
    ///
    /// <para><c>EnableMiscue</c> flips to <c>true</c> here because against a real script it finally
    /// means something: Azure can distinguish a word that was mispronounced from one that was
    /// omitted or inserted, and the drill wants to tell "you said the other twin" apart from "you
    /// said nothing".</para>
    ///
    /// <para><b>What this does NOT buy, measured against the live vendor:</b> named phonemes. For
    /// <c>ru-RU</c> every <c>Phoneme</c> field comes back as an empty string in scripted mode too,
    /// under IPA and SAPI alike — Azure documents phoneme names for <c>en-US</c>/<c>zh-CN</c> only,
    /// and an identical request against <c>en-US</c> returns 14/14 named IPA symbols where
    /// <c>ru-RU</c> returns 0/11. What scripted mode DOES buy is that the per-position scores become
    /// a comparison against the intended word. The drill supplies the names itself, from its own
    /// curated content, aligned by position.</para>
    /// </summary>
    private static string ScriptedAssessmentHeader(string referenceText)
    {
        // Serialized rather than interpolated: a reference word is authored content that can contain
        // a quote or a backslash, and a hand-built JSON string would send Azure a malformed header
        // (a 400 that looks like an outage) or, worse, let content alter the other parameters.
        var json = JsonSerializer.Serialize(new
        {
            ReferenceText = referenceText,
            GradingSystem = "HundredMark",
            Granularity = "Phoneme",
            EnableMiscue = true,
            EnableProsodyAssessment = true,
        });

        return Convert.ToBase64String(Encoding.UTF8.GetBytes(json));
    }

    private static readonly JsonSerializerOptions Json = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    /// <summary>Everything that is not a word character or whitespace becomes a space before words
    /// are counted. .NET's <c>\w</c> is Unicode-aware, so Cyrillic survives — forcing ECMAScript
    /// mode here would strip it and score every Russian phrase as zero.</summary>
    private static readonly Regex Punctuation = new(@"[^\w\s]", RegexOptions.Compiled);

    private readonly IHttpClientFactory _http;

    public AzureSpeechSttBackend(IHttpClientFactory http) => _http = http;

    public string Name => AiProviders.AzureSpeech;

    public bool IsConfigured(AiRuntimeConfig config)
        => !string.IsNullOrWhiteSpace(config.AzureSpeechKey)
           && !string.IsNullOrWhiteSpace(config.AzureSpeechRegion);

    public async Task<SttResult> TranscribeAsync(
        byte[] audio, string filename, string? referenceText, AiRuntimeConfig config, CancellationToken ct,
        SttRecognitionMode mode = SttRecognitionMode.Unscripted)
    {
        // Scripted recognition needs BOTH the explicit opt-in and something to script against. A
        // caller asking for Scripted with no reference falls back to unscripted rather than sending
        // Azure an empty ReferenceText with EnableMiscue on, which scores every word as an omission.
        var scripted = mode == SttRecognitionMode.Scripted && !string.IsNullOrWhiteSpace(referenceText);
        var assessmentHeader = scripted ? ScriptedAssessmentHeader(referenceText!.Trim()) : AssessmentHeader;

        // Azure's short-audio endpoint decodes nothing: it reads the PCM we declare in Content-Type.
        // Browser recordings are webm/opus, so this is not an optimisation, it is the only way in.
        var wav = await AudioTranscode.ToAzurePcmWavAsync(audio, ct).ConfigureAwait(false);

        var url = $"https://{config.AzureSpeechRegion}.stt.speech.microsoft.com" +
                  $"/speech/recognition/conversation/cognitiveservices/v1" +
                  $"?language={Language}&format=detailed";

        using var request = new HttpRequestMessage(HttpMethod.Post, url);
        request.Headers.TryAddWithoutValidation("Ocp-Apim-Subscription-Key", config.AzureSpeechKey);
        request.Headers.TryAddWithoutValidation("Pronunciation-Assessment", assessmentHeader);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));

        var content = new ByteArrayContent(wav);
        // Added raw: `codecs=audio/pcm` contains a '/', which is not a legal unquoted HTTP parameter
        // value, so the validating setter rejects the exact string Azure documents.
        content.Headers.TryAddWithoutValidation(
            "Content-Type", $"audio/wav; codecs=audio/pcm; samplerate={AudioTranscode.TargetSampleRate}");
        request.Content = content;

        using var response = await _http.CreateClient(HttpClientName)
            .SendAsync(request, HttpCompletionOption.ResponseContentRead, ct)
            .ConfigureAwait(false);

        var body = await response.Content.ReadAsStringAsync(ct).ConfigureAwait(false);

        if (!response.IsSuccessStatusCode)
            throw new HttpRequestException(
                $"Azure Speech returned {(int)response.StatusCode} {response.ReasonPhrase}: {Trim(body)}");

        var parsed = Deserialize(body);
        var status = parsed.RecognitionStatus ?? "";

        // Silence is an ANSWER, not an outage. NoMatch / InitialSilenceTimeout / BabbleTimeout mean
        // Azure heard nothing it could turn into words, which for this app is the truthful result:
        // an empty transcript, scored accordingly. Throwing instead would fall the chain through to
        // Whisper, which hallucinates confident filler text on silence — a student who said nothing
        // would get a transcript of words they never spoke.
        if (IsNothingHeard(status))
            return Empty(referenceText);

        if (!status.Equals("Success", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException(
                $"Azure Speech recognition status '{status}' (expected Success). Body: {Trim(body)}");

        var best = parsed.NBest?.FirstOrDefault()
                   ?? throw new InvalidOperationException(
                       $"Azure Speech reported Success with no NBest hypothesis. Body: {Trim(body)}");

        // Lexical, NOT Display. See the type-level note: Display would normalise away the mistakes.
        var text = best.Lexical ?? string.Empty;

        var words = MapWords(best.Words);
        var aggregate = best.PronunciationAssessment;
        var match = ComputeReferenceMatch(text, referenceText);

        // UNSCRIPTED ASSESSMENT RETURNS A DIFFERENT SHAPE, and this cost us a live bug.
        //
        // With a reference text, Azure nests the scores under `NBest[0].PronunciationAssessment`
        // and includes PronScore / Fluency / Completeness / Prosody. With the EMPTY reference text
        // this backend deliberately sends (see the type-level note on why recognition stays
        // unscripted), it returns a single `AccuracyScore` **flattened onto `NBest[0]` itself** and
        // no wrapper object at all — the other three cannot be computed without something to
        // compare against.
        //
        // Reading only the nested shape therefore yielded null on every real submission: word
        // timings arrived, `transcripts.pronunciation` was NULL, and the C5 blend silently degraded
        // every graded answer to text-only. It passed the smoke test because silence returns no
        // scores either way — only a round-trip with real speech exposes it.
        var accuracy = aggregate?.AccuracyScore ?? best.AccuracyScore;
        var hasAnyScore = aggregate is not null || accuracy is not null;

        return new SttResult
        {
            Text = text,
            Language = Language,
            Words = words,
            DurationSec = DurationOf(words, parsed.Duration),
            // Built whenever there is anything to carry. The reference match rides inside this object,
            // so returning null because Azure omitted the aggregate would also throw away the
            // shadowing on-topic gate that decides whether the attempt earns XP.
            Pronunciation = !hasAnyScore && match is null
                ? null
                : new SttPronunciation
                {
                    Accuracy = accuracy,
                    Fluency = aggregate?.FluencyScore,
                    Completeness = aggregate?.CompletenessScore,
                    Prosody = aggregate?.ProsodyScore,
                    // PronScore first, accuracy as the fallback — see the note above `accuracy`.
                    // This is the ONE field the frozen C5 blend reads, so leaving it null when Azure
                    // did report a score silently drops pronunciation from a fifth of the grade.
                    Pronunciation = aggregate?.PronScore ?? accuracy,
                    ReferenceMatch = match,
                },
            Model = $"azure-speech:{Language}",
        };
    }

    // ─────────────────────────── response mapping ───────────────────────────

    private static AzureResponse Deserialize(string body)
    {
        try
        {
            return JsonSerializer.Deserialize<AzureResponse>(body, Json)
                   ?? throw new InvalidOperationException("Azure Speech returned a null JSON document.");
        }
        catch (JsonException ex)
        {
            throw new InvalidOperationException(
                $"Azure Speech returned a body that is not the documented `detailed` JSON: {Trim(body)}", ex);
        }
    }

    private static IReadOnlyList<SttWord>? MapWords(IReadOnlyList<AzureWord>? words)
    {
        if (words is null || words.Count == 0)
            return null;

        var mapped = new List<SttWord>(words.Count);
        foreach (var word in words)
        {
            var start = word.Offset is null ? (double?)null : word.Offset.Value / TicksPerSecond;
            var end = start is null || word.Duration is null
                ? null
                : start + word.Duration.Value / TicksPerSecond;

            mapped.Add(new SttWord
            {
                Word = word.Word,
                Start = start,
                End = end,
                // Nested first, flattened as the fallback — both shapes are real. See AzureWord:
                // the live vendor sends the flattened one, so reading only the nested shape left
                // every word score null.
                Accuracy = word.PronunciationAssessment?.AccuracyScore ?? word.AccuracyScore,
                ErrorType = word.PronunciationAssessment?.ErrorType ?? word.ErrorType,
                Phonemes = MapPhonemes(word.Phonemes),
            });
        }

        return mapped;
    }

    /// <summary>Azure has shipped the phoneme score both nested under <c>PronunciationAssessment</c>
    /// and flattened onto the phoneme itself across API revisions. Both are read so an endpoint
    /// upgrade cannot silently blank the per-sound feedback.</summary>
    private static IReadOnlyList<SttPhoneme>? MapPhonemes(IReadOnlyList<AzurePhoneme>? phonemes)
    {
        if (phonemes is null || phonemes.Count == 0)
            return null;

        var mapped = new List<SttPhoneme>(phonemes.Count);
        foreach (var phoneme in phonemes)
            mapped.Add(new SttPhoneme(
                phoneme.Phoneme,
                phoneme.PronunciationAssessment?.AccuracyScore ?? phoneme.AccuracyScore));

        return mapped;
    }

    /// <summary>Recording length: the end of the last word when we have timings (what the learner
    /// actually filled), otherwise the segment duration Azure reports.</summary>
    private static double? DurationOf(IReadOnlyList<SttWord>? words, long? ticks)
    {
        double? last = null;
        if (words is not null)
            foreach (var word in words)
                if (word.End is { } end && (last is null || end > last))
                    last = end;

        return last ?? (ticks is null ? null : ticks.Value / TicksPerSecond);
    }

    private static SttResult Empty(string? referenceText) => new()
    {
        Text = string.Empty,
        Language = Language,
        Model = $"azure-speech:{Language}",
        Pronunciation = ComputeReferenceMatch(string.Empty, referenceText) is { } match
            ? new SttPronunciation { ReferenceMatch = match }
            : null,
    };

    private static bool IsNothingHeard(string status)
        => status.Equals("NoMatch", StringComparison.OrdinalIgnoreCase)
           || status.Equals("InitialSilenceTimeout", StringComparison.OrdinalIgnoreCase)
           || status.Equals("BabbleTimeout", StringComparison.OrdinalIgnoreCase);

    private static string Trim(string body)
    {
        var trimmed = body.Trim();
        if (trimmed.Length == 0)
            return "(empty body)";
        return trimmed.Length <= ErrorBodyChars ? trimmed : trimmed[..ErrorBodyChars] + "…";
    }

    // ─────────────────────── shadowing reference match ───────────────────────

    /// <summary>
    /// How much of the shadowing target the learner actually spoke — computed HERE, from the
    /// unscripted transcript, because Azure was deliberately never told what the target was.
    ///
    /// <para>This is the C7 behaviour frozen by the characterization suite
    /// (<c>tests/characterization/fixtures/reference_match_cases.json</c>), and it is pinned rather
    /// than merely specified because <c>on_topic = completeness &gt;= 50</c> is the gate that decides
    /// whether a shadowing attempt earns XP. A simpler bag-of-words overlap would score differently
    /// on repeated words and reordered phrases, and every student's reward would shift with it. The
    /// numbers are therefore the Ratcliff–Obershelp matching-block totals:
    /// <c>completeness = matched / reference * 100</c>, <c>similarity = 2 * matched / (ref + spoken)</c>.</para>
    ///
    /// <para>Returns <c>null</c> for an empty reference: a free-speech task has no target, and a
    /// completeness of "0% of nothing" would read as a failed shadowing attempt.</para>
    /// </summary>
    private static SttReferenceMatch? ComputeReferenceMatch(string? spokenText, string? referenceText)
    {
        var reference = NormalizeWords(referenceText);
        if (reference.Count == 0)
            return null;

        var spoken = NormalizeWords(spokenText);

        var matched = TotalMatchedSize(reference, spoken);
        var completeness = Math.Round(matched / (double)reference.Count * 100, 1, MidpointRounding.ToEven);
        var total = reference.Count + spoken.Count;
        var similarity = Math.Round(
            total == 0 ? 1.0 : 2.0 * matched / total, 3, MidpointRounding.ToEven);

        return new SttReferenceMatch(
            Completeness: completeness,
            Similarity: similarity,
            MatchedWords: matched,
            ReferenceWords: reference.Count,
            SpokenWords: spoken.Count,
            OnTopic: completeness >= 50.0);
    }

    /// <summary>Lowercase → fold <c>ё</c> onto <c>е</c> → punctuation to spaces → split. The <c>ё</c>
    /// fold is the one addition to the pinned normalisation: Russian is written both ways, Azure
    /// picks one, and the teacher who typed the reference picked the other, so without it a perfectly
    /// spoken "всё" scores as a miss against the reference "все".</summary>
    private static List<string> NormalizeWords(string? text)
    {
        var lowered = (text ?? string.Empty).ToLowerInvariant().Replace('ё', 'е');
        return Punctuation.Replace(lowered, " ")
            .Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries)
            .ToList();
    }

    /// <summary>Total size of all matching blocks: take the longest common run, then recurse into
    /// what is left of it and what is right of it. Only the SUM is used and the recursion order does
    /// not change it, so the usual sort/merge/sentinel pass over the block list is skipped.</summary>
    private static int TotalMatchedSize(IReadOnlyList<string> a, IReadOnlyList<string> b)
    {
        var index = new Dictionary<string, List<int>>();
        for (var j = 0; j < b.Count; j++)
        {
            if (!index.TryGetValue(b[j], out var positions))
                index[b[j]] = positions = new List<int>();
            positions.Add(j);
        }

        var matched = 0;
        var pending = new Stack<(int ALo, int AHi, int BLo, int BHi)>();
        pending.Push((0, a.Count, 0, b.Count));

        while (pending.Count > 0)
        {
            var (aLo, aHi, bLo, bHi) = pending.Pop();
            var (i, j, size) = LongestMatch(a, b, index, aLo, aHi, bLo, bHi);
            if (size <= 0)
                continue;

            matched += size;
            if (aLo < i && bLo < j)
                pending.Push((aLo, i, bLo, j));
            if (i + size < aHi && j + size < bHi)
                pending.Push((i + size, aHi, j + size, bHi));
        }

        return matched;
    }

    /// <summary>Longest matching block in <c>a[aLo..aHi]</c> against <c>b[bLo..bHi]</c>, no junk
    /// heuristic. The tie-break — smallest <c>i</c>, then smallest <c>j</c> — is carried by the STRICT
    /// <c>size &gt; best</c> comparison plus the ascending index order; relaxing either to <c>&gt;=</c>
    /// silently selects a different block and shifts the score.</summary>
    private static (int I, int J, int Size) LongestMatch(
        IReadOnlyList<string> a, IReadOnlyList<string> b,
        Dictionary<string, List<int>> index,
        int aLo, int aHi, int bLo, int bHi)
    {
        int bestI = aLo, bestJ = bLo, bestSize = 0;
        var runs = new Dictionary<int, int>();

        for (var i = aLo; i < aHi; i++)
        {
            var next = new Dictionary<int, int>();
            if (index.TryGetValue(a[i], out var positions))
            {
                foreach (var j in positions)          // ascending
                {
                    if (j < bLo) continue;
                    if (j >= bHi) break;

                    var size = (runs.TryGetValue(j - 1, out var previous) ? previous : 0) + 1;
                    next[j] = size;
                    if (size > bestSize)
                        (bestI, bestJ, bestSize) = (i - size + 1, j - size + 1, size);
                }
            }
            runs = next;
        }

        while (bestI > aLo && bestJ > bLo && a[bestI - 1] == b[bestJ - 1])
            (bestI, bestJ, bestSize) = (bestI - 1, bestJ - 1, bestSize + 1);

        while (bestI + bestSize < aHi && bestJ + bestSize < bHi
               && a[bestI + bestSize] == b[bestJ + bestSize])
            bestSize++;

        return (bestI, bestJ, bestSize);
    }

    // ─────────────────────────── wire shapes ───────────────────────────
    // `format=detailed` only. `Display` is intentionally absent from these records: a field that does
    // not exist cannot be assigned to Text by mistake.

    private sealed record AzureResponse
    {
        public string? RecognitionStatus { get; init; }
        public long? Duration { get; init; }
        public IReadOnlyList<AzureNBest>? NBest { get; init; }
    }

    private sealed record AzureNBest
    {
        public string? Lexical { get; init; }

        /// <summary>Present only for SCRIPTED assessment (non-empty reference text). Unscripted
        /// recognition omits it entirely and flattens the one score it can compute onto
        /// <see cref="AccuracyScore"/> below.</summary>
        public AzureAggregate? PronunciationAssessment { get; init; }

        /// <summary>The flattened unscripted accuracy score. Deliberately NOT folded into
        /// <see cref="AzureAggregate"/>: it sits at a different level of the response, and pretending
        /// otherwise is what made the nested-only mapping look correct while returning null.</summary>
        public double? AccuracyScore { get; init; }

        public IReadOnlyList<AzureWord>? Words { get; init; }
    }

    private sealed record AzureAggregate
    {
        public double? AccuracyScore { get; init; }
        public double? FluencyScore { get; init; }
        public double? CompletenessScore { get; init; }
        public double? ProsodyScore { get; init; }
        public double? PronScore { get; init; }
    }

    private sealed record AzureWord
    {
        public string? Word { get; init; }
        public long? Offset { get; init; }
        public long? Duration { get; init; }
        public AzureWordAssessment? PronunciationAssessment { get; init; }

        /// <summary>The FLATTENED word accuracy — the same shape problem the NBest level has, one
        /// level down, and it was silently costing every word score. Measured against the live
        /// vendor: <c>"Word":"мышка","Offset":…,"AccuracyScore":49.0,"Phonemes":[…]</c> — no
        /// <c>PronunciationAssessment</c> wrapper anywhere in the response, so reading only the
        /// nested shape yielded null for every word of every attempt.</summary>
        public double? AccuracyScore { get; init; }

        /// <summary>Flattened miscue label, for the same reason as <see cref="AccuracyScore"/>.</summary>
        public string? ErrorType { get; init; }

        public IReadOnlyList<AzurePhoneme>? Phonemes { get; init; }
    }

    private sealed record AzureWordAssessment
    {
        public double? AccuracyScore { get; init; }

        /// <summary>Azure's own miscue label (<c>None</c>, <c>Mispronunciation</c>, <c>Omission</c>,
        /// <c>Insertion</c>). Unscripted recognition can only ever report <c>None</c> or
        /// <c>Mispronunciation</c> — omissions and insertions need a script, and we never send one.</summary>
        public string? ErrorType { get; init; }
    }

    private sealed record AzurePhoneme
    {
        public string? Phoneme { get; init; }
        public double? AccuracyScore { get; init; }
        public AzureWordAssessment? PronunciationAssessment { get; init; }
    }
}
