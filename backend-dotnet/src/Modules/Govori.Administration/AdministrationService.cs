using Govori.Contracts;
using Govori.Infrastructure;
using Govori.Infrastructure.Entities;
using Microsoft.EntityFrameworkCore;

namespace Govori.Administration;

/// <summary>
/// Application service for the Administration vertical slice (docs/07 §3.7, Faza 3.7) — admin user
/// management. Faithful port of <c>backend/app/api/v1/admin.py</c> (stats + teacher/student list +
/// update + delete). Role gate = <c>require_admin</c> (deps.py:66-69): any non-admin ⇒ 403, an
/// inactive/absent user ⇒ 401. role/is_active are read from the DB, never trusted from the token.
///
/// <para><b>Freemium grant/revoke + (de)activate.</b> Premium is granted/revoked and accounts are
/// (de)activated through <see cref="UpdateStudentAsync"/> (<c>is_premium</c> / <c>is_active</c>) —
/// the same PATCH the Python admin surface uses (admin.py:173-196). The flag lives on
/// <c>users.is_premium</c> and is read live by the freemium gate, so a grant takes effect on the
/// student's next request without re-login.</para>
///
/// <para><b>Deferred vs the Python admin surface (documented, not silently dropped):</b>
/// <list type="bullet">
///   <item>CREATE teacher/student and password change (admin.py:73-90 / 153-170; the
///   <c>password</c> branch of the PATCH handlers) — these need the frozen BCrypt hasher, an
///   Identity-module auth primitive this module intentionally does not reference (see the csproj
///   note). None of the task-enumerated ops need hashing;</item>
///   <item><c>GET /admin/students/{id}/detail</c> (admin.py:212-223) — its drill-down reuses the
///   submission/scoring serialization owned by the Classroom/Assessment slices; out of this slice's
///   scope.</item>
/// </list></para>
///
/// <para>Search (<c>?search=</c>) is an additive enhancement over admin.py's plain list, porting the
/// <c>ilike(full_name|email)</c> predicate from the sibling <c>users.list_students</c>
/// (users.py:65-67) so the task's "list/search users" is satisfied. Admin scope = everyone.</para>
/// </summary>
public sealed class AdministrationService
{
    private readonly GovoriDbContext _db;

    public AdministrationService(GovoriDbContext db) => _db = db;

    // ─── Auth gates (shared with the settings endpoints) ─────────────────────

    /// <summary>require_admin (deps.py:66-69): active user + admin role, else Unauthorized/Forbidden.</summary>
    public async Task<AdminOutcome> CheckAdminAsync(Guid userId, CancellationToken ct = default)
    {
        var user = await _db.Users
            .AsNoTracking()
            .FirstOrDefaultAsync(u => u.Id == userId && u.IsActive, ct);
        if (user is null) return AdminOutcome.Unauthorized;
        return user.Role == UserRole.Admin ? AdminOutcome.Ok : AdminOutcome.Forbidden;
    }

    /// <summary>get_current_user (deps.py:15-33): any active user, else Unauthorized. Backs the
    /// public read of runtime links.</summary>
    public async Task<AdminOutcome> CheckActiveUserAsync(Guid userId, CancellationToken ct = default)
        => await _db.Users.AsNoTracking().AnyAsync(u => u.Id == userId && u.IsActive, ct)
            ? AdminOutcome.Ok
            : AdminOutcome.Unauthorized;

    // ─── Stats (admin.py:32-48) ──────────────────────────────────────────────

    public async Task<AdminResult<AdminStatsResponse>> StatsAsync(Guid userId, CancellationToken ct = default)
    {
        var gate = await CheckAdminAsync(userId, ct);
        if (gate != AdminOutcome.Ok) return AdminResult<AdminStatsResponse>.From(gate);

        var stats = new AdminStatsResponse(
            Teachers: await _db.Users.CountAsync(u => u.Role == UserRole.Teacher, ct),
            Students: await _db.Users.CountAsync(u => u.Role == UserRole.Student, ct),
            Questions: await _db.Questions.CountAsync(ct),
            PublishedQuestions: await _db.Questions.CountAsync(q => q.IsPublished, ct),
            Submissions: await _db.Submissions.CountAsync(ct),
            EvaluatedSubmissions: await _db.Submissions.CountAsync(s => s.Status == SubmissionStatus.Done, ct));
        return AdminResult<AdminStatsResponse>.Ok(stats);
    }

