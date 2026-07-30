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

    public PracticeService(GovoriDbContext db, IObjectStorage storage, CatalogService catalog, IGradingQueue grading)
    {
        _db = db;
        _storage = storage;
        _catalog = catalog;
        _grading = grading;
    }

    // Storage-key extension for a recorded answer's content type; anything unknown → "webm".
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
    /// 404 (no question) → [non-admin] 403 (not reachable) → 402 (freemium gate) → store audio →
    /// create the <c>pending</c> Submission → enqueue grading → 201. Every rejection happens before
    /// the upload, so a rejected attempt leaves no object and no row behind.
    /// </summary>
    public async Task<SubmitResult> SubmitAsync(Guid userId, SubmitAudio audio, CancellationToken ct = default)
    {
        // role/is_active come from the DB per request, never from the token (§7.5).
        var student = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId, ct);
        if (student is null || !student.IsActive)
            return new SubmitResult(SubmitStatus.Unauthorized);

        var question = await _db.Questions.FirstOrDefaultAsync(q => q.Id == audio.QuestionId, ct);
        if (question is null)
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
            // Reachable via its module, a still-open assignment, or a pending review item.
            var inReview = await _db.ReviewItems.AnyAsync(
                r => r.StudentId == student.Id && r.QuestionId == question.Id && !r.Completed, ct);
            var reachable = await CanReachAsync(student, question, ct) || assignment is not null || inReview;
            if (!reachable)
                return new SubmitResult(SubmitStatus.Forbidden);

            // Positional freemium gate — the ONLY 402 in the app, raised here at submit and
            // BEFORE any upload. Reuses Catalog's frozen decision.
            if (await _catalog.NeedsPremiumAsync(student, question, ct))
                return new SubmitResult(SubmitStatus.PaymentRequired);
        }

        // Store the audio only once the gates have passed, under the "answers" key prefix.
        // A gated student never reaches this line.
        var key = _storage.NewKey("answers", ExtForContentType(audio.ContentType));
        await _storage.PutAsync(key, audio.Content, audio.ContentType, ct);

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

        // Hand the new attempt to the grading pipeline (Faza 3.4). The default in-process queue
        // runs the STT + analysis pipeline in its OWN scope, and short-circuits (leaving the
        // attempt pending) until real STT/Grader providers are wired — so submit stays fast.
        // TODO(Hangfire, Faza 3.9): swap in the durable background queue so grading is off-request.
        await _grading.EnqueueAsync(submission.Id, ct);

        var response = await ToResponseAsync(submission, student, question, ct);
        return new SubmitResult(SubmitStatus.Ok, response);
    }

    /// <summary>
    /// List attempts. Real (non-shadow) answers only (<c>reference_text IS NULL</c>). Students see
    /// only their own; teachers see answers to their own questions from their own roster; admins
    /// see all. Newest first, paged. Returns <c>null</c> when the user is missing/inactive, which
    /// the endpoint turns into a 401.
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

        // Shadowing practice (reference_text set) is excluded from the answer list.
        var query = _db.Submissions.Where(s => s.ReferenceText == null);

        if (user.Role == UserRole.Student)
        {
            query = query.Where(s => s.StudentId == user.Id);               // own answers only
        }
        else if (user.Role == UserRole.Teacher)
        {
            // Answers to the teacher's OWN questions AND only from their own roster — both
            // conditions apply; neither alone grants visibility.
            var roster = _db.GroupMembers
                .Where(gm => gm.Group.TeacherId == user.Id)
                .Select(gm => gm.StudentId);
            query = query
                .Where(s => s.Question != null && s.Question.TeacherId == user.Id)
                .Where(s => roster.Contains(s.StudentId));
        }
        // admin: all submissions

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
            query = query.Where(s => s.Status == SubmissionStatus.Done && s.ReviewedAt == null);

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

    /// <summary>
    /// Attempt status/detail. Anyone may read their OWN attempt; a student may read only their own;
    /// a teacher only their own students' answers to their own questions. Missing OR not visible
    /// → 404 (never leaks existence).
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

        // Visibility: the owner always may read their own attempt — this ownership check must come
        // FIRST, because a teacher/admin's own shadowing practice has no question and would
        // otherwise trip the roster check below. Beyond that, a student reads only their own; a
        // teacher only their own students' answers to their own questions.
        var visible =
            submission.StudentId == user.Id
            || (user.Role != UserRole.Student
                && !(user.Role == UserRole.Teacher && await TeacherDeniedAsync(user.Id, submission, ct)));
        if (!visible)
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

        var visible =
            sub.StudentId == user.Id
            || (user.Role != UserRole.Student
                && !(user.Role == UserRole.Teacher && await TeacherDeniedAsync(user.Id, sub, ct)));
        if (!visible)
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
    /// "Izoh o'quvchiga" comment, stamped with who reviewed it and when.
    ///
    /// <para><b>Visibility is the same rule as reading the attempt</b> (<see cref="TeacherDeniedAsync"/>):
    /// a teacher may review only their OWN students' answers to their OWN questions, and anything
    /// else is 404 — never 403 — so a teacher cannot probe which submission ids exist. A student is
    /// refused outright even for their own attempt: grading yourself is not a thing.</para>
    ///
    /// <para>An empty body (neither field) is a 400. Without that guard it would stamp
    /// <c>ReviewedAt</c>, drop the row out of the review queue, and record no actual decision.</para>
    /// </summary>
    public async Task<ReviewStatus> ReviewAsync(
        Guid userId, Guid submissionId, ReviewSubmissionRequest body, CancellationToken ct = default)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId, ct);
        if (user is null || !user.IsActive) return ReviewStatus.Unauthorized;
        if (user.Role == UserRole.Student) return ReviewStatus.Forbidden;

        var hasBand = body.TeacherBand is not null;
        var hasComment = body.TeacherComment is not null;
        if (!hasBand && !hasComment) return ReviewStatus.BadRequest;
        if (hasBand && (body.TeacherBand < 0 || body.TeacherBand > 100)) return ReviewStatus.BadRequest;

        // Include(Question) is REQUIRED, not incidental: TeacherDeniedAsync compares
        // sub.Question.TeacherId, so an unloaded navigation makes it deny every teacher and this
        // endpoint 404s even for the rightful owner.
        var sub = await _db.Submissions
            .Include(s => s.Question)
            .FirstOrDefaultAsync(s => s.Id == submissionId, ct);
        if (sub is null) return ReviewStatus.NotFound;
        if (user.Role == UserRole.Teacher && await TeacherDeniedAsync(user.Id, sub, ct))
            return ReviewStatus.NotFound;                                   // not yours ⇒ does not exist

        var now = DateTime.UtcNow;
        if (hasBand) sub.TeacherBand = body.TeacherBand;
        // A blank comment CLEARS it; an absent one leaves the previous note alone.
        if (hasComment)
            sub.TeacherComment = string.IsNullOrWhiteSpace(body.TeacherComment)
                ? null
                : body.TeacherComment!.Trim();
        sub.ReviewedBy = user.Id;
        sub.ReviewedAt = now;
        sub.UpdatedAt = now;

        await _db.SaveChangesAsync(ct);
        return ReviewStatus.Ok;
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

    /// <summary>
    /// A teacher may view an attempt only if it answers their OWN question AND the student is in
    /// their roster. Returns true when EITHER condition fails, i.e. when the view must be denied.
    /// </summary>
    private async Task<bool> TeacherDeniedAsync(Guid teacherId, Submission sub, CancellationToken ct)
    {
        if (sub.Question is null || sub.Question.TeacherId != teacherId)
            return true;
        var inRoster = await _db.GroupMembers.AnyAsync(
            gm => gm.Group.TeacherId == teacherId && gm.StudentId == sub.StudentId, ct);
        return !inRoster;
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

/// <summary>Outcome of <see cref="PracticeService.SubmitAsync"/> — the service owns the status decision (§7.2).</summary>
public enum SubmitStatus { Ok, Unauthorized, QuestionNotFound, Forbidden, PaymentRequired }

public sealed record SubmitResult(SubmitStatus Status, SubmissionResponse? Submission = null);

/// <summary>Outcome of <see cref="PracticeService.GetAsync"/>.</summary>
public enum GetStatus { Ok, Unauthorized, NotFound }

/// <summary>Outcome of <see cref="PracticeService.ReviewAsync"/>. <c>NotFound</c> covers both a
/// missing submission and one this teacher may not see, so existence is never leaked.</summary>
public enum ReviewStatus { Ok, Unauthorized, Forbidden, NotFound, BadRequest }

public sealed record GetResult(GetStatus Status, SubmissionResponse? Submission = null);

/// <summary>Outcome of <see cref="PracticeService.GetDetailAsync"/> (reuses <see cref="GetStatus"/>).</summary>
public sealed record AttemptDetailResult(GetStatus Status, AttemptDetailResponse? Detail = null);
