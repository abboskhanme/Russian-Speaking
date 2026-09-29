using System.Security.Cryptography;
using System.Text.Json;
using Govori.Contracts;
using Govori.Infrastructure;
using Govori.Infrastructure.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;

namespace Govori.Classroom;

/// <summary>
/// Application service for the Classroom vertical slice (docs/07 §3.5, Faza 3.5) — teacher groups,
/// assignments and the gradebook. Its responsibilities:
/// <list type="bullet">
///   <item>groups: create / join / leave / mine / list / detail-with-roster, and the owner's
///     management — rename, fresh join code, remove one member, delete the group;</item>
///   <item>assignments: single-task and whole-module creation, the teacher and student lists, and
///     taking work back (one row, or one task across a group) or moving a group's deadline;</item>
///   <item>gradebook: choosing which submissions a viewer may see (<see cref="TeacherScope"/>),
///     then one scored row per student;</item>
///   <item>the teacher's view of one roster student — the A6 header and the premium grant.</item>
/// </list>
///
/// <para><b>Removing things never removes student history.</b> Submissions, their evaluations and
/// XP are the student's record and survive every delete here. Only rows that describe an
/// arrangement — a membership, a pending request, an assignment nobody has answered — go, and an
/// answer's <c>assignment_id</c> is nulled before its assignment row is removed (the FK is
/// <c>ON DELETE SET NULL</c> already; nulling first keeps that guarantee in code, not only in a
/// constraint someone could change).</para>
///
/// <para><b>S1 SECURITY FIX (docs/07 §7.8, docs/08 Faza 3.5).</b> Both assignment-creation paths
/// (<see cref="CreateAssignmentsAsync"/> / <see cref="CreateModuleAssignmentsAsync"/>) resolve their
/// targets as <c>StudentIds ∪ group members</c> and then run them through
/// <see cref="RosterStudentIds"/>, so a teacher can only assign work to students on their OWN roster.
/// Filtering by role alone is NOT enough — without the roster check any teacher could push an
/// assignment onto any student, which the audit raised as bug S1. The review-queue path enforces the
/// same rule. Admins still target anyone (super-user). Do not remove or weaken the filter.</para>
///
/// <para>Role/ownership: the teacher-only routes accept teacher OR admin (403 otherwise); the rest
/// accept any active user (401 if missing/inactive). role/is_active are read from the DB, never
/// trusted from the token — the endpoint only supplies the <c>sub</c>.</para>
///
/// <para><b>Notifications</b> (<see cref="IClassroomNotifier"/>, implemented in Engagement): a join
/// request pings the group's teacher, a decision pings the student, new assignments ping each
/// student once per action. They are sent AFTER the write commits and are best-effort — a ping that
/// fails never fails the action it reports.</para>
///
/// <para>Still deferred (documented, not silently dropped): the admin (re)assign-teacher routes and a
/// group overview endpoint.</para>
/// </summary>
public sealed class ClassroomService
{
    private readonly GovoriDbContext _db;
    private readonly IConfiguration? _config;
    private readonly IClassroomNotifier _notifier;

    // Both extras are OPTIONAL (default null) so every test that constructs this service directly —
    // `new ClassroomService(ctx)` — keeps compiling; DI supplies them in the host. The configuration
    // carries only the env-var half of the class-insights feature flag (see
    // ClassInsightsEnabledAsync); the notifier falls back to a no-op.
    public ClassroomService(
        GovoriDbContext db, IConfiguration? config = null, IClassroomNotifier? notifier = null)
    {
        _db = db;
        _config = config;
        _notifier = notifier ?? new NullClassroomNotifier();
    }

    // Unambiguous join-code alphabet — no 0/O/1/I, so a code read aloud cannot be mistyped.
    private const string CodeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    // ─── Groups ─────────────────────────────────────────────────────────────

    /// <summary>POST /groups — a teacher (or admin) creates a group and gets a join code.
    /// An empty name falls back to "Группа".</summary>
    public async Task<ClassroomResult<GroupResponse>> CreateGroupAsync(
        Guid userId, CreateGroupRequest payload, CancellationToken ct = default)
    {
        var user = await ActiveUserAsync(userId, ct);
        if (user is null) return ClassroomResult<GroupResponse>.Unauthorized();
        if (!IsTeacher(user)) return ClassroomResult<GroupResponse>.Forbidden();

        var name = (payload.Name ?? string.Empty).Trim();
        if (name.Length == 0) name = "Группа";

        var now = DateTime.UtcNow;
        var group = new Group
        {
            Id = Guid.NewGuid(),                                     // groups.id is ValueGeneratedNever
            TeacherId = user.Id,
            Name = name,
            JoinCode = await GenerateCodeAsync(ct),
            CreatedAt = now,
            UpdatedAt = now,
        };
        _db.Groups.Add(group);
        await _db.SaveChangesAsync(ct);
        return ClassroomResult<GroupResponse>.Ok(await GroupOutAsync(group, ct));
    }

    /// <summary>POST /groups/join — the current user joins the group with this code, idempotently.
    /// An invalid code → NotFound. ANY active user may join — membership is not restricted to the
    /// student role.</summary>
    public async Task<ClassroomResult<JoinGroupResponse>> JoinGroupAsync(
        Guid userId, JoinGroupRequest payload, CancellationToken ct = default)
    {
        var user = await ActiveUserAsync(userId, ct);
        if (user is null) return ClassroomResult<JoinGroupResponse>.Unauthorized();

        var code = (payload.Code ?? string.Empty).Trim().ToUpperInvariant();  // codes are stored upper-case
        var group = await _db.Groups.FirstOrDefaultAsync(g => g.JoinCode == code, ct);
        if (group is null) return ClassroomResult<JoinGroupResponse>.NotFound(); // unknown join code

        var already = await _db.GroupMembers.AnyAsync(
            gm => gm.GroupId == group.Id && gm.StudentId == user.Id, ct);
        if (already)                                                           // idempotent: re-joining is a no-op
            return ClassroomResult<JoinGroupResponse>.Ok(await JoinOutAsync(group, pending: false, ct));

        // NOT a member yet: file a request for the owning teacher instead of joining outright.
        // Membership is now the teacher's decision (ApproveJoinRequestAsync is the ONLY path that
        // writes a GroupMember from here), so nothing downstream — roster, gradebook, assignments —
        // can see a student the teacher has not accepted.
        var pendingAlready = await _db.GroupJoinRequests.AnyAsync(
            r => r.GroupId == group.Id
                 && r.StudentId == user.Id
                 && r.Status == GroupJoinRequest.StatusPending, ct);
        if (!pendingAlready)                                                   // idempotent: re-asking is a no-op
        {
            var now = DateTime.UtcNow;
            var request = new GroupJoinRequest
            {
                Id = Guid.NewGuid(),
                GroupId = group.Id,
                StudentId = user.Id,
                Status = GroupJoinRequest.StatusPending,
                CreatedAt = now,
                UpdatedAt = now,
            };
            _db.GroupJoinRequests.Add(request);
            await _db.SaveChangesAsync(ct);

            // Only a NEW request pings the teacher; re-asking while one waits is not news.
            await _notifier.SendBestEffortAsync(n => n.JoinRequestFiledAsync(request.Id, ct), ct);
        }
        return ClassroomResult<JoinGroupResponse>.Ok(await JoinOutAsync(group, pending: true, ct));
    }

    /// <summary>
    /// GET /groups/requests — the PENDING join requests across the caller's own groups, oldest
    /// first (the longest-waiting student should be decided first). Teacher/admin only; a teacher
    /// sees requests for groups they own and nothing else, an admin sees all.
    /// </summary>
    public async Task<ClassroomResult<IReadOnlyList<GroupJoinRequestResponse>>> ListJoinRequestsAsync(
        Guid userId, CancellationToken ct = default)
    {
        var user = await ActiveUserAsync(userId, ct);
        if (user is null) return ClassroomResult<IReadOnlyList<GroupJoinRequestResponse>>.Unauthorized();
        if (!IsTeacher(user)) return ClassroomResult<IReadOnlyList<GroupJoinRequestResponse>>.Forbidden();

        var q = _db.GroupJoinRequests
            .Include(r => r.Group)
            .Include(r => r.Student)
            .Where(r => r.Status == GroupJoinRequest.StatusPending);

        if (user.Role == UserRole.Teacher)                                     // admin: every group
            q = q.Where(r => r.Group.TeacherId == user.Id);

        var rows = await q.OrderBy(r => r.CreatedAt).ToListAsync(ct);

        return ClassroomResult<IReadOnlyList<GroupJoinRequestResponse>>.Ok(rows
            .Select(r => new GroupJoinRequestResponse(
                Id: r.Id,
                GroupId: r.GroupId,
                GroupName: r.Group.Name,
                JoinCode: r.Group.JoinCode,
                StudentId: r.StudentId,
                StudentName: r.Student.FullName,
                StudentEmail: r.Student.Email,
                CreatedAt: r.CreatedAt))
            .ToList());
    }

    /// <summary>
    /// POST /groups/requests/{id}/{approve|reject} — decide one pending request.
    ///
    /// <para><b>Ownership is the whole point.</b> A teacher may only decide a request for a group
    /// they OWN; anyone else gets 404, never 403, so the existence of another teacher's request is
    /// not leaked. Admin may decide any.</para>
    ///
    /// <para>Approving inserts the <see cref="GroupMember"/> and marks the request approved in the
    /// SAME SaveChanges, so the two can never disagree. Approving is idempotent against a student
    /// who somehow became a member already (the membership insert is skipped, the request is still
    /// decided). A request that is not pending returns NotFound — deciding twice is not an error the
    /// caller can act on, and the row is no longer in their queue either way.</para>
    /// </summary>
    public async Task<ClassroomOutcome> DecideJoinRequestAsync(
        Guid userId, Guid requestId, bool approve, CancellationToken ct = default)
    {
        var user = await ActiveUserAsync(userId, ct);
        if (user is null) return ClassroomOutcome.Unauthorized;
        if (!IsTeacher(user)) return ClassroomOutcome.Forbidden;

        var request = await _db.GroupJoinRequests
            .Include(r => r.Group)
            .FirstOrDefaultAsync(r => r.Id == requestId, ct);

        if (request is null || request.Status != GroupJoinRequest.StatusPending)
            return ClassroomOutcome.NotFound;
        if (user.Role == UserRole.Teacher && request.Group.TeacherId != user.Id)
            return ClassroomOutcome.NotFound;                                  // not yours ⇒ does not exist

        var now = DateTime.UtcNow;
        request.Status = approve ? GroupJoinRequest.StatusApproved : GroupJoinRequest.StatusRejected;
        request.DecidedAt = now;
        request.DecidedBy = user.Id;
        request.UpdatedAt = now;

        if (approve)
        {
            var already = await _db.GroupMembers.AnyAsync(
                gm => gm.GroupId == request.GroupId && gm.StudentId == request.StudentId, ct);
            if (!already)
            {
                _db.GroupMembers.Add(new GroupMember
                {
                    Id = Guid.NewGuid(),
                    GroupId = request.GroupId,
                    StudentId = request.StudentId,
                    CreatedAt = now,
                    UpdatedAt = now,
                });
            }
        }

        await _db.SaveChangesAsync(ct);

        // The student learns the answer either way (join_approved / join_rejected) — silence after
        // a rejection reads as "still waiting", indefinitely.
        await _notifier.SendBestEffortAsync(n => n.JoinRequestDecidedAsync(request.Id, ct), ct);
        return ClassroomOutcome.Ok;
    }

