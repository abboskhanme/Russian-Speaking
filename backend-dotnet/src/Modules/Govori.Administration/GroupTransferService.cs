using Govori.Contracts;
using Govori.Infrastructure;
using Govori.Infrastructure.Entities;
using Microsoft.EntityFrameworkCore;

namespace Govori.Administration;

/// <summary>
/// <c>POST /api/admin/groups/{id}/transfer</c> — an admin hands a class to another teacher, the
/// real-world case being a teacher who leaves mid-year. Until this existed the only ways out were to
/// delete the group (the class loses its roster, its join code and its unanswered homework) or to
/// leave it with someone who is gone; and a departing teacher could not even be demoted, because
/// <c>teacher_owns_groups</c> refuses that while they still own one.
///
/// <para><b>What a group IS in this schema.</b> Ownership is the single column
/// <c>groups.teacher_id</c>, and almost everything a teacher can do with a class is DERIVED from it
/// rather than copied: the roster (<see cref="TeacherScope"/>), so the review queue, gradebook,
/// insights and student profiles; the join-request queue and its ping; the "my groups" lists.
/// Changing that one column moves all of them at once and leaves no second copy to drift. What does
/// NOT derive from it is listed below, each with the reason it moves or stays.</para>
///
/// <para><b>Moves with the group</b> (all in one transaction):</para>
/// <list type="bullet">
///   <item><c>groups.teacher_id</c> — and with it the roster, every member's past and future
///     answers in the new teacher's queue/gradebook, and every PENDING join request (they point at
///     the group, so the new teacher is the one who decides them).</item>
///   <item>The previous teacher's assignments that were set THROUGH this group
///     (<c>assignments.group_id = group AND teacher_id = previous</c>), open AND finished.
///     <c>assignments.teacher_id</c> is not an authorship record: every reader treats it as "the
///     teacher who manages this row" — the D3/A5 lists, the group's progress percentage, cancel and
///     deadline moves all filter on it. Left behind, the new teacher would run a class whose
///     homework they can neither see nor extend, while the old teacher kept rows for students they
///     can no longer open. Finished rows move too so the group screen's progress keeps its
///     denominator; what was ANSWERED is untouched, because answers live in <c>submissions</c>.</item>
/// </list>
///
/// <para><b>Stays where it is</b> — nothing is deleted, nothing is copied:</para>
/// <list type="bullet">
///   <item>Everything the students did: submissions, evaluations, XP, streaks, SRS review items,
///     teacher reviews (<c>reviewed_by</c> still names whoever reviewed), premium the old teacher
///     granted. None of it references a group or its owner.</item>
///   <item>The join code and the group's name. Printed invite links and codes already handed out
///     keep working — they now land in the new teacher's request queue.</item>
///   <item>The old teacher's tasks and modules (<c>questions.teacher_id</c>,
///     <c>question_blocks.teacher_id</c>). Content belongs to its author and may serve the author's
///     other classes, so it is not the class's to take. A <c>group</c>-visibility module is shown to
///     "students of the module's teacher" (<c>CatalogService.StudentTeacherIdsAsync</c>), so these
///     students stop seeing the old teacher's modules — EXCEPT the tasks they still hold a live
///     assignment for: the module view keeps exactly those reachable (see
///     <c>CatalogService.GetStudentModulesAsync</c>), so no homework a student was given turns into
///     "this task is unavailable" because of a decision they had no part in.</item>
///   <item>Assignments not set through this group: the old teacher's one-off rows for a student
///     (<c>group_id</c> null) were never the class's, and rows an ADMIN set through the group stay
///     the admin's (an admin sees and manages every row anyway).</item>
///   <item>Notifications already delivered. They are history; new ones say what changed (below).</item>
///   <item>Group leaderboards — they are keyed on the group and its members, not on the teacher.</item>
/// </list>
///
/// <para><b>Who may receive a group:</b> an ACTIVE user whose role is <c>teacher</c>. Not a
/// suspended teacher (the class would have nobody who can sign in), not an admin (admins already see
/// every group; a class needs someone whose job it is), not a student. The previous owner's state
/// does not matter — "the teacher left and was suspended" is exactly when this is used.</para>
///
/// <para><b>Concurrency.</b> The transfer takes the role-change advisory lock
/// (<see cref="AdministrationService.RoleChangeLockKey"/>) and then the group's row lock. The first
/// serialises it against <c>PATCH /users/{id}/role</c>: without it, a teacher could be demoted to
/// student (the role change reads "owns 0 groups") in the same instant a group is handed to them,
/// leaving a student owning a class — the exact state <c>teacher_owns_groups</c> exists to prevent.
/// The row lock serialises two transfers of the same group and the owner's own delete, so the
/// <c>same_teacher</c> check and the assignment move are decided against the owner that is actually
/// committed.</para>
///
/// <para><b>Order of answers:</b> 401/403 gate → 400 <c>invalid_target_teacher</c> when
/// <c>teacher_id</c> is absent → 404 unknown group → 400 <c>same_teacher</c> → 400
/// <c>invalid_target_teacher</c> (unknown / not a teacher / suspended) → 200
/// <see cref="GroupTransferResponse"/>. Pings go out after the commit and never fail the transfer.</para>
/// </summary>
public sealed class GroupTransferService
{
    private readonly GovoriDbContext _db;
    private readonly IClassroomNotifier _notifier;

