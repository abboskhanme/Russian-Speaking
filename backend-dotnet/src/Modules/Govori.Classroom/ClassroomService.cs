using System.Security.Cryptography;
using Govori.Contracts;
using Govori.Infrastructure;
using Govori.Infrastructure.Entities;
using Microsoft.EntityFrameworkCore;

namespace Govori.Classroom;

/// <summary>
/// Application service for the Classroom vertical slice (docs/07 §3.5, Faza 3.5) — teacher groups,
/// assignments and the gradebook. Ported faithfully from Python:
/// <list type="bullet">
///   <item>groups: <c>backend/app/api/v1/groups.py</c> (create / join / mine / detail);</item>
///   <item>assignments: <c>backend/app/api/v1/engagement.py</c> (create / module / list);</item>
///   <item>gradebook: <c>backend/app/api/v1/reports.py</c> (<c>_relevant_submissions</c> + <c>_gradebook</c>).</item>
/// </list>
///
/// <para><b>S1 SECURITY FIX (the one intentional deviation — docs/07 §7.8, docs/08 Faza 3.5).</b>
/// Python's <c>create_assignments</c> (engagement.py:400-404) resolves target students as
/// <c>student_ids ∪ group members</c> and filters ONLY by <c>role == student</c> — it never checks
/// that those students belong to the acting teacher, so ANY teacher could push an assignment onto
/// ANY student. Its sibling <c>create_reviews</c> (engagement.py:250-258) DOES filter through the
/// teacher's roster — the audit flagged this inconsistency as bug S1. This port applies the
/// <c>create_reviews</c>-style roster filter to BOTH assignment-creation paths
/// (<see cref="CreateAssignmentsAsync"/> / <see cref="CreateModuleAssignmentsAsync"/>) via
/// <see cref="RosterStudentIds"/>. Admins still target anyone (super-user), exactly as
/// <c>create_reviews</c> allows.</para>
///
/// <para>Role/ownership: <c>require_teacher</c> ⇒ teacher OR admin (403 otherwise);
/// <c>get_current_user</c> ⇒ any active user (401 if missing/inactive). role/is_active are read
/// from the DB, never trusted from the token — the endpoint only supplies the <c>sub</c>.</para>
///
/// <para>Deferred vs Python (documented, not silently dropped): teacher/student NOTIFICATIONS on
/// join/assign (notifications module not yet ported — commit=False side effects, not part of the
/// core write); and the many non-core group endpoints (overview, add/remove member, regenerate,
/// rename, delete, task due/delete, admin (re)assign-teacher) + CSV/analytics — out of this
/// slice's scope.</para>
/// </summary>
public sealed class ClassroomService
{
    private readonly GovoriDbContext _db;

    public ClassroomService(GovoriDbContext db) => _db = db;

    // Unambiguous join-code alphabet — no 0/O/1/I (groups.py:44).
    private const string CodeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    // ─── Groups ─────────────────────────────────────────────────────────────