    /// <summary>
    /// GET /groups/requests/mine — the caller's OWN pending requests. Without this the student's
    /// Home cannot tell "your request is waiting" apart from "you are in no group", and a join would
    /// look like it silently failed.
    /// </summary>
    public async Task<IReadOnlyList<GroupJoinRequestResponse>?> MyJoinRequestsAsync(
        Guid userId, CancellationToken ct = default)
    {
        var user = await ActiveUserAsync(userId, ct);
        if (user is null) return null;

        var rows = await _db.GroupJoinRequests
            .Include(r => r.Group)
            .Include(r => r.Student)
            .Where(r => r.StudentId == user.Id && r.Status == GroupJoinRequest.StatusPending)
            .OrderBy(r => r.CreatedAt)
            .ToListAsync(ct);

        return rows
            .Select(r => new GroupJoinRequestResponse(
                Id: r.Id,
                GroupId: r.GroupId,
                GroupName: r.Group.Name,
                JoinCode: r.Group.JoinCode,
                StudentId: r.StudentId,
                StudentName: r.Student.FullName,
                StudentEmail: r.Student.Email,
                CreatedAt: r.CreatedAt))
            .ToList();
    }

    /// <summary>
    /// POST /groups/leave — the CURRENT USER leaves their group(s). Backs the "Guruhdan chiqish"
    /// danger action on the profile screen.
    ///
    /// <para><b>Self-service only, by construction.</b> The method takes no group id and no student
    /// id: the delete is filtered on <c>StudentId == user.Id</c>, i.e. the authenticated caller's
    /// own <c>GroupMember</c> rows and nothing else. There is no parameter through which a caller
    /// could target another member, and no role check is needed because leaving your own group is
    /// never a privileged action. The membership row is the only thing removed — the group, its
    /// roster of other students and every submission survive untouched.</para>
    ///
    /// <para>Ok ⇒ 204; NotFound ⇒ 404 when the user belongs to no group; Unauthorized ⇒ 401 for a
    /// missing/inactive user. Rows are plural because the schema does not forbid multi-group
    /// membership, and leaving must not silently strand one.</para>
    /// </summary>
    public async Task<ClassroomOutcome> LeaveGroupAsync(Guid userId, CancellationToken ct = default)
    {
        var user = await ActiveUserAsync(userId, ct);
        if (user is null) return ClassroomOutcome.Unauthorized;

        // Scoped to the caller. Bounded by how many groups ONE user is in, so materialising is safe.
        var mine = await _db.GroupMembers
            .Where(gm => gm.StudentId == user.Id)
            .ToListAsync(ct);
        if (mine.Count == 0) return ClassroomOutcome.NotFound;

        _db.GroupMembers.RemoveRange(mine);
        await _db.SaveChangesAsync(ct);
        return ClassroomOutcome.Ok;
    }

    /// <summary>GET /groups/mine — the groups the current user is a member of. Any active user;
    /// null ⇒ 401.</summary>
    public async Task<IReadOnlyList<GroupResponse>?> MyGroupsAsync(Guid userId, CancellationToken ct = default)
    {
        var user = await ActiveUserAsync(userId, ct);
        if (user is null) return null;

        var groupIds = await _db.GroupMembers
            .Where(gm => gm.StudentId == user.Id)
            .Select(gm => gm.GroupId)
            .ToListAsync(ct);
        if (groupIds.Count == 0) return [];

        var groups = await _db.Groups.Where(g => groupIds.Contains(g.Id)).ToListAsync(ct);
        return await GroupsOutAsync(groups, ct);
    }

    /// <summary>GET /groups — the teacher's own groups, newest first. Admin sees
    /// every group, or one teacher's when <paramref name="teacherId"/> is given. Student ⇒ 403.</summary>
    public async Task<ClassroomResult<IReadOnlyList<GroupResponse>>> ListGroupsAsync(
        Guid userId, Guid? teacherId, CancellationToken ct = default)
    {
        var user = await ActiveUserAsync(userId, ct);
        if (user is null) return ClassroomResult<IReadOnlyList<GroupResponse>>.Unauthorized();
        if (!IsTeacher(user)) return ClassroomResult<IReadOnlyList<GroupResponse>>.Forbidden();

        var stmt = _db.Groups.OrderByDescending(g => g.CreatedAt).AsQueryable();
        if (user.Role != UserRole.Admin)
            stmt = stmt.Where(g => g.TeacherId == user.Id);
        else if (teacherId is not null)                              // admin drilling into one teacher
            stmt = stmt.Where(g => g.TeacherId == teacherId.Value);

        var groups = await stmt.ToListAsync(ct);
        return ClassroomResult<IReadOnlyList<GroupResponse>>.Ok(await GroupsOutAsync(groups, ct));
    }

    /// <summary>GET /groups/{id} — a group with its roster. Teacher must own it; admin may read any.
    /// Missing OR not-owned both return NotFound, so the response never leaks a group's existence to
    /// a teacher who does not own it.</summary>
    public async Task<ClassroomResult<GroupDetailResponse>> GroupDetailAsync(
        Guid userId, Guid groupId, CancellationToken ct = default)
    {
        var user = await ActiveUserAsync(userId, ct);
        if (user is null) return ClassroomResult<GroupDetailResponse>.Unauthorized();
        if (!IsTeacher(user)) return ClassroomResult<GroupDetailResponse>.Forbidden();

        var group = await _db.Groups.FirstOrDefaultAsync(g => g.Id == groupId, ct);
        if (group is null || (user.Role != UserRole.Admin && group.TeacherId != user.Id))
            return ClassroomResult<GroupDetailResponse>.NotFound();

        // Roster student ids for this group, with when each joined.
        var memberRows = await _db.GroupMembers
            .Where(gm => gm.GroupId == group.Id)
            .Select(gm => new { gm.StudentId, gm.CreatedAt })
            .ToListAsync(ct);
        var memberIds = memberRows.Select(m => m.StudentId).ToList();
        var joinedAt = memberRows.ToDictionary(m => m.StudentId, m => m.CreatedAt);

        var members = new List<GroupMemberResponse>();
        if (memberIds.Count > 0)
        {
            // Total submissions per member — deliberately NOT scoped to this group.
            var counts = (await _db.Submissions
                .Where(s => memberIds.Contains(s.StudentId))
                .GroupBy(s => s.StudentId)
                .Select(g => new { g.Key, Count = g.Count() })
                .ToListAsync(ct))
                .ToDictionary(x => x.Key, x => x.Count);

            var users = await _db.Users
                .Where(u => memberIds.Contains(u.Id))
                .ToDictionaryAsync(u => u.Id, ct);

            foreach (var sid in memberIds)                          // keep roster query order
            {
                if (!users.TryGetValue(sid, out var u)) continue;
                members.Add(new GroupMemberResponse(
                    Id: u.Id,
                    FullName: u.FullName,
                    Email: u.Email,
                    IsPremium: u.IsPremium,
                    SubmissionCount: counts.GetValueOrDefault(sid, 0),
                    JoinedAt: joinedAt.GetValueOrDefault(sid)));
            }
        }

        var teacherName = await TeacherNameAsync(group.TeacherId, ct);
        return ClassroomResult<GroupDetailResponse>.Ok(new GroupDetailResponse(
            Id: group.Id,
            Name: group.Name,
            JoinCode: group.JoinCode,
            MemberCount: memberIds.Count,
            TeacherId: group.TeacherId,
            TeacherName: teacherName,
            CreatedAt: group.CreatedAt,
            Members: members));
    }

    // ─── Group management (owner / admin) ───────────────────────────────────
    // Every route here resolves the group through OwnedGroupAsync: a teacher who does not own it
    // gets NotFound — never Forbidden — exactly like GroupDetailAsync, so a group id cannot be
    // probed. A student is Forbidden before any lookup.

    /// <summary>Longest group name the column holds (<c>groups.name varchar(128)</c>).</summary>
    private const int GroupNameMax = 128;

    /// <summary>
    /// PATCH /groups/{id} — rename. See <see cref="UpdateGroupRequest"/> for the field rules: an
    /// absent name is left alone, a blank one is <c>name_required</c>, an over-long one
    /// <c>name_too_long</c>, and any <c>level</c> is <c>level_not_supported</c> (no column holds
    /// it). Validation runs before the ownership lookup, so a refused body costs no query and says
    /// nothing about whether the group exists.
    /// </summary>
    public async Task<ClassroomResult<GroupResponse>> UpdateGroupAsync(
        Guid userId, Guid groupId, UpdateGroupRequest payload, CancellationToken ct = default)
    {
        var user = await ActiveUserAsync(userId, ct);
        if (user is null) return ClassroomResult<GroupResponse>.Unauthorized();
        if (!IsTeacher(user)) return ClassroomResult<GroupResponse>.Forbidden();

        if (payload.Level is not null)
            return ClassroomResult<GroupResponse>.BadRequest(
                "A group has no stored level — its CEFR badge is derived from its students' scores",
                "level_not_supported");

        string? name = null;
        if (payload.Name is not null)
        {
            name = payload.Name.Trim();
            if (name.Length == 0)
                return ClassroomResult<GroupResponse>.BadRequest("name must not be blank", "name_required");
            if (name.Length > GroupNameMax)
                return ClassroomResult<GroupResponse>.BadRequest(
                    $"name must be at most {GroupNameMax} characters", "name_too_long");
        }

        var group = await OwnedGroupAsync(user, groupId, ct);
        if (group is null) return ClassroomResult<GroupResponse>.NotFound();

        if (name is not null && name != group.Name)
        {
            group.Name = name;
            group.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
        }
        return ClassroomResult<GroupResponse>.Ok(await GroupOutAsync(group, ct));
    }

