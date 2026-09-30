using Govori.Contracts;
using Govori.Platform.Grader;
using Govori.Platform.Stt;

namespace Govori.Assessment;

/// <summary>
/// The placement test ("dastlabki sinov") behaviour — a one-time, post-register flow that asks a new
/// student 3 short Russian questions and estimates their CEFR level (owner mockup frames A2/A3). It
/// is deliberately tiny and STATELESS: the 3 questions are hardcoded (no DB), each answer is graded
/// and thrown away (nothing persisted per answer), and the level is computed by averaging the 3 bands
/// the client collected.
///
/// <para>Grading reuses the SAME <see cref="ISttProvider"/> + <see cref="IGraderProvider"/> seams the
/// real grading pipeline uses (<see cref="Scoring"/> blend).</para>
///
/// <para><b>No answer is ever invented.</b> When the providers are not configured, or one fails
/// mid-call, <see cref="GradeAnswerAsync"/> returns <c>null</c> and the endpoints answer 503
/// <c>placement_unavailable</c>. This service used to return a "deterministic placeholder band"
/// (40–56, derived from the recording's byte length) in both cases, which the screen then presented
/// as the student's measured level — an A2 or B1 made of file size, on the first screen a new
/// student sees, and a number they would carry into choosing what to practise. A test that cannot
/// be scored right now says so, and the student can retry or skip it.</para>
/// </summary>
public sealed class PlacementService
{
    private readonly ISttProvider _stt;
    private readonly IGraderProvider _grader;

    public PlacementService(ISttProvider stt, IGraderProvider grader)
    {
        _stt = stt;
        _grader = grader;
    }

    /// <summary>The 3 fixed Russian placement prompts (mockup frame A2, "1-savol"). A1→B1 friendly
    /// open questions so any new student can say a couple of sentences (~2 min total).</summary>
    private static readonly string[] Prompts =
    {
        "Расскажите о себе. Кто вы и чем занимаетесь?",
        "Опишите свой обычный день. Что вы делаете утром, днём и вечером?",
        "Расскажите о своих планах на будущее. Кем вы хотите стать?",
    };

    /// <summary>Number of placement questions (the client renders "N / 3-savol" progress).</summary>
    public static int QuestionCount => Prompts.Length;

    /// <summary>The ordered placement questions for <c>GET /api/placement/questions</c>.</summary>
    public IReadOnlyList<PlacementQuestionResponse> Questions() =>
        Prompts.Select((p, i) => new PlacementQuestionResponse(i, p)).ToArray();

    /// <summary>True when <paramref name="index"/> addresses a real placement question.</summary>
    public static bool IsValidIndex(int index) => index >= 0 && index < Prompts.Length;

    /// <summary>
    /// Grade one answer → a 0–100 band (<c>POST /api/placement/submit</c>). Stores nothing. Runs the
    /// real transcribe→grade→blend, and returns <c>null</c> — never a made-up band — when STT or the
    /// grader is not configured or a vendor call fails. <paramref name="index"/> is assumed already
    /// validated by the endpoint. A cancelled request is not a vendor failure and propagates.
    /// </summary>
    public async Task<double?> GradeAnswerAsync(int index, byte[] audio, CancellationToken ct)
    {
        if (!await _stt.IsConfiguredAsync(ct) || !await _grader.IsConfiguredAsync(ct))
            return null;

        try
        {
            // Unscripted open questions → no reference text (memory: transcript stays faithful).
            var stt = await _stt.TranscribeAsync(audio, $"placement-{index}.webm", referenceText: null, ct);
            var graded = await _grader.AnalyzeAsync(new GraderRequest
            {
                QuestionPrompt = Prompts[index],
                TranscriptText = stt.Text,
            }, ct);
            // Same C5 blend the app uses: fold Azure's PronScore in as a 5th criterion.
            return Scoring.WithPron(graded.Scores.Overall, stt.Pronunciation?.Pronunciation);
        }
        catch (Exception) when (!ct.IsCancellationRequested)
        {
            return null;
        }
    }

    /// <summary>
    /// Average the collected per-answer bands → CEFR level + Uzbek label (<c>POST
    /// /api/placement/complete</c>). Ignores nothing — an empty list yields band 0 (→ A1) so the
    /// caller always gets a valid result.
    /// </summary>
    public static PlacementResultResponse Complete(IReadOnlyList<double> bands)
    {
        var band = bands is { Count: > 0 } ? bands.Average() : 0.0;
        var rounded = Math.Round(band, MidpointRounding.AwayFromZero);
        var (level, label) = MapCefr(rounded);
        return new PlacementResultResponse(level, label, rounded);
    }

    /// <summary>
    /// CEFR bucket + short Uzbek label from a 0–100 band. Thresholds tuned so a mid-range placement
    /// (~45) reads A2 · "boshlang'ich" exactly like the mockup, and higher bands climb sanely.
    ///
    /// <para>The thresholds themselves now live in <see cref="CefrScale"/> (Govori.Contracts) so
    /// <c>GET /api/auth/me</c> and the Profile slice can derive the SAME level without an illegal
    /// Identity→Assessment module edge. Behaviour is unchanged — this is a pure delegation, and the
    /// buckets exist in exactly one place, so they cannot drift.</para>
    /// </summary>
    private static (string Level, string LabelUz) MapCefr(double band) => CefrScale.FromBand(band);
}
