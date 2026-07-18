using Govori.Catalog;
using Govori.Contracts;
using Govori.Infrastructure;
using Govori.Infrastructure.Entities;
using Govori.Platform.Storage;
using Microsoft.EntityFrameworkCore;

namespace Govori.Practice;

/// <summary>
/// Application service for the Practice vertical slice (docs/07 §7.2 — keeps the API thin),
/// ported from backend/app/api/v1/submissions.py (the student attempt/submit flow). Consumes
/// <see cref="GovoriDbContext"/>, <see cref="IObjectStorage"/> and — for the freemium gate —
/// <see cref="CatalogService"/>.
///
/// <para><b>Freemium-gate reuse (task decision 3a).</b> The 402 paywall calls
/// <see cref="CatalogService.NeedsPremiumAsync"/> directly rather than re-implementing
/// <c>needs_premium</c>/<c>task_index</c> here. That method is the single, characterization-frozen
/// (C4/C9) source of truth, already proven through real SQL by <c>CatalogAccessSqlParityTests</c>,
/// so reusing it eliminates the divergence risk two copies would create. Reachability
/// (<see cref="CanReachAsync"/>) reuses <see cref="CatalogService.StudentTeacherIdsAsync"/> for the
/// same reason. The cost is a Practice→Catalog module edge; if a future ArchTest forbids that, the
/// clean refactor is to lift the access logic into a shared kernel both modules consume.</para>
///
/// <para><b>402 is raised ONLY at submit</b> (docs/08 Faza 3.3, C4) and ONLY after reachability,
/// mirroring submissions.py:117-143 — and, crucially, BEFORE the audio is stored, so a gated
/// student's attempt produces neither an upload nor a row.</para>
/// </summary>
public sealed class PracticeService
{
    private readonly GovoriDbContext _db;
    private readonly IObjectStorage _storage;
    private readonly CatalogService _catalog;

    public PracticeService(GovoriDbContext db, IObjectStorage storage, CatalogService catalog)
    {
        _db = db;
        _storage = storage;
        _catalog = catalog;
    }

    // Python _EXT_BY_CONTENT_TYPE (submissions.py:43-49); unknown → "webm".
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
    /// Submit an audio answer, a faithful port of <c>create_submission</c> (submissions.py:105-158).
    /// Guard order is preserved: 404 (no question) → [non-admin] 403 (not reachable) → 402 (freemium
    /// gate) → store audio → create the <c>pending</c> Submission → (TODO: enqueue grading) → 201.
    /// </summary>
    public async Task<SubmitResult> SubmitAsync(Guid userId, SubmitAudio audio, CancellationToken ct = default)
    {
        // role/is_active come from the DB per request, never the token (deps.py:30-32, §7.5).
        var student = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId, ct);
        if (student is null || !student.IsActive)
            return new SubmitResult(SubmitStatus.Unauthorized);

        var question = await _db.Questions.FirstOrDefaultAsync(q => q.Id == audio.QuestionId, ct);
        if (question is null)
            return new SubmitResult(SubmitStatus.QuestionNotFound);         // submissions.py:110-112

        // A submission counts against a still-open assignment for class-leaderboard scoping
        // (submissions.py:116; active_assignment, questions.py:39-52).
        var now = DateTime.UtcNow;
        var assignment = await _db.Assignments.FirstOrDefaultAsync(
            a => a.StudentId == student.Id
                 && a.QuestionId == question.Id
                 && (a.DueAt == null || a.DueAt >= now),
            ct);

        if (student.Role != UserRole.Admin)                                 // admin bypasses both gates
        {
            // Reachable via its module, a still-open assignment, or a pending review item
            // (submissions.py:117-136).
            var inReview = await _db.ReviewItems.AnyAsync(
                r => r.StudentId == student.Id && r.QuestionId == question.Id && !r.Completed, ct);
            var reachable = await CanReachAsync(student, question, ct) || assignment is not null || inReview;
            if (!reachable)
                return new SubmitResult(SubmitStatus.Forbidden);            // submissions.py:132-136

            // Positional freemium gate — the ONLY 402 in the app, raised here at submit and
            // BEFORE any upload (submissions.py:139-143). Reuses Catalog's frozen decision.
            if (await _catalog.NeedsPremiumAsync(student, question, ct))
                return new SubmitResult(SubmitStatus.PaymentRequired);
        }

        // Store the audio only once the gates have passed (Python new_key("answers", ext) scheme,
        // storage.py:40-41 / submissions.py:94). A gated student never reaches this line.
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

        // TODO(Faza 3.4 — Assessment + Hangfire): enqueue grading here. The Python flow fires
        // process_submission.delay(sub.id) (submissions.py:157) to run the STT + analysis pipeline.
        // Hangfire is NOT wired yet (docs/08 Faza 3.4/3.9), so the attempt is left status=pending
        // for the worker to pick up once the job is added.