    /// <summary>
    /// POST /groups/{id}/regenerate-code — replace the join code, e.g. after it leaked into the wrong
    /// chat. The old code stops working at once; members and PENDING requests are untouched (a
    /// request belongs to the group, not to the code it was filed with). Minted by the same
    /// <see cref="GenerateCodeAsync"/> creation uses, whose uniqueness check covers this group's own
    /// current code, so the new code is always a different one.
    /// </summary>
    public async Task<ClassroomResult<GroupResponse>> RegenerateCodeAsync(
        Guid userId, Guid groupId, CancellationToken ct = default)
    {
        var user = await ActiveUserAsync(userId, ct);
        if (user is null) return ClassroomResult<GroupResponse>.Unauthorized();
        if (!IsTeacher(user)) return ClassroomResult<GroupResponse>.Forbidden();

        var group = await OwnedGroupAsync(user, groupId, ct);
        if (group is null) return ClassroomResult<GroupResponse>.NotFound();

        group.JoinCode = await GenerateCodeAsync(ct);
        group.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return ClassroomResult<GroupResponse>.Ok(await GroupOutAsync(group, ct));
    }

    /// <summary>
    /// DELETE /groups/{id}/members/{studentId} — take one student out of the group. NotFound when
    /// the group is not the caller's OR the student is not a member of it.
    ///
    /// <para>Removed in one transaction: the membership, and that student's UNANSWERED assignments
    /// that came from this group (<see cref="Unanswered"/> — overdue ones too: an obligation to a
    /// class you are no longer in is not history, it is clutter). Everything the student actually
    /// did stays — their submissions and grades, and every assignment they answered, which is the
    /// record of that work. Assignments given to them individually (not through this group) are not
    /// this group's to remove.</para>
    /// </summary>
    public async Task<ClassroomOutcome> RemoveMemberAsync(
        Guid userId, Guid groupId, Guid studentId, CancellationToken ct = default)
    {
        var user = await ActiveUserAsync(userId, ct);
        if (user is null) return ClassroomOutcome.Unauthorized;
        if (!IsTeacher(user)) return ClassroomOutcome.Forbidden;

        var group = await OwnedGroupAsync(user, groupId, ct);
        if (group is null) return ClassroomOutcome.NotFound;

        var memberships = await _db.GroupMembers
            .Where(gm => gm.GroupId == group.Id && gm.StudentId == studentId)
            .ToListAsync(ct);
        if (memberships.Count == 0) return ClassroomOutcome.NotFound;

        await using var tx = await _db.Database.BeginTransactionAsync(ct);
        await DeleteAssignmentsAsync(
            Unanswered().Where(a => a.GroupId == group.Id && a.StudentId == studentId), ct);
        _db.GroupMembers.RemoveRange(memberships);
        await _db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return ClassroomOutcome.Ok;
    }

    /// <summary>
    /// DELETE /groups/{id} — delete the group. Every foreign key into <c>groups</c> is handled
    /// explicitly, in one transaction, rather than left to whatever the constraints happen to say:
    /// <list type="bullet">
    ///   <item><c>assignments.group_id</c> (ON DELETE SET NULL): the group's UNANSWERED assignments
    ///     are removed; the answered ones stay as the record of that work, with <c>group_id</c>
    ///     nulled;</item>
    ///   <item><c>group_join_requests.group_id</c> (NOT NULL, CASCADE): every request goes — a
    ///     request to join a group that no longer exists has nothing left to mean;</item>
    ///   <item><c>group_members.group_id</c> (CASCADE): every membership goes.</item>
    /// </list>
    /// Nothing references a group from <c>submissions</c>, <c>evaluations</c> or <c>xp_events</c>,
    /// so the students' answers, grades and XP are untouched by construction.
    /// </summary>
    public async Task<ClassroomOutcome> DeleteGroupAsync(Guid userId, Guid groupId, CancellationToken ct = default)
    {
        var user = await ActiveUserAsync(userId, ct);
        if (user is null) return ClassroomOutcome.Unauthorized;
        if (!IsTeacher(user)) return ClassroomOutcome.Forbidden;

        var group = await OwnedGroupAsync(user, groupId, ct);
        if (group is null) return ClassroomOutcome.NotFound;

        await using var tx = await _db.Database.BeginTransactionAsync(ct);
        await DeleteAssignmentsAsync(Unanswered().Where(a => a.GroupId == group.Id), ct);
        await _db.Assignments
            .Where(a => a.GroupId == group.Id)
            .ExecuteUpdateAsync(s => s.SetProperty(a => a.GroupId, (Guid?)null), ct);
        await _db.GroupJoinRequests.Where(r => r.GroupId == group.Id).ExecuteDeleteAsync(ct);
        await _db.GroupMembers.Where(gm => gm.GroupId == group.Id).ExecuteDeleteAsync(ct);
        await _db.Groups.Where(g => g.Id == group.Id).ExecuteDeleteAsync(ct);
        await tx.CommitAsync(ct);

        // The tracked entity was deleted behind the change tracker's back; detach it so nothing
        // later in this request tries to save it.
        _db.Entry(group).State = EntityState.Detached;
        return ClassroomOutcome.Ok;
    }

    // ─── Assignments ────────────────────────────────────────────────────────

    /// <summary>
    /// POST /assignments — assign one task, with a deadline, to explicit students and/or a whole
    /// group. A teacher may only assign their OWN question (admin: any).
    /// <b>S1 fix</b>: targets are filtered through the teacher's roster before rows are written.
    ///
    /// <para><b>No second copy of a task a student still owes.</b> A target who already has an
    /// <see cref="OpenAssignments">OPEN</see> assignment for this question — not yet answered,
    /// deadline not passed — is skipped, and the response lists only the rows actually written. This
    /// is what the assign dialog's "takror berilmaydi" has always promised, and it is the same rule
    /// the F6 remediation plan uses to pick its audience (<see cref="PlanRemediationAsync"/>), so the
    /// "Mashq ber" preview and what this writes are the same students. An ANSWERED or EXPIRED
    /// assignment does not block a new one: re-setting a task the student already did is exactly
    /// what remediation is for, and a lapsed deadline is not something the student can still
    /// meet.</para>
    ///
    /// <para>Unlike <see cref="CreateModuleAssignmentsAsync"/>, which skips a task a student has EVER
    /// been assigned — re-assigning a module to a group after a newcomer joins must not hand the old
    /// hands six finished tasks again — a single task is the unit of "do this again".</para>
    /// </summary>
    public async Task<ClassroomResult<IReadOnlyList<AssignmentResponse>>> CreateAssignmentsAsync(
        Guid userId, CreateAssignmentRequest payload, CancellationToken ct = default)
    {
        var user = await ActiveUserAsync(userId, ct);
        if (user is null) return ClassroomResult<IReadOnlyList<AssignmentResponse>>.Unauthorized();
        if (!IsTeacher(user)) return ClassroomResult<IReadOnlyList<AssignmentResponse>>.Forbidden();

        if (InvalidMaxAttempts(payload.MaxAttempts) is { } badLimit)
            return ClassroomResult<IReadOnlyList<AssignmentResponse>>.BadRequest(badLimit);

        var q = await _db.Questions.FirstOrDefaultAsync(x => x.Id == payload.QuestionId, ct);
        if (q is null || q.IsDeleted || (user.Role != UserRole.Admin && q.TeacherId != user.Id))
            return ClassroomResult<IReadOnlyList<AssignmentResponse>>.NotFound();  // missing, deleted, or not theirs
        // A draft is the owner's to finish, not a class's to answer: submit refuses an unpublished
        // task, so an assignment to one would be a task the student is shown and cannot do. Told only
        // to the owner (the 404 above came first), and with a code so the UI can say "publish it".
        if (!q.IsPublished)
            return ClassroomResult<IReadOnlyList<AssignmentResponse>>.BadRequest(
                "Publish the task before assigning it", "question_not_published");

        var targetIds = await ResolveTargetsAsync(payload.StudentIds, payload.GroupId, ct);
        var validIds = await RosterStudentIds(user, targetIds, ct);               // S1 fix

        var now = DateTime.UtcNow;
        // One query for the whole target set, not one per student.
        var owing = await OpenAssignmentPairsAsync(validIds, [payload.QuestionId], now, ct);

        var created = new List<Assignment>();
        foreach (var sid in validIds)
        {
            if (owing.Contains((sid, payload.QuestionId))) continue;            // still owes the first copy
            var a = new Assignment
            {
                Id = Guid.NewGuid(),
                TeacherId = user.Id,
                StudentId = sid,
                QuestionId = payload.QuestionId,
                GroupId = payload.GroupId,
                DueAt = payload.DueAt,
                MaxAttempts = payload.MaxAttempts,
                CreatedAt = now,
                UpdatedAt = now,
            };
            _db.Assignments.Add(a);
            created.Add(a);
        }
        if (created.Count > 0)
        {
            await _db.SaveChangesAsync(ct);
            var recipients = created.Select(a => a.StudentId).Distinct().ToList();
            await _notifier.SendBestEffortAsync(
                n => n.AssignmentsCreatedAsync(user.Id, recipients, q.Id, blockId: null, ct), ct);
        }
        return ClassroomResult<IReadOnlyList<AssignmentResponse>>.Ok(await AssignmentsOutAsync(created, ct));
    }

