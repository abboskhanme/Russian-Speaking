using Govori.Contracts;
using Govori.Infrastructure;
using Govori.Infrastructure.Entities;
using Microsoft.EntityFrameworkCore;

namespace Govori.Catalog;

/// <summary>
/// Application service for the Catalog vertical slice (docs/07 §7.2 — keeps the API thin).
/// It owns the student read path over modules and tasks, plus the freemium/sequence access
/// rules that decide what a given student may open. Consumes <see cref="GovoriDbContext"/> and
/// <see cref="CatalogOptions"/> as-is.
///
/// <para>The centrepiece is the STUDENT MODULE VIEW (<see cref="GetStudentModulesAsync"/>) with
/// its <b>two-layer lock</b> — SEQUENTIAL progression + positional FREEMIUM gate — the most
/// complex read query in the app (docs/08 Faza 3.2). <see cref="TaskIndexAsync"/> and
/// <see cref="NeedsPremiumAsync"/> are the crux rules, and their behaviour is FROZEN by the
/// C9/C4 characterization fixtures — change them only by changing those fixtures first.</para>
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
    /// Teacher ids of every group the student belongs to: DISTINCT <c>group.teacher_id</c> over
    /// the student's group memberships. Drives which non-public modules they can see.
    /// </summary>
    public async Task<List<Guid>> StudentTeacherIdsAsync(Guid studentId, CancellationToken ct = default)
        => await _db.GroupMembers
            .Where(gm => gm.StudentId == studentId)
            .Select(gm => gm.Group.TeacherId)
            .Distinct()
            .ToListAsync(ct);

    /// <summary>
    /// 0-based position of a task among its module's published, live siblings, ordered exactly
    /// as students see them — <c>(sort_order, created_at)</c>. Computed as a COUNT of same-block,
    /// non-deleted, published siblings STRICTLY before the target in that key. No module → 0.
    /// Frozen by the C9 fixture (tests/characterization/fixtures/task_index_cases.json).
    ///
    /// <para>The <c>(sort_order &lt; ... OR (sort_order == ... AND created_at &lt; ...))</c>
    /// predicate is evaluated as a single Postgres <c>COUNT(*)</c>. The strict <c>&lt;</c> is
    /// load-bearing: ties on the full key are NOT counted and the target never counts itself, so
    /// the position is deterministic even when two tasks share a sort_order and timestamp.</para>
    /// </summary>
    public async Task<int> TaskIndexAsync(Question q, CancellationToken ct = default)
    {
        if (q.BlockId is null)
            return 0;                               // a task outside any module is at position 0

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
    /// freemium gate. FROZEN by the C4 fixture (needs_premium_cases.json) — the rules are:
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

        // A task with no module — or one whose module row is missing — yields a null visibility
        // and is never gated; only official PUBLIC modules carry the positional paywall.
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
    /// two-layer lock.
    ///
    /// <para>Returns <c>null</c> when the user is missing or inactive; the endpoint turns that
    /// into a 401. Activity is re-checked here against the DB rather than trusted from the
    /// token, so deactivating a user takes effect on their very next request.</para>
    /// </summary>
    public async Task<IReadOnlyList<StudentModuleResponse>?> GetStudentModulesAsync(
        Guid userId, CancellationToken ct = default)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId, ct);
        if (user is null || !user.IsActive)
            return null;

        var teacherIds = await StudentTeacherIdsAsync(userId, ct);

        // Published modules that are official public OR one of the student's teachers' group
        // modules. When teacherIds is empty, Contains(...) is always false, so the set correctly
        // collapses to public-only — a teacherless student still sees the official catalog.
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

        // Every question this student has already completed, in one query.
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

        // All published, live tasks for these modules in one query, then group in memory (rather
        // than one query per module) — the per-block ordering key is (sort_order, created_at),
        // which must match TaskIndexAsync so positions and the freemium gate agree.
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

        var questionIds = questions.Select(q => q.Id).ToList();

        // Caller's BEST graded band per task — max Evaluation.OverallBand over their submissions for
        // each of these tasks — in ONE set-based aggregate (GROUP BY question). Tasks with no graded
        // evaluation are simply absent, so they read as a null band below (never done/never graded).
        var bestBandByQuestion = (await _db.Evaluations
            .Where(e => e.Submission.StudentId == userId
                        && e.Submission.QuestionId != null
                        && questionIds.Contains(e.Submission.QuestionId.Value))
            .GroupBy(e => e.Submission.QuestionId!.Value)
            .Select(g => new { QuestionId = g.Key, Best = g.Max(x => x.OverallBand) })
            .ToListAsync(ct))
            .ToDictionary(x => x.QuestionId, x => x.Best);

        // Caller's total spoken seconds per task — SUM of Submission.AudioDurationSec — in ONE
        // set-based aggregate (GROUP BY question). Summed up to the module in the loop below over the
        // module's live tasks, so no per-task query. SUM is null (⇒ 0) when every duration is null.
        var spentSecByQuestion = (await _db.Submissions
            .Where(s => s.StudentId == userId
                        && s.QuestionId != null
                        && questionIds.Contains(s.QuestionId.Value))
            .GroupBy(s => s.QuestionId!.Value)
            .Select(g => new { QuestionId = g.Key, Seconds = g.Sum(x => x.AudioDurationSec) })
            .ToListAsync(ct))
            .ToDictionary(x => x.QuestionId, x => x.Seconds ?? 0d);

        var result = new List<StudentModuleResponse>();
        foreach (var b in blocks)
        {
            if (!byBlock.TryGetValue(b.Id, out var qs) || qs.Count == 0)
                continue;                           // a module with no live tasks is not shown

            // Positional freemium applies only to official public modules.
            var gated = b.Visibility == "public" && !user.IsPremium && freeN > 0;

            var tasks = new List<StudentTaskResponse>(qs.Count);
            var prevDone = true;                    // the first task is always sequentially unlocked
            Guid? nextId = null;
            var doneCount = 0;
            var spentSec = 0d;                      // caller's total spoken seconds across this module

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

                if (spentSecByQuestion.TryGetValue(q.Id, out var qSpent))
                    spentSec += qSpent;

                // Best graded band (0..100) for this task, or null when never graded.
                int? band = bestBandByQuestion.TryGetValue(q.Id, out var best) ? Band(best) : null;

                tasks.Add(new StudentTaskResponse(
                    Id: q.Id,
                    Title: q.Title,
                    Type: q.Type.ToString().ToLowerInvariant(),   // PG label: text/image/video
                    Level: q.Level,
                    SortOrder: q.SortOrder,
                    Done: done,
                    Locked: seqLocked,
                    PremiumLocked: premiumLocked,
                    Band: band));

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
                Tasks: tasks,
                SpentSec: (int)Math.Round(spentSec, MidpointRounding.AwayFromZero)));
        }

        return result;
    }

    // Evaluation.OverallBand → the whole number the UI shows, clamped to the documented 0..100
    // (same scale as the profile/results band).
    private static int Band(double overallBand)
        => Math.Clamp((int)Math.Round(overallBand, MidpointRounding.AwayFromZero), 0, 100);
}
