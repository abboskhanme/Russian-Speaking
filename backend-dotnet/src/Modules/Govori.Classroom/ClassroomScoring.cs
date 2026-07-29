using Govori.Infrastructure.Entities;

namespace Govori.Classroom;

/// <summary>
/// The canonical student progress score (C3) — <see cref="EffectiveBand"/> /
/// <see cref="RollingAvg"/> / <see cref="BestBand"/>. This is the number every student and teacher
/// sees, so the gradebook (<c>avg_band</c>/<c>best_band</c>) and each assignment's
/// <c>overall_band</c> must compute it identically. The logic is frozen by the C3 fixture
/// (<c>tests/characterization/fixtures/scoring_cases.json</c>, driven by
/// <c>Govori.Characterization.ProgressCharacterizationTests</c>) — this production code must keep
/// matching it exactly. Do not "improve" the math.
///
/// <para>Requires <see cref="Submission.Evaluation"/> to be LOADED on each submission (the caller
/// eager-loads it); a submission whose evaluation was not loaded is treated as ungraded (band =
/// null), so callers MUST include it.</para>
/// </summary>
public static class ClassroomScoring
{
    /// <summary>Recent-window size (10) — must stay in sync with the frontend's <c>LEVEL_WINDOW</c>
    /// so student and teacher always see the identical number.</summary>
    public const int RecentWindow = 10;

    /// <summary>
    /// One answer's single 0..100 score, or <c>null</c> when it isn't graded yet:
    /// a teacher's manual override wins (<b>0.0 counts</b> — an <c>is not null</c> check, not
    /// truthiness), else the level-relative AI score, else the legacy absolute band.
    /// </summary>
    public static double? EffectiveBand(Submission s)
    {
        if (s.TeacherBand is not null) return s.TeacherBand;      // 0.0 must win
        var ev = s.Evaluation;
        if (ev is null) return null;                             // not graded
        return ev.LevelScore ?? ev.OverallBand;                  // level-relative, else legacy band
    }

    // Effective bands of the graded answers, newest first. OrderByDescending is a STABLE sort, so
    // answers sharing a created_at keep the relative order they arrived in.
    private static List<double> GradedDesc(IEnumerable<Submission> subs)
        => subs.Select(s => (s.CreatedAt, Band: EffectiveBand(s)))
               .Where(x => x.Band is not null)
               .OrderByDescending(x => x.CreatedAt)
               .Select(x => x.Band!.Value)
               .ToList();

    /// <summary>Stable headline score: mean of the most recent <paramref name="window"/> graded
    /// answers, half-to-even to 2 dp. <c>null</c> when nothing is graded.</summary>
    public static double? RollingAvg(IEnumerable<Submission> subs, int window = RecentWindow)
    {
        var bands = GradedDesc(subs).Take(window).ToList();
        return bands.Count == 0 ? null : Math.Round(bands.Sum() / bands.Count, 2, MidpointRounding.ToEven);
    }

    /// <summary>Best single answer the student ever produced, half-to-even to 2 dp. <c>null</c> when
    /// nothing is graded.</summary>
    public static double? BestBand(IEnumerable<Submission> subs)
    {
        var bands = GradedDesc(subs);
        return bands.Count == 0 ? null : Math.Round(bands.Max(), 2, MidpointRounding.ToEven);
    }
}