    // ─── Teachers (admin.py:57-127) ──────────────────────────────────────────

    public async Task<AdminResult<IReadOnlyList<TeacherResponse>>> ListTeachersAsync(
        Guid userId, string? search, CancellationToken ct = default)
    {
        var gate = await CheckAdminAsync(userId, ct);
        if (gate != AdminOutcome.Ok) return AdminResult<IReadOnlyList<TeacherResponse>>.From(gate);

        var q = _db.Users.AsNoTracking().Where(u => u.Role == UserRole.Teacher);
        q = ApplySearch(q, search);
        var teachers = await q.OrderBy(u => u.CreatedAt).ToListAsync(ct);

        var counts = await QuestionCountsAsync(teachers.Select(t => t.Id).ToList(), ct);
        var rows = teachers.Select(t => TeacherOut(t, counts.GetValueOrDefault(t.Id, 0))).ToList();
        return AdminResult<IReadOnlyList<TeacherResponse>>.Ok(rows);
    }

    public async Task<AdminResult<TeacherResponse>> UpdateTeacherAsync(
        Guid userId, Guid teacherId, TeacherUpdateRequest payload, CancellationToken ct = default)
    {
        var gate = await CheckAdminAsync(userId, ct);
        if (gate != AdminOutcome.Ok) return AdminResult<TeacherResponse>.From(gate);

        var teacher = await _db.Users.FirstOrDefaultAsync(u => u.Id == teacherId, ct);
        if (teacher is null || teacher.Role != UserRole.Teacher)
            return AdminResult<TeacherResponse>.NotFound();      // admin.py:101-102

        if (payload.FullName is not null) teacher.FullName = payload.FullName;
        if (payload.IsActive is not null) teacher.IsActive = payload.IsActive.Value;
        teacher.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);