    /// <summary>POST /assignments/module — assign every published, not-deleted task of a module in
    /// one go (a soft-deleted or draft task is skipped — submit would refuse it anyway).
    /// A teacher must own the module (admin: any). Skips every task a student has EVER been
    /// assigned, answered or not: assigning a module is enrolment, and the everyday repeat —
    /// re-assigning it to the whole group after a newcomer joins — must hand the newcomer the module
    /// without handing everyone else their finished tasks again. (The single-task path skips only
    /// OPEN copies; see <see cref="CreateAssignmentsAsync"/> for why the two differ.)
    /// <b>S1 fix</b>: same roster filter as the single-task path.</summary>
    public async Task<ClassroomResult<IReadOnlyList<AssignmentResponse>>> CreateModuleAssignmentsAsync(
        Guid userId, CreateModuleAssignmentRequest payload, CancellationToken ct = default)
    {
        var user = await ActiveUserAsync(userId, ct);
        if (user is null) return ClassroomResult<IReadOnlyList<AssignmentResponse>>.Unauthorized();
        if (!IsTeacher(user)) return ClassroomResult<IReadOnlyList<AssignmentResponse>>.Forbidden();

        if (InvalidMaxAttempts(payload.MaxAttempts) is { } badLimit)
            return ClassroomResult<IReadOnlyList<AssignmentResponse>>.BadRequest(badLimit);

        var block = await _db.QuestionBlocks.FirstOrDefaultAsync(b => b.Id == payload.BlockId, ct);
        if (block is null || (user.Role != UserRole.Admin && block.TeacherId != user.Id))
            return ClassroomResult<IReadOnlyList<AssignmentResponse>>.NotFound();  // missing, or not theirs

        var tasks = await _db.Questions
            .Where(x => x.BlockId == block.Id && !x.IsDeleted && x.IsPublished)
            .OrderBy(x => x.SortOrder).ThenBy(x => x.CreatedAt)
            .ToListAsync(ct);
        if (tasks.Count == 0)
            return ClassroomResult<IReadOnlyList<AssignmentResponse>>.BadRequest("Module has no published tasks");

        var targetIds = await ResolveTargetsAsync(payload.StudentIds, payload.GroupId, ct);
        var validIds = await RosterStudentIds(user, targetIds, ct);               // S1 fix
        var qids = tasks.Select(t => t.Id).ToList();

        var now = DateTime.UtcNow;
        var created = new List<Assignment>();
        foreach (var sid in validIds)
        {
            var existing = (await _db.Assignments
                .Where(a => a.StudentId == sid && qids.Contains(a.QuestionId))
                .Select(a => a.QuestionId)
                .ToListAsync(ct))
                .ToHashSet();
            foreach (var task in tasks)
            {
                if (existing.Contains(task.Id)) continue;            // never assign the same task twice
                var a = new Assignment
                {
                    Id = Guid.NewGuid(),
                    TeacherId = user.Id,
                    StudentId = sid,
                    QuestionId = task.Id,
                    GroupId = payload.GroupId,
                    DueAt = payload.DueAt,
                    MaxAttempts = payload.MaxAttempts,   // per task, not shared across the module
                    CreatedAt = now,
                    UpdatedAt = now,
                };
                _db.Assignments.Add(a);
                created.Add(a);
            }
        }
        if (created.Count > 0)
        {
            await _db.SaveChangesAsync(ct);
            // ONE ping per student for the whole module, however many of its tasks they received.
            var recipients = created.Select(a => a.StudentId).Distinct().ToList();
            await _notifier.SendBestEffortAsync(
                n => n.AssignmentsCreatedAsync(user.Id, recipients, questionId: null, block.Id, ct), ct);
        }
        return ClassroomResult<IReadOnlyList<AssignmentResponse>>.Ok(await AssignmentsOutAsync(created, ct));
    }

    /// <summary>GET /assignments — the teacher's own assignments, newest first. Admin sees every
    /// teacher's. Student ⇒ 403.</summary>
    public async Task<ClassroomResult<IReadOnlyList<AssignmentResponse>>> ListAssignmentsTeacherAsync(
        Guid userId, CancellationToken ct = default)
    {
        var user = await ActiveUserAsync(userId, ct);
        if (user is null) return ClassroomResult<IReadOnlyList<AssignmentResponse>>.Unauthorized();
        if (!IsTeacher(user)) return ClassroomResult<IReadOnlyList<AssignmentResponse>>.Forbidden();

        var stmt = _db.Assignments.OrderByDescending(a => a.CreatedAt).AsQueryable();
        if (user.Role != UserRole.Admin)
            stmt = stmt.Where(a => a.TeacherId == user.Id);
        var items = await stmt.ToListAsync(ct);
        return ClassroomResult<IReadOnlyList<AssignmentResponse>>.Ok(await AssignmentsOutAsync(items, ct));
    }

    /// <summary>GET /assignments/mine — the current user's own assignments, newest first.
    /// Any active user; null ⇒ 401.</summary>
    public async Task<IReadOnlyList<AssignmentResponse>?> ListAssignmentsStudentAsync(
        Guid userId, CancellationToken ct = default)
    {
        var user = await ActiveUserAsync(userId, ct);
        if (user is null) return null;

        var items = await _db.Assignments
            .Where(a => a.StudentId == user.Id)
            .OrderByDescending(a => a.CreatedAt)
            .ToListAsync(ct);
        return await AssignmentsOutAsync(items, ct);
    }

    // ─── Taking work back / moving deadlines ────────────────────────────────
    // Ownership of an assignment is its teacher_id; ownership of a group-wide operation is the group
    // (OwnedGroupAsync). A teacher who owns neither gets NotFound, never Forbidden. Every delete runs
    // through DeleteAssignmentsAsync, which detaches answers from the row before removing it.

    /// <summary>
    /// DELETE /assignments/{id} — withdraw one assignment row. The teacher who set it (admin: any)
    /// may; another teacher gets NotFound. The student's answers to it and their grades survive —
    /// they simply stop being attributed to an assignment that no longer exists.
    /// </summary>
    public async Task<ClassroomOutcome> DeleteAssignmentAsync(
        Guid userId, Guid assignmentId, CancellationToken ct = default)
    {
        var user = await ActiveUserAsync(userId, ct);
        if (user is null) return ClassroomOutcome.Unauthorized;
        if (!IsTeacher(user)) return ClassroomOutcome.Forbidden;

        var rows = _db.Assignments.Where(a => a.Id == assignmentId);
        if (user.Role != UserRole.Admin) rows = rows.Where(a => a.TeacherId == user.Id);
        if (!await rows.AnyAsync(ct)) return ClassroomOutcome.NotFound;

        await using var tx = await _db.Database.BeginTransactionAsync(ct);
        await DeleteAssignmentsAsync(rows, ct);
        await tx.CommitAsync(ct);
        return ClassroomOutcome.Ok;
    }

    /// <summary>
    /// POST /assignments/cancel — take one task back from one group: every row of the caller's
    /// (admin: anyone's) for that question that was assigned THROUGH that group, answered or not.
    /// Idempotent — nothing left to cancel is <c>{ cancelled: 0 }</c>, not an error. NotFound when
    /// the group is not the caller's.
    /// </summary>
    public async Task<ClassroomResult<CancelGroupAssignmentsResponse>> CancelGroupAssignmentsAsync(
        Guid userId, CancelGroupAssignmentsRequest payload, CancellationToken ct = default)
    {
        var user = await ActiveUserAsync(userId, ct);
        if (user is null) return ClassroomResult<CancelGroupAssignmentsResponse>.Unauthorized();
        if (!IsTeacher(user)) return ClassroomResult<CancelGroupAssignmentsResponse>.Forbidden();

        var group = await OwnedGroupAsync(user, payload.GroupId, ct);
        if (group is null) return ClassroomResult<CancelGroupAssignmentsResponse>.NotFound();

        await using var tx = await _db.Database.BeginTransactionAsync(ct);
        var cancelled = await DeleteAssignmentsAsync(GroupTaskRows(user, group.Id, payload.QuestionId), ct);
        await tx.CommitAsync(ct);
        return ClassroomResult<CancelGroupAssignmentsResponse>.Ok(new CancelGroupAssignmentsResponse(cancelled));
    }

    /// <summary>
    /// PATCH /assignments/group — set (or, with an explicit <c>null</c>, remove) the deadline of one
    /// task across one group: every row of the caller's (admin: anyone's) for that question assigned
    /// through that group. See <see cref="UpdateGroupAssignmentsRequest"/> for why an ABSENT
    /// <c>due_at</c> is <c>due_at_required</c> and never a silent "no deadline". A past instant is
    /// <c>due_in_past</c>: nobody can meet it, and an assignment born overdue only teaches the
    /// student to ignore deadlines.
    ///
    /// <para>Moving a deadline also re-opens the answering window: submit attributes an answer to an
    /// assignment only while <c>due_at</c> is null or in the future, so extending a lapsed deadline
    /// is how a teacher gives the class more time.</para>
    /// </summary>
    public async Task<ClassroomResult<UpdateGroupAssignmentsResponse>> UpdateGroupAssignmentsDueAsync(
        Guid userId, UpdateGroupAssignmentsRequest payload, CancellationToken ct = default)
    {
        var user = await ActiveUserAsync(userId, ct);
        if (user is null) return ClassroomResult<UpdateGroupAssignmentsResponse>.Unauthorized();
        if (!IsTeacher(user)) return ClassroomResult<UpdateGroupAssignmentsResponse>.Forbidden();

        if (!payload.HasDueAt)
            return ClassroomResult<UpdateGroupAssignmentsResponse>.BadRequest(
                "due_at is required — send null to remove the deadline", "due_at_required");

        var now = DateTime.UtcNow;
        DateTime? dueAt = payload.DueAt is { } raw ? AsUtc(raw) : null;
        if (dueAt < now)
            return ClassroomResult<UpdateGroupAssignmentsResponse>.BadRequest(
                "due_at is in the past", "due_in_past");

        var group = await OwnedGroupAsync(user, payload.GroupId, ct);
        if (group is null) return ClassroomResult<UpdateGroupAssignmentsResponse>.NotFound();

        var updated = await GroupTaskRows(user, group.Id, payload.QuestionId)
            .ExecuteUpdateAsync(s => s
                .SetProperty(a => a.DueAt, dueAt)
                .SetProperty(a => a.UpdatedAt, now), ct);
        return ClassroomResult<UpdateGroupAssignmentsResponse>.Ok(new UpdateGroupAssignmentsResponse(updated));
    }

    /// <summary>The rows a group-wide operation on one task touches: this task, assigned through this
    /// group, by the caller (admin: by anyone).</summary>
    private IQueryable<Assignment> GroupTaskRows(User user, Guid groupId, Guid questionId)
    {
        var rows = _db.Assignments.Where(a => a.GroupId == groupId && a.QuestionId == questionId);
        return user.Role == UserRole.Admin ? rows : rows.Where(a => a.TeacherId == user.Id);
    }

    /// <summary>
    /// A wire instant as UTC. System.Text.Json hands back <c>Utc</c> for a "Z" value, <c>Local</c>
    /// for one with an offset (already converted, so only the kind is wrong) and <c>Unspecified</c>
    /// for one with no zone at all — which is read as UTC, the only zone this API speaks. Npgsql
    /// refuses anything but <c>Utc</c> for a <c>timestamptz</c>, so skipping this is a 500.
    /// </summary>
    private static DateTime AsUtc(DateTime value) => value.Kind switch
    {
        DateTimeKind.Utc => value,
        DateTimeKind.Local => value.ToUniversalTime(),
        _ => DateTime.SpecifyKind(value, DateTimeKind.Utc),
    };

    // ─── Gradebook ──────────────────────────────────────────────────────────

