using System.Security.Cryptography;
using Govori.Contracts;
using Govori.Infrastructure;
using Govori.Infrastructure.Entities;
using Microsoft.EntityFrameworkCore;

namespace Govori.Classroom;

/// <summary>
/// Application service for the Classroom vertical slice (docs/07 §3.5, Faza 3.5) — teacher groups,
/// assignments and the gradebook. Its responsibilities:
/// <list type="bullet">
///   <item>groups: create / join / leave / mine / list / detail-with-roster;</item>
///   <item>assignments: single-task and whole-module creation, plus the teacher and student lists;</item>
///   <item>gradebook: choosing which submissions a viewer may see, then one scored row per student.</item>
/// </list>
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
/// <para>Deferred (documented, not silently dropped): teacher/student NOTIFICATIONS on join/assign
/// (the notifications module is not wired into this slice — they are side effects that would ride on
/// the same transaction, not part of the core write); and the many non-core group endpoints
/// (overview, add/remove member, regenerate, rename, delete, task due/delete, admin
/// (re)assign-teacher) + CSV/analytics — out of this slice's scope.</para>
/// </summary>
public sealed class ClassroomService
{
    private readonly GovoriDbContext _db;

    public ClassroomService(GovoriDbContext db) => _db = db;

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
            _db.GroupJoinRequests.Add(new GroupJoinRequest
            {
                Id = Guid.NewGuid(),
                GroupId = group.Id,
                StudentId = user.Id,
                Status = GroupJoinRequest.StatusPending,
                CreatedAt = now,
                UpdatedAt = now,
            });
            // (Deferred) notifying the group's teacher — the notifications module is not wired in here.
            await _db.SaveChangesAsync(ct);
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

    // ─── Assignments ────────────────────────────────────────────────────────

    /// <summary>POST /assignments — assign one task, with a deadline, to explicit students and/or a
    /// whole group. A teacher may only assign their OWN question (admin: any).
    /// <b>S1 fix</b>: targets are filtered through the teacher's roster before rows are written.</summary>
    public async Task<ClassroomResult<IReadOnlyList<AssignmentResponse>>> CreateAssignmentsAsync(
        Guid userId, CreateAssignmentRequest payload, CancellationToken ct = default)
    {
        var user = await ActiveUserAsync(userId, ct);
        if (user is null) return ClassroomResult<IReadOnlyList<AssignmentResponse>>.Unauthorized();
        if (!IsTeacher(user)) return ClassroomResult<IReadOnlyList<AssignmentResponse>>.Forbidden();

        var q = await _db.Questions.FirstOrDefaultAsync(x => x.Id == payload.QuestionId, ct);
        if (q is null || (user.Role != UserRole.Admin && q.TeacherId != user.Id))
            return ClassroomResult<IReadOnlyList<AssignmentResponse>>.NotFound();  // missing, or not theirs

        var targetIds = await ResolveTargetsAsync(payload.StudentIds, payload.GroupId, ct);
        var validIds = await RosterStudentIds(user, targetIds, ct);               // S1 fix

        var now = DateTime.UtcNow;
        var created = new List<Assignment>();
        foreach (var sid in validIds)
        {
            var a = new Assignment
            {
                Id = Guid.NewGuid(),
                TeacherId = user.Id,
                StudentId = sid,
                QuestionId = payload.QuestionId,
                GroupId = payload.GroupId,
                DueAt = payload.DueAt,
                CreatedAt = now,
                UpdatedAt = now,
            };
            _db.Assignments.Add(a);
            created.Add(a);
            // (Deferred) notifying each student — the notifications module is not wired in here.
        }
        if (created.Count > 0) await _db.SaveChangesAsync(ct);
        return ClassroomResult<IReadOnlyList<AssignmentResponse>>.Ok(await AssignmentsOutAsync(created, ct));
    }

