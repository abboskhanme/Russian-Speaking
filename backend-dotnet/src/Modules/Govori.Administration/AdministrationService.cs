using Govori.Contracts;
using Govori.Infrastructure;
using Govori.Infrastructure.Entities;
using Microsoft.EntityFrameworkCore;

namespace Govori.Administration;

/// <summary>
/// Application service for the Administration vertical slice (docs/07 §3.7, Faza 3.7) — admin user
/// management: dashboard stats, list/update/delete for teachers and students, creating a teacher,
/// listing admins, and changing a user's role. The role gate is admin-only: any non-admin ⇒ 403, an
/// inactive/absent user ⇒ 401. role and is_active are read from the DB on every call, never trusted
/// from the token — which is also why a role change takes effect on the user's very next request,
/// with no token to revoke.
///
/// <para><b>Freemium grant/revoke + (de)activate.</b> Premium is granted/revoked and accounts are
/// (de)activated through <see cref="UpdateStudentAsync"/> (<c>is_premium</c> / <c>is_active</c>).
/// The flag lives on <c>users.is_premium</c> and is read live by the freemium gate, so a grant takes
/// effect on the student's next request without re-login.</para>
///
/// <para><b>How a teacher comes to exist.</b> Self-service sign-up always makes a student and
/// <c>deploy/bootstrap-admin.sh</c> only makes admins, so on a fresh install the ONLY paths to a
/// teacher are <see cref="CreateTeacherAsync"/> (a new account for a phone nobody uses yet) and
/// <see cref="ChangeRoleAsync"/> (promote an existing student). Accounts are passwordless — phone +
/// Telegram OTP — so creating one needs no hashing and no Identity-module primitive: the new teacher
/// simply signs in with their number.</para>
///
/// <para><b>Deliberately out of scope:</b> <c>GET /admin/students/{id}/detail</c> — its drill-down
/// reuses the submission/scoring serialization owned by the Classroom/Assessment slices.</para>
///
/// <para>Search (<c>?search=</c>) matches case-insensitively on full name OR email, and — when the
/// term holds at least three digits — on the phone number, so admins can find a user without an
/// exact match. Admin scope = everyone, unlike the teacher-scoped lists.</para>
/// </summary>
public sealed class AdministrationService
{
    /// <summary>Cap for <c>full_name</c>, matching the <c>users.full_name varchar(255)</c> column —
    /// the same limit sign-up enforces, so an over-long name is a clean 400 rather than a Postgres
    /// length error surfacing as a 500.</summary>
    private const int FullNameMaxLength = 255;

    /// <summary>Database names of the two unique indexes a new phone account can collide on. The
    /// placeholder email is DERIVED from the phone, so a duplicate phone is a duplicate email too, and
    /// which one Postgres reports first is not something to depend on (same reasoning as
    /// AuthService's registration path).</summary>
    private const string PhoneUniqueIndex = "ix_users_phone";
    private const string EmailUniqueIndex = "ix_users_email";

    /// <summary>
    /// Key of the transaction-scoped Postgres advisory lock that serialises role changes. The value
    /// is arbitrary; it only has to be one no other code in this database locks on, and nothing else
    /// here takes advisory locks. See <see cref="ChangeRoleAsync"/> for why the lock exists.
    /// <see cref="GroupTransferService"/> takes the same lock, because "who owns groups" is one of
    /// the facts a role change decides on.
    /// </summary>
    internal const long RoleChangeLockKey = 0x676F_766F_7269_0001;   // "govori" + 1

    /// <summary>Minimum digits in a search term before it is also matched against phone numbers.
    /// Fewer than three would match nearly every +998 number and bury the name matches.</summary>
    private const int MinPhoneSearchDigits = 3;

    private readonly GovoriDbContext _db;

    public AdministrationService(GovoriDbContext db) => _db = db;

    // ─── Auth gates (shared with the settings endpoints) ─────────────────────