    /// <summary>GET /reports/gradebook — one row per student with attempts + stable average/best band.
    /// A teacher is scoped to their OWN roster's answers to ANY question (<see cref="TeacherScope"/>);
    /// admin sees everything. Optional <paramref name="groupId"/> narrows to that group's members.
    /// Student ⇒ 403.</summary>
    public async Task<ClassroomResult<IReadOnlyList<GradebookRowResponse>>> GradebookAsync(
        Guid userId, Guid? groupId, CancellationToken ct = default)
    {
        var user = await ActiveUserAsync(userId, ct);
        if (user is null) return ClassroomResult<IReadOnlyList<GradebookRowResponse>>.Unauthorized();
        if (!IsTeacher(user)) return ClassroomResult<IReadOnlyList<GradebookRowResponse>>.Forbidden();

        var subs = await RelevantSubmissionsAsync(user, groupId, ct);
        return ClassroomResult<IReadOnlyList<GradebookRowResponse>>.Ok(await GradebookRowsAsync(subs, ct));
    }

    // The submission set a gradebook/analytics view is allowed to see: answers to a question (never
    // question-less shadowing practice), narrowed by the shared rule — admin everything, a teacher
    // their own roster's answers to ANY question. The same rule the attempt list, detail and review
    // routes apply, so the Jurnal, the queue and the student profile always count the same answers.
    private async Task<List<Submission>> RelevantSubmissionsAsync(User user, Guid? groupId, CancellationToken ct)
    {
        var stmt = _db.Submissions
            .Include(s => s.Evaluation)
            .Where(s => s.QuestionId != null)
            .VisibleTo(_db, user);

        if (groupId is not null)
        {
            var memberIds = await _db.GroupMembers
                .Where(gm => gm.GroupId == groupId.Value)
                .Select(gm => gm.StudentId)
                .ToListAsync(ct);
            if (memberIds.Count == 0) return [];                    // empty group ⇒ no rows at all
            stmt = stmt.Where(s => memberIds.Contains(s.StudentId));
        }

        return await stmt.ToListAsync(ct);
    }

    // Group by student, score with the shared C3 definition, sort by name.
    private async Task<IReadOnlyList<GradebookRowResponse>> GradebookRowsAsync(List<Submission> subs, CancellationToken ct)
    {
        var byStudent = subs.GroupBy(s => s.StudentId).ToList();
        if (byStudent.Count == 0) return [];

        var studentIds = byStudent.Select(g => g.Key).ToList();
        var users = await _db.Users
            .Where(u => studentIds.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id, ct);

        var rows = new List<GradebookRowResponse>();
        foreach (var g in byStudent)
        {
            var slist = g.ToList();
            users.TryGetValue(g.Key, out var u);
            // Per-skill columns read the SAME answers avg_band averages, so a row can never show a
            // headline drawn from one window beside skills drawn from another. An answer graded only
            // by a teacher (teacher_band, no evaluation) counts toward avg_band but has no skills.
            var recent = ClassroomScoring.RecentGraded(slist)
                .Select(s => s.Evaluation)
                .Where(e => e is not null)
                .Select(e => e!)
                .ToList();
            rows.Add(new GradebookRowResponse(
                StudentId: g.Key,
                FullName: u?.FullName ?? "—",
                Email: u?.Email ?? string.Empty,
                Attempts: slist.Count,
                AvgBand: ClassroomScoring.RollingAvg(slist),
                BestBand: ClassroomScoring.BestBand(slist),
                LastActivity: slist.Max(s => s.CreatedAt),
                Fluency: ClassroomScoring.MeanOrNull(recent.Select(e => (double?)e.FluencyScore)),
                Grammar: ClassroomScoring.MeanOrNull(recent.Select(e => (double?)e.GrammarScore)),
                Pronunciation: ClassroomScoring.MeanOrNull(recent.Select(e => e.PronunciationScore)),
                Lexical: ClassroomScoring.MeanOrNull(recent.Select(e => (double?)e.LexicalScore)),
                TrendDelta: ClassroomScoring.TrendDelta(slist)));
        }
        rows.Sort((a, b) => string.Compare(a.FullName, b.FullName, StringComparison.OrdinalIgnoreCase));
        return rows;
    }

    // ─── Analitika · Insaytlar ──────────────────────────────────────────────

    /// <summary>
    /// GET /reports/insights — everything the D1 Insaytlar screen shows, in one read. Same scoping as
    /// <see cref="GradebookAsync"/> (own roster, any question; <paramref name="groupId"/> narrows).
    /// Student ⇒ 403.
    ///
    /// <para>Every number is composed from rows that already exist — no new table, no migration. The
    /// windows are UTC and rolling (<c>now - 7×24h</c>), not calendar weeks: a calendar week would
    /// make Monday morning report a near-empty class, which reads as a data outage rather than a
    /// fresh week.</para>
    ///
    /// <para>The whole scoped submission set is materialised once and every statistic is computed off
    /// it in memory. That is deliberate: the set is already bounded by one teacher's roster, and the
    /// alternative is a dozen round trips that could each see a slightly different instant — the
    /// headline and the chart under it would then disagree.</para>
    /// </summary>
    public async Task<ClassroomResult<InsightsResponse>> InsightsAsync(
        Guid userId, Guid? groupId, CancellationToken ct = default)
    {
        var user = await ActiveUserAsync(userId, ct);
        if (user is null) return ClassroomResult<InsightsResponse>.Unauthorized();
        if (!IsTeacher(user)) return ClassroomResult<InsightsResponse>.Forbidden();

        var subs = await RelevantSubmissionsAsync(user, groupId, ct);
        var rosterIds = await RosterIdsAsync(user, groupId, ct);
        var now = DateTime.UtcNow;
        var weekStart = now.AddDays(-7);

        // Headline: the mean of the per-student rolling averages — literally the mean of the
        // avg_band values the D2 Jurnal prints, so the two can never disagree. Ungraded students are
        // absent from the rows entirely, so they are excluded rather than counted as zero.
        var rows = await GradebookRowsAsync(subs, ct);
        var classAvg = ClassroomScoring.MeanOrNull(rows.Select(r => r.AvgBand));
        var (classLevel, classLevelLabel) = CefrScale.FromAverageBand(classAvg);

        var trend = MonthlyTrend(subs, now);
        var trendDelta = TrendDelta(trend);

        var weekSubs = subs.Where(s => s.CreatedAt >= weekStart).ToList();

        var (done, total) = await AssignmentProgressAsync(user, groupId, rosterIds, ct);

        // Skills average over the graded answers in scope. PronunciationScore is nullable per
        // evaluation, so it goes in as-is and MeanOrNull skips the missing ones.
        var evals = subs.Select(s => s.Evaluation).Where(e => e is not null).Select(e => e!).ToList();
        var skills = new InsightsSkillsResponse(
            Fluency: ClassroomScoring.MeanOrNull(evals.Select(e => (double?)e.FluencyScore)),
            Grammar: ClassroomScoring.MeanOrNull(evals.Select(e => (double?)e.GrammarScore)),
            Pronunciation: ClassroomScoring.MeanOrNull(evals.Select(e => e.PronunciationScore)),
            Lexical: ClassroomScoring.MeanOrNull(evals.Select(e => (double?)e.LexicalScore)));

        // F6 · the one-tap remediation. Flag off ⇒ the tallies are still turned into rows (the
        // "Ko'p uchragan xatolar" list has always been there) but nothing is planned, so the extra
        // queries below never run and the client draws no button at all.
        var tallies = TallyCorrections(subs);
        var remediationOn = await ClassInsightsEnabledAsync(ct);
        var errors = remediationOn
            ? await PlanRemediationAsync(user, tallies, ct)
            : TopErrorPatterns(tallies);

        return ClassroomResult<InsightsResponse>.Ok(new InsightsResponse(
            ClassAvg: classAvg,
            ClassLevel: classLevel,
            ClassLevelLabel: classLevelLabel,
            TrendDelta: trendDelta,
            Trend: trend,
            ActiveStudents: weekSubs.Select(s => s.StudentId).Distinct().Count(),
            TotalStudents: rosterIds.Count,
            AssignmentsDone: done,
            AssignmentsTotal: total,
            // Seconds on the wire; the UI rounds to minutes once, at the edge.
            PracticeSecWeek: (int)Math.Round(weekSubs.Sum(s => s.AudioDurationSec ?? 0), MidpointRounding.AwayFromZero),
            ReviewedWeek: subs.Count(s => s.ReviewedAt is { } r && r >= weekStart),
            Skills: skills,
            Week: DailyActivity(subs, now),
            Errors: errors,
            RemediationEnabled: remediationOn,
            RemediationMinStudents: remediationOn ? RemediationMinStudents : 0));
    }

    /// <summary>
    /// The class trend: the last 3 calendar months, oldest first, ALWAYS 3 entries so the chart keeps
    /// a fixed x-axis. Each point is the mean effective band of the answers GIVEN that month —
    /// volume-weighted on purpose (see <see cref="InsightsResponse"/>), and <c>null</c> for a month
    /// with nothing graded so the client draws a gap instead of a plunge to zero.
    /// </summary>
    private static IReadOnlyList<InsightsMonthPoint> MonthlyTrend(List<Submission> subs, DateTime now)
    {
        var thisMonth = new DateTime(now.Year, now.Month, 1, 0, 0, 0, now.Kind);
        var points = new List<InsightsMonthPoint>(3);
        for (var back = 2; back >= 0; back--)
        {
            var start = thisMonth.AddMonths(-back);
            var end = start.AddMonths(1);
            var inMonth = subs.Where(s => s.CreatedAt >= start && s.CreatedAt < end).ToList();
            points.Add(new InsightsMonthPoint(
                Year: start.Year,
                Month: start.Month,
                Avg: ClassroomScoring.MeanOrNull(inMonth.Select(ClassroomScoring.EffectiveBand)),
                Attempts: inMonth.Count));
        }
        return points;
    }

    /// <summary>
    /// The "↑ +7 punkt" chip: the change between the two most recent months that BOTH have a graded
    /// average — not simply "this month minus last month".
    ///
    /// <para>The naive rule reads null for the first days of every month, because the current month
    /// has nothing graded yet. That is the moment a teacher is most likely to open the screen, so the
    /// chip would be missing far more often than present. Skipping empty months keeps the last real
    /// movement visible, and the chart beside it still shows the empty month as a gap, so the number
    /// is never presented as fresher than it is.</para>
    ///
    /// <para>Still <c>null</c> when fewer than two months have any graded answer — one data point is
    /// not a trend, and an unknown change is not a change of zero.</para>
    /// </summary>
    private static double? TrendDelta(IReadOnlyList<InsightsMonthPoint> trend)
    {
        var graded = trend.Where(p => p.Avg is not null).Select(p => p.Avg!.Value).ToList();
        return graded.Count < 2
            ? null
            : Math.Round(graded[^1] - graded[^2], 2, MidpointRounding.ToEven);
    }

