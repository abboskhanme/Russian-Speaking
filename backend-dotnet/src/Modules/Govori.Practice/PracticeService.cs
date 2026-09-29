using System.Text.Json;
using Govori.Catalog;
using Govori.Contracts;
using Govori.Infrastructure;
using Govori.Infrastructure.Entities;
using Govori.Platform.Storage;
using Microsoft.EntityFrameworkCore;

namespace Govori.Practice;

/// <summary>
/// Application service for the Practice vertical slice (docs/07 §7.2 — keeps the API thin).
/// It owns the student attempt/submit flow: submitting an audio answer, listing attempts, and
/// reading one attempt's status/detail. Consumes <see cref="GovoriDbContext"/>,
/// <see cref="IObjectStorage"/> and — for the freemium gate — <see cref="CatalogService"/>.
///
/// <para><b>Freemium-gate reuse (task decision 3a).</b> The 402 paywall calls
/// <see cref="CatalogService.NeedsPremiumAsync"/> directly rather than re-implementing the
/// premium/position rules here. That method is the single, characterization-frozen
/// (C4/C9) source of truth, already proven through real SQL by <c>CatalogAccessSqlParityTests</c>,
/// so reusing it eliminates the divergence risk two copies would create. Reachability
/// (<see cref="CanReachAsync"/>) reuses <see cref="CatalogService.StudentTeacherIdsAsync"/> for the
/// same reason. The cost is a Practice→Catalog module edge; if a future ArchTest forbids that, the
/// clean refactor is to lift the access logic into a shared kernel both modules consume.</para>
///
/// <para><b>402 is raised ONLY at submit</b> (docs/08 Faza 3.3, C4), ONLY after the reachability
/// check, and — crucially — BEFORE the audio is stored, so a gated student's attempt produces
/// neither an upload nor a row.</para>
/// </summary>
public sealed class PracticeService
{
    private readonly GovoriDbContext _db;
    private readonly IObjectStorage _storage;
    private readonly CatalogService _catalog;
    private readonly IGradingQueue _grading;
    private readonly IClassroomNotifier _notifier;

    // The notifier is OPTIONAL (default: a no-op) so a service constructed directly keeps compiling;
    // the host injects Engagement's implementation. It only ever tells a student their attempt was
    // reviewed — see ReviewAsync.
    public PracticeService(
        GovoriDbContext db, IObjectStorage storage, CatalogService catalog, IGradingQueue grading,
        IClassroomNotifier? notifier = null)
    {
        _db = db;
        _storage = storage;
        _catalog = catalog;
        _grading = grading;
        _notifier = notifier ?? new NullClassroomNotifier();
    }

    // Storage-key extension for a recorded answer's content type; anything unknown → "webm". The
    // input is already the bare media type (see SubmitAsync): browsers send MediaRecorder's
    // `audio/ogg;codecs=opus` and friends, which would otherwise all miss these arms and be keyed
    // as .webm.
    private static string ExtForContentType(string? contentType) => contentType switch
    {
        "audio/webm" => "webm",
        "audio/ogg" => "ogg",
        "audio/mpeg" => "mp3",
        "audio/mp4" => "mp4",
        "audio/wav" => "wav",
        _ => "webm",
    };

    /// <summary>
    /// Submit an audio answer. The guard ORDER is load-bearing and must not be rearranged:
    /// 404 (no question, or a soft-deleted one) → [non-admin] 403 (unpublished, or not reachable) →
    /// 402 (freemium gate) → store audio → create the <c>pending</c> Submission → enqueue grading →
    /// 201. Every rejection happens before the upload, so a rejected attempt leaves no object and no
    /// row behind.
    ///
    /// <para><b>The task itself must be live, whatever path reaches it.</b> Reachability used to be
    /// judged on the MODULE (published?) and on side doors (an open assignment, a review item) — never
    /// on the task. So a soft-deleted task inside a published module, or an unpublished or deleted
    /// task a student still had an assignment for, could be answered by a direct POST and would then
    /// spend an STT and a grader call on content its author had withdrawn. A soft-deleted task is now
    /// a 404 for everyone, admin included — it is gone, and "gone" is what 404 means. An unpublished
    /// one is a 403 for everyone but an admin, whichever door they came through; the admin bypass is
    /// kept so a draft can still be tried end to end before it ships.</para>
    /// </summary>
    public async Task<SubmitResult> SubmitAsync(Guid userId, SubmitAudio audio, CancellationToken ct = default)
    {
        // role/is_active come from the DB per request, never from the token (§7.5).
        var student = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId, ct);
        if (student is null || !student.IsActive)
            return new SubmitResult(SubmitStatus.Unauthorized);

