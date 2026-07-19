using Govori.Contracts;
using Govori.Platform.Stt;

namespace Govori.Guest;

/// <summary>
/// The Guest demo's behaviour (docs/07 §3.8), a faithful port of
/// <c>backend/app/api/v1/guest.py</c>. Owns the phrase pick, the STT-driven demo assessment and the
/// per-criterion score blend + rough CEFR level — all without an account and storing nothing.
///
/// <para>Thin endpoints (<see cref="GuestEndpoints"/>) call this; the scoring math lives here so it
/// can be exercised directly. Reuses the SAME <see cref="ISttProvider"/> the grading pipeline uses,
/// so the demo runs the identical Azure pronunciation assessment as the app (guest.py:4).</para>
/// </summary>
public sealed class GuestService
{
    private readonly ISttProvider _stt;

    public GuestService(ISttProvider stt) => _stt = stt;

    /// <summary>A random demo phrase (guest.py:63-65).</summary>
    public string RandomPhrase() => GuestPhrases.Demo[Random.Shared.Next(GuestPhrases.Demo.Count)];

    /// <summary>
    /// Assess a guest's spoken attempt at the phrase they were shown (guest.py:68-128). The
    /// <paramref name="phrase"/> must be one we handed out — otherwise the first demo phrase is the
    /// reference. Returns <c>null</c> when speech analysis fails (STT threw) — the endpoint maps that
    /// to 503, mirroring guest.py:81-82. The caller has already validated the audio (non-empty, size).
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
            return null; // guest.py:81-82 → 503 "Speech analysis failed, try again"
        }

        var pa = r.Pronunciation;                 // guest.py:84  pa = r.get("pronunciation") or {}
        var match = pa?.ReferenceMatch;           // guest.py:85  match = pa.get("reference_match") or {}
        var completeness = pa?.Completeness;      // guest.py:86

        // Scripted repeat: "grammar" = how completely/correctly the target was reproduced
        // (guest.py:89-91). Completeness if present, else similarity*100 from our own match.
        double? grammar = completeness
            ?? (match is not null ? match.Similarity * 100 : (double?)null);

        double? accuracy = pa?.Accuracy, fluency = pa?.Fluency, prosody = pa?.Prosody;

        // Prosody (stress + intonation) is occasionally absent — fall back to a blend so the demo
        // never shows a blank criterion (guest.py:93-96).
        double? stress = prosody ?? Blend(accuracy, fluency);
        int? intonation = prosody is not null ? Blend(prosody, fluency) : Blend(fluency, accuracy);

        var criteria = new GuestCriteria(
            Pronunciation: Round(accuracy),   // talaffuz
            Stress: Round(stress),            // urg'u
            Intonation: intonation,           // intonatsiya
            Fluency: Round(fluency),          // ravonlik
            Grammar: Round(grammar));         // grammatika

        // guest.py:104  overall = _round(pa.get("pronunciation")) or _blend(*criteria.values())
        // Python `or`: falls through when the rounded PronScore is None OR 0.
        var roundedPron = Round(pa?.Pronunciation);
        int? overall = roundedPron is null or 0
            ? Blend(criteria.Pronunciation, criteria.Stress, criteria.Intonation, criteria.Fluency, criteria.Grammar)
            : roundedPron;

        // Weakest 3 spoken words (lowest per-word accuracy < 80) as concrete errors (guest.py:106-112).
        var errors = (r.Words ?? Array.Empty<SttWord>())
            .Where(w => !string.IsNullOrEmpty(w.Word) && w.Accuracy is not null)
            .Where(w => w.Accuracy!.Value < 80)
            .OrderBy(w => w.Accuracy!.Value)
            .Take(3)
            .Select(w => new GuestWordError(w.Word!, (int)Math.Round(w.Accuracy!.Value, MidpointRounding.ToEven), w.ErrorType))
            .ToList();

        // Did they actually say the given phrase? Gate on our own content check (guest.py:114-117).
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
            Scored: pa is not null); // guest.py:127  scored = pa != {}
    }

    // ── scoring helpers (faithful ports of guest.py:39-60) ──────────────────────────────

    /// <summary>guest.py:39-40 <c>_round</c> — Python 3 <c>round()</c> is banker's rounding.</summary>
    internal static int? Round(double? v) =>
        v is null ? null : (int)Math.Round(v.Value, MidpointRounding.ToEven);

    /// <summary>guest.py:43-45 <c>_blend</c> — mean of the non-null values, banker's-rounded, or
    /// <c>null</c> when none are present.</summary>
    internal static int? Blend(params double?[] values)
    {
        var xs = values.Where(v => v is not null).Select(v => v!.Value).ToList();
        return xs.Count == 0 ? null : (int)Math.Round(xs.Average(), MidpointRounding.ToEven);
    }

    private static int? Blend(params int?[] values) =>
        Blend(values.Select(v => (double?)v).ToArray());

    /// <summary>guest.py:48-60 <c>_level</c> — rough CEFR estimate from the overall score.</summary>
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