    /// <summary>The admin gate: the user must be active AND hold the admin role. An inactive or
    /// unknown user is Unauthorized; an active non-admin is Forbidden.</summary>
    public async Task<AdminOutcome> CheckAdminAsync(Guid userId, CancellationToken ct = default)
    {
        var user = await _db.Users
            .AsNoTracking()
            .FirstOrDefaultAsync(u => u.Id == userId && u.IsActive, ct);
        if (user is null) return AdminOutcome.Unauthorized;
        return user.Role == UserRole.Admin ? AdminOutcome.Ok : AdminOutcome.Forbidden;
    }

    /// <summary>The signed-in gate: any active user passes, anyone else is Unauthorized. Backs the
    /// public read of runtime links, which needs a session but no particular role.</summary>
    public async Task<AdminOutcome> CheckActiveUserAsync(Guid userId, CancellationToken ct = default)
        => await _db.Users.AsNoTracking().AnyAsync(u => u.Id == userId && u.IsActive, ct)
            ? AdminOutcome.Ok
            : AdminOutcome.Unauthorized;

    // ─── Stats ───────────────────────────────────────────────────────────────

    public async Task<AdminResult<AdminStatsResponse>> StatsAsync(Guid userId, CancellationToken ct = default)
    {
        var gate = await CheckAdminAsync(userId, ct);
        if (gate != AdminOutcome.Ok) return AdminResult<AdminStatsResponse>.From(gate);

        // Soft-deleted tasks are excluded: the row survives only so student history can still point
        // at it, and counting it would tell the admin a deleted task still exists.
        var stats = new AdminStatsResponse(
            Teachers: await _db.Users.CountAsync(u => u.Role == UserRole.Teacher, ct),
            Students: await _db.Users.CountAsync(u => u.Role == UserRole.Student, ct),
            Questions: await _db.Questions.CountAsync(q => !q.IsDeleted, ct),
            PublishedQuestions: await _db.Questions.CountAsync(q => q.IsPublished && !q.IsDeleted, ct),
            Submissions: await _db.Submissions.CountAsync(ct),
            EvaluatedSubmissions: await _db.Submissions.CountAsync(s => s.Status == SubmissionStatus.Done, ct),
            PendingSubmissions: await _db.Submissions.CountAsync(
                s => s.Status == SubmissionStatus.Pending || s.Status == SubmissionStatus.Processing, ct),
            FailedSubmissions: await _db.Submissions.CountAsync(s => s.Status == SubmissionStatus.Failed, ct));
        return AdminResult<AdminStatsResponse>.Ok(stats);
    }

    /// <summary>Days the activity series covers: two comparable weeks (this one and the one before).</summary>
    public const int ActivityDays = 14;

    /// <summary>
    /// GET /api/admin/stats/activity — per-product-day series for the dashboard's trend deltas and
    /// sparklines. Three bounded queries (the window's submissions as narrow tuples, the window's new
    /// students, the window's AI-ledger rows), bucketed in memory — no per-day round trips.
    /// </summary>
    public async Task<AdminResult<AdminActivityResponse>> ActivityAsync(
        Guid userId, DateTime? utcNow = null, CancellationToken ct = default)
    {
        var gate = await CheckAdminAsync(userId, ct);
        if (gate != AdminOutcome.Ok) return AdminResult<AdminActivityResponse>.From(gate);

        var now = utcNow ?? DateTime.UtcNow;
        var today = ProductDay.Today(now);
        var first = today.AddDays(-(ActivityDays - 1));
        var since = ProductDay.StartUtc(first);

        var subs = await _db.Submissions.AsNoTracking()
            .Where(s => s.CreatedAt >= since)
            .Select(s => new { s.CreatedAt, s.Status, s.StudentId })
            .ToListAsync(ct);
        var joined = await _db.Users.AsNoTracking()
            .Where(u => u.Role == UserRole.Student && u.CreatedAt >= since)
            .Select(u => u.CreatedAt)
            .ToListAsync(ct);
        var spend = await _db.AiSpendDaily.AsNoTracking()
            .Where(r => r.Day >= first && r.Day <= today)
            .GroupBy(r => r.Day)
            .Select(g => new { Day = g.Key, Cost = g.Sum(r => r.CostUsd) })
            .ToListAsync(ct);

        var subsByDay = subs.ToLookup(s => ProductDay.Of(s.CreatedAt));
        var joinedByDay = joined.GroupBy(ProductDay.Of).ToDictionary(g => g.Key, g => g.Count());
        var spendByDay = spend.ToDictionary(r => r.Day, r => r.Cost);

        var days = new List<AdminActivityDay>(ActivityDays);
        for (var d = first; d <= today; d = d.AddDays(1))
        {
            var rows = subsByDay[d].ToList();
            days.Add(new AdminActivityDay(
                d,
                rows.Count,
                rows.Count(r => r.Status == SubmissionStatus.Done),
                rows.Count(r => r.Status == SubmissionStatus.Failed),
                rows.Select(r => r.StudentId).Distinct().Count(),
                joinedByDay.GetValueOrDefault(d, 0),
                (double)Math.Round(spendByDay.GetValueOrDefault(d, 0m), 4)));
        }
        return AdminResult<AdminActivityResponse>.Ok(new AdminActivityResponse(days));
    }