        var count = await _db.Questions.CountAsync(q => q.TeacherId == teacher.Id, ct);
        return AdminResult<TeacherResponse>.Ok(TeacherOut(teacher, count));
    }

    public async Task<AdminResult<Unit>> DeleteTeacherAsync(
        Guid userId, Guid teacherId, CancellationToken ct = default)
    {
        var gate = await CheckAdminAsync(userId, ct);
        if (gate != AdminOutcome.Ok) return AdminResult<Unit>.From(gate);

        var teacher = await _db.Users.FirstOrDefaultAsync(u => u.Id == teacherId, ct);
        if (teacher is null || teacher.Role != UserRole.Teacher)
            return AdminResult<Unit>.NotFound();                 // admin.py:124-125

        _db.Users.Remove(teacher);
        await _db.SaveChangesAsync(ct);
        return AdminResult<Unit>.Ok(Unit.Value);
    }

    // ─── Students (admin.py:137-209) ─────────────────────────────────────────

    public async Task<AdminResult<IReadOnlyList<StudentResponse>>> ListStudentsAsync(
        Guid userId, string? search, CancellationToken ct = default)
    {
        var gate = await CheckAdminAsync(userId, ct);
        if (gate != AdminOutcome.Ok) return AdminResult<IReadOnlyList<StudentResponse>>.From(gate);

        var q = _db.Users.AsNoTracking().Where(u => u.Role == UserRole.Student);
        q = ApplySearch(q, search);
        var students = await q.OrderBy(u => u.CreatedAt).ToListAsync(ct);

        var counts = await SubmissionCountsAsync(students.Select(s => s.Id).ToList(), ct);
        var rows = students.Select(s => StudentOut(s, counts.GetValueOrDefault(s.Id, 0))).ToList();
        return AdminResult<IReadOnlyList<StudentResponse>>.Ok(rows);
    }

    public async Task<AdminResult<StudentResponse>> UpdateStudentAsync(
        Guid userId, Guid studentId, StudentUpdateRequest payload, CancellationToken ct = default)
    {
        var gate = await CheckAdminAsync(userId, ct);
        if (gate != AdminOutcome.Ok) return AdminResult<StudentResponse>.From(gate);

        var student = await _db.Users.FirstOrDefaultAsync(u => u.Id == studentId, ct);
        if (student is null || student.Role != UserRole.Student)
            return AdminResult<StudentResponse>.NotFound();      // admin.py:181-182

        if (payload.FullName is not null) student.FullName = payload.FullName;
        if (payload.IsActive is not null) student.IsActive = payload.IsActive.Value;
        if (payload.IsPremium is not null) student.IsPremium = payload.IsPremium.Value;  // grant/revoke
        student.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);

        var count = await _db.Submissions.CountAsync(s => s.StudentId == student.Id, ct);
        return AdminResult<StudentResponse>.Ok(StudentOut(student, count));
    }

    public async Task<AdminResult<Unit>> DeleteStudentAsync(
        Guid userId, Guid studentId, CancellationToken ct = default)
    {
        var gate = await CheckAdminAsync(userId, ct);
        if (gate != AdminOutcome.Ok) return AdminResult<Unit>.From(gate);

        var student = await _db.Users.FirstOrDefaultAsync(u => u.Id == studentId, ct);
        if (student is null || student.Role != UserRole.Student)
            return AdminResult<Unit>.NotFound();                 // admin.py:206-207

        _db.Users.Remove(student);
        await _db.SaveChangesAsync(ct);
        return AdminResult<Unit>.Ok(Unit.Value);
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    // users.py:65-67 — case-insensitive contains over full_name OR email.
    private static IQueryable<User> ApplySearch(IQueryable<User> q, string? search)
    {
        var term = search?.Trim();
        if (string.IsNullOrEmpty(term)) return q;
        var like = $"%{term}%";
        return q.Where(u => EF.Functions.ILike(u.FullName, like) || EF.Functions.ILike(u.Email, like));
    }

    private async Task<Dictionary<Guid, int>> QuestionCountsAsync(List<Guid> teacherIds, CancellationToken ct)
    {
        if (teacherIds.Count == 0) return new();
        return (await _db.Questions
                .Where(q => teacherIds.Contains(q.TeacherId))
                .GroupBy(q => q.TeacherId)
                .Select(g => new { g.Key, Count = g.Count() })
                .ToListAsync(ct))
            .ToDictionary(x => x.Key, x => x.Count);
    }

    private async Task<Dictionary<Guid, int>> SubmissionCountsAsync(List<Guid> studentIds, CancellationToken ct)
    {
        if (studentIds.Count == 0) return new();
        return (await _db.Submissions
                .Where(s => studentIds.Contains(s.StudentId))
                .GroupBy(s => s.StudentId)
                .Select(g => new { g.Key, Count = g.Count() })
                .ToListAsync(ct))
            .ToDictionary(x => x.Key, x => x.Count);
    }

    private static TeacherResponse TeacherOut(User t, int questionCount)
        => new(t.Id, t.Email, t.FullName, t.IsActive, t.CreatedAt, questionCount);

    private static StudentResponse StudentOut(User s, int submissionCount)
        => new(s.Id, s.Email, s.FullName, s.Phone, s.Region, s.District, s.Age,
               s.IsActive, s.IsPremium, s.CreatedAt, submissionCount);
}

// ─── Result plumbing (mirrors the Classroom module's outcome→HTTP mapping) ───

/// <summary>Domain outcome an endpoint maps to an HTTP status.</summary>
public enum AdminOutcome { Ok, Unauthorized, Forbidden, NotFound }

/// <summary>Unit payload for outcomes with no body (204 delete).</summary>
public sealed record Unit
{
    public static readonly Unit Value = new();
}

/// <summary>A service result: an <see cref="AdminOutcome"/> plus a payload on success.</summary>
public sealed record AdminResult<T>(AdminOutcome Outcome, T? Value = default)
{
    public static AdminResult<T> Ok(T value) => new(AdminOutcome.Ok, value);
    public static AdminResult<T> NotFound() => new(AdminOutcome.NotFound);
    public static AdminResult<T> From(AdminOutcome outcome) => new(outcome);
}