    /// <summary>Exactly 7 day buckets, oldest first, ending today (UTC). Days with no answers are
    /// present with <c>0</c> rather than omitted — a missing day would silently shrink the chart.</summary>
    private static IReadOnlyList<InsightsDayPoint> DailyActivity(List<Submission> subs, DateTime now)
    {
        var perDay = subs.GroupBy(s => DateOnly.FromDateTime(s.CreatedAt))
                         .ToDictionary(g => g.Key, g => g.Count());
        var today = DateOnly.FromDateTime(now);
        var days = new List<InsightsDayPoint>(7);
        for (var back = 6; back >= 0; back--)
        {
            var day = today.AddDays(-back);
            days.Add(new InsightsDayPoint(day, perDay.GetValueOrDefault(day, 0)));
        }
        return days;
    }

    /// <summary>
    /// "Topshiriq bajarilishi" — done / total over the caller's OWN assignments (admin: everyone's),
    /// narrowed to the group's members when a group is given. "Done" delegates to
    /// <see cref="AssignmentsOutAsync"/> so the percentage here and the progress rows on the A5 group
    /// screen can never be computed by two different rules.
    /// </summary>
    private async Task<(int Done, int Total)> AssignmentProgressAsync(
        User user, Guid? groupId, List<Guid> rosterIds, CancellationToken ct)
    {
        var stmt = _db.Assignments.AsQueryable();
        if (user.Role != UserRole.Admin) stmt = stmt.Where(a => a.TeacherId == user.Id);
        if (groupId is not null) stmt = stmt.Where(a => rosterIds.Contains(a.StudentId));

        var items = await stmt.ToListAsync(ct);
        if (items.Count == 0) return (0, 0);

        var projected = await AssignmentsOutAsync(items, ct);
        return (projected.Count(a => a.Completed), projected.Count);
    }

    /// <summary>Everything one correction type contributed to the scoped answers.</summary>
    private sealed class ErrorTally
    {
        /// <summary>How many individual corrections of this type were written.</summary>
        public int Count;
        /// <summary>The distinct students who made it — the "12 o'quvchi" half of the row, and the
        /// exact audience a remediation may target.</summary>
        public HashSet<Guid> Students { get; } = [];
        /// <summary>question id → how often this type occurred ON that question. This is the ONLY
        /// measured link between an error type and a task (see
        /// <see cref="InsightsRemediationResponse"/>), so it is kept rather than summed away.</summary>
        public Dictionary<Guid, int> PerQuestion { get; } = [];
    }

    /// <summary>
    /// Reads <c>evaluations.corrections</c> across the scoped answers into per-type tallies.
    ///
    /// <para><c>corrections</c> is a JSON column holding <c>[{original,corrected,type,explanation}]</c>.
    /// It is parsed HERE, in memory, rather than aggregated in SQL: the set is already bounded by one
    /// teacher's roster, and pushing JSON unnesting into the query would tie this read to
    /// Postgres-specific SQL for no measurable gain. A malformed or non-array blob is skipped
    /// silently — one bad row written by an older grader must not take the whole analytics screen
    /// down.</para>
    /// </summary>
    private static (Dictionary<string, ErrorTally> ByType, int Total) TallyCorrections(List<Submission> subs)
    {
        var byType = new Dictionary<string, ErrorTally>(StringComparer.Ordinal);
        var total = 0;

        foreach (var s in subs)
        {
            var raw = s.Evaluation?.Corrections;
            if (string.IsNullOrWhiteSpace(raw)) continue;

            JsonDocument doc;
            try { doc = JsonDocument.Parse(raw); }
            catch (JsonException) { continue; }                  // legacy / half-written blob

            using (doc)
            {
                if (doc.RootElement.ValueKind != JsonValueKind.Array) continue;
                foreach (var item in doc.RootElement.EnumerateArray())
                {
                    if (item.ValueKind != JsonValueKind.Object) continue;
                    if (!item.TryGetProperty("type", out var t) || t.ValueKind != JsonValueKind.String) continue;
                    var type = t.GetString();
                    if (string.IsNullOrWhiteSpace(type)) continue;

                    if (!byType.TryGetValue(type, out var tally))
                        byType[type] = tally = new ErrorTally();
                    tally.Count++;
                    tally.Students.Add(s.StudentId);
                    // A free-practice answer has no question, so it counts toward the error but can
                    // never be the drill — there is no task to re-assign.
                    if (s.QuestionId is { } qid)
                        tally.PerQuestion[qid] = tally.PerQuestion.GetValueOrDefault(qid) + 1;
                    total++;
                }
            }
        }

        return (byType, total);
    }

    /// <summary>
    /// "Ko'p uchragan xatolar" — the top 5 correction types by frequency.
    ///
    /// <para>Ties break on the type string so the order is stable between two identical requests.</para>
    /// </summary>
    private static List<InsightsErrorResponse> TopErrorPatterns((Dictionary<string, ErrorTally> ByType, int Total) tallies)
    {
        if (tallies.Total == 0) return [];
        return tallies.ByType
            .OrderByDescending(kv => kv.Value.Count)
            .ThenBy(kv => kv.Key, StringComparer.Ordinal)
            .Take(5)
            .Select(kv => new InsightsErrorResponse(
                Type: kv.Key,                                    // verbatim — the client owns the label
                Count: kv.Value.Count,
                StudentCount: kv.Value.Students.Count,
                Share: Math.Round((double)kv.Value.Count / tallies.Total, 4, MidpointRounding.ToEven)))
            .ToList();
    }

    // ─── F6 · one-tap remediation ───────────────────────────────────────────

    /// <summary><c>app_settings</c> key that gates the F6 remediation. Faza 6 features ship behind a
    /// flag and cutover does not wait for them (docs/08 "Deploy ≠ release"), so it defaults to
    /// <b>off</b>: the analytics screen keeps listing the class's errors, but no "Mashq ber" button
    /// is offered until someone stores a truthy value (or sets <c>CLASS_INSIGHTS_ENABLED</c>).</summary>
    public const string ClassInsightsFlagKey = "class_insights_enabled";

    // Env-var default for the flag — the uppercase form of the key, the convention every other
    // app_settings key follows.
    private const string ClassInsightsFlagEnvVar = "CLASS_INSIGHTS_ENABLED";

    /// <summary>
    /// How many DISTINCT students must have made an error before a remediation is offered for it.
    ///
    /// <para><b>Why there is a floor at all.</b> F6's promise is "12 students stumbled on the
    /// genitive → one tap". <b>12</b> is the whole insight. One student stumbling is not a class
    /// pattern, and offering a live button under it invites a teacher to fan a task out to the whole
    /// affected set on the strength of a single graded answer. That is noise dressed as an insight,
    /// and it is the kind of thing that costs a feature its credibility in its first week.</para>
    ///
    /// <para><b>Why students, not occurrences.</b> One talkative answer can carry five corrections of
    /// the same type; counting occurrences would let a single student clear any bar. The unit of a
    /// CLASS insight is people.</para>
    ///
    /// <para><b>Why three.</b> It is the smallest count that cannot be "one person, plus a repeat" —
    /// the smallest set that describes a pattern ACROSS people rather than one student's habit (which
    /// calls for a conversation, not a class drill). Measured against the data in hand it lands
    /// exactly where it should: <c>word_order</c> (5 distinct students on its top questions, 127
    /// occurrences) is offered, while <c>relevance</c> and <c>style</c> — one student, one occurrence
    /// each — are not.</para>
    ///
    /// <para>A row below the floor still RENDERS. The teacher should know a rare error happened; they
    /// just do not get a one-tap fan-out for it.</para>
    /// </summary>
    public const int RemediationMinStudents = 3;

    // The truthy spellings app_settings uses for boolean-ish keys. Identical to the admin module's
    // and Engagement's set on purpose: two toggles in one table that disagree about what "on" spells
    // is a bug waiting to be filed against whichever one the admin typed "yes" into.
    private static readonly HashSet<string> FlagTrueWords =
        new(StringComparer.Ordinal) { "true", "1", "yes", "on" };

    /// <summary>
    /// Whether the F6 one-tap remediation is switched on. Same resolution order as every other
    /// setting — <c>app_settings</c> override → env default → <c>false</c> — but resolved against the
    /// table DIRECTLY rather than through <c>AppSettingsService</c>: that service lives in
    /// <c>Govori.Administration</c>, and a module→module reference is exactly what the §7.2 boundary
    /// guardrail (and <c>BoundaryRuleTests</c>) forbids. One indexed lookup on a screen a teacher
    /// opens a handful of times a day is not worth a second cache.
    /// </summary>
    public async Task<bool> ClassInsightsEnabledAsync(CancellationToken ct = default)
    {
        var raw = await _db.AppSettings
            .AsNoTracking()
            .Where(s => s.Key == ClassInsightsFlagKey)
            .Select(s => s.Value)
            .FirstOrDefaultAsync(ct);

        // A stored NULL or "" is not an override — it falls through to the env default, matching
        // AppSettingsService.GetAsync, so clearing the row really does revert the flag.
        if (string.IsNullOrEmpty(raw)) raw = _config?[ClassInsightsFlagEnvVar];

        return raw is not null && FlagTrueWords.Contains(raw.Trim().ToLowerInvariant());
    }

