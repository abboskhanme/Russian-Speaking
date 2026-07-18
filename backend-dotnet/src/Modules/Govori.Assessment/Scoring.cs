namespace Govori.Assessment;

/// <summary>
/// The number every student sees. The REAL C5 scoring port (docs/07 §7.7, characterization C5) —
/// a byte-faithful port of the inline arithmetic in <c>workers/tasks.py:31-33, 239-247</c>
/// (<c>_with_pron</c> blend + orthoepy penalty). FROZEN: proven against
/// <c>tests/characterization/fixtures/pron_math_cases.json</c> by
/// <c>Govori.Characterization.AssessmentScoringPortTests</c>. Do not "improve" the math.
/// </summary>
public static class Scoring
{
    /// <summary>How hard one orthoepy slip (a word read AS SPELLED) hits the band (tasks.py:32).</summary>
    public const double OrthoepyPenaltyPerError = 4.0;

    /// <summary>Cap on the total orthoepy penalty (tasks.py:33).</summary>
    public const double OrthoepyPenaltyCap = 20.0;

    /// <summary>
    /// Fold Azure's pronunciation <c>PronScore</c> in as a 5th, equally-weighted criterion:
    /// <c>(text*4 + pron)/5</c>. When <paramref name="pronScore"/> is <c>null</c> (Whisper path —
    /// no pronunciation) the score is text-only. Port of <c>_with_pron</c> (tasks.py:241-244).
    /// </summary>
    public static double WithPron(double textScore, double? pronScore)
        => pronScore is null ? textScore : (textScore * 4 + pronScore.Value) / 5;

    /// <summary>
    /// Final band: <c>max(0, with_pron(x, pron) - min(nErrors*4, 20))</c>. Port of
    /// tasks.py:246-247 (<c>overall_band</c> / <c>level_score</c> share this formula).
    /// </summary>
    public static double Level(double textScore, double? pronScore, int orthoepyErrors)
    {
        var penalty = Math.Min(orthoepyErrors * OrthoepyPenaltyPerError, OrthoepyPenaltyCap);
        return Math.Max(0.0, WithPron(textScore, pronScore) - penalty);
    }
}