    // The notifier is optional so a test can construct this over a bare DbContext; the host's
    // container supplies the real one.
    public GroupTransferService(GovoriDbContext db, IClassroomNotifier? notifier = null)
    {
        _db = db;
        _notifier = notifier ?? new NullClassroomNotifier();
    }

    public async Task<AdminResult<GroupTransferResponse>> TransferAsync(
        Guid userId, Guid groupId, GroupTransferRequest payload, CancellationToken ct = default)
    {
        Guid fromTeacherId;
        GroupTransferResponse response;

        await using (var tx = await _db.Database.BeginTransactionAsync(ct))
        {
            await _db.Database.ExecuteSqlAsync(
                $"SELECT pg_advisory_xact_lock({AdministrationService.RoleChangeLockKey})", ct);

            // The gate runs INSIDE the lock, like ChangeRoleAsync: a caller demoted while waiting
            // must be refused rather than act on authority they no longer hold.
            var caller = await _db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == userId && u.IsActive, ct);
            if (caller is null) return AdminResult<GroupTransferResponse>.From(AdminOutcome.Unauthorized);
            if (caller.Role != UserRole.Admin) return AdminResult<GroupTransferResponse>.From(AdminOutcome.Forbidden);

            if (payload.TeacherId is not { } toTeacherId)
                return AdminResult<GroupTransferResponse>.BadRequest(new CodedErrorResponse(
                    "teacher_id is required", AdminErrorCodes.InvalidTargetTeacher));

            // Row lock on the group (see the class remarks). Materialised as-is: EF does not wrap a
            // bare FromSql it has nothing to compose onto, so the FOR UPDATE reaches Postgres intact.
            var group = (await _db.Groups
                    .FromSql($"SELECT * FROM groups WHERE id = {groupId} FOR UPDATE")
                    .AsNoTracking()
                    .ToListAsync(ct))
                .SingleOrDefault();
            if (group is null) return AdminResult<GroupTransferResponse>.NotFound();

            if (group.TeacherId == toTeacherId)
                return AdminResult<GroupTransferResponse>.BadRequest(new CodedErrorResponse(
                    "The group already belongs to this teacher", AdminErrorCodes.SameTeacher));

            var target = await _db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == toTeacherId, ct);
            if (target is null || target.Role != UserRole.Teacher || !target.IsActive)
                return AdminResult<GroupTransferResponse>.BadRequest(new CodedErrorResponse(
                    "teacher_id must name an active teacher", AdminErrorCodes.InvalidTargetTeacher));

            fromTeacherId = group.TeacherId;
            var now = DateTime.UtcNow;

            await _db.Groups
                .Where(g => g.Id == group.Id)
                .ExecuteUpdateAsync(s => s
                    .SetProperty(g => g.TeacherId, toTeacherId)
                    .SetProperty(g => g.UpdatedAt, now), ct);

            var moved = await _db.Assignments
                .Where(a => a.GroupId == group.Id && a.TeacherId == fromTeacherId)
                .ExecuteUpdateAsync(s => s
                    .SetProperty(a => a.TeacherId, toTeacherId)
                    .SetProperty(a => a.UpdatedAt, now), ct);

            var fromName = await _db.Users.Where(u => u.Id == fromTeacherId)
                .Select(u => u.FullName).FirstOrDefaultAsync(ct) ?? "";
            var members = await _db.GroupMembers.CountAsync(gm => gm.GroupId == group.Id, ct);

            await tx.CommitAsync(ct);

            response = new GroupTransferResponse(
                GroupId: group.Id,
                GroupName: group.Name,
                FromTeacherId: fromTeacherId,
                FromTeacherName: fromName,
                ToTeacherId: toTeacherId,
                ToTeacherName: target.FullName,
                MemberCount: members,
                AssignmentsMoved: moved);
        }

        // After the commit and outside the transaction: a ping is a courtesy about the write, never
        // part of it (IClassroomNotifier's contract).
        await _notifier.SendBestEffortAsync(n => n.GroupTransferredAsync(groupId, fromTeacherId, ct), ct);
        return AdminResult<GroupTransferResponse>.Ok(response);
    }
}
