using Govori.Contracts;
using Govori.Identity;

namespace Govori.UnitTests.Profile;

/// <summary>
/// The two pure rules behind the Home motivation strip: the XP level curve (<see cref="XpLevels"/>)
/// and the seven-day activity strip (<see cref="ProfileService.BuildActiveDays"/>). Both take plain
/// values, so the boundaries are asserted without a database.
/// </summary>
public class HomeMotivationTests
{
    [Theory]
    [InlineData(0, 1, 0, 100)]
    [InlineData(99, 1, 0, 100)]
    [InlineData(100, 2, 100, 300)]      // exactly on a boundary belongs to the NEW level
    [InlineData(299, 2, 100, 300)]
    [InlineData(300, 3, 300, 600)]
    [InlineData(4_500, 10, 4_500, 5_500)]
    [InlineData(-5, 1, 0, 100)]         // a negative total is read as 0, never a crash
    public void Xp_level_curve(int xp, int level, int start, int next)
    {
        var (l, s, n) = XpLevels.For(xp);
        Assert.Equal(level, l);
        Assert.Equal(start, s);
        Assert.Equal(next, n);
    }

    [Fact]
    public void Each_level_gap_is_one_step_larger_than_the_last()
    {
        for (var level = 1; level < 30; level++)
            Assert.Equal(XpLevels.Step * level, XpLevels.StartOf(level + 1) - XpLevels.StartOf(level));
    }

    [Fact]
    public void Active_days_put_today_last_and_cut_on_Tashkent_midnight()
    {
        var today = new DateOnly(2026, 10, 21);
        var events = new[]
        {
            new DateTime(2026, 10, 21, 3, 0, 0, DateTimeKind.Utc),   // today 08:00 local
            new DateTime(2026, 10, 20, 19, 30, 0, DateTimeKind.Utc), // today 00:30 local — still today
            new DateTime(2026, 10, 20, 18, 30, 0, DateTimeKind.Utc), // yesterday 23:30 local
            new DateTime(2026, 10, 15, 10, 0, 0, DateTimeKind.Utc),  // six days ago — first slot
            new DateTime(2026, 10, 14, 10, 0, 0, DateTimeKind.Utc),  // seven days ago — outside
        };

        var days = ProfileService.BuildActiveDays(events, today);

        Assert.Equal(new[] { true, false, false, false, false, true, true }, days);
    }

    [Fact]
    public void No_events_is_seven_unlit_days()
        => Assert.Equal(new bool[7], ProfileService.BuildActiveDays(Array.Empty<DateTime>(), new DateOnly(2026, 1, 1)));
}
