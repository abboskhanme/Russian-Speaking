using Govori.Administration;
using Govori.Infrastructure.Entities;

namespace Govori.UnitTests.Administration;

/// <summary>
/// The role-change invariants (<see cref="RoleChangeRules.Evaluate"/>), asserted as a pure function.
///
/// <para>This is where <c>last_admin</c> is proven. Through HTTP a single request cannot reach it —
/// the caller is always an active admin and may not change their own role, so "other active admins"
/// is never zero — and the concurrent case (two admins demoting each other) cannot be staged
/// deterministically against a shared test database. The service reads the counts under a lock and
/// hands them here, so testing the decision is testing the invariant.</para>
/// </summary>
public class RoleChangeRulesTests
{
    [Theory]
    [InlineData(UserRole.Student)]
    [InlineData(UserRole.Teacher)]
    [InlineData(UserRole.Admin)]
    public void Same_role_is_a_no_op_even_when_other_rules_would_object(UserRole role)
        // No other admin and several groups: a no-op must still be a no-op, not a 409.
        => Assert.Equal(RoleChangeVerdict.NoOp,
            RoleChangeRules.Evaluate(role, currentIsActive: true, next: role, otherActiveAdmins: 0, ownedGroups: 3));

    [Theory]
    [InlineData(UserRole.Teacher)]
    [InlineData(UserRole.Student)]
    public void Demoting_the_last_active_admin_is_refused(UserRole next)
        => Assert.Equal(RoleChangeVerdict.LastAdmin,
            RoleChangeRules.Evaluate(UserRole.Admin, currentIsActive: true, next, otherActiveAdmins: 0, ownedGroups: 0));

    [Fact]
    public void Demoting_an_admin_is_allowed_while_another_active_admin_remains()
        => Assert.Equal(RoleChangeVerdict.Allowed,
            RoleChangeRules.Evaluate(UserRole.Admin, currentIsActive: true, UserRole.Teacher, otherActiveAdmins: 1, ownedGroups: 0));

    [Fact]
    public void An_inactive_admin_is_not_the_last_admin()
        // Nobody can sign in as a deactivated admin, so demoting one removes no working admin.
        => Assert.Equal(RoleChangeVerdict.Allowed,
            RoleChangeRules.Evaluate(UserRole.Admin, currentIsActive: false, UserRole.Teacher, otherActiveAdmins: 0, ownedGroups: 0));

    [Theory]
    [InlineData(UserRole.Teacher)]
    [InlineData(UserRole.Admin)]          // admins can own groups too
    public void Becoming_a_student_while_owning_groups_is_refused(UserRole current)
        => Assert.Equal(RoleChangeVerdict.OwnsGroups,
            RoleChangeRules.Evaluate(current, currentIsActive: true, UserRole.Student, otherActiveAdmins: 1, ownedGroups: 2));

    [Fact]
    public void Owning_groups_does_not_block_a_move_between_teacher_and_admin()
    {
        Assert.Equal(RoleChangeVerdict.Allowed,
            RoleChangeRules.Evaluate(UserRole.Teacher, true, UserRole.Admin, otherActiveAdmins: 1, ownedGroups: 4));
        Assert.Equal(RoleChangeVerdict.Allowed,
            RoleChangeRules.Evaluate(UserRole.Admin, true, UserRole.Teacher, otherActiveAdmins: 1, ownedGroups: 4));
    }

    [Fact]
    public void Last_admin_is_reported_before_owned_groups()
        // Both would object; the one that protects the platform wins.
        => Assert.Equal(RoleChangeVerdict.LastAdmin,
            RoleChangeRules.Evaluate(UserRole.Admin, true, UserRole.Student, otherActiveAdmins: 0, ownedGroups: 2));

    [Theory]
    [InlineData(UserRole.Teacher)]
    [InlineData(UserRole.Admin)]
    public void Promoting_a_student_is_allowed(UserRole next)
        => Assert.Equal(RoleChangeVerdict.Allowed,
            RoleChangeRules.Evaluate(UserRole.Student, true, next, otherActiveAdmins: 0, ownedGroups: 0));
}