    /// <summary>
    /// The top-5 error rows, each carrying what "Mashq ber" would send (see
    /// <see cref="InsightsRemediationResponse"/> for WHY the task is chosen this way).
    ///
    /// <para>Per row: the candidate task is the still-assignable question this error type occurred on
    /// most often, and the audience is the students who actually made it — never the whole class.
    /// Students who already have an <see cref="OpenAssignments">OPEN</see> assignment for that
    /// question are dropped: a second copy of a task they have not done yet is noise. It is the very
    /// predicate <see cref="CreateAssignmentsAsync"/> skips by, so the names the confirm lists are the
    /// rows the confirm writes.</para>
    ///
    /// <para>Rows under <see cref="RemediationMinStudents"/> are not planned for at all — they are
    /// returned unchanged, with <c>Remediation</c> null.</para>
    ///
    /// <para>Three extra queries for the whole screen, not three per row: every candidate question,
    /// every relevant assignment and every student name is fetched once for all five rows.</para>
    /// </summary>
    private async Task<List<InsightsErrorResponse>> PlanRemediationAsync(
        User user,
        (Dictionary<string, ErrorTally> ByType, int Total) tallies,
        CancellationToken ct)
    {
        var rows = TopErrorPatterns(tallies);
        if (rows.Count == 0) return rows;

        // The floor (see RemediationMinStudents) is applied BEFORE anything is looked up: a row that
        // cannot be offered a drill must not cost a query, and must not appear in the audience of one.
        var top = rows
            .Select(r => (Row: r, Tally: tallies.ByType[r.Type]))
            .Where(x => x.Tally.Students.Count >= RemediationMinStudents)
            .ToList();
        if (top.Count == 0) return rows;

        // Only questions that can still be handed out. A teacher may assign their OWN questions
        // (admin: any) — the same ownership rule CreateAssignmentsAsync enforces, applied here so the
        // button is never offered for a task the confirm would then be refused for.
        var candidateIds = top.SelectMany(x => x.Tally.PerQuestion.Keys).Distinct().ToList();
        if (candidateIds.Count == 0) return rows;                 // free-practice errors only
        var isAdmin = user.Role == UserRole.Admin;
        var assignable = await _db.Questions
            .Where(q => candidateIds.Contains(q.Id)
                        && !q.IsDeleted
                        && q.IsPublished
                        && (isAdmin || q.TeacherId == user.Id))
            .ToDictionaryAsync(q => q.Id, ct);

        // Pick each row's task first, so the assignment/name lookups below cover exactly the pairs
        // that survive.
        var picked = new Dictionary<string, Question>(StringComparer.Ordinal);
        foreach (var (row, tally) in top)
        {
            var best = tally.PerQuestion
                .Where(kv => assignable.ContainsKey(kv.Key))
                .OrderByDescending(kv => kv.Value)
                .ThenBy(kv => kv.Key)                            // stable between identical requests
                .Select(kv => (Guid?)kv.Key)
                .FirstOrDefault();
            if (best is { } qid) picked[row.Type] = assignable[qid];
        }
        if (picked.Count == 0) return rows;

        // The roster filter (S1) applied at PLAN time, so the count the teacher confirms is the count
        // CreateAssignmentsAsync will actually write — a preview that promises 12 and writes 9 is
        // worse than no preview.
        var affected = top.Where(x => picked.ContainsKey(x.Row.Type))
                          .SelectMany(x => x.Tally.Students)
                          .Distinct()
                          .ToList();
        var onRoster = (await RosterStudentIds(user, affected, ct)).ToHashSet();

        var pickedIds = picked.Values.Select(q => q.Id).Distinct().ToList();
        var owing = await OpenAssignmentPairsAsync(affected, pickedIds, DateTime.UtcNow, ct);

        var names = await _db.Users
            .Where(u => affected.Contains(u.Id))
            .Select(u => new { u.Id, u.FullName })
            .ToDictionaryAsync(u => u.Id, u => u.FullName, ct);

        var plans = new Dictionary<string, InsightsRemediationResponse>(StringComparer.Ordinal);
        foreach (var (row, tally) in top)
        {
            if (!picked.TryGetValue(row.Type, out var q)) continue;   // nothing assignable

            var students = tally.Students
                .Where(onRoster.Contains)
                .Where(sid => !owing.Contains((sid, q.Id)))
                .Select(sid => new InsightsRemediationStudent(sid, names.GetValueOrDefault(sid, "—")))
                .OrderBy(s => s.FullName, StringComparer.OrdinalIgnoreCase)
                .ToList();

            plans[row.Type] = new InsightsRemediationResponse(
                QuestionId: q.Id,
                QuestionTitle: q.Title,
                QuestionTopic: q.Topic,
                QuestionLevel: q.Level,
                Students: students);
        }

        // Mapped over ROWS, not over `top`: a row below the floor (or with nothing assignable) keeps
        // its place in the ranked list with `Remediation` null. Dropping it would hide a real error
        // from the teacher because the product could not offer them a shortcut for it.
        return rows
            .Select(r => plans.TryGetValue(r.Type, out var plan) ? r with { Remediation = plan } : r)
            .ToList();
    }

    /// <summary>
    /// The students an analytics view may count — the denominator of "41 / 48". A teacher's roster is
    /// the members of the groups they OWN; admin sees every group's members.
    ///
    /// <para>The group filter INTERSECTS, it does not replace: a teacher passing another teacher's
    /// <c>group_id</c> gets an empty roster, exactly as they get no submissions, so the screen can
    /// never leak how many students are in a group they do not teach.</para>
    /// </summary>
    private async Task<List<Guid>> RosterIdsAsync(User user, Guid? groupId, CancellationToken ct)
    {
        var stmt = _db.GroupMembers.AsQueryable();
        if (user.Role != UserRole.Admin)
            stmt = stmt.Where(gm => gm.Group.TeacherId == user.Id);
        if (groupId is not null)
            stmt = stmt.Where(gm => gm.GroupId == groupId.Value);

        return await stmt.Select(gm => gm.StudentId).Distinct().ToListAsync(ct);
    }

    // ─── One roster student: the A6 header and the premium grant ─────────────
    // Visibility is the roster rule (TeacherScope): a teacher reaches only a STUDENT who sits in one
    // of their groups, and anyone else — another teacher's student, a teacher, an unknown id — is
    // NotFound, so neither route can be used to probe who exists. Admin reaches any student.

    /// <summary>
    /// GET /classroom/students/{id} — the student card behind the A6 profile header: name, the
    /// premium grant (the toggle's state) and effective premium, and which of the caller's groups the
    /// student is in.
    /// </summary>
    public async Task<ClassroomResult<ClassroomStudentResponse>> StudentAsync(
        Guid userId, Guid studentId, CancellationToken ct = default)
    {
        var user = await ActiveUserAsync(userId, ct);
        if (user is null) return ClassroomResult<ClassroomStudentResponse>.Unauthorized();
        if (!IsTeacher(user)) return ClassroomResult<ClassroomStudentResponse>.Forbidden();

        var student = await ReachableStudentAsync(user, studentId, ct);
        if (student is null) return ClassroomResult<ClassroomStudentResponse>.NotFound();

        var memberships = _db.GroupMembers.Where(gm => gm.StudentId == student.Id);
        if (user.Role != UserRole.Admin)
            memberships = memberships.Where(gm => gm.Group.TeacherId == user.Id);
        var groups = await memberships
            .OrderBy(gm => gm.CreatedAt)
            .Select(gm => new ClassroomStudentGroupResponse(gm.GroupId, gm.Group.Name, gm.CreatedAt))
            .ToListAsync(ct);

        return ClassroomResult<ClassroomStudentResponse>.Ok(new ClassroomStudentResponse(
            Id: student.Id,
            FullName: student.FullName,
            Email: student.Email,
            IsPremium: student.IsPremium,
            HasPremium: await PremiumAccess.HasPremiumAsync(_db, student, DateTime.UtcNow, ct),
            Groups: groups));
    }

    /// <summary>
    /// PATCH /classroom/students/{id}/premium — the teacher grants or revokes the freemium premium
    /// ("Premiumni o'qituvchingiz berishi mumkin"), as the legacy product let them. It writes
    /// <c>users.is_premium</c> — the same column the admin PATCH writes — and nothing else: whether a
    /// student HAS premium is still decided by <see cref="PremiumAccess"/> (grant OR an active paid
    /// subscription), so revoking a grant never takes away something the student paid for. The
    /// response carries both, see <see cref="StudentPremiumResponse"/>.
    /// </summary>
    public async Task<ClassroomResult<StudentPremiumResponse>> SetStudentPremiumAsync(
        Guid userId, Guid studentId, SetStudentPremiumRequest payload, CancellationToken ct = default)
    {
        var user = await ActiveUserAsync(userId, ct);
        if (user is null) return ClassroomResult<StudentPremiumResponse>.Unauthorized();
        if (!IsTeacher(user)) return ClassroomResult<StudentPremiumResponse>.Forbidden();

        if (payload.IsPremium is not { } grant)
            return ClassroomResult<StudentPremiumResponse>.BadRequest(
                "is_premium (true or false) is required", "is_premium_required");

        var student = await ReachableStudentAsync(user, studentId, ct);
        if (student is null) return ClassroomResult<StudentPremiumResponse>.NotFound();

        if (student.IsPremium != grant)
        {
            student.IsPremium = grant;
            student.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
        }

        return ClassroomResult<StudentPremiumResponse>.Ok(new StudentPremiumResponse(
            student.Id,
            student.IsPremium,
            await PremiumAccess.HasPremiumAsync(_db, student, DateTime.UtcNow, ct)));
    }

    /// <summary>The target of a per-student route: a user with the STUDENT role that the caller may
    /// reach — admin any, a teacher only their own roster. Null otherwise (⇒ NotFound).</summary>
    private async Task<User?> ReachableStudentAsync(User caller, Guid studentId, CancellationToken ct)
    {
        var student = await _db.Users.FirstOrDefaultAsync(
            u => u.Id == studentId && u.Role == UserRole.Student, ct);
        if (student is null) return null;
        if (caller.Role == UserRole.Admin) return student;
        return await TeacherScope.TeachesAsync(_db, caller.Id, student.Id, ct) ? student : null;
    }

    // ─── Shared helpers ─────────────────────────────────────────────────────

    private async Task<User?> ActiveUserAsync(Guid userId, CancellationToken ct)
        => await _db.Users.FirstOrDefaultAsync(u => u.Id == userId && u.IsActive, ct);

    /// <summary>The group, if the caller may manage it: its owner, or any admin. Null for a missing
    /// group AND for someone else's — the two must be indistinguishable (⇒ NotFound).</summary>
    private async Task<Group?> OwnedGroupAsync(User user, Guid groupId, CancellationToken ct)
    {
        var group = await _db.Groups.FirstOrDefaultAsync(g => g.Id == groupId, ct);
        return group is not null && (user.Role == UserRole.Admin || group.TeacherId == user.Id)
            ? group
            : null;
    }

    /// <summary>
    /// Assignments the student has not answered yet — by the SAME rule
    /// <see cref="AssignmentResponse.Completed"/> reports (any answer to that question given at or
    /// after the assignment was set closes it), so a list that shows a task as done and a delete that
    /// treats it as history can never disagree. Deadline-blind on purpose: this is "what is not the
    /// student's record", used when an arrangement is dismantled.
    /// </summary>
    private IQueryable<Assignment> Unanswered()
        => _db.Assignments.Where(a => !_db.Submissions.Any(
            s => s.StudentId == a.StudentId
                 && s.QuestionId == a.QuestionId
                 && s.CreatedAt >= a.CreatedAt));