    /// <summary>POST /assignments/module — assign every published task of a module in one go.
    /// A teacher must own the module (admin: any). Skips tasks a student already has an
    /// assignment for. <b>S1 fix</b>: same roster filter as the single-task path.</summary>
    public async Task<ClassroomResult<IReadOnlyList<AssignmentResponse>>> CreateModuleAssignmentsAsync(
        Guid userId, CreateModuleAssignmentRequest payload, CancellationToken ct = default)
    {
        var user = await ActiveUserAsync(userId, ct);
        if (user is null) return ClassroomResult<IReadOnlyList<AssignmentResponse>>.Unauthorized();
        if (!IsTeacher(user)) return ClassroomResult<IReadOnlyList<AssignmentResponse>>.Forbidden();

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
                    CreatedAt = now,
                    UpdatedAt = now,
                };
                _db.Assignments.Add(a);
                created.Add(a);
            }
        }
        if (created.Count > 0) await _db.SaveChangesAsync(ct);
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

    // ─── Gradebook ──────────────────────────────────────────────────────────

    /// <summary>GET /reports/gradebook — one row per student with attempts + stable average/best band.
    /// A teacher is scoped to their OWN questions AND their OWN roster; admin sees
    /// everything. Optional <paramref name="groupId"/> narrows to that group's members. Student ⇒ 403.</summary>
    public async Task<ClassroomResult<IReadOnlyList<GradebookRowResponse>>> GradebookAsync(
        Guid userId, Guid? groupId, CancellationToken ct = default)
    {
        var user = await ActiveUserAsync(userId, ct);
        if (user is null) return ClassroomResult<IReadOnlyList<GradebookRowResponse>>.Unauthorized();
        if (!IsTeacher(user)) return ClassroomResult<IReadOnlyList<GradebookRowResponse>>.Forbidden();

        var subs = await RelevantSubmissionsAsync(user, groupId, ct);
        return ClassroomResult<IReadOnlyList<GradebookRowResponse>>.Ok(await GradebookRowsAsync(subs, ct));
    }

    // The submission set a gradebook/analytics view is allowed to see.
    private async Task<List<Submission>> RelevantSubmissionsAsync(User user, Guid? groupId, CancellationToken ct)
    {
        var stmt = _db.Submissions.Include(s => s.Evaluation).AsQueryable();

        if (user.Role == UserRole.Teacher)   // admin: no restriction
        {
            // Own questions AND own students (roster) only — never a student this teacher doesn't teach.
            var roster = _db.GroupMembers
                .Where(gm => gm.Group.TeacherId == user.Id)
                .Select(gm => gm.StudentId);
            stmt = stmt.Where(s => s.Question != null
                                   && s.Question.TeacherId == user.Id
                                   && roster.Contains(s.StudentId));
        }

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
            rows.Add(new GradebookRowResponse(
                StudentId: g.Key,
                FullName: u?.FullName ?? "—",
                Email: u?.Email ?? string.Empty,
                Attempts: slist.Count,
                AvgBand: ClassroomScoring.RollingAvg(slist),
                BestBand: ClassroomScoring.BestBand(slist),
                LastActivity: slist.Max(s => s.CreatedAt)));
        }
        rows.Sort((a, b) => string.Compare(a.FullName, b.FullName, StringComparison.OrdinalIgnoreCase));
        return rows;
    }

    // ─── Shared helpers ─────────────────────────────────────────────────────

    private async Task<User?> ActiveUserAsync(Guid userId, CancellationToken ct)
        => await _db.Users.FirstOrDefaultAsync(u => u.Id == userId && u.IsActive, ct);

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
    /// must stay on every assignment-creation path; the review-queue path applies the same rule.
    /// </summary>
    private async Task<List<Guid>> RosterStudentIds(User teacher, List<Guid> targetIds, CancellationToken ct)
    {
        if (targetIds.Count == 0) return [];
        var isAdmin = teacher.Role == UserRole.Admin;
        return await _db.Users
            .Where(u => targetIds.Contains(u.Id)
                        && u.Role == UserRole.Student
                        && (isAdmin
                            || _db.GroupMembers.Any(gm => gm.StudentId == u.Id
                                                          && gm.Group.TeacherId == teacher.Id)))
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
                OverallBand: sub is null ? null : ClassroomScoring.EffectiveBand(sub)));
        }
        return result;
    }
}

// ─── Result plumbing (mirrors the Practice module's outcome→HTTP mapping) ────

/// <summary>Domain outcome an endpoint maps to an HTTP status.</summary>
public enum ClassroomOutcome { Ok, Unauthorized, Forbidden, NotFound, BadRequest }

/// <summary>A service result: an <see cref="ClassroomOutcome"/> plus a payload on success and an
/// optional detail message for error bodies.</summary>
public sealed record ClassroomResult<T>(ClassroomOutcome Outcome, T? Value = null, string? Detail = null)
    where T : class
{
    public static ClassroomResult<T> Ok(T value) => new(ClassroomOutcome.Ok, value);
    public static ClassroomResult<T> Unauthorized() => new(ClassroomOutcome.Unauthorized);
    public static ClassroomResult<T> Forbidden() => new(ClassroomOutcome.Forbidden);
    public static ClassroomResult<T> NotFound() => new(ClassroomOutcome.NotFound);
    public static ClassroomResult<T> BadRequest(string detail) => new(ClassroomOutcome.BadRequest, null, detail);
}
