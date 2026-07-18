using Govori.Engagement;
using Xunit;

namespace Govori.Characterization;

/// <summary>
/// C8 — the REAL XP port. Unlike <see cref="ScoringCharacterizationTests"/> (which reimplements the
/// XP arithmetic inline), this drives the ACTUAL production function
/// <see cref="Govori.Engagement.EngagementService.XpForBand"/> — the one the grading worker calls to
/// award XP — against the frozen Python-generated fixture <c>xp_cases.json</c>. Every case must
/// match: this is the proof that the C# XP curve is byte-for-byte the Python
/// <c>gamification.py:24-31</c> (<c>&lt;27 → 0</c>, else <c>int(round(pct/4))</c>, <c>None → 0</c>).
/// The fixture is the contract — never edit it to make this pass.
/// </summary>
public class EngagementXpPortTests
{
    [Fact]
    public void Real_xp_function_matches_xp_cases_fixture()
    {
        var fx = Fixtures.Load<XpFixture>("xp_cases.json");
        Assert.NotEmpty(fx.Cases);

        foreach (var c in fx.Cases)
            Assert.Equal(c.Xp, EngagementService.XpForBand(c.Band));
    }

    [Fact]
    public void Null_and_sub_floor_bands_earn_zero_in_the_real_function()
    {
        // None → 0 (the `score or 0` guard) and anything under the 27% anti-farming floor → 0.
        Assert.Equal(0, EngagementService.XpForBand(null));
        var fx = Fixtures.Load<XpFixture>("xp_cases.json");
        foreach (var c in fx.Cases.Where(x => (x.Band ?? 0) < 27))
            Assert.Equal(0, EngagementService.XpForBand(c.Band));
    }
}
