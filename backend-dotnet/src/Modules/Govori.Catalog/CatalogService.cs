using Govori.Contracts;
using Govori.Infrastructure;
using Govori.Infrastructure.Entities;
using Microsoft.EntityFrameworkCore;

namespace Govori.Catalog;

/// <summary>
/// Application service for the Catalog vertical slice (docs/07 §7.2 — keeps the API thin),
/// ported from backend/app/api/v1/blocks.py (student read path) + backend/app/services/access.py
/// (the freemium/sequence access rules). Consumes <see cref="GovoriDbContext"/> and
/// <see cref="CatalogOptions"/> as-is.
///
/// <para>The centrepiece is the STUDENT MODULE VIEW (<see cref="GetStudentModulesAsync"/>) with
/// its <b>two-layer lock</b> — SEQUENTIAL progression + positional FREEMIUM gate — the most
/// complex read query in the app (docs/08 Faza 3.2). <see cref="TaskIndexAsync"/> and
/// <see cref="NeedsPremiumAsync"/> are faithful EF Core ports of the crux functions frozen by
/// the C9/C4 characterization fixtures (access.py:54-89).</para>
/// </summary>
public sealed class CatalogService
{
    private readonly GovoriDbContext _db;
    private readonly CatalogOptions _options;

    public CatalogService(GovoriDbContext db, CatalogOptions options)
    {
        _db = db;
        _options = options;
    }

    /// <summary>
    /// Teacher ids of every group the student belongs to. Faithful port of
    /// <c>student_teacher_ids</c> (access.py:25-34): DISTINCT <c>group.teacher_id</c> over the
    /// student's group memberships.
    /// </summary>
    public async Task<List<Guid>> StudentTeacherIdsAsync(Guid studentId, CancellationToken ct = default)
        => await _db.GroupMembers
            .Where(gm => gm.StudentId == studentId)
            .Select(gm => gm.Group.TeacherId)
            .Distinct()
            .ToListAsync(ct);

    /// <summary>
    /// 0-based position of a task among its module's published, live siblings, ordered exactly
    /// as students see them — <c>(sort_order, created_at)</c>. Faithful port of <c>task_index</c>
    /// (access.py:54-75): a COUNT of same-block, non-deleted, published siblings STRICTLY before
    /// the target in that key. No module → 0. Frozen by the C9 fixture
    /// (tests/characterization/fixtures/task_index_cases.json).
    ///
    /// <para>The <c>OR (sort_order &lt; ... OR (sort_order == ... AND created_at &lt; ...))</c>
    /// predicate is a single Postgres <c>COUNT(*)</c> — the exact SQL SQLAlchemy emits — so ties
    /// (equal key) are NOT counted (strict <c>&lt;</c>) and the target never counts itself.</para>
    /// </summary>
    public async Task<int> TaskIndexAsync(Question q, CancellationToken ct = default)
    {
        if (q.BlockId is null)
            return 0;                               // access.py:57-58 — no module → position 0

        var blockId = q.BlockId.Value;
        var sortOrder = q.SortOrder;
        var createdAt = q.CreatedAt;

        return await _db.Questions.CountAsync(
            x => x.BlockId == blockId
                 && !x.IsDeleted
                 && x.IsPublished
                 && (x.SortOrder < sortOrder
                     || (x.SortOrder == sortOrder && x.CreatedAt < createdAt)),
            ct);
    }

    /// <summary>
    /// True when a NON-premium student is blocked from answering this task by the positional
    /// freemium gate. Faithful port of <c>needs_premium</c> (access.py:78-89), frozen by the C4
    /// fixture (needs_premium_cases.json):
    /// <list type="bullet">
    ///   <item>non-student OR premium → false</item>
    ///   <item>no module OR visibility != "public" → false (teacher/group content never self-paywalled)</item>
    ///   <item>FreeTasksPerModule &lt;= 0 → false (whole module free)</item>
    ///   <item>else → <see cref="TaskIndexAsync"/> &gt;= FreeTasksPerModule</item>
    /// </list>
    /// </summary>
    public async Task<bool> NeedsPremiumAsync(User student, Question q, CancellationToken ct = default)
    {
        if (student.Role != UserRole.Student || student.IsPremium)
            return false;

        // block = db.get(QuestionBlock, q.block_id) if q.block_id else None (access.py:83).
        // A missing block yields a null visibility; only official PUBLIC modules are gated.
        var visibility = q.BlockId is null
            ? null
            : await _db.QuestionBlocks
                .Where(b => b.Id == q.BlockId.Value)
                .Select(b => (string?)b.Visibility)
                .FirstOrDefaultAsync(ct);
        if (visibility is null || visibility != "public")
            return false;

        var n = _options.FreeTasksPerModule;
        if (n <= 0)
            return false;                           // 0 = whole module free

        return await TaskIndexAsync(q, ct) >= n;
    }