    // ─── Teachers ────────────────────────────────────────────────────────────

    public async Task<AdminResult<IReadOnlyList<TeacherResponse>>> ListTeachersAsync(
        Guid userId, string? search, CancellationToken ct = default)
    {
        var gate = await CheckAdminAsync(userId, ct);
        if (gate != AdminOutcome.Ok) return AdminResult<IReadOnlyList<TeacherResponse>>.From(gate);

        var q = _db.Users.AsNoTracking().Where(u => u.Role == UserRole.Teacher);
        q = ApplySearch(q, search);
        var teachers = await q.OrderBy(u => u.CreatedAt).ToListAsync(ct);

        var ids = teachers.Select(t => t.Id).ToList();
        var counts = await QuestionCountsAsync(ids, ct);
        var rosters = await TeacherRostersAsync(ids, ct);
        var rows = teachers.Select(t =>
        {
            var roster = rosters.GetValueOrDefault(t.Id);
            return TeacherOut(t, counts.GetValueOrDefault(t.Id, 0)) with
            {
                GroupCount = roster.Groups,
                StudentCount = roster.Students,
            };
        }).ToList();
        return AdminResult<IReadOnlyList<TeacherResponse>>.Ok(rows);
    }

    /// <summary>
    /// POST /api/admin/teachers — create a teacher account for a phone nobody uses yet. The account
    /// is shaped exactly like a sign-up (see AuthService's registration path) except for the role:
    /// canonical <c>+998…</c> phone, placeholder email <c>{phone}@govori.uz</c>, NULL
    /// <c>password_hash</c>, active, <c>preferred_language = "uz"</c>. The teacher then signs in with
    /// that number through the ordinary Telegram OTP login, which logs in any existing active phone
    /// account regardless of role.
    ///
    /// <para><b>A taken phone is two different answers.</b> Held by a STUDENT → 409
    /// <c>phone_taken_by_student</c> with the student's id and name, because the real-world case is
    /// "this person already signed up to try the app and is now joining as a teacher" — the admin
    /// wants to promote that account, not mint a second one for the same human. Held by a teacher or
    /// admin → plain 409 <c>phone_taken</c>: there is nothing to offer.</para>
    /// </summary>
    public async Task<AdminResult<TeacherResponse>> CreateTeacherAsync(
        Guid userId, CreateTeacherRequest payload, CancellationToken ct = default)
    {
        var gate = await CheckAdminAsync(userId, ct);
        if (gate != AdminOutcome.Ok) return AdminResult<TeacherResponse>.From(gate);

        string phone;
        try
        {
            phone = PhoneNumbers.NormalizeUz(payload.Phone);
        }
        catch (FormatException ex)
        {
            // The message is the same user-facing one sign-up shows for a bad number.
            return AdminResult<TeacherResponse>.BadRequest(
                new CodedErrorResponse(ex.Message, AdminErrorCodes.InvalidPhone));
        }

        var name = (payload.FullName ?? string.Empty).Trim();
        if (name.Length == 0 || name.Length > FullNameMaxLength)
            return AdminResult<TeacherResponse>.BadRequest(new CodedErrorResponse(
                $"full_name is required (at most {FullNameMaxLength} characters)", AdminErrorCodes.InvalidFullName));

        var email = $"{phone}@govori.uz";
        if (await PhoneConflictAsync(phone, email, ct) is { } conflict)
            return AdminResult<TeacherResponse>.Conflict(conflict);

        var now = DateTime.UtcNow;
        var teacher = new User
        {
            Id = Guid.NewGuid(),                 // Id is ValueGeneratedNever → set client-side
            Phone = phone,
            Email = email,                       // NOT NULL + UNIQUE — the same placeholder sign-up derives
            PasswordHash = null,                 // passwordless: OTP is the only way in
            FullName = name,
            Role = UserRole.Teacher,
            IsActive = true,                     // no DB default on is_active — set explicitly
            IsPremium = false,
            PreferredLanguage = "uz",
            CreatedAt = now,
            UpdatedAt = now,
        };
        _db.Users.Add(teacher);
        try
        {
            await _db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException ex) when (DbErrors.IsUniqueViolation(ex, PhoneUniqueIndex)
                                       || DbErrors.IsUniqueViolation(ex, EmailUniqueIndex))
        {
            // Someone took the number between the check above and this insert — a double-clicked
            // "Qo'shish", or the person signing up at that very moment. Answer as if the check had
            // run a millisecond later. Detach first so the failed insert is not retried by a later
            // SaveChanges on this context.
            _db.Entry(teacher).State = EntityState.Detached;
            var lateConflict = await PhoneConflictAsync(phone, email, ct)
                               ?? new CodedErrorResponse("This phone number is already in use", AdminErrorCodes.PhoneTaken);
            return AdminResult<TeacherResponse>.Conflict(lateConflict);
        }

        return AdminResult<TeacherResponse>.Ok(TeacherOut(teacher, questionCount: 0));
    }