    /// <summary>POST /groups — a teacher (or admin) creates a group and gets a join code
    /// (groups.py:101-111). Empty name falls back to "Группа", mirroring Python.</summary>
    public async Task<ClassroomResult<GroupResponse>> CreateGroupAsync(
        Guid userId, CreateGroupRequest payload, CancellationToken ct = default)
    {
        var user = await ActiveUserAsync(userId, ct);
        if (user is null) return ClassroomResult<GroupResponse>.Unauthorized();
        if (!IsTeacher(user)) return ClassroomResult<GroupResponse>.Forbidden();

        var name = (payload.Name ?? string.Empty).Trim();
        if (name.Length == 0) name = "Группа";                       // groups.py:107

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

    /// <summary>POST /groups/join — the current user joins the group with this code, idempotently
    /// (groups.py:160-197). Invalid code → NotFound. Any active user may join (get_current_user),
    /// exactly as Python allows.</summary>
    public async Task<ClassroomResult<GroupResponse>> JoinGroupAsync(
        Guid userId, JoinGroupRequest payload, CancellationToken ct = default)
    {
        var user = await ActiveUserAsync(userId, ct);
        if (user is null) return ClassroomResult<GroupResponse>.Unauthorized();

        var code = (payload.Code ?? string.Empty).Trim().ToUpperInvariant();  // groups.py:166
        var group = await _db.Groups.FirstOrDefaultAsync(g => g.JoinCode == code, ct);
        if (group is null) return ClassroomResult<GroupResponse>.NotFound();   // groups.py:194-195

        var already = await _db.GroupMembers.AnyAsync(
            gm => gm.GroupId == group.Id && gm.StudentId == user.Id, ct);
        if (!already)                                                          // idempotent (groups.py:169-173)
        {
            var now = DateTime.UtcNow;
            _db.GroupMembers.Add(new GroupMember
            {
                Id = Guid.NewGuid(),
                GroupId = group.Id,
                StudentId = user.Id,
                CreatedAt = now,
                UpdatedAt = now,
            });
            // (Deferred) Python also notifies the group's teacher — notifications module not ported.
            await _db.SaveChangesAsync(ct);
        }
        return ClassroomResult<GroupResponse>.Ok(await GroupOutAsync(group, ct));
    }

    /// <summary>GET /groups/mine — the groups the current user is a member of (groups.py:150-157).
    /// Any active user; null ⇒ 401.</summary>
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

    /// <summary>GET /groups — the teacher's own groups, newest first (groups.py:135-147). Admin sees
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

    /// <summary>GET /groups/{id} — a group with its roster (groups.py:200-209). Teacher must own it;
    /// admin may read any. Missing OR not-owned ⇒ NotFound (never leaks existence, groups.py:207).</summary>
    public async Task<ClassroomResult<GroupDetailResponse>> GroupDetailAsync(
        Guid userId, Guid groupId, CancellationToken ct = default)
    {
        var user = await ActiveUserAsync(userId, ct);
        if (user is null) return ClassroomResult<GroupDetailResponse>.Unauthorized();
        if (!IsTeacher(user)) return ClassroomResult<GroupDetailResponse>.Forbidden();

        var group = await _db.Groups.FirstOrDefaultAsync(g => g.Id == groupId, ct);
        if (group is null || (user.Role != UserRole.Admin && group.TeacherId != user.Id))
            return ClassroomResult<GroupDetailResponse>.NotFound();

        // Roster student ids for this group (groups.py:69-71).
        var memberIds = await _db.GroupMembers
            .Where(gm => gm.GroupId == group.Id)
            .Select(gm => gm.StudentId)
            .ToListAsync(ct);

        var members = new List<GroupMemberResponse>();
        if (memberIds.Count > 0)
        {
            // Total submissions per member — NOT scoped to this group (groups.py:72-80).
            var counts = (await _db.Submissions
                .Where(s => memberIds.Contains(s.StudentId))
                .GroupBy(s => s.StudentId)
                .Select(g => new { g.Key, Count = g.Count() })
                .ToListAsync(ct))
                .ToDictionary(x => x.Key, x => x.Count);

            var users = await _db.Users
                .Where(u => memberIds.Contains(u.Id))
                .ToDictionaryAsync(u => u.Id, ct);

            foreach (var sid in memberIds)                          // keep roster query order (groups.py:85)
            {
                if (!users.TryGetValue(sid, out var u)) continue;
                members.Add(new GroupMemberResponse(
                    Id: u.Id,
                    FullName: u.FullName,
                    Email: u.Email,
                    IsPremium: u.IsPremium,
                    SubmissionCount: counts.GetValueOrDefault(sid, 0)));
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
    /// whole group (engagement.py:380-429). Teacher may only assign their OWN question (admin: any).
    /// <b>S1 fix</b>: targets are filtered through the teacher's roster before rows are written.</summary>
    public async Task<ClassroomResult<IReadOnlyList<AssignmentResponse>>> CreateAssignmentsAsync(
        Guid userId, CreateAssignmentRequest payload, CancellationToken ct = default)
    {
        var user = await ActiveUserAsync(userId, ct);
        if (user is null) return ClassroomResult<IReadOnlyList<AssignmentResponse>>.Unauthorized();
        if (!IsTeacher(user)) return ClassroomResult<IReadOnlyList<AssignmentResponse>>.Forbidden();

        var q = await _db.Questions.FirstOrDefaultAsync(x => x.Id == payload.QuestionId, ct);
        if (q is null || (user.Role != UserRole.Admin && q.TeacherId != user.Id))
            return ClassroomResult<IReadOnlyList<AssignmentResponse>>.NotFound();  // engagement.py:386-388

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
            // (Deferred) Python notifies each student — notifications module not ported.
        }
        if (created.Count > 0) await _db.SaveChangesAsync(ct);
        return ClassroomResult<IReadOnlyList<AssignmentResponse>>.Ok(await AssignmentsOutAsync(created, ct));
    }

    /// <summary>POST /assignments/module — assign every published task of a module in one go
    /// (engagement.py:443-506). Teacher must own the module (admin: any). Skips tasks a student
    /// already has an assignment for. <b>S1 fix</b>: same roster filter as the single-task path.</summary>
    public async Task<ClassroomResult<IReadOnlyList<AssignmentResponse>>> CreateModuleAssignmentsAsync(
        Guid userId, CreateModuleAssignmentRequest payload, CancellationToken ct = default)
    {
        var user = await ActiveUserAsync(userId, ct);
        if (user is null) return ClassroomResult<IReadOnlyList<AssignmentResponse>>.Unauthorized();
        if (!IsTeacher(user)) return ClassroomResult<IReadOnlyList<AssignmentResponse>>.Forbidden();

        var block = await _db.QuestionBlocks.FirstOrDefaultAsync(b => b.Id == payload.BlockId, ct);
        if (block is null || (user.Role != UserRole.Admin && block.TeacherId != user.Id))
            return ClassroomResult<IReadOnlyList<AssignmentResponse>>.NotFound();  // engagement.py:450-452

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
                if (existing.Contains(task.Id)) continue;            // avoid duplicates (engagement.py:481-483)
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

    /// <summary>GET /assignments — the teacher's own assignments, newest first (engagement.py:509-518).
    /// Admin sees every teacher's. Student ⇒ 403.</summary>
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

    /// <summary>GET /assignments/mine — the current user's own assignments, newest first
    /// (engagement.py:521-529). Any active user; null ⇒ 401.</summary>
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

    /// <summary>GET /reports/gradebook — one row per student with attempts + stable average/best band
    /// (reports.py:22-82). Teacher is scoped to their OWN questions AND their OWN roster; admin sees
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

    // reports.py:22-46 — the submission set a gradebook/analytics view is allowed to see.
    private async Task<List<Submission>> RelevantSubmissionsAsync(User user, Guid? groupId, CancellationToken ct)
    {
        var stmt = _db.Submissions.Include(s => s.Evaluation).AsQueryable();

        if (user.Role == UserRole.Teacher)   // admin: no restriction (reports.py:26)
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
            if (memberIds.Count == 0) return [];                    // reports.py:43-44
            stmt = stmt.Where(s => memberIds.Contains(s.StudentId));
        }

        return await stmt.ToListAsync(ct);
    }

    // reports.py:49-73 — group by student, score with the shared C3 definition, sort by name.
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

    // Targets = explicit ids ∪ a whole group's members (engagement.py:392-398 / 432-437).
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
    /// the acting teacher's roster — a student who is a member of some group this teacher owns. Ports
    /// the roster filter that <c>create_reviews</c> already had (engagement.py:250-258) onto the
    /// assignment path, which lacked it (engagement.py:400-404).
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

    // groups.py:47-51 — a unique 6-char code from the unambiguous alphabet.
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

    // engagement.py:321-377 — serialize assignments with the live completion state + level-relative
    // band, using bulk lookups (a handful of queries, not per-row).
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
        // per pair that is not older than the assignment wins (engagement.py:335-356).
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