    /// <summary>
    /// OPEN assignments — the ones a student still owes: <see cref="Unanswered"/> AND the deadline
    /// has not passed. The one definition of "they already have this task", shared by the
    /// single-task create path and the F6 remediation plan. A lapsed deadline is not open: submit no
    /// longer attributes answers to it, so it is not something the student can still do.
    /// </summary>
    private IQueryable<Assignment> OpenAssignments(DateTime now)
        => Unanswered().Where(a => a.DueAt == null || a.DueAt >= now);

    /// <summary>The (student, question) pairs among these that have an <see cref="OpenAssignments">
    /// OPEN</see> assignment — one query for the whole set, never one per student.</summary>
    private async Task<HashSet<(Guid StudentId, Guid QuestionId)>> OpenAssignmentPairsAsync(
        List<Guid> studentIds, List<Guid> questionIds, DateTime now, CancellationToken ct)
    {
        if (studentIds.Count == 0 || questionIds.Count == 0) return [];
        var rows = await OpenAssignments(now)
            .Where(a => studentIds.Contains(a.StudentId) && questionIds.Contains(a.QuestionId))
            .Select(a => new { a.StudentId, a.QuestionId })
            .ToListAsync(ct);
        return rows.Select(r => (r.StudentId, r.QuestionId)).ToHashSet();
    }

    /// <summary>
    /// Deletes these assignment rows WITHOUT taking student history with them: every answer that
    /// was attributed to one is detached first (<c>assignment_id = NULL</c>), then the rows go. The
    /// FK already says <c>ON DELETE SET NULL</c>; doing it here too keeps the guarantee in reviewed
    /// code rather than only in a constraint. The ids are materialised once so both statements act
    /// on the same rows. Run inside the caller's transaction. Returns how many rows were removed.
    /// </summary>
    private async Task<int> DeleteAssignmentsAsync(IQueryable<Assignment> rows, CancellationToken ct)
    {
        var ids = await rows.Select(a => a.Id).ToListAsync(ct);
        if (ids.Count == 0) return 0;

        await _db.Submissions
            .Where(s => s.AssignmentId != null && ids.Contains(s.AssignmentId.Value))
            .ExecuteUpdateAsync(s => s.SetProperty(x => x.AssignmentId, (Guid?)null), ct);
        return await _db.Assignments.Where(a => ids.Contains(a.Id)).ExecuteDeleteAsync(ct);
    }

    private static bool IsTeacher(User u) => u.Role is UserRole.Teacher or UserRole.Admin;

    // Targets = explicit ids ∪ a whole group's members.
    private async Task<List<Guid>> ResolveTargetsAsync(List<Guid>? studentIds, Guid? groupId, CancellationToken ct)
    {
        var target = new HashSet<Guid>(studentIds ?? []);
        if (groupId is not null)
        {
            var members = await _db.GroupMembers
                .Where(gm => gm.GroupId == groupId.Value)
                .Select(gm => gm.StudentId)
                .ToListAsync(ct);
            foreach (var m in members) target.Add(m);
        }
        return target.ToList();
    }

    /// <summary>
    /// The S1 fix. Keep only targets that are students AND (unless the actor is an admin) belong to
    /// the acting teacher's roster — a student who is a member of some group this teacher owns.
    /// This is the check that stops one teacher assigning work to another teacher's students, so it
    /// must stay on every assignment-creation path; the read side (list, review, gradebook) applies
    /// the same roster through <see cref="TeacherScope"/>, which is where this reads it from.
    /// </summary>
    private async Task<List<Guid>> RosterStudentIds(User teacher, List<Guid> targetIds, CancellationToken ct)
    {
        if (targetIds.Count == 0) return [];
        var isAdmin = teacher.Role == UserRole.Admin;
        var roster = TeacherScope.RosterStudentIds(_db, teacher.Id);
        return await _db.Users
            .Where(u => targetIds.Contains(u.Id)
                        && u.Role == UserRole.Student
                        && (isAdmin || roster.Contains(u.Id)))
            .Select(u => u.Id)
            .ToListAsync(ct);
    }

    // A unique 6-char code drawn from the unambiguous alphabet; retries until it finds a free one.
    private async Task<string> GenerateCodeAsync(CancellationToken ct)
    {
        while (true)
        {
            var chars = new char[6];
            for (var i = 0; i < chars.Length; i++)
                chars[i] = CodeAlphabet[RandomNumberGenerator.GetInt32(CodeAlphabet.Length)];
            var code = new string(chars);
            if (!await _db.Groups.AnyAsync(g => g.JoinCode == code, ct))
                return code;
        }
    }

    /// <summary><see cref="GroupOutAsync"/> plus the <c>pending</c> flag — the join response.</summary>
    private async Task<JoinGroupResponse> JoinOutAsync(Group g, bool pending, CancellationToken ct)
    {
        var o = await GroupOutAsync(g, ct);
        return new JoinGroupResponse(
            Id: o.Id,
            Name: o.Name,
            JoinCode: o.JoinCode,
            MemberCount: o.MemberCount,
            TeacherId: o.TeacherId,
            TeacherName: o.TeacherName,
            CreatedAt: o.CreatedAt,
            Pending: pending);
    }

    private async Task<GroupResponse> GroupOutAsync(Group g, CancellationToken ct)
    {
        var count = await _db.GroupMembers.CountAsync(gm => gm.GroupId == g.Id, ct);
        var teacherName = await TeacherNameAsync(g.TeacherId, ct);
        return new GroupResponse(
            Id: g.Id,
            Name: g.Name,
            JoinCode: g.JoinCode,
            MemberCount: count,
            TeacherId: g.TeacherId,
            TeacherName: teacherName,
            CreatedAt: g.CreatedAt);
    }

    private async Task<IReadOnlyList<GroupResponse>> GroupsOutAsync(List<Group> groups, CancellationToken ct)
    {
        var result = new List<GroupResponse>(groups.Count);
        foreach (var g in groups)
            result.Add(await GroupOutAsync(g, ct));
        return result;
    }

    private async Task<string?> TeacherNameAsync(Guid teacherId, CancellationToken ct)
        => await _db.Users.Where(u => u.Id == teacherId).Select(u => u.FullName).FirstOrDefaultAsync(ct);

    // Serialize assignments with the live completion state + level-relative band, using bulk lookups
    // (a handful of queries, not one per row).
    private async Task<IReadOnlyList<AssignmentResponse>> AssignmentsOutAsync(List<Assignment> items, CancellationToken ct)
    {
        if (items.Count == 0) return [];

        var studentIds = items.Select(a => a.StudentId).Distinct().ToList();
        var questionIds = items.Select(a => a.QuestionId).Distinct().ToList();

        var students = await _db.Users
            .Where(u => studentIds.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id, ct);
        var questions = await _db.Questions
            .Where(q => questionIds.Contains(q.Id))
            .ToDictionaryAsync(q => q.Id, ct);

        // Candidate submissions for these (student, question) pairs, newest first — the first match
        // per pair that is not older than the assignment wins.
        var subs = await _db.Submissions
            .Include(s => s.Evaluation)
            .Where(s => studentIds.Contains(s.StudentId)
                        && s.QuestionId != null
                        && questionIds.Contains(s.QuestionId.Value))
            .OrderByDescending(s => s.CreatedAt)
            .ToListAsync(ct);

        var result = new List<AssignmentResponse>(items.Count);
        foreach (var a in items)
        {
            var sub = subs.FirstOrDefault(s => s.StudentId == a.StudentId
                                               && s.QuestionId == a.QuestionId
                                               && s.CreatedAt >= a.CreatedAt);
            students.TryGetValue(a.StudentId, out var student);
            questions.TryGetValue(a.QuestionId, out var q);
            // Attempts spent, by the SAME rule the submit gate enforces (AttemptsSpent) — one
            // definition, so the number a student is shown can never disagree with the number that
            // turns them away.
            var used = subs.Count(s => s.AssignmentId == a.Id && s.Status != SubmissionStatus.Failed);
            result.Add(new AssignmentResponse(
                Id: a.Id,
                StudentId: a.StudentId,
                StudentName: student?.FullName,
                QuestionId: a.QuestionId,
                QuestionTitle: q?.Title,
                QuestionTopic: q?.Topic,
                QuestionLevel: q?.Level,
                DueAt: a.DueAt,
                CreatedAt: a.CreatedAt,
                Completed: sub is not null,
                SubmissionId: sub?.Id,
                OverallBand: sub is null ? null : ClassroomScoring.EffectiveBand(sub),
                MaxAttempts: a.MaxAttempts,
                AttemptsUsed: used));
        }
        return result;
    }

    /// <summary>
    /// Validates an attempt budget. <c>null</c> is valid and means unlimited.
    ///
    /// <para>The ceiling is deliberate. The field exists so a teacher can say "three tries, make them
    /// count"; a budget of 40 is not a budget, and an unbounded integer invites a typo (30 meant as
    /// 3) that silently reads as no limit at all. A teacher who wants no limit says so by leaving it
    /// empty, which is unambiguous.</para>
    /// </summary>
    /// <returns>An error message, or <c>null</c> when the value is acceptable.</returns>
    private static string? InvalidMaxAttempts(int? value)
        => value is null || (value >= 1 && value <= MaxAttemptsCeiling)
            ? null
            : $"max_attempts must be between 1 and {MaxAttemptsCeiling}, or omitted for unlimited";

    /// <summary>Upper bound for <c>max_attempts</c>. See <see cref="InvalidMaxAttempts"/>.</summary>
    private const int MaxAttemptsCeiling = 10;
}

// ─── Result plumbing (mirrors the Practice module's outcome→HTTP mapping) ────

/// <summary>Domain outcome an endpoint maps to an HTTP status.</summary>
public enum ClassroomOutcome { Ok, Unauthorized, Forbidden, NotFound, BadRequest }

/// <summary>A service result: an <see cref="ClassroomOutcome"/> plus a payload on success, and for
/// errors an optional human <c>Detail</c> and machine <c>Code</c>. A code is written to the error
/// body only when there is one, so every 400 that predates codes keeps its exact
/// <c>{ "detail": ... }</c> shape.</summary>
public sealed record ClassroomResult<T>(
    ClassroomOutcome Outcome, T? Value = null, string? Detail = null, string? Code = null)
    where T : class
{
    public static ClassroomResult<T> Ok(T value) => new(ClassroomOutcome.Ok, value);
    public static ClassroomResult<T> Unauthorized() => new(ClassroomOutcome.Unauthorized);
    public static ClassroomResult<T> Forbidden() => new(ClassroomOutcome.Forbidden);
    public static ClassroomResult<T> NotFound() => new(ClassroomOutcome.NotFound);
    public static ClassroomResult<T> BadRequest(string detail, string? code = null)
        => new(ClassroomOutcome.BadRequest, null, detail, code);
}
