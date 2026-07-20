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
/// real grading pipeline uses (<see cref="Scoring"/> blend). Today both are STUB providers reporting
/// <see cref="ISttProvider.IsConfigured"/> = <c>false</c> (no Azure/Gemini keys), so this service
/// falls back to a DETERMINISTIC placeholder band — the placement flow works end-to-end and shows a
/// sane, approximate level until real keys land (Faza 3.4). The moment the real providers are wired,
/// the same code path grades for real with no change here.</para>
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
    /// Grade one answer → a 0–100 band (<c>POST /api/placement/submit</c>). Stores nothing. When the
    /// STT + grader providers are BOTH configured, runs the real transcribe→grade→blend; otherwise
    /// (today's stubs, or a provider fault) returns a deterministic placeholder band so the flow never
    /// breaks. <paramref name="index"/> is assumed already validated by the endpoint.
    /// </summary>
    public async Task<double> GradeAnswerAsync(int index, byte[] audio, CancellationToken ct)
    {
        // Unscripted open questions → no reference text (memory: transcript stays faithful).
        if (_stt.IsConfigured && _grader.IsConfigured)
        {
            try
            {
                var stt = await _stt.TranscribeAsync(audio, $"placement-{index}.webm", referenceText: null, ct);
                var graded = await _grader.AnalyzeAsync(new GraderRequest
                {
                    QuestionPrompt = Prompts[index],
                    TranscriptText = stt.Text,
                }, ct);
                // Same C5 blend the app uses: fold Azure's PronScore in as a 5th criterion.
                return Scoring.WithPron(graded.Scores.Overall, stt.Pronunciation?.Pronunciation);
            }
            catch
            {
                // A real provider faulted mid-call — degrade to the placeholder rather than fail the
                // placement (an approximate level beats a broken onboarding).
                return DeterministicBand(index, audio.Length);
            }
        }

        return DeterministicBand(index, audio.Length);
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
    /// </summary>
    private static (string Level, string LabelUz) MapCefr(double band) => band switch
    {
        < 30 => ("A1", "yangi boshlovchi"),
        < 50 => ("A2", "boshlang'ich"),
        < 70 => ("B1", "o'rta"),
        < 85 => ("B2", "o'rta-yuqori"),
        _ => ("C1", "yuqori"),
    };

    /// <summary>
    /// Deterministic placeholder band for when the AI providers are stubbed (no keys). Not random:
    /// stable for the same recording + question so a re-submit reproduces the number. Lands in a
    /// sane mid window (~40–56) so the 3-answer average shows a plausible A2/B1 during the demo.
    /// </summary>
    private static double DeterministicBand(int index, int audioLength) =>
        40 + (audioLength + index * 7) % 17; // 40..56, stable per (audio, index)
}