        var question = await _db.Questions.FirstOrDefaultAsync(q => q.Id == audio.QuestionId, ct);
        if (question is null || question.IsDeleted)                         // soft-deleted ⇒ gone, for everyone
            return new SubmitResult(SubmitStatus.QuestionNotFound);

        // A submission counts against a still-open assignment (no due date, or not yet past it)
        // for class-leaderboard scoping.
        var now = DateTime.UtcNow;
        var assignment = await _db.Assignments.FirstOrDefaultAsync(
            a => a.StudentId == student.Id
                 && a.QuestionId == question.Id
                 && (a.DueAt == null || a.DueAt >= now),
            ct);

        if (student.Role != UserRole.Admin)                                 // admin bypasses both gates
        {
            // An unpublished task is reachable by NO path — not its module, not an open assignment,
            // not the review queue. Checked first, so a withdrawn draft costs no further query.
            if (!question.IsPublished)
                return new SubmitResult(SubmitStatus.Forbidden);

            // Reachable via its module, a still-open assignment, or a pending review item.
            var inReview = await _db.ReviewItems.AnyAsync(
                r => r.StudentId == student.Id && r.QuestionId == question.Id && !r.Completed, ct);
            var reachable = await CanReachAsync(student, question, ct) || assignment is not null || inReview;
            if (!reachable)
                return new SubmitResult(SubmitStatus.Forbidden);

            // Attempt budget (D3's "Urinish"). Only an ASSIGNMENT carries one, and it binds exactly
            // the answers ATTRIBUTED to it — the same rule that already decides `assignment_id`
            // above. So while the assignment is open every answer to that task counts against it,
            // however the student navigated there, and answers given before it was set (or after it
            // closes) do not: they carry a different assignment_id, or none. Anything narrower would
            // make the budget depend on which route the student happened to take, which they cannot
            // see. `null` — every row written before this column existed — means unlimited.
            //
            // Checked BEFORE the premium gate on purpose. Out of attempts, the answer cannot be
            // accepted at any price, and prompting someone to upgrade for something they still could
            // not submit would be a lie told by ordering.
            if (assignment?.MaxAttempts is int limit)
            {
                // Same rule the response projection reports, so "2/3" and the refusal agree. A
                // FAILED attempt does not count: grading fell over on our side, and charging the
                // student for it would make an outage cost them their last try.
                var used = await _db.Submissions.CountAsync(
                    s => s.AssignmentId == assignment.Id && s.Status != SubmissionStatus.Failed, ct);
                if (used >= limit)
                    return new SubmitResult(
                        SubmitStatus.AttemptsExhausted,
                        Detail: $"All {limit} attempts for this task have been used.");
            }

            // Positional freemium gate — the ONLY 402 in the app, raised here at submit and
            // BEFORE any upload. Reuses Catalog's frozen decision.
            if (await _catalog.NeedsPremiumAsync(student, question, ct))
                return new SubmitResult(SubmitStatus.PaymentRequired);
        }

        // Store the audio only once the gates have passed, under the "answers" key prefix.
        // A gated student never reaches this line. The bare media type drives both the key's
        // extension and the stored object's type, so `audio/webm;codecs=opus` (Chrome/Android) and
        // `audio/webm` land identically.
        var contentType = ContentTypes.Essence(audio.ContentType);
        var key = _storage.NewKey("answers", ExtForContentType(contentType));
        await _storage.PutAsync(key, audio.Content, contentType, ct);

