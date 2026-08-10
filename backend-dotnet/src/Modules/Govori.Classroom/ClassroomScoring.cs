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

    /// <summary>
    /// The very answers <see cref="RollingAvg"/> averages — graded, newest first, capped at the same
    /// window. Exists so a caller that needs more than the mean (the gradebook's per-skill columns
    /// read each answer's <c>Evaluation</c>) describes the SAME set of answers as <c>avg_band</c>
    /// instead of re-deriving a window that could drift out of sync. Reads the frozen definition; it
    /// does not change it.
    /// </summary>
    public static List<Submission> RecentGraded(IEnumerable<Submission> subs, int window = RecentWindow)
        => subs.Where(s => EffectiveBand(s) is not null)
               .OrderByDescending(s => s.CreatedAt)              // stable, like GradedDesc
               .Take(window)
               .ToList();

    /// <summary>Fewest graded answers a trend may be computed from — 2 per half, so a single answer
    /// can never be called a direction.</summary>
    public const int MinTrendSample = 4;

    /// <summary>
    /// Which way this student is moving: the mean of the NEWER half of their recent graded answers
    /// minus the mean of the OLDER half, half-to-even to 2 dp. Positive = improving.
    ///
    /// <para>The window is split rather than fixed at "last N vs the N before" because a fixed split
    /// needs twice <see cref="RecentWindow"/> answers before it says anything at all, and most
    /// students here have well under twenty. Splitting what they DO have means a student with six
    /// answers gets a real 3-vs-3 comparison.</para>
    ///
    /// <para><c>null</c> below <see cref="MinTrendSample"/> graded answers, and on an odd count the
    /// MIDDLE answer is dropped rather than counted on both sides — it would otherwise pull both
    /// means toward each other and flatten every trend.</para>
    ///
    /// <para>This is a different statistic from <see cref="RollingAvg"/> and deliberately so: one says
    /// where the student is, the other which way they are going. Callers must not present the delta
    /// as the difference between two <c>avg_band</c> values.</para>
    /// </summary>
    public static double? TrendDelta(IEnumerable<Submission> subs, int window = RecentWindow)
    {
        // Newest first, then reversed so the halves read oldest → newest.
        var bands = RecentGraded(subs, window)
            .Select(s => EffectiveBand(s)!.Value)
            .Reverse()
            .ToList();
        if (bands.Count < MinTrendSample) return null;

        var half = bands.Count / 2;
        var older = bands.Take(half).ToList();
        var newer = bands.Skip(bands.Count - half).ToList();   // skips the middle on an odd count
        return Math.Round(
            newer.Sum() / newer.Count - older.Sum() / older.Count,
            2, MidpointRounding.ToEven);
    }

    /// <summary>Mean of the values that are present, half-to-even to 2 dp; <c>null</c> when none are.
    /// The nullable input is the point: a missing score (an ungraded skill) must be SKIPPED, never
    /// folded in as a zero that drags the mean down.</summary>
    public static double? MeanOrNull(IEnumerable<double?> values)
    {
        var present = values.Where(v => v is not null).Select(v => v!.Value).ToList();
        return present.Count == 0 ? null : Math.Round(present.Sum() / present.Count, 2, MidpointRounding.ToEven);
    }
}