        var response = await ToResponseAsync(submission, student, question, ct);
        return new SubmitResult(SubmitStatus.Ok, response);
    }

    /// <summary>
    /// List attempts, a port of <c>list_submissions</c> (submissions.py:199-238). Real (non-shadow)
    /// answers only (<c>reference_text IS NULL</c>). Students see only their own; teachers see
    /// answers to their own questions from their own roster; admins see all. Newest first, paged.
    /// Returns <c>null</c> when the user is missing/inactive (→ 401), like <c>get_current_user</c>.
    /// </summary>
    public async Task<IReadOnlyList<SubmissionResponse>?> ListAsync(
        Guid userId, Guid? questionId, int limit, int offset, CancellationToken ct = default)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId, ct);
        if (user is null || !user.IsActive)
            return null;

        limit = Math.Clamp(limit, 1, 200);                                  // Python Query ge=1, le=200
        offset = Math.Max(offset, 0);                                       // Python Query ge=0

        // Shadowing practice (reference_text set) is excluded from the answer list (submissions.py:207).
        var query = _db.Submissions.Where(s => s.ReferenceText == null);

        if (user.Role == UserRole.Student)
        {
            query = query.Where(s => s.StudentId == user.Id);               // own answers only
        }
        else if (user.Role == UserRole.Teacher)
        {
            // Answers to the teacher's OWN questions AND only from their own roster (submissions.py:213-223).
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

        var rows = await query
            .Include(s => s.Student)
            .Include(s => s.Question)
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
    /// Attempt status/detail, a port of <c>get_submission</c> (submissions.py:255-274). Anyone may
    /// read their OWN attempt; a student may read only their own; a teacher only their own students'
    /// answers to their own questions. Missing → 404 (never leaks existence).
    /// </summary>
    public async Task<GetResult> GetAsync(Guid userId, Guid submissionId, CancellationToken ct = default)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId, ct);
        if (user is null || !user.IsActive)
            return new GetResult(GetStatus.Unauthorized);

        var submission = await _db.Submissions
            .Include(s => s.Student)
            .Include(s => s.Question)
            .FirstOrDefaultAsync(s => s.Id == submissionId, ct);
        if (submission is null)
            return new GetResult(GetStatus.NotFound);

        // Visibility, mirroring get_submission (submissions.py:267-273): the owner always may read
        // it (incl. a teacher/admin's own shadowing practice, which has no question and would trip
        // the roster check below); a student reads only their own; a teacher only their own
        // students' answers to their own questions.
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
    /// Module-path reachability for one task (submissions.py can_reach → access.py:37-51). Reuses
    /// <see cref="CatalogService.StudentTeacherIdsAsync"/> for the teacher-ids lookup so the group
    /// membership query is not duplicated.
    /// </summary>
    private async Task<bool> CanReachAsync(User student, Question q, CancellationToken ct)
    {
        if (q.BlockId is null)
            return false;                                                   // access.py:48-49
        var block = await _db.QuestionBlocks.FirstOrDefaultAsync(b => b.Id == q.BlockId.Value, ct);
        if (block is null || !block.IsPublished)
            return false;                                                   // access.py:39-40
        if (block.Visibility == "public")
            return true;                                                    // official public curriculum
        var teacherIds = await _catalog.StudentTeacherIdsAsync(student.Id, ct);
        return teacherIds.Contains(block.TeacherId);                        // the student's teacher's group module
    }

    /// <summary>
    /// A teacher may view an attempt only if it answers their OWN question AND the student is in
    /// their roster. Port of <c>_teacher_denied</c> (submissions.py:241-252).
    /// </summary>
    private async Task<bool> TeacherDeniedAsync(Guid teacherId, Submission sub, CancellationToken ct)
    {
        if (sub.Question is null || sub.Question.TeacherId != teacherId)
            return true;
        var inRoster = await _db.GroupMembers.AnyAsync(
            gm => gm.Group.TeacherId == teacherId && gm.StudentId == sub.StudentId, ct);
        return !inRoster;
    }

    // Presign the audio URL (local SigV4 signing — no network), then project. Mirrors _to_out
    // (submissions.py:67-80): audio_url + denormalized student/question labels.
    private async Task<SubmissionResponse> ToResponseAsync(
        Submission sub, User? student, Question? question, CancellationToken ct)
    {
        var audioUrl = await _storage.GetPresignedUrlAsync(sub.AudioKey, ct: ct);
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
            // Prefer the fresh per-attempt exemplar; fall back to the question's stored one (submissions.py:77-79).
            ModelAnswerText: sub.ModelAnswerText ?? question?.ModelAnswerText,
            TeacherComment: sub.TeacherComment,
            TeacherBand: sub.TeacherBand,
            ReviewedAt: sub.ReviewedAt);
}

/// <summary>The audio + metadata the endpoint hands the service for a submit (HTTP-layer parsed).</summary>
public sealed record SubmitAudio(Guid QuestionId, Stream Content, string ContentType, double? DurationSec);

/// <summary>Outcome of <see cref="PracticeService.SubmitAsync"/> — the service owns the status decision (§7.2).</summary>
public enum SubmitStatus { Ok, Unauthorized, QuestionNotFound, Forbidden, PaymentRequired }

public sealed record SubmitResult(SubmitStatus Status, SubmissionResponse? Submission = null);

/// <summary>Outcome of <see cref="PracticeService.GetAsync"/>.</summary>
public enum GetStatus { Ok, Unauthorized, NotFound }

public sealed record GetResult(GetStatus Status, SubmissionResponse? Submission = null);