        var submission = new Submission
        {
            Id = Guid.NewGuid(),               // submissions.id is ValueGeneratedNever (DB has no default)
            StudentId = student.Id,
            QuestionId = question.Id,
            AssignmentId = assignment?.Id,
            AudioKey = key,
            AudioDurationSec = audio.DurationSec,
            Status = SubmissionStatus.Pending,
            CreatedAt = now,
            UpdatedAt = now,
        };
        _db.Submissions.Add(submission);
        await _db.SaveChangesAsync(ct);

        // Hand the new attempt to the grading pipeline. In production this only ENQUEUES a durable
        // Hangfire job (HangfireGradingQueue) that the Worker grades off-request, so submit returns
        // at once; with GOVORI_HANGFIRE=false the in-process queue grades right here instead, which
        // is what the integration suites use to assert results inline.
        await _grading.EnqueueAsync(submission.Id, ct);

        var response = await ToResponseAsync(submission, student, question, ct);
        return new SubmitResult(SubmitStatus.Ok, response);
    }

    /// <summary>
    /// List attempts. Real (non-shadow) answers only (<c>reference_text IS NULL</c>). Students see
    /// only their own; teachers see every answer their own roster gives, to ANY question
    /// (<see cref="TeacherScope"/> — a class on the public catalog is still the teacher's class);
    /// admins see all. Newest first, paged. Returns <c>null</c> when the user is missing/inactive,
    /// which the endpoint turns into a 401.
    /// </summary>
    public async Task<IReadOnlyList<SubmissionResponse>?> ListAsync(
        Guid userId, Guid? questionId, int limit, int offset, CancellationToken ct = default,
        Guid? studentId = null, bool? needsReview = null)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId, ct);
        if (user is null || !user.IsActive)
            return null;

        limit = Math.Clamp(limit, 1, 200);                                  // page size is capped at 200
        offset = Math.Max(offset, 0);                                       // never page backwards

        // Shadowing practice (reference_text set) is excluded from the answer list. The role scope
        // (student: own · teacher: own roster, any question · admin: all) is the shared rule, so
        // this list and the detail/review routes below can never disagree about an attempt.
        var query = _db.Submissions
            .Where(s => s.ReferenceText == null)
            .VisibleTo(_db, user);

        if (questionId is not null)
            query = query.Where(s => s.QuestionId == questionId);

        // ?student_id — one student's attempts, for the teacher's student profile (A6).
        // Purely a NARROWING filter applied AFTER the role scoping above, never instead of
        // it: a teacher asking for a student outside their roster gets an empty list, not
        // that student's work. A student asking for anyone else likewise gets nothing,
        // because their own clause already pinned StudentId to themselves.
        if (studentId is not null)
            query = query.Where(s => s.StudentId == studentId);

        // ?needs_review — the teacher's grading queue (B1 «Tekshirish navbati»): AI grading has
        // FINISHED but no teacher has signed off. `failed` is excluded on purpose: a pipeline
        // failure is an ops problem, not a grading decision, and putting it in front of a teacher
        // asks them to judge an attempt that was never scored.
        if (needsReview == true)
            query = query.Where(NeedsReview);

        var rows = await query
            .Include(s => s.Student)
            .Include(s => s.Question)
            .Include(s => s.Evaluation)                                     // scores on each row
            .OrderByDescending(s => s.CreatedAt)
            .Skip(offset)
            .Take(limit)
            .ToListAsync(ct);

        var result = new List<SubmissionResponse>(rows.Count);
        foreach (var s in rows)
            result.Add(await ToResponseAsync(s, s.Student, s.Question, ct));
        return result;
    }

    /// <summary>The grading queue's membership rule — shared by the list and the count so the badge
    /// and the list can never disagree about what "waiting for review" means.</summary>
    private static readonly System.Linq.Expressions.Expression<Func<Submission, bool>> NeedsReview =
        s => s.Status == SubmissionStatus.Done && s.ReviewedAt == null;

    /// <summary>
    /// GET /api/submissions/review-count — how many answers wait for this user's review, under the
    /// same role scope as <see cref="ListAsync"/>.
    ///
    /// <para>Exists because the panel counted the queue by fetching it: every teacher screen asked
    /// for 100 rows and printed <c>.length</c> on the FAB badge, so a roster with 125 unreviewed
    /// answers read "100" — and widening the teacher scope to the whole roster made that the normal
    /// case, not an edge. A count is one indexed query and no row materialisation.</para>
    /// </summary>
    public async Task<int?> ReviewCountAsync(Guid userId, CancellationToken ct = default)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId, ct);
        if (user is null || !user.IsActive)
            return null;

        return await _db.Submissions
            .Where(s => s.ReferenceText == null)
            .VisibleTo(_db, user)
            .Where(NeedsReview)
            .CountAsync(ct);
    }

    /// <summary>
    /// Attempt status/detail. Anyone may read their OWN attempt; a student may read only their own;
    /// a teacher any answer from their own roster (<see cref="TeacherScope"/>). Missing OR not
    /// visible → 404 (never leaks existence).
    /// </summary>
    public async Task<GetResult> GetAsync(Guid userId, Guid submissionId, CancellationToken ct = default)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId, ct);
        if (user is null || !user.IsActive)
            return new GetResult(GetStatus.Unauthorized);

        var submission = await _db.Submissions
            .Include(s => s.Student)
            .Include(s => s.Question)
            .Include(s => s.Evaluation)                                     // scores on the response
            .FirstOrDefaultAsync(s => s.Id == submissionId, ct);
        if (submission is null)
            return new GetResult(GetStatus.NotFound);

        // Visibility is the shared rule (owner first, then admin / teacher-roster) — the same one
        // the list applies, so an attempt the queue shows is always an attempt this route serves.
        if (!await TeacherScope.CanSeeAsync(_db, user, submission, ct))
            return new GetResult(GetStatus.NotFound);                       // never leaks existence

        var response = await ToResponseAsync(submission, submission.Student, submission.Question, ct);
        return new GetResult(GetStatus.Ok, response);
    }

    /// <summary>
    /// One attempt's FULL detail (audio + transcript + AI evaluation) for the student result screen.
    /// Same visibility rule as <see cref="GetAsync"/>. The audio is presigned only while it survives
    /// (the retention job sets <c>AudioDeletedAt</c> after 90 days, keeping the row + transcript +
    /// scores) — a purged attempt returns <c>AudioExpired = true</c> and a null URL.
    /// </summary>
    public async Task<AttemptDetailResult> GetDetailAsync(Guid userId, Guid submissionId, CancellationToken ct = default)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId, ct);
        if (user is null || !user.IsActive)
            return new AttemptDetailResult(GetStatus.Unauthorized);

        var sub = await _db.Submissions
            .Include(s => s.Question)
            .Include(s => s.Evaluation)
            .Include(s => s.Transcript)
            .Include(s => s.Student)                                            // name for the teacher's header
            .FirstOrDefaultAsync(s => s.Id == submissionId, ct);
        if (sub is null)
            return new AttemptDetailResult(GetStatus.NotFound);

        if (!await TeacherScope.CanSeeAsync(_db, user, sub, ct))
            return new AttemptDetailResult(GetStatus.NotFound);                 // never leaks existence

        var expired = sub.AudioDeletedAt is not null;
        var audioUrl = expired ? null : await _storage.GetPresignedUrlAsync(sub.AudioKey, ct: ct);

        var e = sub.Evaluation;
        var band = e is not null
            ? Math.Clamp((int)Math.Round(e.OverallBand, MidpointRounding.AwayFromZero), 0, 100)
            : (int?)null;

        var detail = new AttemptDetailResponse(
            Id: sub.Id,
            Status: sub.Status.ToString().ToLowerInvariant(),
            CreatedAt: sub.CreatedAt,
            CompletedAt: sub.CompletedAt,
            QuestionTitle: sub.Question?.Title,
            QuestionTopic: sub.Question?.Topic,
            QuestionLevel: sub.Question?.Level,
            ReferenceText: sub.ReferenceText,
            ModelAnswerText: sub.ModelAnswerText ?? sub.Question?.ModelAnswerText,
            AudioUrl: audioUrl,
            AudioDurationSec: sub.AudioDurationSec,
            AudioExpired: expired,
            Transcript: sub.Transcript?.Text,
            Band: band,
            OverallBand: e?.OverallBand,
            FluencyScore: e?.FluencyScore,
            LexicalScore: e?.LexicalScore,
            GrammarScore: e?.GrammarScore,
            PronunciationScore: e?.PronunciationScore,
            RelevanceScore: e?.RelevanceScore,
            Feedback: e?.Feedback,
            Corrections: e?.Corrections,
            TeacherBand: sub.TeacherBand,
            TeacherComment: sub.TeacherComment,
            ReviewedAt: sub.ReviewedAt,
            Words: ParseWords(sub.Transcript?.WordTimestamps),
            StudentName: sub.Student?.FullName);

        return new AttemptDetailResult(GetStatus.Ok, detail);
    }

    /// <summary>Serializer for the STT jsonb columns — snake_case, matching what the assessment
    /// pipeline wrote (<c>word_timestamps</c> holds <c>{word,start,end,accuracy,error_type}</c>).</summary>
    private static readonly JsonSerializerOptions WordJsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
    };

    /// <summary>
    /// <c>transcripts.word_timestamps</c> → the per-word rows.
    ///
    /// <para>Returns an EMPTY list, never null, for absent or unparseable JSON: a malformed stored
    /// payload must degrade to "no word data" and still render the plain transcript, not fail the
    /// whole attempt-detail request. Words with no text are dropped — they would render as gaps the
    /// reader cannot interpret.</para>
    /// </summary>
    private static IReadOnlyList<TranscriptWordResponse> ParseWords(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return [];
        try
        {
            var raw = JsonSerializer.Deserialize<List<StoredWord>>(json, WordJsonOptions);
            if (raw is null) return [];
            return raw
                .Where(w => !string.IsNullOrWhiteSpace(w.Word))
                .Select(w => new TranscriptWordResponse(w.Word!, w.Start, w.End, w.Accuracy, w.ErrorType))
                .ToList();
        }
        catch (JsonException)
        {
            return [];
        }
    }

    /// <summary>The stored per-word shape. Mirrors <c>Govori.Platform.Stt.SttWord</c>'s persisted
    /// fields; declared locally so Practice does not take a dependency on the STT provider types
    /// just to read a column it owns.</summary>
    private sealed record StoredWord
    {
        public string? Word { get; init; }
        public double? Start { get; init; }
        public double? End { get; init; }
        public double? Accuracy { get; init; }
        public string? ErrorType { get; init; }
    }

    /// <summary>
    /// PATCH /submissions/{id}/review — a teacher's manual verdict: overall band and/or the
    /// "Izoh o'quvchiga" comment, stamped with who reviewed it and when. Field semantics (absent =
    /// unchanged, <c>null</c> = clear, <c>confirm</c> never overwrites a comment) are documented on
    /// <see cref="ReviewSubmissionRequest"/>.
    ///
    /// <para><b>Visibility is the roster rule</b> (<see cref="TeacherScope"/>): a teacher may review
    /// any answer their own students give, to any question, and anything else is 404 — never 403 —
    /// so a teacher cannot probe which submission ids exist. A student is refused outright even for
    /// their own attempt, and nobody may grade their OWN attempt: the owner shortcut that lets
    /// anyone READ their attempt deliberately does not apply here.</para>
    ///
    /// <para>After the verdict is committed the student is told (<c>review_done</c>) — but only when
    /// this request actually decided something new: a first review, or a changed band or comment. A
    /// double-tapped Save or a re-confirm is not news.</para>
    /// </summary>
    public async Task<ReviewResult> ReviewAsync(
        Guid userId, Guid submissionId, ReviewSubmissionRequest body, CancellationToken ct = default)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId, ct);
        if (user is null || !user.IsActive) return new ReviewResult(ReviewStatus.Unauthorized);
        if (user.Role == UserRole.Student) return new ReviewResult(ReviewStatus.Forbidden);

        var confirm = body.Confirm == true;
        if (!body.HasTeacherBand && !body.HasTeacherComment && !confirm)
            return ReviewResult.BadRequest(ReviewErrorCodes.EmptyReview,
                "Provide teacher_band (0..100), teacher_comment, or confirm: true");
        if (confirm && body.HasTeacherBand)
            return ReviewResult.BadRequest(ReviewErrorCodes.ConfirmWithBand,
                "confirm accepts the AI's score; it cannot be sent together with teacher_band");
        if (body.TeacherBand is { } band && (band < 0 || band > 100))
            return ReviewResult.BadRequest(ReviewErrorCodes.BandOutOfRange, "teacher_band must be between 0 and 100");

        var sub = await _db.Submissions.FirstOrDefaultAsync(s => s.Id == submissionId, ct);
        if (sub is null || sub.StudentId == user.Id)
            return new ReviewResult(ReviewStatus.NotFound);
        var mayReview = user.Role == UserRole.Admin
                        || await TeacherScope.TeachesAsync(_db, user.Id, sub.StudentId, ct);
        if (!mayReview)
            return new ReviewResult(ReviewStatus.NotFound);                // not yours ⇒ does not exist

        var wasReviewed = sub.ReviewedAt is not null;
        var bandBefore = sub.TeacherBand;
        var commentBefore = sub.TeacherComment;

        // Absent keys never reach these branches, so an omitted field is left exactly as stored.
        if (body.HasTeacherBand)
            sub.TeacherBand = body.TeacherBand;                             // null withdraws the override
        if (body.HasTeacherComment)
        {
            var comment = string.IsNullOrWhiteSpace(body.TeacherComment)
                ? null                                                      // null or blank clears
                : body.TeacherComment!.Trim();
            // A confirm's note only fills an EMPTY slot. It used to overwrite what the teacher had
            // actually written, leaving "AI score confirmed" beside the teacher's own band.
            if (!confirm || sub.TeacherComment is null)
                sub.TeacherComment = comment;
        }

        var now = DateTime.UtcNow;
        sub.ReviewedBy = user.Id;
        sub.ReviewedAt = now;
        sub.UpdatedAt = now;
        await _db.SaveChangesAsync(ct);

        var decidedSomething = !wasReviewed
                               || !Nullable.Equals(bandBefore, sub.TeacherBand)
                               || !string.Equals(commentBefore, sub.TeacherComment, StringComparison.Ordinal);
        if (decidedSomething)
            await _notifier.SendBestEffortAsync(n => n.ReviewSavedAsync(sub.Id, ct), ct);

        return new ReviewResult(ReviewStatus.Ok);
    }

    /// <summary>
    /// Module-path reachability for one task: can this student open it through the published
    /// catalog at all? Reuses <see cref="CatalogService.StudentTeacherIdsAsync"/> for the
    /// teacher-ids lookup so the group membership query is not duplicated.
    /// </summary>
    private async Task<bool> CanReachAsync(User student, Question q, CancellationToken ct)
    {
        if (q.BlockId is null)
            return false;                                                   // a task with no module is unreachable
        var block = await _db.QuestionBlocks.FirstOrDefaultAsync(b => b.Id == q.BlockId.Value, ct);
        if (block is null || !block.IsPublished)
            return false;                                                   // unpublished modules hide their tasks
        if (block.Visibility == "public")
            return true;                                                    // official public curriculum
        var teacherIds = await _catalog.StudentTeacherIdsAsync(student.Id, ct);
        return teacherIds.Contains(block.TeacherId);                        // the student's teacher's group module
    }

    // Presign the audio URL (local SigV4 signing — no network), then project: the wire shape
    // carries audio_url plus denormalized student/question labels so clients need no extra fetch.
    private async Task<SubmissionResponse> ToResponseAsync(
        Submission sub, User? student, Question? question, CancellationToken ct)
    {
        // Don't hand out a URL for audio the retention job has purged (the object is gone).
        var audioUrl = sub.AudioDeletedAt is not null
            ? null
            : await _storage.GetPresignedUrlAsync(sub.AudioKey, ct: ct);
        return Project(sub, student, question, audioUrl);
    }

    private static SubmissionResponse Project(Submission sub, User? student, Question? question, string? audioUrl)
        => new(
            Id: sub.Id,
            StudentId: sub.StudentId,
            QuestionId: sub.QuestionId,
            ReferenceText: sub.ReferenceText,
            AudioKey: sub.AudioKey,
            AudioUrl: audioUrl,
            AudioDurationSec: sub.AudioDurationSec,
            Status: sub.Status.ToString().ToLowerInvariant(),               // PG label: pending/processing/done/failed
            ErrorMessage: sub.ErrorMessage,
            CreatedAt: sub.CreatedAt,
            CompletedAt: sub.CompletedAt,
            StudentName: student?.FullName,
            QuestionTitle: question?.Title,
            QuestionTopic: question?.Topic,
            QuestionLevel: question?.Level,
            // Prefer the fresh per-attempt exemplar; fall back to the question's stored one.
            ModelAnswerText: sub.ModelAnswerText ?? question?.ModelAnswerText,
            TeacherComment: sub.TeacherComment,
            TeacherBand: sub.TeacherBand,
            ReviewedAt: sub.ReviewedAt,
            // Null whenever the Evaluation is absent — either not graded yet, or the
            // caller's query did not Include(s => s.Evaluation). Every path that
            // hands a score to a client MUST include it; a silently-null score reads
            // as "ungraded" and would be indistinguishable from the real thing.
            OverallBand: sub.Evaluation?.OverallBand,
            FluencyScore: sub.Evaluation?.FluencyScore,
            LexicalScore: sub.Evaluation?.LexicalScore,
            GrammarScore: sub.Evaluation?.GrammarScore,
            PronunciationScore: sub.Evaluation?.PronunciationScore);
}

