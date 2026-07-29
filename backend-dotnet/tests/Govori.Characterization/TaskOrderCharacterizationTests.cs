using Xunit;

namespace Govori.Characterization;

/// <summary>
/// C9 — task_index: the 0-based freemium position of a task among its module
/// siblings.
///
/// In production the count is a Postgres COUNT(*), which cannot run without a
/// database, so what is characterized here is the ordering PREDICATE that the SQL
/// encodes. A sibling counts as "before" the
/// target iff it is in the same module, published, not deleted, and strictly
/// earlier in the (sort_order, created_at) key. Ties (equal key) are NOT before
/// (strict &lt;), so the target never counts itself.
/// </summary>
public class TaskOrderCharacterizationTests
{
    private static readonly TaskIndexFixture Fx = Fixtures.Load<TaskIndexFixture>("task_index_cases.json");

    private static int TaskIndex(TaskIndexTarget target, IEnumerable<TaskIndexRow> siblings)
    {
        if (!target.BlockIdPresent)
            return 0;                                   // no module ⇒ no siblings ⇒ position 0

        var count = 0;
        foreach (var r in siblings)
        {
            if (r.BlockId != target.BlockId) continue;  // same module only
            if (r.IsDeleted || !r.IsPublished) continue; // live siblings only

            var before = r.SortOrder < target.SortOrder
                         || (r.SortOrder == target.SortOrder && r.CreatedAt < target.CreatedAt);
            if (before) count++;
        }
        return count;
    }

    [Fact]
    public void Fixture_has_cases()
    {
        Assert.NotEmpty(Fx.Cases);
    }

    [Fact]
    public void Task_index_matches_the_golden_fixture_on_every_case()
    {
        foreach (var c in Fx.Cases)
        {
            var actual = TaskIndex(c.Target, c.Siblings);
            Assert.True(c.ExpectedIndex == actual,
                $"task_index mismatch in '{c.Name}': actual={actual} vs expected={c.ExpectedIndex}");
        }
    }

    [Fact]
    public void A_task_with_no_module_is_position_zero()
    {
        foreach (var c in Fx.Cases.Where(x => !x.Target.BlockIdPresent))
            Assert.Equal(0, c.ExpectedIndex);
    }
}
