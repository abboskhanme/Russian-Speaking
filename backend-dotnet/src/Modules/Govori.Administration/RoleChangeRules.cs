using Govori.Infrastructure.Entities;

namespace Govori.Administration;

/// <summary>What <see cref="RoleChangeRules.Evaluate"/> decided about one role change.</summary>
public enum RoleChangeVerdict
{
    /// <summary>Apply the change.</summary>
    Allowed,

    /// <summary>The user already holds the requested role — answer 200 and write nothing.</summary>
    NoOp,

    /// <summary>The change would leave the platform with no active admin.</summary>
    LastAdmin,

    /// <summary>The user would become a student while still owning groups.</summary>
    OwnsGroups,
}

/// <summary>
/// The invariants a role change must not break, as one pure decision
/// (<c>PATCH /api/admin/users/{id}/role</c>). The service gathers the two counts under a lock and
/// asks this; keeping the rule free of the database is what lets it be unit-tested exhaustively.
///
/// <para><b>Why <see cref="RoleChangeVerdict.LastAdmin"/> matters even though HTTP can barely reach
/// it.</b> The caller is always an active admin and may not change their own role, so a single
/// request can never demote the last one. Two can: admins A and B demoting each other at the same
/// moment each see "one other admin left" and both succeed. The service serialises role changes
/// (a transaction-scoped advisory lock) and re-reads the counts inside it, and this rule is what
/// then refuses the second one. With no admin left there is no way back in from the UI — only a
/// shell on the server (deploy/bootstrap-admin.sh) — so the check is cheap insurance.</para>
///
/// <para><b>Why <see cref="RoleChangeVerdict.OwnsGroups"/>.</b> A student cannot open the teacher
/// panel, so their groups — and every student in them — would be orphaned: still enrolled, still
/// receiving the module view, with nobody able to assign, review or remove anything. The admin has
/// to hand the groups over or delete them first. This applies to an admin being demoted straight to
/// student as well; admins can own groups too.</para>
/// </summary>
public static class RoleChangeRules
{
    /// <param name="current">The role the user holds now.</param>
    /// <param name="currentIsActive">Whether the user is active — an inactive admin does not count
    /// as an admin anyone can sign in as, so demoting one never removes the "last" admin.</param>
    /// <param name="next">The requested role.</param>
    /// <param name="otherActiveAdmins">Active admins OTHER than this user.</param>
    /// <param name="ownedGroups">Groups whose <c>teacher_id</c> is this user.</param>
    public static RoleChangeVerdict Evaluate(
        UserRole current, bool currentIsActive, UserRole next, int otherActiveAdmins, int ownedGroups)
    {
        if (current == next)
            return RoleChangeVerdict.NoOp;

        if (current == UserRole.Admin && currentIsActive && otherActiveAdmins == 0)
            return RoleChangeVerdict.LastAdmin;

        if (next == UserRole.Student && ownedGroups > 0)
            return RoleChangeVerdict.OwnsGroups;

        return RoleChangeVerdict.Allowed;
    }
}