    /// <summary>
    /// The 409 body for a phone (or its derived email) that is already in use, or <c>null</c> when
    /// both are free. The email case is the rare one: a number that was later re-issued to someone
    /// else, while the account that first registered it moved to a new number and — by design —
    /// kept its original placeholder email. That account is not a student to promote, so it answers
    /// the plain <c>phone_taken</c>.
    /// </summary>
    private async Task<object?> PhoneConflictAsync(string phone, string email, CancellationToken ct)
    {
        var holder = await _db.Users.AsNoTracking()
            .Where(u => u.Phone == phone)
            .Select(u => new { u.Id, u.FullName, u.Role })
            .FirstOrDefaultAsync(ct);
        if (holder is not null)
            return holder.Role == UserRole.Student
                ? new PhoneTakenByStudentResponse(
                    "This phone number belongs to a student account", AdminErrorCodes.PhoneTakenByStudent,
                    holder.Id, holder.FullName)
                : new CodedErrorResponse("This phone number is already in use", AdminErrorCodes.PhoneTaken);

        if (await _db.Users.AnyAsync(u => u.Email == email, ct))
            return new CodedErrorResponse(
                "This phone number's login email is held by another account (the number was re-issued)",
                AdminErrorCodes.PhoneTaken);

        return null;
    }

    public async Task<AdminResult<TeacherResponse>> UpdateTeacherAsync(
        Guid userId, Guid teacherId, TeacherUpdateRequest payload, CancellationToken ct = default)
    {
        var gate = await CheckAdminAsync(userId, ct);
        if (gate != AdminOutcome.Ok) return AdminResult<TeacherResponse>.From(gate);

        var teacher = await _db.Users.FirstOrDefaultAsync(u => u.Id == teacherId, ct);
        if (teacher is null || teacher.Role != UserRole.Teacher)
            return AdminResult<TeacherResponse>.NotFound();      // wrong role ⇒ 404, same as absent

        if (payload.FullName is not null) teacher.FullName = payload.FullName;
        if (payload.IsActive is not null) teacher.IsActive = payload.IsActive.Value;
        teacher.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);

