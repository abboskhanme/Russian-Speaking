using Xunit;

namespace Govori.Characterization;

/// <summary>
/// C4 — needs_premium: the freemium paywall decision (services/access.py:78-89).
///
/// The Python function is NOT pure — its signature is needs_premium(db, student, q)
/// and it reads the DB (the module row + a positional COUNT via task_index). The
/// fixture was produced by driving the REAL function with a fake Session that
/// injects those two reads, so every branch/short-circuit below is the production
/// code's own; only the module row and the index are supplied.
///
/// Decision (access.py:81-89):
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
        // block = db.get(QuestionBlock, q.block_id) if q.block_id else None
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
    public void Needs_premium_matches_Python_on_every_case()
    {
        foreach (var c in Fx.Cases)
            Assert.True(c.Expected == NeedsPremium(c),
                $"needs_premium mismatch: role={c.Role} premium={c.IsPremium} " +
                $"blockPresent={c.BlockIdPresent} blockExists={c.BlockExists} vis={c.Visibility ?? "null"} " +
                $"n={c.FreeTasksPerModule} idx={c.TaskIndex} → C#={NeedsPremium(c)} vs Python={c.Expected}");
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
