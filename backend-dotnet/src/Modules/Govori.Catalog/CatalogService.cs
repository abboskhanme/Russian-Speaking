using Govori.Contracts;
using Govori.Infrastructure;
using Govori.Infrastructure.Entities;
using Govori.Platform.Storage;
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
    private readonly IObjectStorage _storage;

    public CatalogService(GovoriDbContext db, CatalogOptions options, IObjectStorage storage)
    {
        _db = db;
        _options = options;
        _storage = storage;
    }

    /// <summary>Ceiling for a task's media. Larger than an avatar because this may be a short video
    /// clip, and small enough that a rejected upload never buffers anything big — the length is
    /// checked before the stream reaches storage.</summary>
    private const long MaxMediaBytes = 25L * 1024 * 1024;

    /// <summary>The ONLY accepted media content-types, mapped to their storage-key extension.
    /// Raster + two web-native video containers. <c>image/svg+xml</c> is absent for the same reason
    /// it is absent from the avatar allow-list: an SVG can carry script and would be a stored-XSS
    /// vector the moment its presigned url is opened. Anything not in this map is a 400.</summary>
    private static readonly Dictionary<string, string> MediaTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        ["image/jpeg"] = "jpg",
        ["image/png"] = "png",
        ["image/webp"] = "webp",
        ["video/mp4"] = "mp4",
        ["video/webm"] = "webm",
    };

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
    ///
    /// <para><b>"Premium" widened in Faza 6.6 and the gate did not.</b> It used to read
    /// <c>student.IsPremium</c> — the teacher grant — and now asks
    /// <see cref="PremiumAccess.HasPremiumAsync(GovoriDbContext, User, DateTime, CancellationToken)"/>,
    /// which is that same flag OR an active subscription. Teacher-granted premium therefore behaves
    /// EXACTLY as before (the check short-circuits on the flag and never reaches the database), and
    /// with no subscription rows every answer this method gives is byte-for-byte the pre-6.6 one.
    /// The C4 fixture is unchanged because the rule it froze is unchanged: what counts as premium
    /// simply has a second, additive source. Reading that source from here rather than duplicating
    /// it is what stops a paying student meeting a 402.</para>
    /// </summary>
    public async Task<bool> NeedsPremiumAsync(User student, Question q, CancellationToken ct = default)
    {
        if (student.Role != UserRole.Student)
            return false;
        if (await PremiumAccess.HasPremiumAsync(_db, student, DateTime.UtcNow, ct))
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

        // Resolved ONCE for the whole view, from the same single source the 402 gate uses
        // (PremiumAccess: teacher grant OR active subscription). Once, not per module: the module
        // list must not be able to disagree with itself about whether this student has premium, and
        // one EXISTS query is not worth repeating per row.
        var hasPremium = await PremiumAccess.HasPremiumAsync(_db, user, DateTime.UtcNow, ct);

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
            var gated = b.Visibility == "public" && !hasPremium && freeN > 0;

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

                // A locked task (either layer) shows its title/type/level teaser and nothing a
                // student could answer from — see StudentTaskResponse. Presigning is local HMAC
                // signing, not a round trip, so doing it per unlocked task costs no I/O.
                var open = !seqLocked && !premiumLocked;
                var hasMedia = open && !string.IsNullOrEmpty(q.MediaKey);

                tasks.Add(new StudentTaskResponse(
                    Id: q.Id,
                    Title: q.Title,
                    Type: q.Type.ToString().ToLowerInvariant(),   // PG label: text/image/video
                    Level: q.Level,
                    SortOrder: q.SortOrder,
                    Done: done,
                    Locked: seqLocked,
                    PremiumLocked: premiumLocked,
                    Band: band,
                    PromptText: open ? q.PromptText : null,
                    InstructionText: open ? q.InstructionText : null,
                    MediaUrl: hasMedia ? await _storage.GetPresignedUrlAsync(q.MediaKey!, ct: ct) : null,
                    MediaType: hasMedia ? MediaTypeOf(q) : null,
                    PrepTimeSec: q.PrepTimeSec,
                    AnswerTimeLimitSec: q.AnswerTimeLimitSec));

                prevDone = done;
            }

            result.Add(new StudentModuleResponse(
                Id: b.Id,
                Name: b.Name,
                Topic: b.Topic,
                Level: b.Level,
                RuStyle: b.RuStyle,
                Visibility: b.Visibility,
                CoverUrl: null,                     // no route writes a cover yet — see StudentModuleResponse
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

    private static readonly HashSet<string> ImageExtensions = new(StringComparer.OrdinalIgnoreCase)
        { "jpg", "jpeg", "png", "webp", "gif" };
    private static readonly HashSet<string> VideoExtensions = new(StringComparer.OrdinalIgnoreCase)
        { "mp4", "webm", "mov" };

    /// <summary>
    /// "image" / "video" for a task that has media, so the client knows whether to render an
    /// <c>img</c> or a <c>video</c>. Read from the storage key's extension, which
    /// <see cref="SetQuestionMediaAsync"/> derives from the VALIDATED content-type (never from the
    /// client's filename). A key written before that — by the legacy backend — may not say; then the
    /// task's own <c>type</c> column decides, and if that is plain "text" the answer is null rather
    /// than a guess that renders a video as a broken image.
    /// </summary>
    private static string? MediaTypeOf(Question q)
    {
        var ext = Path.GetExtension(q.MediaKey ?? string.Empty).TrimStart('.');
        if (ImageExtensions.Contains(ext)) return "image";
        if (VideoExtensions.Contains(ext)) return "video";
        return q.Type switch
        {
            QuestionType.Image => "image",
            QuestionType.Video => "video",
            _ => null,
        };
    }

    // ─── Teacher authoring (Kontent board C1 · C2 · C4 · C5) ────────────────────
    // A write surface over the EXISTING question_blocks / questions tables. Every method is
    // OWNER-SCOPED: a teacher reads and mutates only rows whose TeacherId is theirs, and anything
    // else answers NotFound rather than Forbidden so ids cannot be probed. Admin sees everything,
    // and is the only role that may set visibility "public" (an official module).

    /// <summary>GET /api/blocks — the caller's own modules (an admin: every module), lowest sort
    /// order first, each with its owner's name. Teacher/admin.</summary>
    public async Task<CatalogResult<IReadOnlyList<TeacherBlockResponse>>> ListBlocksAsync(
        Guid userId, CancellationToken ct = default)
    {
        var user = await ActiveUserAsync(userId, ct);
        if (user is null) return CatalogResult<IReadOnlyList<TeacherBlockResponse>>.Unauthorized();
        if (!IsTeacher(user)) return CatalogResult<IReadOnlyList<TeacherBlockResponse>>.Forbidden();

        var q = _db.QuestionBlocks.AsQueryable();
        if (user.Role != UserRole.Admin) q = q.Where(b => b.TeacherId == user.Id);

        // The owner's name rides along in the same query (a join, not a lookup per row) — it is what
        // makes an admin's all-modules list readable.
        var rows = await q.OrderBy(b => b.SortOrder).ThenByDescending(b => b.CreatedAt)
            .Select(b => new { Block = b, OwnerName = b.Teacher.FullName })
            .ToListAsync(ct);
        var reach = await RosterReachAsync(user, ct);

        var ids = rows.Select(r => r.Block.Id).ToList();
        var counts = await CountsPerBlockAsync(ids, ct);

        return CatalogResult<IReadOnlyList<TeacherBlockResponse>>.Ok(rows
            .Select(r => new TeacherBlockResponse(
                Id: r.Block.Id, Name: r.Block.Name, Topic: r.Block.Topic, Level: r.Block.Level,
                RuStyle: r.Block.RuStyle, Visibility: r.Block.Visibility, IsPublished: r.Block.IsPublished,
                SortOrder: r.Block.SortOrder,
                TaskCount: counts.GetValueOrDefault(r.Block.Id, 0),
                // Reach is the same for every module the teacher owns — it is their roster size.
                // A DRAFT reaches nobody yet, and saying "38 o'quvchi" on a draft would be a lie.
                StudentCount: r.Block.IsPublished ? reach : 0,
                CreatedAt: r.Block.CreatedAt, UpdatedAt: r.Block.UpdatedAt,
                OwnerName: r.OwnerName))
            .ToList());
    }

    /// <summary>GET /api/blocks/{id} — one module plus its ordered tasks (the C4 editor).</summary>
    public async Task<CatalogResult<TeacherBlockDetailResponse>> GetBlockAsync(
        Guid userId, Guid blockId, CancellationToken ct = default)
    {
        var user = await ActiveUserAsync(userId, ct);
        if (user is null) return CatalogResult<TeacherBlockDetailResponse>.Unauthorized();
        if (!IsTeacher(user)) return CatalogResult<TeacherBlockDetailResponse>.Forbidden();

        var b = await _db.QuestionBlocks.FirstOrDefaultAsync(x => x.Id == blockId, ct);
        if (b is null || (user.Role != UserRole.Admin && b.TeacherId != user.Id))
            return CatalogResult<TeacherBlockDetailResponse>.NotFound();

        var tasks = await _db.Questions
            .Where(q => q.BlockId == b.Id && !q.IsDeleted)
            .OrderBy(q => q.SortOrder).ThenBy(q => q.CreatedAt)
            .ToListAsync(ct);
        var subCounts = await SubmissionCountsAsync(tasks.Select(t => t.Id).ToList(), ct);
        var reach = await RosterReachAsync(user, ct);
        var ownerName = b.TeacherId == user.Id
            ? user.FullName
            : await _db.Users.Where(u => u.Id == b.TeacherId).Select(u => u.FullName).FirstOrDefaultAsync(ct) ?? "";

        return CatalogResult<TeacherBlockDetailResponse>.Ok(new TeacherBlockDetailResponse(
            Id: b.Id, Name: b.Name, Topic: b.Topic, Level: b.Level, RuStyle: b.RuStyle,
            Visibility: b.Visibility, IsPublished: b.IsPublished, SortOrder: b.SortOrder,
            TaskCount: tasks.Count, StudentCount: b.IsPublished ? reach : 0,
            CreatedAt: b.CreatedAt, UpdatedAt: b.UpdatedAt,
            Tasks: await Task.WhenAll(tasks.Select(q => QuestionOutAsync(q, b.Name, subCounts.GetValueOrDefault(q.Id, 0), ct))),
            OwnerName: ownerName));
    }

    /// <summary>POST /api/blocks — create a module. Starts as a DRAFT so nothing reaches students
    /// until the teacher publishes it explicitly.</summary>
    public async Task<CatalogResult<TeacherBlockDetailResponse>> CreateBlockAsync(
        Guid userId, CreateBlockRequest body, CancellationToken ct = default)
    {
        var user = await ActiveUserAsync(userId, ct);
        if (user is null) return CatalogResult<TeacherBlockDetailResponse>.Unauthorized();
        if (!IsTeacher(user)) return CatalogResult<TeacherBlockDetailResponse>.Forbidden();
        if (body.Visibility == PublicVisibility && user.Role != UserRole.Admin)
            return PublicRequiresAdmin<TeacherBlockDetailResponse>();

        var name = (body.Name ?? string.Empty).Trim();
        if (name.Length == 0) return CatalogResult<TeacherBlockDetailResponse>.BadRequest("name is required");

        var now = DateTime.UtcNow;
        var block = new QuestionBlock
        {
            Id = Guid.NewGuid(),
            TeacherId = user.Id,
            Name = name,
            Topic = Trimmed(body.Topic),
            Level = Trimmed(body.Level),
            RuStyle = Trimmed(body.RuStyle),
            // "group" = visible to the owner's own students (and the default for anything
            // unrecognised, as it always was); "private" = the owner only; "public" = an official
            // module every student sees — reachable only by an admin, checked above.
            Visibility = body.Visibility is "private" or PublicVisibility ? body.Visibility : "group",
            IsPublished = false,
            SortOrder = await NextBlockSortAsync(user.Id, ct),
            CreatedAt = now,
            UpdatedAt = now,
        };
        _db.QuestionBlocks.Add(block);
        await _db.SaveChangesAsync(ct);

        return await GetBlockAsync(userId, block.Id, ct);
    }

    /// <summary>
    /// PATCH /api/blocks/{id} — partial update; absent fields are left alone.
    ///
    /// <para><b>Publishing a module publishes its tasks.</b> A task is created as a draft whenever
    /// its module is a draft, and a module is hidden from students until it has at least one live
    /// task — so before this rule, pressing "Nashr qilish" on a new module changed nothing a student
    /// could see, and there was no UI to publish the tasks one by one. On the false → true edge every
    /// non-deleted draft task in the module is published in the SAME SaveChanges as the module, so a
    /// student can never observe a published module whose tasks are still drafts. Unpublishing does
    /// not touch the tasks: the module flag already hides them.</para>
    /// </summary>
    public async Task<CatalogResult<TeacherBlockDetailResponse>> UpdateBlockAsync(
        Guid userId, Guid blockId, UpdateBlockRequest body, CancellationToken ct = default)
    {
        var user = await ActiveUserAsync(userId, ct);
        if (user is null) return CatalogResult<TeacherBlockDetailResponse>.Unauthorized();
        if (!IsTeacher(user)) return CatalogResult<TeacherBlockDetailResponse>.Forbidden();

        var b = await _db.QuestionBlocks.FirstOrDefaultAsync(x => x.Id == blockId, ct);
        if (b is null || (user.Role != UserRole.Admin && b.TeacherId != user.Id))
            return CatalogResult<TeacherBlockDetailResponse>.NotFound();

        // Refused before anything is touched, and after the ownership check so another teacher's
        // module still answers 404 rather than revealing that it exists.
        if (body.Visibility == PublicVisibility && user.Role != UserRole.Admin)
            return PublicRequiresAdmin<TeacherBlockDetailResponse>();

        if (body.Name is not null)
        {
            var name = body.Name.Trim();
            // Refuse to blank the name rather than accepting an unnamed module: the list would
            // render an empty card the teacher cannot identify or recover.
            if (name.Length == 0)
                return CatalogResult<TeacherBlockDetailResponse>.BadRequest("name cannot be blank");
            b.Name = name;
        }
        if (body.Topic is not null) b.Topic = Trimmed(body.Topic);
        if (body.Level is not null) b.Level = Trimmed(body.Level);
        if (body.RuStyle is not null) b.RuStyle = Trimmed(body.RuStyle);
        // An unrecognised value is ignored (left as it was), as it always has been.
        if (body.Visibility is "group" or "private" or PublicVisibility)
            b.Visibility = body.Visibility;
        if (body.SortOrder is not null) b.SortOrder = body.SortOrder.Value;

        var now = DateTime.UtcNow;
        if (body.IsPublished is { } publish)
        {
            if (publish && !b.IsPublished)
            {
                // Tracked, not ExecuteUpdate: an ExecuteUpdate would commit on its own, before (and
                // regardless of) the SaveChanges below that publishes the module.
                var drafts = await _db.Questions
                    .Where(q => q.BlockId == b.Id && !q.IsDeleted && !q.IsPublished)
                    .ToListAsync(ct);
                foreach (var task in drafts)
                {
                    task.IsPublished = true;
                    task.UpdatedAt = now;
                }
            }
            b.IsPublished = publish;
        }
        b.UpdatedAt = now;

        await _db.SaveChangesAsync(ct);
        return await GetBlockAsync(userId, blockId, ct);
    }

    /// <summary>
    /// DELETE /api/blocks/{id} — remove a module without destroying anyone's history.
    ///
    /// <para><b>Why the tasks are soft-deleted and the module row is hard-deleted.</b>
    /// <c>submissions_question_id_fkey</c>, <c>assignments_question_id_fkey</c> and
    /// <c>review_items_question_id_fkey</c> are all <c>ON DELETE CASCADE</c>, and evaluations and
    /// transcripts cascade from submissions in turn — so hard-deleting a task would silently erase
    /// every student's attempts at it, grades included. The tasks are therefore only
    /// marked deleted (and unpublished). The ONLY foreign key into <c>question_blocks</c> is
    /// <c>fk_questions_block_id</c>, which is <c>ON DELETE SET NULL</c>: removing the module row
    /// detaches its (now soft-deleted) tasks and cascades into nothing else, so the row itself can
    /// go. The one thing lost is the task → module link, which only a deleted module would have
    /// used.</para>
    ///
    /// <para>Both steps happen in ONE SaveChanges (one transaction): there is no moment where the
    /// module is gone but its tasks are still live, unattached, in the teacher's library.</para>
    /// </summary>
    public async Task<CatalogResult<bool>> DeleteBlockAsync(
        Guid userId, Guid blockId, CancellationToken ct = default)
    {
        var user = await ActiveUserAsync(userId, ct);
        if (user is null) return CatalogResult<bool>.Unauthorized();
        if (!IsTeacher(user)) return CatalogResult<bool>.Forbidden();

        var b = await _db.QuestionBlocks.FirstOrDefaultAsync(x => x.Id == blockId, ct);
        if (b is null || (user.Role != UserRole.Admin && b.TeacherId != user.Id))
            return CatalogResult<bool>.NotFound();

        var now = DateTime.UtcNow;
        var tasks = await _db.Questions.Where(q => q.BlockId == b.Id && !q.IsDeleted).ToListAsync(ct);
        foreach (var task in tasks)
            SoftDelete(task, now);

        // EF mirrors the FK's SET NULL on the tracked tasks; Postgres applies it to any already
        // soft-deleted ones this query did not load.
        _db.QuestionBlocks.Remove(b);
        await _db.SaveChangesAsync(ct);

        // The cover object is unreachable once the row is gone. Best-effort, like task media.
        if (!string.IsNullOrEmpty(b.CoverKey))
            await TryDeleteMediaAsync(b.CoverKey, ct);

        return CatalogResult<bool>.Ok(true);
    }

    /// <summary>
    /// GET /api/questions — the caller's own tasks. <paramref name="search"/> matches title OR
    /// prompt (case-insensitive); <paramref name="blockId"/> narrows to one module;
    /// <paramref name="unassignedOnly"/> returns only tasks with no module, which is what C5's
    /// library picker offers so a task cannot be attached to two modules at once.
    /// </summary>
    public async Task<CatalogResult<IReadOnlyList<TeacherQuestionResponse>>> ListQuestionsAsync(
        Guid userId, string? search, Guid? blockId, bool unassignedOnly, int limit,
        CancellationToken ct = default)
    {
        var user = await ActiveUserAsync(userId, ct);
        if (user is null) return CatalogResult<IReadOnlyList<TeacherQuestionResponse>>.Unauthorized();
        if (!IsTeacher(user)) return CatalogResult<IReadOnlyList<TeacherQuestionResponse>>.Forbidden();

        limit = Math.Clamp(limit, 1, 200);
        var q = _db.Questions.Include(x => x.Block).Where(x => !x.IsDeleted);
        if (user.Role != UserRole.Admin) q = q.Where(x => x.TeacherId == user.Id);
        if (blockId is not null) q = q.Where(x => x.BlockId == blockId);
        if (unassignedOnly) q = q.Where(x => x.BlockId == null);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim();
            q = q.Where(x => EF.Functions.ILike(x.Title, $"%{term}%")
                             || EF.Functions.ILike(x.PromptText, $"%{term}%"));
        }

        var rows = await q.OrderBy(x => x.SortOrder).ThenByDescending(x => x.CreatedAt)
            .Take(limit).ToListAsync(ct);
        var subCounts = await SubmissionCountsAsync(rows.Select(r => r.Id).ToList(), ct);

        return CatalogResult<IReadOnlyList<TeacherQuestionResponse>>.Ok(
            await Task.WhenAll(rows.Select(x => QuestionOutAsync(x, x.Block?.Name, subCounts.GetValueOrDefault(x.Id, 0), ct))));
    }

    /// <summary>POST /api/questions — create a task. A task created inside a module inherits the
    /// module's CURRENT <c>is_published</c>: adding a task to a live module makes it live at once
    /// (the teacher is extending something students already use), while a task in a draft module
    /// stays a draft until the module is published — which publishes it
    /// (<see cref="UpdateBlockAsync"/>). An unattached task starts as a draft.</summary>
    public async Task<CatalogResult<TeacherQuestionResponse>> CreateQuestionAsync(
        Guid userId, CreateQuestionRequest body, CancellationToken ct = default)
    {
        var user = await ActiveUserAsync(userId, ct);
        if (user is null) return CatalogResult<TeacherQuestionResponse>.Unauthorized();
        if (!IsTeacher(user)) return CatalogResult<TeacherQuestionResponse>.Forbidden();

        var title = (body.Title ?? string.Empty).Trim();
        var prompt = (body.PromptText ?? string.Empty).Trim();
        if (title.Length == 0) return CatalogResult<TeacherQuestionResponse>.BadRequest("title is required");
        // A task with no prompt is not answerable — there would be nothing to speak about.
        if (prompt.Length == 0) return CatalogResult<TeacherQuestionResponse>.BadRequest("prompt_text is required");

        QuestionBlock? block = null;
        if (body.BlockId is not null)
        {
            block = await _db.QuestionBlocks.FirstOrDefaultAsync(x => x.Id == body.BlockId, ct);
            // Attaching to someone else's module is the same as it not existing.
            if (block is null || (user.Role != UserRole.Admin && block.TeacherId != user.Id))
                return CatalogResult<TeacherQuestionResponse>.NotFound();
        }

        var now = DateTime.UtcNow;
        var q = new Question
        {
            Id = Guid.NewGuid(),
            TeacherId = user.Id,
            Type = QuestionType.Text,
            Title = title,
            PromptText = prompt,
            Level = Trimmed(body.Level),
            Topic = Trimmed(body.Topic),
            RuStyle = Trimmed(body.RuStyle),
            InstructionText = Trimmed(body.InstructionText),
            ModelAnswerText = Trimmed(body.ModelAnswerText),
            PrepTimeSec = Math.Clamp(body.PrepTimeSec ?? 30, 0, 600),
            AnswerTimeLimitSec = Math.Clamp(body.AnswerTimeLimitSec ?? 120, 10, 1800),
            IsPublished = block?.IsPublished ?? false,
            IsPublic = false,
            IsDeleted = false,
            BlockId = block?.Id,
            SortOrder = block is null ? 0 : await NextQuestionSortAsync(block.Id, ct),
            CreatedAt = now,
            UpdatedAt = now,
        };
        _db.Questions.Add(q);
        await _db.SaveChangesAsync(ct);

        return CatalogResult<TeacherQuestionResponse>.Ok(await QuestionOutAsync(q, block?.Name, 0, ct));
    }

    /// <summary>PATCH /api/questions/{id} — partial update; absent fields are left alone.
    /// <c>detach_block: true</c> removes the module attachment (see the request DTO).</summary>
    public async Task<CatalogResult<TeacherQuestionResponse>> UpdateQuestionAsync(
        Guid userId, Guid questionId, UpdateQuestionRequest body, CancellationToken ct = default)
    {
        var user = await ActiveUserAsync(userId, ct);
        if (user is null) return CatalogResult<TeacherQuestionResponse>.Unauthorized();
        if (!IsTeacher(user)) return CatalogResult<TeacherQuestionResponse>.Forbidden();

        var q = await _db.Questions.Include(x => x.Block)
            .FirstOrDefaultAsync(x => x.Id == questionId && !x.IsDeleted, ct);
        if (q is null || (user.Role != UserRole.Admin && q.TeacherId != user.Id))
            return CatalogResult<TeacherQuestionResponse>.NotFound();

        if (body.Title is not null)
        {
            var title = body.Title.Trim();
            if (title.Length == 0) return CatalogResult<TeacherQuestionResponse>.BadRequest("title cannot be blank");
            q.Title = title;
        }
        if (body.PromptText is not null)
        {
            var prompt = body.PromptText.Trim();
            if (prompt.Length == 0) return CatalogResult<TeacherQuestionResponse>.BadRequest("prompt_text cannot be blank");
            q.PromptText = prompt;
        }
        if (body.Level is not null) q.Level = Trimmed(body.Level);
        if (body.Topic is not null) q.Topic = Trimmed(body.Topic);
        if (body.RuStyle is not null) q.RuStyle = Trimmed(body.RuStyle);
        if (body.InstructionText is not null) q.InstructionText = Trimmed(body.InstructionText);
        if (body.ModelAnswerText is not null) q.ModelAnswerText = Trimmed(body.ModelAnswerText);
        if (body.PrepTimeSec is not null) q.PrepTimeSec = Math.Clamp(body.PrepTimeSec.Value, 0, 600);
        if (body.AnswerTimeLimitSec is not null)
            q.AnswerTimeLimitSec = Math.Clamp(body.AnswerTimeLimitSec.Value, 10, 1800);
        if (body.IsPublished is not null) q.IsPublished = body.IsPublished.Value;
        if (body.SortOrder is not null) q.SortOrder = body.SortOrder.Value;

        QuestionBlock? newBlock = q.Block;
        if (body.DetachBlock == true)
        {
            q.BlockId = null;
            newBlock = null;
        }
        else if (body.BlockId is not null)
        {
            var target = await _db.QuestionBlocks.FirstOrDefaultAsync(x => x.Id == body.BlockId, ct);
            if (target is null || (user.Role != UserRole.Admin && target.TeacherId != user.Id))
                return CatalogResult<TeacherQuestionResponse>.NotFound();
            // Moving into a module puts it at the end unless the caller also set a sort order.
            if (q.BlockId != target.Id && body.SortOrder is null)
                q.SortOrder = await NextQuestionSortAsync(target.Id, ct);
            q.BlockId = target.Id;
            newBlock = target;
        }

        q.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);

        var subs = await _db.Submissions.CountAsync(s => s.QuestionId == q.Id, ct);
        return CatalogResult<TeacherQuestionResponse>.Ok(await QuestionOutAsync(q, newBlock?.Name, subs, ct));
    }

    /// <summary>
    /// DELETE /api/questions/{id} — SOFT delete. The row is kept because submissions, assignments
    /// and review items all reference it with <c>ON DELETE CASCADE</c>: a hard delete would erase
    /// every student's attempts and grades for the task (see <see cref="DeleteBlockAsync"/>).
    ///
    /// <para>After this the task is gone from everywhere the catalog lists tasks — every authoring
    /// query and the student module view filter on <c>is_deleted</c> — and it is also unpublished,
    /// so any reader that checks only <c>is_published</c> hides it too. The module link and the media
    /// object are kept: history screens can still say what the task was.</para>
    ///
    /// <para>An already-deleted task answers 404, the same as one that never existed.</para>
    /// </summary>
    public async Task<CatalogResult<bool>> DeleteQuestionAsync(
        Guid userId, Guid questionId, CancellationToken ct = default)
    {
        var user = await ActiveUserAsync(userId, ct);
        if (user is null) return CatalogResult<bool>.Unauthorized();
        if (!IsTeacher(user)) return CatalogResult<bool>.Forbidden();

        var q = await _db.Questions.FirstOrDefaultAsync(x => x.Id == questionId && !x.IsDeleted, ct);
        if (q is null || (user.Role != UserRole.Admin && q.TeacherId != user.Id))
            return CatalogResult<bool>.NotFound();

        SoftDelete(q, DateTime.UtcNow);
        await _db.SaveChangesAsync(ct);
        return CatalogResult<bool>.Ok(true);
    }

    /// <summary>
    /// POST /api/questions/{id}/media — set (or replace) a task's image / short video. The mockup's
    /// optional "Rasm yoki video yuklash" on C2.
    ///
    /// <para>Validation is ENTIRELY server-side, mirroring the avatar path: the content-type must be
    /// in <see cref="MediaTypes"/> (notably NOT <c>image/svg+xml</c>, a stored-XSS vector), and the
    /// body must be non-empty and at most <see cref="MaxMediaBytes"/>. Both are checked BEFORE the
    /// user is loaded or storage is touched, so a rejected upload writes nothing.</para>
    ///
    /// <para>The object goes under a RANDOM <c>questions/</c> key with the extension derived from the
    /// VALIDATED content-type — the client's filename is ignored entirely, so a hostile name can
    /// never influence the stored key. The superseded object is then deleted BEST-EFFORT: an orphan
    /// is acceptable, a failed cleanup must never fail a request whose media already changed.</para>
    ///
    /// <para>Ownership is the same rule the rest of this surface uses — a teacher may only touch
    /// their OWN task (admin: any), and a task belonging to someone else is a 404, not a 403, so
    /// task ids stay unprobeable.</para>
    /// </summary>
    public async Task<CatalogResult<TeacherQuestionResponse>> SetQuestionMediaAsync(
        Guid userId, Guid questionId, Stream content, string? contentType, long length,
        CancellationToken ct = default)
    {
        // Checked and stored as the BARE media type, so `video/webm;codecs=vp9` passes the allow-list
        // exactly like `video/webm` and never reaches storage with parameters (see ContentTypes).
        var mediaType = ContentTypes.Essence(contentType);
        if (!MediaTypes.TryGetValue(mediaType, out var ext))
            return CatalogResult<TeacherQuestionResponse>.BadRequest(
                "Faqat rasm (JPEG/PNG/WebP) yoki video (MP4/WebM) yuklash mumkin");
        if (length <= 0)
            return CatalogResult<TeacherQuestionResponse>.BadRequest("Fayl bo'sh");
        if (length > MaxMediaBytes)
            return CatalogResult<TeacherQuestionResponse>.BadRequest("Fayl juda katta (eng ko'pi 25 MB)");

        var user = await ActiveUserAsync(userId, ct);
        if (user is null) return CatalogResult<TeacherQuestionResponse>.Unauthorized();
        if (!IsTeacher(user)) return CatalogResult<TeacherQuestionResponse>.Forbidden();

        var q = await _db.Questions.Include(x => x.Block)
            .FirstOrDefaultAsync(x => x.Id == questionId && !x.IsDeleted, ct);
        if (q is null || (user.Role != UserRole.Admin && q.TeacherId != user.Id))
            return CatalogResult<TeacherQuestionResponse>.NotFound();

        var oldKey = q.MediaKey;
        var newKey = _storage.NewKey("questions", ext);
        await _storage.PutAsync(newKey, content, mediaType, ct);

        q.MediaKey = newKey;
        q.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);

        // Only after the new key is committed, so a failure here never loses the new media.
        if (!string.IsNullOrEmpty(oldKey) && oldKey != newKey)
            await TryDeleteMediaAsync(oldKey, ct);

        var subs = await _db.Submissions.CountAsync(s => s.QuestionId == q.Id, ct);
        return CatalogResult<TeacherQuestionResponse>.Ok(await QuestionOutAsync(q, q.Block?.Name, subs, ct));
    }

    /// <summary>DELETE /api/questions/{id}/media — clear a task's media. Idempotent: a task with none
    /// is still a 200, because "make sure this has no media" is the caller's actual intent.</summary>
    public async Task<CatalogResult<TeacherQuestionResponse>> RemoveQuestionMediaAsync(
        Guid userId, Guid questionId, CancellationToken ct = default)
    {
        var user = await ActiveUserAsync(userId, ct);
        if (user is null) return CatalogResult<TeacherQuestionResponse>.Unauthorized();
        if (!IsTeacher(user)) return CatalogResult<TeacherQuestionResponse>.Forbidden();

        var q = await _db.Questions.Include(x => x.Block)
            .FirstOrDefaultAsync(x => x.Id == questionId && !x.IsDeleted, ct);
        if (q is null || (user.Role != UserRole.Admin && q.TeacherId != user.Id))
            return CatalogResult<TeacherQuestionResponse>.NotFound();

        var oldKey = q.MediaKey;
        if (oldKey is not null)
        {
            q.MediaKey = null;
            q.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
            await TryDeleteMediaAsync(oldKey, ct);
        }

        var subs = await _db.Submissions.CountAsync(s => s.QuestionId == q.Id, ct);
        return CatalogResult<TeacherQuestionResponse>.Ok(await QuestionOutAsync(q, q.Block?.Name, subs, ct));
    }

    // Best-effort object cleanup: the row already points elsewhere, so a storage hiccup must not
    // surface as a failed request. An orphaned object is the cheaper of the two problems.
    private async Task TryDeleteMediaAsync(string key, CancellationToken ct)
    {
        try { await _storage.DeleteAsync(key, ct); }
        catch { /* orphan is acceptable; losing the request is not */ }
    }

    // ─── authoring helpers ──────────────────────────────────────────────────────

    /// <summary>The <c>question_blocks.visibility</c> value of an official module.</summary>
    private const string PublicVisibility = "public";

    // A teacher asking for an official module. 403 with a code rather than the bare "Teacher role
    // required" — the caller IS a teacher, and the UI needs to explain what only an admin may do.
    private static CatalogResult<T> PublicRequiresAdmin<T>()
        => CatalogResult<T>.Forbidden(
            "Only an admin can make a module public (official)", CatalogErrorCodes.PublicRequiresAdmin);

    // Hidden from every listing (is_deleted) AND unpublished, so a reader that only checks
    // is_published hides it as well.
    private static void SoftDelete(Question q, DateTime now)
    {
        q.IsDeleted = true;
        q.IsPublished = false;
        q.UpdatedAt = now;
    }

    /// <summary>
    /// Project one task, minting a PRESIGNED url for its media when it has any.
    ///
    /// <para>Async only because of that url — presigning is local HMAC signing, not a round trip, so
    /// doing it per row in a 200-item library costs 200 hashes and no I/O. That is why every response
    /// can carry a real url rather than the list returning a bare "has media" flag the editor would
    /// then have to resolve with a second request.</para>
    /// </summary>
    private async Task<TeacherQuestionResponse> QuestionOutAsync(
        Question q, string? blockName, int submissionCount, CancellationToken ct)
        => new(
            Id: q.Id, Title: q.Title, PromptText: q.PromptText,
            Type: q.Type.ToString().ToLowerInvariant(),
            Level: q.Level, Topic: q.Topic, RuStyle: q.RuStyle,
            InstructionText: q.InstructionText, ModelAnswerText: q.ModelAnswerText,
            PrepTimeSec: q.PrepTimeSec, AnswerTimeLimitSec: q.AnswerTimeLimitSec,
            IsPublished: q.IsPublished, IsPublic: q.IsPublic,
            BlockId: q.BlockId, BlockName: blockName, SortOrder: q.SortOrder,
            SubmissionCount: submissionCount,
            CreatedAt: q.CreatedAt, UpdatedAt: q.UpdatedAt,
            MediaUrl: q.MediaKey is null ? null : await _storage.GetPresignedUrlAsync(q.MediaKey, ct: ct));

    private static string? Trimmed(string? s)
    {
        if (s is null) return null;
        var t = s.Trim();
        return t.Length == 0 ? null : t;                                     // blank clears the field
    }

    private async Task<User?> ActiveUserAsync(Guid userId, CancellationToken ct)
    {
        var u = await _db.Users.FirstOrDefaultAsync(x => x.Id == userId, ct);
        return u is null || !u.IsActive ? null : u;
    }

    private static bool IsTeacher(User u) => u.Role is UserRole.Teacher or UserRole.Admin;

    /// <summary>Distinct students across the teacher's own groups — the reach a published module has.</summary>
    private async Task<int> RosterReachAsync(User user, CancellationToken ct)
        => user.Role == UserRole.Admin
            ? await _db.GroupMembers.Select(gm => gm.StudentId).Distinct().CountAsync(ct)
            : await _db.GroupMembers.Where(gm => gm.Group.TeacherId == user.Id)
                .Select(gm => gm.StudentId).Distinct().CountAsync(ct);

    private async Task<Dictionary<Guid, int>> CountsPerBlockAsync(List<Guid> blockIds, CancellationToken ct)
        => blockIds.Count == 0
            ? new Dictionary<Guid, int>()
            : (await _db.Questions
                .Where(q => q.BlockId != null && blockIds.Contains(q.BlockId.Value) && !q.IsDeleted)
                .GroupBy(q => q.BlockId!.Value)
                .Select(g => new { Id = g.Key, Count = g.Count() })
                .ToListAsync(ct))
                .ToDictionary(x => x.Id, x => x.Count);

    private async Task<Dictionary<Guid, int>> SubmissionCountsAsync(List<Guid> questionIds, CancellationToken ct)
        => questionIds.Count == 0
            ? new Dictionary<Guid, int>()
            : (await _db.Submissions
                .Where(s => s.QuestionId != null && questionIds.Contains(s.QuestionId.Value))
                .GroupBy(s => s.QuestionId!.Value)
                .Select(g => new { Id = g.Key, Count = g.Count() })
                .ToListAsync(ct))
                .ToDictionary(x => x.Id, x => x.Count);

    private async Task<int> NextBlockSortAsync(Guid teacherId, CancellationToken ct)
        => (await _db.QuestionBlocks.Where(b => b.TeacherId == teacherId)
                .MaxAsync(b => (int?)b.SortOrder, ct) ?? -1) + 1;

    private async Task<int> NextQuestionSortAsync(Guid blockId, CancellationToken ct)
        => (await _db.Questions.Where(q => q.BlockId == blockId && !q.IsDeleted)
                .MaxAsync(q => (int?)q.SortOrder, ct) ?? -1) + 1;

}

/// <summary>Outcome of a Catalog authoring call.</summary>
public enum CatalogOutcome { Ok, Unauthorized, Forbidden, NotFound, BadRequest }

/// <summary>A Catalog authoring result: outcome + payload on success, detail on failure. <c>Code</c>
/// is set only for a failure the UI must tell apart (a <see cref="CatalogErrorCodes"/> value); the
/// endpoint then answers with a <see cref="CodedErrorResponse"/>.</summary>
public sealed record CatalogResult<T>(
    CatalogOutcome Outcome, T? Value = default, string? Detail = null, string? Code = null)
{
    public static CatalogResult<T> Ok(T value) => new(CatalogOutcome.Ok, value);
    public static CatalogResult<T> Unauthorized() => new(CatalogOutcome.Unauthorized);
    public static CatalogResult<T> Forbidden() => new(CatalogOutcome.Forbidden);
    public static CatalogResult<T> Forbidden(string detail, string code) => new(CatalogOutcome.Forbidden, default, detail, code);
    public static CatalogResult<T> NotFound() => new(CatalogOutcome.NotFound);
    public static CatalogResult<T> BadRequest(string detail) => new(CatalogOutcome.BadRequest, default, detail);
}
