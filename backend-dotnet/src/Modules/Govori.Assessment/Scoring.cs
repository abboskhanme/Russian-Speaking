namespace Govori.Assessment;

/// <summary>
/// The number every student sees: the C5 scoring arithmetic (docs/07 §7.7, characterization C5) —
/// the pronunciation blend plus the orthoepy penalty. FROZEN: proven against
/// <c>tests/characterization/fixtures/pron_math_cases.json</c> by
/// <c>Govori.Characterization.AssessmentScoringPortTests</c>. Do not "improve" the math — any
/// change here silently re-scores every student.
/// </summary>
public static class Scoring
{
    /// <summary>
    /// How hard one orthoepy slip (a word read AS SPELLED) hits the band. FROZEN constant.
    /// </summary>
    public const double OrthoepyPenaltyPerError = 4.0;

    /// <summary>
    /// Cap on the total orthoepy penalty, so a badly-read answer cannot be driven to zero by
    /// pronunciation slips alone. FROZEN constant.
    /// </summary>
    public const double OrthoepyPenaltyCap = 20.0;

    /// <summary>
    /// Fold Azure's pronunciation <c>PronScore</c> in as a 5th, equally-weighted criterion:
    /// <c>(text*4 + pron)/5</c>. When <paramref name="pronScore"/> is <c>null</c> (Whisper path —
    /// no pronunciation) the score is text-only, NOT text blended with a zero.
    /// </summary>
    public static double WithPron(double textScore, double? pronScore)
        => pronScore is null ? textScore : (textScore * 4 + pronScore.Value) / 5;

    /// <summary>
    /// Final band: <c>max(0, WithPron(x, pron) - min(nErrors*4, 20))</c>. The overall band and
    /// the level score share this one formula — they must never diverge.
    /// </summary>
    public static double Level(double textScore, double? pronScore, int orthoepyErrors)
    {
        var penalty = Math.Min(orthoepyErrors * OrthoepyPenaltyPerError, OrthoepyPenaltyCap);
        return Math.Max(0.0, WithPron(textScore, pronScore) - penalty);
    }
}
