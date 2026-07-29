using Govori.Contracts;
using Govori.Identity;

namespace Govori.UnitTests.Profile;

/// <summary>
/// Drives the pure 21-badge catalogue builder (<see cref="ProfileService.BuildAchievements"/>)
/// directly — it takes the already-aggregated numbers, so the catalogue shape, the unlock
/// thresholds and the "unlocked first, then closest-to-unlocking" ordering are all asserted without
/// a database. The DB wiring (which columns feed which argument) is covered by the endpoint tests.
/// </summary>
public class AchievementCatalogueTests
{
    /// <summary>The 21 keys in catalogue order — the contract the frontend emoji map mirrors.</summary>
    private static readonly string[] ExpectedKeys =
    {
        "first_step", "attempts_10", "attempts_50", "attempts_100",
        "streak_3", "streak_7", "streak_30", "streak_100",
        "level_a2", "level_b1", "level_b2",
        "score_80", "score_90",
        "practice_1h", "practice_5h",
        "group_member",
        "xp_100", "xp_500", "xp_1000", "xp_2500", "xp_5000",
    };

    // A fresh user with nothing done yet: everything locked, and the catalogue still has all 21.
    private static IReadOnlyList<AchievementResponse> Empty()
        => ProfileService.BuildAchievements(
            attempts: 0, longestStreak: 0, bestBand: null, level: null,
            totalPracticeMinutes: 0, inAnyGroup: false, xp: 0);

    [Fact]
    public void Catalogue_has_exactly_twenty_one_distinct_badges()
    {
        var badges = Empty();

        Assert.Equal(21, badges.Count);
        Assert.Equal(21, badges.Select(b => b.Key).Distinct().Count());
        // Same SET of keys as the spec (order is asserted separately — here it is membership only).
        Assert.Equal(ExpectedKeys.OrderBy(k => k), badges.Select(b => b.Key).OrderBy(k => k));
    }

    [Fact]
    public void A_brand_new_user_has_every_badge_locked()
    {
        Assert.All(Empty(), b => Assert.False(b.Unlocked));
    }

    [Theory]
    // streak badges measure the BEST run (longestStreak), unlocking exactly at the target.
    [InlineData("streak_3", 2, false)]
    [InlineData("streak_3", 3, true)]
    [InlineData("streak_7", 6, false)]
    [InlineData("streak_7", 7, true)]
    public void Streak_badge_unlocks_at_its_threshold(string key, int longestStreak, bool expected)
    {
        var badge = Badge(
            ProfileService.BuildAchievements(0, longestStreak, null, null, 0, false, 0), key);

        Assert.Equal(expected, badge.Unlocked);
        // Progress is the raw streak value, never capped at the target.
        Assert.Equal(longestStreak, badge.Progress);
    }

    [Theory]
    // score badges measure the BEST single band, so a later weaker attempt cannot re-lock them.
    [InlineData("score_80", 79, false)]
    [InlineData("score_80", 80, true)]
    [InlineData("score_90", 89, false)]
    [InlineData("score_90", 90, true)]
    public void Score_badge_unlocks_at_its_threshold(string key, int bestBand, bool expected)
    {
        var badge = Badge(
            ProfileService.BuildAchievements(0, 0, bestBand, null, 0, false, 0), key);

        Assert.Equal(expected, badge.Unlocked);
    }

    [Theory]
    // XP badges measure the raw lifetime User.Xp, unlocking exactly at the milestone.
    [InlineData("xp_100", 99, false)]
    [InlineData("xp_100", 100, true)]
    [InlineData("xp_1000", 999, false)]
    [InlineData("xp_1000", 1000, true)]
    [InlineData("xp_5000", 5000, true)]
    public void Xp_badge_unlocks_at_its_milestone(string key, int xp, bool expected)
    {
        var badge = Badge(
            ProfileService.BuildAchievements(0, 0, null, null, 0, false, xp), key);

        Assert.Equal(expected, badge.Unlocked);
        // Progress is the raw XP total, never capped at the milestone.
        Assert.Equal(xp, badge.Progress);
    }

    [Theory]
    // practice badges measure whole minutes; 60 min unlocks the hour, 59 does not.
    [InlineData(59, false, false)]
    [InlineData(60, true, false)]
    [InlineData(300, true, true)]
    public void Practice_badges_unlock_by_total_minutes(int minutes, bool oneHour, bool fiveHours)
    {
        var badges = ProfileService.BuildAchievements(0, 0, null, null, minutes, false, 0);

        Assert.Equal(oneHour, Badge(badges, "practice_1h").Unlocked);
        Assert.Equal(fiveHours, Badge(badges, "practice_5h").Unlocked);
        // The raw minute count is reported, uncapped, on both.
        Assert.Equal(minutes, Badge(badges, "practice_1h").Progress);
    }

    [Fact]
    public void Level_badges_unlock_cumulatively_up_the_ladder()
    {
        var b1 = ProfileService.BuildAchievements(0, 0, null, level: "B1", 0, false, 0);

        // B1 clears A2 and B1 but not the higher B2.
        Assert.True(Badge(b1, "level_a2").Unlocked);
        Assert.True(Badge(b1, "level_b1").Unlocked);
        Assert.False(Badge(b1, "level_b2").Unlocked);
    }

    [Fact]
    public void First_step_and_attempts_use_the_raw_uncapped_count()
    {
        var badges = ProfileService.BuildAchievements(128, 0, null, null, 0, false, 0);

        // first_step's progress is min(attempts, 1) — capped to its target by design.
        Assert.Equal(1, Badge(badges, "first_step").Progress);
        Assert.True(Badge(badges, "first_step").Unlocked);
        // attempts_50 reports the true 128, not a clamped 50.
        Assert.Equal(128, Badge(badges, "attempts_50").Progress);
        Assert.True(Badge(badges, "attempts_50").Unlocked);
    }

    [Fact]
    public void Ordering_puts_unlocked_first_then_the_closest_to_unlocking()
    {
        // attempts 128, best run 8 days, best band 82, level B1, 75 min practice, in a group, 620 XP.
        // 620 XP clears xp_100 + xp_500, so 13 unlocked in total.
        var badges = ProfileService.BuildAchievements(
            attempts: 128, longestStreak: 8, bestBand: 82, level: "B1",
            totalPracticeMinutes: 75, inAnyGroup: true, xp: 620);

        // Every unlocked badge precedes every locked one.
        var firstLocked = badges.ToList().FindIndex(b => !b.Unlocked);
        Assert.Equal(13, firstLocked);
        Assert.All(badges.Take(firstLocked), b => Assert.True(b.Unlocked));
        Assert.All(badges.Skip(firstLocked), b => Assert.False(b.Unlocked));

        // Among the locked tail, higher capped ratio first, then smaller target, then catalogue order:
        //   xp_1000 620/1000=0.62 > streak_30 8/30≈0.27 > practice_5h 75/300=0.25 >
        //   xp_2500 620/2500≈0.25 > xp_5000 620/5000=0.12 > streak_100 8/100=0.08 >
        //   level_b2 & score_90 (ratio 0, target 1 — level_b2 first by catalogue index).
        var lockedKeys = badges.Skip(firstLocked).Select(b => b.Key).ToArray();
        Assert.Equal(
            new[] { "xp_1000", "streak_30", "practice_5h", "xp_2500", "xp_5000", "streak_100", "level_b2", "score_90" },
            lockedKeys);
    }

    private static AchievementResponse Badge(IReadOnlyList<AchievementResponse> badges, string key)
        => badges.Single(b => b.Key == key);
}
