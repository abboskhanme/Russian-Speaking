using Xunit;

namespace Govori.Characterization;

/// <summary>
/// C4 — needs_premium: the freemium paywall decision.
///
/// The real decision is NOT pure: it also reads the DB (the module row plus a
/// positional COUNT via task_index). The golden fixture supplies exactly those two
/// reads as data, so the branch/short-circuit ladder reproduced below can be
/// exercised as a pure function over every recorded combination.
///
/// Decision:
///   non-student OR premium              → False
///   no module OR visibility != public   → False   (teacher/group content never self-paywalled)
///   FREE_TASKS_PER_MODULE (n) &lt;= 0       → False   (whole module free)
///   else                                → task_index &gt;= n
/// </summary>
public class FreemiumCharacterizationTests
{
    private static readonly NeedsPremiumFixture Fx =
        Fixtures.Load<NeedsPremiumFixture>("needs_premium_cases.json");

    private static bool NeedsPremium(NeedsPremiumCase c)
    {
        if (c.Role != "student" || c.IsPremium)
            return false;
        // A block is only in play when the question names one AND that row exists.
        var hasBlock = c.BlockIdPresent && c.BlockExists;
        if (!hasBlock || c.Visibility != "public")
            return false;                       // teacher-governed content is never self-serve paywalled
        if (c.FreeTasksPerModule <= 0)
            return false;                       // 0 = whole module free
        return c.TaskIndex >= c.FreeTasksPerModule;
    }

    [Fact]
    public void Default_free_tasks_per_module_is_three()
    {
        Assert.Equal(3, Fx.DefaultFreeTasksPerModule);
        Assert.NotEmpty(Fx.Cases);
    }

    [Fact]
    public void Needs_premium_matches_the_golden_fixture_on_every_case()
    {
        foreach (var c in Fx.Cases)
            Assert.True(c.Expected == NeedsPremium(c),
                $"needs_premium mismatch: role={c.Role} premium={c.IsPremium} " +
                $"blockPresent={c.BlockIdPresent} blockExists={c.BlockExists} vis={c.Visibility ?? "null"} " +
                $"n={c.FreeTasksPerModule} idx={c.TaskIndex} → actual={NeedsPremium(c)} vs expected={c.Expected}");
    }

    [Fact]
    public void Only_students_are_ever_gated()
    {
        // Teachers and admins bypass the freemium gate entirely.
        foreach (var c in Fx.Cases.Where(x => x.Role != "student"))
            Assert.False(c.Expected);
    }

    [Fact]
    public void Premium_students_are_never_gated()
    {
        foreach (var c in Fx.Cases.Where(x => x.Role == "student" && x.IsPremium))
            Assert.False(c.Expected);
    }
}
