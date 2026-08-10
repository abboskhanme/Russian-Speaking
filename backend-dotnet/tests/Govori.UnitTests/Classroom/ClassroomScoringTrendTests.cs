using Govori.Classroom;
using Govori.Infrastructure.Entities;

namespace Govori.UnitTests.Classroom;

/// <summary>
/// <see cref="ClassroomScoring.TrendDelta"/> — the per-student direction behind the A4 roster's ↑/↓
/// arrow and the A1 Obzor's "N o'quvchi ball tushirdi" card.
///
/// <para>These are the rules a teacher's screen depends on, so they are pinned rather than left to
/// the implementation: too few answers is NO direction (not a flat one), the middle answer of an odd
/// count belongs to neither half, and a teacher's manual band wins here exactly as it wins in
/// <c>avg_band</c>.</para>
///
/// <para>The FROZEN scoring definitions (<c>RollingAvg</c>/<c>BestBand</c>) are not retested here —
/// they stay pinned by the C3 characterization fixture.</para>
/// </summary>
public sealed class ClassroomScoringTrendTests
{
    // Oldest first in the argument list, which is how a reader thinks about a trend; the helper
    // reverses into the newest-first order the production code sorts by.
    private static List<Submission> Answers(params double?[] bandsOldestFirst)
    {
        var start = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        return bandsOldestFirst
            .Select((band, i) => new Submission
            {
                Id = Guid.NewGuid(),
                StudentId = Guid.Empty,
                AudioKey = $"a{i}.webm",
                CreatedAt = start.AddDays(i),
                Evaluation = band is null
                    ? null
                    : new Evaluation { OverallBand = band.Value, LevelScore = band.Value },
            })
            .ToList();
    }

    [Fact]
    public void Under_four_graded_answers_there_is_no_direction()
    {
        // Three answers climbing hard still yields null: one answer per half is noise, not a trend,
        // and an arrow drawn from it would be a claim the data cannot support.
        Assert.Null(ClassroomScoring.TrendDelta(Answers(40, 60, 80)));
        Assert.Null(ClassroomScoring.TrendDelta(Answers(50)));
        Assert.Null(ClassroomScoring.TrendDelta([]));
    }

    [Fact]
    public void Four_answers_compare_the_newer_pair_against_the_older_pair()
    {
        // (70+80)/2 - (40+50)/2 = 75 - 45 = 30
        Assert.Equal(30, ClassroomScoring.TrendDelta(Answers(40, 50, 70, 80)));
        // Symmetric on the way down.
        Assert.Equal(-30, ClassroomScoring.TrendDelta(Answers(70, 80, 40, 50)));
    }

    [Fact]
    public void An_odd_count_drops_the_middle_answer_rather_than_double_counting_it()
    {
        // Halves are (20,20) and (80,80) → +60. Counting the middle 50 on BOTH sides would pull the
        // means together and report +40, flattening a trend that is really steeper.
        Assert.Equal(60, ClassroomScoring.TrendDelta(Answers(20, 20, 50, 80, 80)));
    }

    [Fact]
    public void Ungraded_answers_are_skipped_not_treated_as_zero()
    {
        // The two nulls are invisible; the graded four are compared as if adjacent. A null folded in
        // as 0 would report a catastrophic drop for a student who simply has an answer still in the
        // queue.
        Assert.Equal(30, ClassroomScoring.TrendDelta(Answers(40, null, 50, 70, null, 80)));
    }

    [Fact]
    public void A_teacher_band_overrides_the_ai_here_exactly_as_it_does_in_avg_band()
    {
        var subs = Answers(40, 50, 70, 80);
        // The newest answer was AI-scored 80; the teacher marked it 20.
        subs[3].TeacherBand = 20;
        // (70+20)/2 - (40+50)/2 = 45 - 45 = 0
        Assert.Equal(0, ClassroomScoring.TrendDelta(subs));
    }

    [Fact]
    public void Only_the_recent_window_counts_so_old_answers_cannot_freeze_the_trend()
    {
        // Ten terrible answers followed by ten excellent ones: the window keeps only the newest ten,
        // which are all excellent and flat, so the direction is 0 — not a huge rise dragged in from
        // history the student has long since moved past.
        var bands = new double?[10].Select(_ => (double?)10)
            .Concat(new double?[10].Select(_ => (double?)90))
            .ToArray();
        Assert.Equal(0, ClassroomScoring.TrendDelta(Answers(bands)));
    }
}