        var count = await _db.Questions.CountAsync(q => q.TeacherId == teacher.Id && !q.IsDeleted, ct);
        return AdminResult<TeacherResponse>.Ok(TeacherOut(teacher, count));
    }

    public async Task<AdminResult<Unit>> DeleteTeacherAsync(
        Guid userId, Guid teacherId, CancellationToken ct = default)
    {
        var gate = await CheckAdminAsync(userId, ct);
        if (gate != AdminOutcome.Ok) return AdminResult<Unit>.From(gate);

        var teacher = await _db.Users.FirstOrDefaultAsync(u => u.Id == teacherId, ct);
        if (teacher is null || teacher.Role != UserRole.Teacher)
            return AdminResult<Unit>.NotFound();                 // wrong role ⇒ 404, same as absent

        _db.Users.Remove(teacher);
        await _db.SaveChangesAsync(ct);
        return AdminResult<Unit>.Ok(Unit.Value);
    }

    // ─── Students ────────────────────────────────────────────────────────────

    public async Task<AdminResult<IReadOnlyList<StudentResponse>>> ListStudentsAsync(
        Guid userId, string? search, CancellationToken ct = default)
    {
        var gate = await CheckAdminAsync(userId, ct);
        if (gate != AdminOutcome.Ok) return AdminResult<IReadOnlyList<StudentResponse>>.From(gate);

        var q = _db.Users.AsNoTracking().Where(u => u.Role == UserRole.Student);
        q = ApplySearch(q, search);
        var students = await q.OrderBy(u => u.CreatedAt).ToListAsync(ct);

        // Three set-based reads for the whole page — submissions, scores, group memberships — each
        // one grouped query, never a query per row.
        var ids = students.Select(s => s.Id).ToList();
        var activity = await SubmissionActivityAsync(ids, ct);
        var bands = await AverageBandsAsync(ids, ct);
        var groups = await StudentGroupsAsync(ids, ct);
        var rows = students.Select(s =>
        {
            var act = activity.GetValueOrDefault(s.Id);
            return StudentOut(s, act?.Count ?? 0) with
            {
                LastActiveAt = act?.LastAt,
                AvgBand = bands.TryGetValue(s.Id, out var band)
                    ? Math.Round(band, 1, MidpointRounding.AwayFromZero)
                    : null,
                Groups = groups.GetValueOrDefault(s.Id) ?? [],
            };
        }).ToList();
        return AdminResult<IReadOnlyList<StudentResponse>>.Ok(rows);
    }

    public async Task<AdminResult<StudentResponse>> UpdateStudentAsync(
        Guid userId, Guid studentId, StudentUpdateRequest payload, CancellationToken ct = default)
    {
        var gate = await CheckAdminAsync(userId, ct);
        if (gate != AdminOutcome.Ok) return AdminResult<StudentResponse>.From(gate);

        var student = await _db.Users.FirstOrDefaultAsync(u => u.Id == studentId, ct);
        if (student is null || student.Role != UserRole.Student)
            return AdminResult<StudentResponse>.NotFound();      // wrong role ⇒ 404, same as absent

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
            return AdminResult<Unit>.NotFound();                 // wrong role ⇒ 404, same as absent

        _db.Users.Remove(student);
        await _db.SaveChangesAsync(ct);
        return AdminResult<Unit>.Ok(Unit.Value);
    }

    // ─── Admins + role changes ───────────────────────────────────────────────

    /// <summary>GET /api/admin/admins — every admin account (active or not), oldest first, each
    /// flagged <c>is_self</c> for the caller's own row.</summary>
    public async Task<AdminResult<IReadOnlyList<AdminUserResponse>>> ListAdminsAsync(
        Guid userId, CancellationToken ct = default)
    {
        var gate = await CheckAdminAsync(userId, ct);
        if (gate != AdminOutcome.Ok) return AdminResult<IReadOnlyList<AdminUserResponse>>.From(gate);

        var admins = await _db.Users.AsNoTracking()
            .Where(u => u.Role == UserRole.Admin)
            .OrderBy(u => u.CreatedAt)
            .ToListAsync(ct);

        var counts = await QuestionCountsAsync(admins.Select(a => a.Id).ToList(), ct);
        var rows = admins
            .Select(a => new AdminUserResponse(
                a.Id, a.Email, a.FullName, a.Phone, a.IsActive, a.CreatedAt,
                QuestionCount: counts.GetValueOrDefault(a.Id, 0),
                IsSelf: a.Id == userId))
            .ToList();
        return AdminResult<IReadOnlyList<AdminUserResponse>>.Ok(rows);
    }

    /// <summary>
    /// PATCH /api/admin/users/{id}/role — move a user between student, teacher and admin.
    ///
    /// <para><b>Order of answers:</b> 401/403 gate → 400 <c>invalid_role</c> → 400
    /// <c>cannot_change_own_role</c> → 404 → same role = 200 no-op → 409 <c>last_admin</c> / 409
    /// <c>teacher_owns_groups</c> (<see cref="RoleChangeRules"/>) → 200. An admin may not change
    /// their own role at all: demoting yourself by accident is unrecoverable from the UI, and
    /// promoting yourself is meaningless.</para>
    ///
    /// <para><b>Why a transaction and an advisory lock.</b> The <c>last_admin</c> rule reads "how
    /// many OTHER active admins are there" and then writes. Two admins demoting each other at the same
    /// moment would each read "one other" and both succeed, leaving zero. So every role change takes
    /// the same transaction-scoped lock first and does its gate and its reads inside it: the second
    /// request waits, then re-reads a world in which its caller may no longer be an admin at all —
    /// and is refused (403) rather than acting on authority it has already lost. The lock is released
    /// by the commit or the rollback; role changes are rare, so serialising them costs nothing.</para>
    ///
    /// <para>Nothing else changes with the role: owned modules and tasks stay owned, and a promoted
    /// student keeps their history. The new role applies from the user's next request because the
    /// role is always read from the database, never from the token.</para>
    /// </summary>
    public async Task<AdminResult<UserRoleResponse>> ChangeRoleAsync(
        Guid userId, Guid targetId, UserRoleUpdateRequest payload, CancellationToken ct = default)
    {
        await using var tx = await _db.Database.BeginTransactionAsync(ct);
        await _db.Database.ExecuteSqlAsync($"SELECT pg_advisory_xact_lock({RoleChangeLockKey})", ct);

        var gate = await CheckAdminAsync(userId, ct);
        if (gate != AdminOutcome.Ok) return AdminResult<UserRoleResponse>.From(gate);

        if (!TryParseRole(payload.Role, out var next))
            return AdminResult<UserRoleResponse>.BadRequest(new CodedErrorResponse(
                "role must be one of: student, teacher, admin", AdminErrorCodes.InvalidRole));

        if (targetId == userId)
            return AdminResult<UserRoleResponse>.BadRequest(new CodedErrorResponse(
                "You cannot change your own role", AdminErrorCodes.CannotChangeOwnRole));

        var target = await _db.Users.FirstOrDefaultAsync(u => u.Id == targetId, ct);
        if (target is null) return AdminResult<UserRoleResponse>.NotFound();

        // Both counts are read even when the rule will not need them: two COUNTs on a rare admin
        // action buy a rule that is a pure function of its inputs (and unit-tested as one).
        var otherActiveAdmins = await _db.Users.CountAsync(
            u => u.Role == UserRole.Admin && u.IsActive && u.Id != target.Id, ct);
        var ownedGroups = await _db.Groups.CountAsync(g => g.TeacherId == target.Id, ct);

        switch (RoleChangeRules.Evaluate(target.Role, target.IsActive, next, otherActiveAdmins, ownedGroups))
        {
            case RoleChangeVerdict.NoOp:
                return AdminResult<UserRoleResponse>.Ok(new UserRoleResponse(target.Id, RoleWire(target.Role)));
            case RoleChangeVerdict.LastAdmin:
                return AdminResult<UserRoleResponse>.Conflict(new CodedErrorResponse(
                    "This would leave the platform without an active admin", AdminErrorCodes.LastAdmin));
            case RoleChangeVerdict.OwnsGroups:
                return AdminResult<UserRoleResponse>.Conflict(new TeacherOwnsGroupsResponse(
                    "This user still owns groups; hand them over or delete them first",
                    AdminErrorCodes.TeacherOwnsGroups, ownedGroups));
        }

        target.Role = next;
        target.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return AdminResult<UserRoleResponse>.Ok(new UserRoleResponse(target.Id, RoleWire(next)));
    }

    // The three wire spellings, matched case-insensitively after a trim — a UI sending "Teacher"
    // means the same thing, and there is no fourth role for a lenient parse to collide with.
    private static bool TryParseRole(string? raw, out UserRole role)
    {
        switch (raw?.Trim().ToLowerInvariant())
        {
            case "student": role = UserRole.Student; return true;
            case "teacher": role = UserRole.Teacher; return true;
            case "admin": role = UserRole.Admin; return true;
            default: role = default; return false;
        }
    }

    // Same spelling /api/auth/me uses for `role` (the PG enum label).
    private static string RoleWire(UserRole role) => role.ToString().ToLowerInvariant();

    // ─── Helpers ─────────────────────────────────────────────────────────────

    // Case-insensitive "contains" over full name OR email; a blank term is a no-op filter. When the
    // term carries at least MinPhoneSearchDigits digits it ALSO matches the phone: the digits are
    // pulled out of the term ("90 123-45" → "9012345") and looked for inside the stored canonical
    // "+998XXXXXXXXX", so an admin can paste a number in whatever format they have it.
    private static IQueryable<User> ApplySearch(IQueryable<User> q, string? search)
    {
        var term = search?.Trim();
        if (string.IsNullOrEmpty(term)) return q;
        var like = $"%{term}%";

        var digits = new string(term.Where(char.IsAsciiDigit).ToArray());
        if (digits.Length < MinPhoneSearchDigits)
            return q.Where(u => EF.Functions.ILike(u.FullName, like) || EF.Functions.ILike(u.Email, like));

        return q.Where(u => EF.Functions.ILike(u.FullName, like)
                            || EF.Functions.ILike(u.Email, like)
                            || (u.Phone != null && u.Phone.Contains(digits)));
    }

    // Soft-deleted tasks are not counted — the teacher no longer has them.
    private async Task<Dictionary<Guid, int>> QuestionCountsAsync(List<Guid> teacherIds, CancellationToken ct)
    {
        if (teacherIds.Count == 0) return new();
        return (await _db.Questions
                .Where(q => teacherIds.Contains(q.TeacherId) && !q.IsDeleted)
                .GroupBy(q => q.TeacherId)
                .Select(g => new { g.Key, Count = g.Count() })
                .ToListAsync(ct))
            .ToDictionary(x => x.Key, x => x.Count);
    }


    private sealed record SubmissionActivity(int Count, DateTime LastAt);

    // Count + latest timestamp in ONE grouped aggregate.
    private async Task<Dictionary<Guid, SubmissionActivity>> SubmissionActivityAsync(
        List<Guid> studentIds, CancellationToken ct)
    {
        if (studentIds.Count == 0) return new();
        return (await _db.Submissions
                .Where(s => studentIds.Contains(s.StudentId))
                .GroupBy(s => s.StudentId)
                .Select(g => new { g.Key, Count = g.Count(), LastAt = g.Max(s => s.CreatedAt) })
                .ToListAsync(ct))
            .ToDictionary(x => x.Key, x => new SubmissionActivity(x.Count, x.LastAt));
    }

    // Lifetime mean of the AI band, the same figure the student's own profile shows. A student with
    // no graded answer is simply absent from the map (⇒ null on the row, never 0).
    private async Task<Dictionary<Guid, double>> AverageBandsAsync(List<Guid> studentIds, CancellationToken ct)
    {
        if (studentIds.Count == 0) return new();
        return (await _db.Evaluations
                .Where(e => studentIds.Contains(e.Submission.StudentId))
                .GroupBy(e => e.Submission.StudentId)
                .Select(g => new { g.Key, Avg = g.Average(e => e.OverallBand) })
                .ToListAsync(ct))
            .ToDictionary(x => x.Key, x => x.Avg);
    }

    private async Task<Dictionary<Guid, List<AdminStudentGroupRef>>> StudentGroupsAsync(
        List<Guid> studentIds, CancellationToken ct)
    {
        if (studentIds.Count == 0) return new();
        var rows = await _db.GroupMembers
            .Where(gm => studentIds.Contains(gm.StudentId))
            .Select(gm => new
            {
                gm.StudentId,
                Ref = new AdminStudentGroupRef(gm.Group.Id, gm.Group.Name, gm.Group.TeacherId, gm.Group.Teacher.FullName),
            })
            .ToListAsync(ct);
        return rows
            .GroupBy(r => r.StudentId)
            .ToDictionary(
                g => g.Key,
                g => g.Select(r => r.Ref).OrderBy(r => r.Name, StringComparer.CurrentCultureIgnoreCase).ToList());
    }

    // Groups owned and DISTINCT students across them, per teacher — two grouped reads.
    private async Task<Dictionary<Guid, (int Groups, int Students)>> TeacherRostersAsync(
        List<Guid> teacherIds, CancellationToken ct)
    {
        if (teacherIds.Count == 0) return new();
        var groups = await _db.Groups
            .Where(g => teacherIds.Contains(g.TeacherId))
            .GroupBy(g => g.TeacherId)
            .Select(g => new { g.Key, Count = g.Count() })
            .ToListAsync(ct);
        var students = await _db.GroupMembers
            .Where(gm => teacherIds.Contains(gm.Group.TeacherId))
            .Select(gm => new { gm.Group.TeacherId, gm.StudentId })
            .Distinct()
            .GroupBy(x => x.TeacherId)
            .Select(g => new { g.Key, Count = g.Count() })
            .ToListAsync(ct);
        var studentMap = students.ToDictionary(x => x.Key, x => x.Count);
        return groups.ToDictionary(x => x.Key, x => (x.Count, studentMap.GetValueOrDefault(x.Key, 0)));
    }

    private static TeacherResponse TeacherOut(User t, int questionCount)
        => new(t.Id, t.Email, t.FullName, t.IsActive, t.CreatedAt, questionCount, t.Phone);

    private static StudentResponse StudentOut(User s, int submissionCount)
        => new(s.Id, s.Email, s.FullName, s.Phone, s.Region, s.District, s.Age,
               s.IsActive, s.IsPremium, s.CreatedAt, submissionCount);
}

