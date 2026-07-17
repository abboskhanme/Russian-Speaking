using Xunit;

namespace Govori.Characterization;

/// <summary>
/// C3 — the score numbers every student and teacher sees.
/// Ported from services/scoring.py:26-55 (effective_band / rolling_avg / best_band).
///
/// These are pure functions of the Submission rows handed to them, so the
/// fixture was produced by feeding the REAL Python functions duck-typed
/// stand-ins. The C# below is an independent reimplementation checked against
/// that fixture; the port's real scoring code will later be checked against the
/// same file.
///
/// Traps this pins down:
///  - teacher_band == 0 must WIN (the `is not None` check, not truthiness).
///  - level_score present → used; else fall back to overall_band (legacy rows).
///  - rolling_avg averages only the newest `window` graded answers, newest-first,
///    with ties in created_at resolved by a STABLE sort (original order kept).
///  - rounding is half-to-even to 2 decimals (74.125 → 74.12).
/// </summary>
public class ProgressCharacterizationTests
{
    private static readonly ScoringFixture Fx = Fixtures.Load<ScoringFixture>("scoring_cases.json");

    // scoring.py:26-35 — one answer's 0..100 number, or null if ungraded.
    private static double? EffectiveBand(ScoringSubmission s)
    {
        if (s.TeacherBand is not null) return s.TeacherBand;      // 0.0 wins here
        if (!s.HasEvaluation) return null;                        // evaluation is None
        return s.LevelScore ?? s.OverallBand;                     // level-relative, else legacy band
    }

    // scoring.py:38-43 — effective bands of graded answers, newest first.
    // LINQ OrderByDescending is a STABLE sort, matching Python's list.sort(reverse=True):
    // equal created_at keeps the original list order.
    private static List<double> GradedDesc(IEnumerable<ScoringSubmission> subs)
        => subs.Select(s => (s.CreatedAt, Band: EffectiveBand(s)))
               .Where(x => x.Band is not null)
               .OrderByDescending(x => x.CreatedAt)
               .Select(x => x.Band!.Value)
               .ToList();

    private static double? RollingAvg(IEnumerable<ScoringSubmission> subs, int window)
    {
        var bands = GradedDesc(subs).Take(window).ToList();
        return bands.Count == 0 ? null : Math.Round(bands.Sum() / bands.Count, 2, MidpointRounding.ToEven);
    }

    private static double? BestBand(IEnumerable<ScoringSubmission> subs)
    {
        var bands = GradedDesc(subs);
        return bands.Count == 0 ? null : Math.Round(bands.Max(), 2, MidpointRounding.ToEven);
    }

    [Fact]
    public void Recent_window_is_ten()
    {
        Assert.Equal(10, Fx.RecentWindow);
        Assert.NotEmpty(Fx.Cases);
    }

    [Fact]
    public void Effective_band_matches_Python_per_answer()
    {
        foreach (var scenario in Fx.Cases)
            foreach (var s in scenario.Submissions)
                Assert.Equal(s.EffectiveBand, EffectiveBand(s));
    }

    [Fact]
    public void Rolling_avg_and_best_band_match_Python()
    {
        foreach (var s in Fx.Cases)
        {
            AssertNullableEqual(s.RollingAvg, RollingAvg(s.Submissions, s.Window),
                $"rolling_avg mismatch in scenario '{s.Name}'");
            AssertNullableEqual(s.BestBand, BestBand(s.Submissions),
                $"best_band mismatch in scenario '{s.Name}'");
        }
    }

    private static void AssertNullableEqual(double? expected, double? actual, string message)
    {
        if (expected is null || actual is null)
        {
            Assert.True(expected is null && actual is null, $"{message}: expected {expected?.ToString() ?? "null"}, got {actual?.ToString() ?? "null"}");
            return;
        }
        Assert.True(Math.Abs(expected.Value - actual.Value) < 1e-9,
            $"{message}: expected {expected.Value}, got {actual.Value}");
    }
}
