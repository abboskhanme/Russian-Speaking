using Govori.Contracts;

namespace Govori.UnitTests.Time;

/// <summary>
/// The product-day rule (<see cref="ProductDay"/>): every user-facing day on the server begins at
/// local midnight in Tashkent, UTC+05:00 — i.e. at 19:00Z on the previous UTC date — and NOT at UTC
/// midnight, which is 05:00 in Tashkent.
///
/// <para>These pin the boundary itself, to the second, because every consumer inherits it: the
/// streak's writer and its three readers, the roleplay and sound-drill daily budgets, the "today"
/// tile, the teacher's day and month charts, and <c>/api/daily</c>'s default. The budgets' use of it
/// against real rows is pinned in the integration tests (DrillEndpointsTests,
/// PracticeEndpointsTests); the streak writer's in EngagementEndpointsTests.</para>
/// </summary>
public class ProductDayTests
{
    private static DateTime Utc(int y, int mo, int d, int h, int mi, int s = 0)
        => new(y, mo, d, h, mi, s, DateTimeKind.Utc);

    [Fact]
    public void The_offset_is_Tashkent_UTC_plus_five()
    {
        Assert.Equal(300, ProductDay.OffsetMinutes);
        Assert.Equal(TimeSpan.FromHours(5), ProductDay.Offset);
    }

    [Fact]
    public void One_second_before_19_00Z_is_still_the_same_local_day()
        // 18:59:59Z is 23:59:59 in Tashkent — the last second of the 29th there.
        => Assert.Equal(new DateOnly(2026, 9, 29), ProductDay.Today(Utc(2026, 9, 29, 18, 59, 59)));

    [Fact]
    public void At_19_00Z_it_is_already_the_next_local_day()
        // 19:00:00Z is 00:00 on the 30th in Tashkent. Under the old UTC rule it stayed the 29th until
        // 00:00Z — five more hours, which is exactly the bug.
        => Assert.Equal(new DateOnly(2026, 9, 30), ProductDay.Today(Utc(2026, 9, 29, 19, 0, 0)));

    [Fact]
    public void The_boundary_is_19_00Z_and_not_UTC_midnight()
    {
        // Between 19:00Z and 00:00Z the product day is one ahead of the UTC date…
        var late = Utc(2026, 9, 29, 21, 30);
        Assert.Equal(DateOnly.FromDateTime(late).AddDays(1), ProductDay.Today(late));
        // …and UTC midnight moves nothing: 23:59Z and 00:00Z are the same Tashkent day (04:59, 05:00).
        Assert.Equal(ProductDay.Today(Utc(2026, 9, 29, 23, 59, 59)), ProductDay.Today(Utc(2026, 9, 30, 0, 0, 0)));
    }

    [Theory]
    // Month rollover: 30 Sep → 1 Oct.
    [InlineData(2026, 9, 30, 18, 59, 59, 2026, 9, 30)]
    [InlineData(2026, 9, 30, 19, 0, 0, 2026, 10, 1)]
    // Year rollover: 31 Dec → 1 Jan.
    [InlineData(2026, 12, 31, 18, 59, 59, 2026, 12, 31)]
    [InlineData(2026, 12, 31, 19, 0, 0, 2027, 1, 1)]
    // February in a leap year: 28 → 29, then 29 Feb → 1 Mar.
    [InlineData(2028, 2, 28, 19, 0, 0, 2028, 2, 29)]
    [InlineData(2028, 2, 29, 19, 0, 0, 2028, 3, 1)]
    public void Month_and_year_roll_over_at_Tashkent_midnight(
        int y, int mo, int d, int h, int mi, int s, int ey, int emo, int ed)
        => Assert.Equal(new DateOnly(ey, emo, ed), ProductDay.Today(Utc(y, mo, d, h, mi, s)));

    [Fact]
    public void A_product_day_starts_at_19_00Z_on_the_previous_UTC_date()
    {
        var start = ProductDay.StartUtc(new DateOnly(2027, 1, 1));
        Assert.Equal(Utc(2026, 12, 31, 19, 0), start);
        // Utc, explicitly: Npgsql refuses to bind an Unspecified DateTime to timestamptz.
        Assert.Equal(DateTimeKind.Utc, start.Kind);
    }

    [Fact]
    public void The_start_of_today_moves_at_19_00Z()
    {
        // The `since` of every "spent today" budget count.
        Assert.Equal(Utc(2026, 9, 28, 19, 0), ProductDay.StartOfTodayUtc(Utc(2026, 9, 29, 18, 59, 59)));
        Assert.Equal(Utc(2026, 9, 29, 19, 0), ProductDay.StartOfTodayUtc(Utc(2026, 9, 29, 19, 0, 0)));
        Assert.Equal(DateTimeKind.Utc, ProductDay.StartOfTodayUtc(Utc(2026, 9, 29, 12, 0)).Kind);
    }

    [Fact]
    public void Every_instant_of_a_day_maps_back_into_that_day()
    {
        var day = new DateOnly(2026, 3, 8);
        var start = ProductDay.StartUtc(day);
        Assert.Equal(day, ProductDay.Of(start));
        Assert.Equal(day, ProductDay.Of(start.AddDays(1).AddTicks(-1)));
        Assert.Equal(day.AddDays(1), ProductDay.Of(start.AddDays(1)));
    }

    [Fact]
    public void Local_time_is_wall_clock_Tashkent_and_not_an_instant()
    {
        var local = ProductDay.LocalTime(Utc(2026, 9, 29, 19, 30));
        Assert.Equal(new DateTime(2026, 9, 30, 0, 30, 0), local);
        Assert.Equal(DateTimeKind.Unspecified, local.Kind);
    }

    [Fact]
    public void An_unspecified_kind_is_read_as_UTC()
        => Assert.Equal(
            ProductDay.Today(Utc(2026, 9, 29, 19, 0)),
            ProductDay.Today(new DateTime(2026, 9, 29, 19, 0, 0, DateTimeKind.Unspecified)));

    [Fact]
    public void The_streak_day_is_the_product_day()
    {
        // StreakRules.Today is what the writer AND every reader call; it must be this rule exactly,
        // or a streak could look broken on one side of the boundary and alive on the other.
        foreach (var instant in new[]
                 {
                     Utc(2026, 9, 29, 18, 59, 59), Utc(2026, 9, 29, 19, 0), Utc(2026, 12, 31, 19, 0),
                 })
            Assert.Equal(ProductDay.Today(instant), StreakRules.Today(instant));
    }

    [Fact]
    public void Answers_at_23_30_and_00_30_Tashkent_are_two_consecutive_streak_days()
    {
        var before = Utc(2026, 9, 29, 18, 30);   // 23:30 on the 29th in Tashkent
        var after = Utc(2026, 9, 29, 19, 30);    // 00:30 on the 30th in Tashkent

        // Under UTC they were ONE day — the second answer extended nothing.
        Assert.Equal(DateOnly.FromDateTime(before), DateOnly.FromDateTime(after));

        // As product days they are consecutive: a gap of one, which continues a streak with no freeze.
        var gap = StreakRules.Today(after).DayNumber - StreakRules.Today(before).DayNumber;
        Assert.Equal(1, gap);
        Assert.True(StreakRules.SurvivesGap(gap, streakFreezes: 0));
    }
}