    /// <summary>
    /// The student module view: official PUBLIC modules (everyone, incl. teacherless students)
    /// plus the student's own teachers' GROUP modules, each with its ordered tasks carrying the
    /// two-layer lock. Faithful port of <c>student_modules</c> (blocks.py:90-176).
    ///
    /// <para>Returns <c>null</c> when the user is missing or inactive — mirrors Python's
    /// <c>get_current_user</c> denying such requests (deps.py:31-32) → 401 at the endpoint.</para>
    /// </summary>
    public async Task<IReadOnlyList<StudentModuleResponse>?> GetStudentModulesAsync(
        Guid userId, CancellationToken ct = default)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId, ct);
        if (user is null || !user.IsActive)
            return null;

        var teacherIds = await StudentTeacherIdsAsync(userId, ct);

        // Published modules that are official public OR one of the student's teachers' group
        // modules (blocks.py:100-116). When teacherIds is empty, Contains(...) is always false,
        // so the set collapses to public-only — identical to Python's conditional OR.
        var blocks = await _db.QuestionBlocks
            .Where(b => b.IsPublished
                        && (b.Visibility == "public"
                            || (b.Visibility == "group" && teacherIds.Contains(b.TeacherId))))
            // Teacher (group) modules first, then official public ones; each by order.
            .OrderBy(b => b.Visibility)
            .ThenBy(b => b.SortOrder)
            .ThenBy(b => b.CreatedAt)
            .ToListAsync(ct);
        if (blocks.Count == 0)
            return [];

        // Every question this student has already completed (blocks.py:119-129).
        var doneQids = (await _db.Submissions
            .Where(s => s.StudentId == userId
                        && s.Status == SubmissionStatus.Done
                        && s.QuestionId != null)
            .Select(s => s.QuestionId!.Value)
            .Distinct()
            .ToListAsync(ct))
            .ToHashSet();

        var freeN = _options.FreeTasksPerModule;
        var blockIds = blocks.Select(b => b.Id).ToList();

        // All published, live tasks for these modules in one query, then group in memory — the
        // per-block ordering key is (sort_order, created_at), exactly as Python re-queries per
        // block (blocks.py:133-143).
        var questions = await _db.Questions
            .Where(q => q.BlockId != null
                        && blockIds.Contains(q.BlockId.Value)
                        && !q.IsDeleted
                        && q.IsPublished)
            .OrderBy(q => q.SortOrder)
            .ThenBy(q => q.CreatedAt)
            .ToListAsync(ct);

        var byBlock = questions
            .GroupBy(q => q.BlockId!.Value)
            .ToDictionary(g => g.Key, g => g.ToList());

        var result = new List<StudentModuleResponse>();
        foreach (var b in blocks)
        {
            if (!byBlock.TryGetValue(b.Id, out var qs) || qs.Count == 0)
                continue;                           // skip empty modules (blocks.py:144-145)

            // Positional freemium applies only to official public modules (blocks.py:147).
            var gated = b.Visibility == "public" && !user.IsPremium && freeN > 0;

            var tasks = new List<StudentTaskResponse>(qs.Count);
            var prevDone = true;                    // the first task is always sequentially unlocked
            Guid? nextId = null;
            var doneCount = 0;

            for (var idx = 0; idx < qs.Count; idx++)
            {
                var q = qs[idx];
                var done = doneQids.Contains(q.Id);
                var seqLocked = !prevDone;
                var premiumLocked = gated && idx >= freeN;

                if (done)
                    doneCount++;
                else if (!seqLocked && !premiumLocked && nextId is null)
                    nextId = q.Id;

                tasks.Add(new StudentTaskResponse(
                    Id: q.Id,
                    Title: q.Title,
                    Type: q.Type.ToString().ToLowerInvariant(),   // PG label: text/image/video
                    Level: q.Level,
                    SortOrder: q.SortOrder,
                    Done: done,
                    Locked: seqLocked,
                    PremiumLocked: premiumLocked));

                prevDone = done;
            }

            result.Add(new StudentModuleResponse(
                Id: b.Id,
                Name: b.Name,
                Topic: b.Topic,
                Level: b.Level,
                RuStyle: b.RuStyle,
                Visibility: b.Visibility,
                CoverUrl: null,                     // presigned URL → Govori.Platform.Storage (deferred)
                Total: qs.Count,
                DoneCount: doneCount,
                NextTaskId: nextId,
                Tasks: tasks));
        }

        return result;
    }
}
