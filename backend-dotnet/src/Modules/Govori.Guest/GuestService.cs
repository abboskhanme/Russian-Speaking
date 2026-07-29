using Govori.Contracts;
using Govori.Platform.Stt;

namespace Govori.Guest;

/// <summary>
/// The Guest demo's behaviour (docs/07 §3.8). Owns the phrase pick, the STT-driven demo assessment
/// and the per-criterion score blend + rough CEFR level — all without an account and storing nothing.
///
/// <para>Thin endpoints (<see cref="GuestEndpoints"/>) call this; the scoring math lives here so it
/// can be exercised directly. Reuses the SAME <see cref="ISttProvider"/> the grading pipeline uses,
/// so the demo scores a visitor with the identical Azure pronunciation assessment the app runs for
/// signed-in students.</para>
/// </summary>
public sealed class GuestService
{
    private readonly ISttProvider _stt;

    public GuestService(ISttProvider stt) => _stt = stt;

    /// <summary>A random phrase from the demo pool, so a visitor isn't shown the same sentence
    /// on every visit.</summary>
    public string RandomPhrase() => GuestPhrases.Demo[Random.Shared.Next(GuestPhrases.Demo.Count)];

    /// <summary>
    /// Assess a guest's spoken attempt at the phrase they were shown. The <paramref name="phrase"/>
    /// must be one we handed out — otherwise the first demo phrase is used as the reference, so a
    /// caller can't have arbitrary text scored. Returns <c>null</c> when speech analysis fails (STT
    /// threw); the endpoint maps that to 503. The caller has already validated the audio (non-empty,
    /// within the size cap).
    /// </summary>
    public async Task<GuestAssessResponse?> AssessAsync(byte[] audio, string? phrase, CancellationToken ct)
    {
        var reference = phrase is not null && GuestPhrases.Demo.Contains(phrase)
            ? phrase
            : GuestPhrases.Demo[0];

        SttResult r;
        try
        {
            r = await _stt.TranscribeAsync(audio, "demo.webm", reference, ct);
        }
        catch
        {
            return null; // the endpoint turns this into 503 "Speech analysis failed, try again"
        }

        // Every pronunciation field is optional: STT may return no assessment block at all.
        var pa = r.Pronunciation;
        var match = pa?.ReferenceMatch;
        var completeness = pa?.Completeness;

        // Scripted repeat: "grammar" here means how completely/correctly the target was reproduced.
        // Completeness if present, else similarity*100 from our own reference match.
        double? grammar = completeness
            ?? (match is not null ? match.Similarity * 100 : (double?)null);

        double? accuracy = pa?.Accuracy, fluency = pa?.Fluency, prosody = pa?.Prosody;

        // Prosody (stress + intonation) is occasionally absent — fall back to a blend so the demo
        // never shows a blank criterion.
        double? stress = prosody ?? Blend(accuracy, fluency);
        int? intonation = prosody is not null ? Blend(prosody, fluency) : Blend(fluency, accuracy);

        var criteria = new GuestCriteria(
            Pronunciation: Round(accuracy),   // talaffuz
            Stress: Round(stress),            // urg'u
            Intonation: intonation,           // intonatsiya
            Fluency: Round(fluency),          // ravonlik
            Grammar: Round(grammar));         // grammatika

        // Overall = the provider's own PronScore when it gave a usable one. A missing score AND a
        // rounded 0 both fall through to the blend of the five criteria — a hard 0 here means the
        // provider declined to score, not that the speaker earned zero.
        var roundedPron = Round(pa?.Pronunciation);
        int? overall = roundedPron is null or 0
            ? Blend(criteria.Pronunciation, criteria.Stress, criteria.Intonation, criteria.Fluency, criteria.Grammar)
            : roundedPron;

        // Weakest 3 spoken words (lowest per-word accuracy < 80) as concrete errors to show back.
        var errors = (r.Words ?? Array.Empty<SttWord>())
            .Where(w => !string.IsNullOrEmpty(w.Word) && w.Accuracy is not null)
            .Where(w => w.Accuracy!.Value < 80)
            .OrderBy(w => w.Accuracy!.Value)
            .Take(3)
            .Select(w => new GuestWordError(w.Word!, (int)Math.Round(w.Accuracy!.Value, MidpointRounding.ToEven), w.ErrorType))
            .ToList();

        // Did they actually say the given phrase? Gate on our own content check, defaulting to
        // "off topic" when the match block is missing.
        var onTopic = match?.OnTopic ?? false;

        return new GuestAssessResponse(
            Transcript: r.Text,
            Phrase: reference,
            Overall: overall,
            Criteria: criteria,
            Errors: errors,
            Level: Level(overall),
            OnTopic: onTopic,
            Completeness: Round(completeness),
            Scored: pa is not null); // false ⇒ transcript only, the UI must not show scores
    }

    // ── scoring helpers ────────────────────────────────────────────────────────────────

    /// <summary>Round a score to a whole number, propagating <c>null</c>. Uses banker's rounding
    /// (halves to even) so displayed scores stay stable against the stored values.</summary>
    internal static int? Round(double? v) =>
        v is null ? null : (int)Math.Round(v.Value, MidpointRounding.ToEven);

    /// <summary>Mean of the non-null values, banker's-rounded, or <c>null</c> when none are
    /// present. Used to fill a criterion the provider didn't report.</summary>
    internal static int? Blend(params double?[] values)
    {
        var xs = values.Where(v => v is not null).Select(v => v!.Value).ToList();
        return xs.Count == 0 ? null : (int)Math.Round(xs.Average(), MidpointRounding.ToEven);
    }

    private static int? Blend(params int?[] values) =>
        Blend(values.Select(v => (double?)v).ToArray());

    /// <summary>Rough CEFR estimate from the overall score. An unscored attempt shows A1 rather
    /// than nothing, so the demo always ends on a level.</summary>
    internal static string Level(int? overall) => overall switch
    {
        null => "A1",
        < 45 => "A0",
        < 60 => "A1",
        < 72 => "A1+",
        < 85 => "A2",
        _ => "B1",
    };
}