/// <summary>The audio + metadata the endpoint hands the service for a submit (HTTP-layer parsed).</summary>
public sealed record SubmitAudio(Guid QuestionId, Stream Content, string ContentType, double? DurationSec);

/// <summary>Outcome of <see cref="PracticeService.SubmitAsync"/> — the service owns the status decision (§7.2).
/// <c>AttemptsExhausted</c> is separate from <c>Forbidden</c> because it is the one refusal here that
/// is not about permission: the task IS the student's, they have simply spent its budget.</summary>
public enum SubmitStatus { Ok, Unauthorized, QuestionNotFound, Forbidden, PaymentRequired, AttemptsExhausted }

/// <summary><paramref name="Detail"/> carries a message the endpoint can pass through verbatim, for
/// the refusals whose specifics (a limit, a count) the endpoint has no way to know.</summary>
public sealed record SubmitResult(
    SubmitStatus Status, SubmissionResponse? Submission = null, string? Detail = null);

/// <summary>Outcome of <see cref="PracticeService.GetAsync"/>.</summary>
public enum GetStatus { Ok, Unauthorized, NotFound }

/// <summary>Outcome of <see cref="PracticeService.ReviewAsync"/>. <c>NotFound</c> covers both a
/// missing submission and one this teacher may not see, so existence is never leaked.</summary>
public enum ReviewStatus { Ok, Unauthorized, Forbidden, NotFound, BadRequest }

/// <summary>A review outcome plus, for a 400, the machine <paramref name="Code"/> and human
/// <paramref name="Detail"/> the endpoint writes as <c>{ "detail", "code" }</c>.</summary>
public sealed record ReviewResult(ReviewStatus Status, string? Code = null, string? Detail = null)
{
    public static ReviewResult BadRequest(string code, string detail) => new(ReviewStatus.BadRequest, code, detail);
}

public sealed record GetResult(GetStatus Status, SubmissionResponse? Submission = null);

/// <summary>Outcome of <see cref="PracticeService.GetDetailAsync"/> (reuses <see cref="GetStatus"/>).</summary>
public sealed record AttemptDetailResult(GetStatus Status, AttemptDetailResponse? Detail = null);