// ─── Result plumbing (mirrors the Classroom module's outcome→HTTP mapping) ───

/// <summary>Domain outcome an endpoint maps to an HTTP status. <c>BadRequest</c> and
/// <c>Conflict</c> always carry an error body (<see cref="AdminResult{T}.Error"/>).</summary>
public enum AdminOutcome { Ok, Unauthorized, Forbidden, NotFound, BadRequest, Conflict }

/// <summary>Unit payload for outcomes with no body (204 delete).</summary>
public sealed record Unit
{
    public static readonly Unit Value = new();
}

/// <summary>
/// A service result: an <see cref="AdminOutcome"/> plus a payload on success, or — for 400/409 —
/// the error body to send. <c>Error</c> is one of the Govori.Contracts error records
/// (<see cref="CodedErrorResponse"/>, <see cref="PhoneTakenByStudentResponse"/>,
/// <see cref="TeacherOwnsGroupsResponse"/>) and is serialized as-is, so the service decides the
/// whole body and the endpoint only picks the status.
/// </summary>
public sealed record AdminResult<T>(AdminOutcome Outcome, T? Value = default, object? Error = null)
{
    public static AdminResult<T> Ok(T value) => new(AdminOutcome.Ok, value);
    public static AdminResult<T> NotFound() => new(AdminOutcome.NotFound);
    public static AdminResult<T> BadRequest(object error) => new(AdminOutcome.BadRequest, default, error);
    public static AdminResult<T> Conflict(object error) => new(AdminOutcome.Conflict, default, error);
    public static AdminResult<T> From(AdminOutcome outcome) => new(outcome);
}
