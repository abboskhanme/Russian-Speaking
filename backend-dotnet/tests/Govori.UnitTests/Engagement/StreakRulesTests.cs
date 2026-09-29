using Govori.Contracts;

namespace Govori.UnitTests.Engagement;

/// <summary>
/// Boundary cases of <see cref="StreakRules.Effective"/> — the streak every read path now reports in
/// place of the stored <c>current_streak</c>, which only changes on the student's next XP award and
/// so kept broken streaks "alive" on the profile, the daily card and both leaderboards.
///
/// <para>The rule under test is "is the streak still continuable TODAY": practised today or
/// yesterday, or the missed days in between are covered one-for-one by freezes. The same predicate
/// (<see cref="StreakRules.SurvivesGap"/>) is what the writer, EngagementService.UpdateStreak, applies
/// when the student practises — the writer side of that is pinned by the streak test in
/// EngagementEndpointsTests.</para>
/// </summary>
public class StreakRulesTests
{
    private static readonly DateOnly Today = new(2026, 9, 29);

    [Fact]
    public void Practised_today_shows_the_stored_streak()
        => Assert.Equal(7, StreakRules.Effective(7, Today, streakFreezes: 0, Today));

    [Fact]
    public void Practised_yesterday_is_still_alive_without_any_freeze()
        => Assert.Equal(7, StreakRules.Effective(7, Today.AddDays(-1), streakFreezes: 0, Today));

    [Fact]
    public void Two_days_ago_with_no_freeze_is_broken()
        // One missed day (yesterday) and nothing to bridge it: practising today would restart at 1.
        => Assert.Equal(0, StreakRules.Effective(7, Today.AddDays(-2), streakFreezes: 0, Today));

    [Theory]
    // gap 2 = one missed day, gap 5 = four missed days: exactly as many freezes as missed days holds.
    [InlineData(2, 1)]
    [InlineData(5, 4)]
    // More freezes than needed holds too.
    [InlineData(3, 9)]
    public void A_gap_covered_by_freezes_keeps_the_streak(int gapDays, int freezes)
        => Assert.Equal(12, StreakRules.Effective(12, Today.AddDays(-gapDays), freezes, Today));

    [Theory]
    // One freeze short of the missed days breaks it.
    [InlineData(3, 1)]
    [InlineData(6, 4)]
    // The dev-DB shape the audit found: a streak weeks old.
    [InlineData(40, 2)]
    public void A_gap_the_freezes_cannot_cover_shows_zero(int gapDays, int freezes)
        => Assert.Equal(0, StreakRules.Effective(12, Today.AddDays(-gapDays), freezes, Today));

    [Fact]
    public void Reading_never_invents_a_streak_or_a_date()
    {
        // No streak stays no streak, whatever the gap.
        Assert.Equal(0, StreakRules.Effective(0, Today.AddDays(-30), streakFreezes: 0, Today));
        // No last-practice date: nothing to measure, so the stored value is returned as-is.
        Assert.Equal(3, StreakRules.Effective(3, lastPracticeDate: null, streakFreezes: 0, Today));
        // A last-practice date in the future (clock skew): the writer leaves the streak alone, so does this.
        Assert.Equal(4, StreakRules.Effective(4, Today.AddDays(2), streakFreezes: 0, Today));
    }

    [Theory]
    [InlineData(0, 0, true)]
    [InlineData(1, 0, true)]
    [InlineData(2, 0, false)]
    [InlineData(2, 1, true)]
    [InlineData(4, 2, false)]
    [InlineData(4, 3, true)]
    public void SurvivesGap_needs_one_freeze_per_missed_day(int gapDays, int freezes, bool survives)
        => Assert.Equal(survives, StreakRules.SurvivesGap(gapDays, freezes));
}
