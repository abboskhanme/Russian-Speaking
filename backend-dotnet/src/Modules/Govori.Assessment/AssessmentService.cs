using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;
using Govori.Contracts;
using Govori.Infrastructure;
using Govori.Infrastructure.Entities;
using Govori.Platform.Grader;
using Govori.Platform.Stt;
using Govori.Platform.Storage;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace Govori.Assessment;

/// <summary>The terminal state of one grading run — the service owns the status decision (§7.2).</summary>
public enum AssessmentOutcome
{
    /// <summary>Graded: Transcript + Evaluation persisted, submission <c>done</c>.</summary>
    Done,
    /// <summary>Shadowing (reference_text set): Transcript persisted, submission <c>done</c>, no Evaluation.</summary>
    Shadowing,
    /// <summary>An error occurred: submission marked <c>failed</c> with a
    /// <see cref="SubmissionErrorCodes">machine code</see> in <c>error_message</c>.</summary>
    Failed,
    /// <summary>No submission with that id.</summary>
    NotFound,
    /// <summary>No real STT/Grader wired (guard) — attempt left <c>pending</c>. Nothing re-runs it: if
    /// no key arrives, the stuck-submission sweeper fails it after 20 minutes.</summary>
    Deferred,
}

/// <summary>
/// The grading pipeline (docs/07 §7.7, Faza 3.4) — the work of grading ONE submission. Turns a
/// <c>pending</c> submission into a scored <c>Evaluation</c>:
/// <code>
///   load → [resume? reuse Transcript : STT] → (shadowing? done) → grade → C5 score → persist → done
/// </code>
///
/// <para><b>Nuances that must be preserved (docs/07 §7.7):</b></para>
/// <list type="bullet">
///   <item><b>Resume-from-transcript</b> — a persisted <c>Transcript</c> is reused and STT is
///   SKIPPED (no re-billing Azure); the pron score for the C5 blend comes from the stored JSONB.</item>
///   <item><b>Lazy audio</b> — bytes are downloaded only when STT actually runs.</item>
///   <item><b>C5 scoring</b> — <see cref="Scoring"/> (pronunciation blend + orthoepy penalty), frozen.</item>
///   <item><b>Evaluation DELETE-then-INSERT</b> — <c>submission_id</c> is unique; a re-run must not collide.</item>
///   <item><b>Faithful transcript</b> — the STT text is written verbatim (memory: transcript must stay faithful).</item>
/// </list>
///
/// <para><b>How a run ends.</b> Every failure is TERMINAL here: the row goes <c>failed</c> with a stable
/// <see cref="SubmissionErrorCodes">code</see> (the exception itself goes to the log, never to the
/// student), and the student records again. The one exception is the job's own token being cancelled
/// — the worker is shutting down — which is rethrown untouched so Hangfire re-queues the job for the
/// next worker start (see the catch at the end of <see cref="RunAsync"/>). The engagement reward is
/// not this class's business: <see cref="GradingJob"/> hands a finished grade to
/// <see cref="IGradingRewarder"/>.</para>
///
/// <para><b>Deferred (TODO):</b> the per-vendor circuit breakers docs/07 §7.7 describes — today the
/// provider chain's fallback and the per-vendor timeouts are the only protection against a failing
/// vendor; and the best-effort orthoepy audio pass on its own breaker — orthoepyErrors is 0 for now
/// (see the two TODO(orthoepy) markers below).</para>
/// </summary>
public sealed class AssessmentService
{
    private readonly GovoriDbContext _db;
    private readonly IObjectStorage _storage;
    private readonly ISttProvider _stt;
    private readonly IGraderProvider _grader;
    private readonly IGradingEvents _events;
    private readonly ILogger<AssessmentService> _logger;

    // JSONB columns are written as snake_case JSON. These key names are WIRE-COMPATIBILITY:
    // the frontend already reads them (summary/strengths/orthoepy_errors, word/start/end,
    // reference_match…), so renaming a property here breaks stored rows and clients alike.
    // Cyrillic is emitted literally (not \uXXXX) so the stored JSON stays human-readable.
    private static readonly JsonSerializerOptions JsonbOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    private static readonly IReadOnlyDictionary<string, string> ImageMimes = new Dictionary<string, string>
    {
        ["jpg"] = "image/jpeg", ["jpeg"] = "image/jpeg", ["png"] = "image/png",
        ["webp"] = "image/webp", ["gif"] = "image/gif",
    };

    public AssessmentService(
        GovoriDbContext db,
        IObjectStorage storage,
        ISttProvider stt,
        IGraderProvider grader,
        IGradingEvents events,
        ILogger<AssessmentService> logger)
    {
        _db = db;
        _storage = storage;
        _stt = stt;
        _grader = grader;
        _events = events;
        _logger = logger;
    }

    /// <summary>Run the grading pipeline for one submission.</summary>
    public async Task<AssessmentOutcome> RunAsync(Guid submissionId, CancellationToken ct = default)
    {
        var sub = await _db.Submissions
            .Include(s => s.Question)
            .FirstOrDefaultAsync(s => s.Id == submissionId, ct);
        if (sub is null)
        {
            GradingMetrics.RecordOutcome("not_found");
            return AssessmentOutcome.NotFound;
        }

        var isShadowing = !string.IsNullOrWhiteSpace(sub.ReferenceText);

        // GUARD (Faza 3.4/3.9): the provider chain reports false when NO backend in the admin's
        // configured order has a key. When nothing real is wired, DEFER — leave the attempt pending
        // rather than burning it on a vendor call that cannot happen. Nothing re-enqueues a deferred
        // attempt: the job completes, and if no key lands the stuck-submission sweeper
        // (MaintenanceJobs) fails it after 20 minutes as grading_timeout, which is what the student
        // then sees. Fakes (tests) report true, so the full pipeline runs.
        if (!await _stt.IsConfiguredAsync(ct) || (!isShadowing && !await _grader.IsConfiguredAsync(ct)))
        {
            _logger.LogInformation(
                "grading deferred — no STT/Grader provider configured (submission {SubmissionId})", submissionId);
            // Counted, not just logged: a pipeline that defers everything has an excellent latency
            // profile and grades nothing. Without this the TTFS histogram would look healthy on a
            // completely non-functioning app (docs/08 Faza 3.10).
            GradingMetrics.RecordOutcome("deferred");
            return AssessmentOutcome.Deferred;
        }

        // Real-time progress (docs/08 Faza 3.10): the job has been picked up — still pending.
        await EmitAsync(submissionId, GradingState.Queued, "pending", null);

        // Which stage is running decides the code a failure is stored under: set just before each
        // vendor stage and put back just after it, so a failure anywhere else — the claim, a
        // persistence write — reads as `internal` rather than being blamed on a vendor.
        var failureCode = SubmissionErrorCodes.Internal;

        try
        {
            sub.Status = SubmissionStatus.Processing;                       // claim it before any slow work
            // A re-run (the job re-queued after a worker restart) may find the code a previous
            // attempt, or the stuck-submission sweeper, left behind. This run's outcome replaces it.
            sub.ErrorMessage = null;
            await _db.SaveChangesAsync(ct);
            await EmitAsync(submissionId, GradingState.Transcribing, "processing", null);

            var filename = sub.AudioKey.Split('/')[^1];

            // Lazy audio: a resume that already has a Transcript never re-downloads.
            byte[]? audio = null;
            async Task<byte[]> LoadAudioAsync() => audio ??= await _storage.GetBytesAsync(sub.AudioKey, ct);

            // RESUME-FROM-TRANSCRIPT: reuse a persisted Transcript and skip STT, so a retried job
            // never re-bills the STT provider for audio it has already transcribed.
            var transcript = await _db.Transcripts.FirstOrDefaultAsync(t => t.SubmissionId == sub.Id, ct);
            SttResult stt;
            if (transcript is not null)
            {
                stt = new SttResult
                {
                    Text = transcript.Text,
                    Language = transcript.Language,
                    Words = Deserialize<List<SttWord>>(transcript.WordTimestamps),
                    Pronunciation = Deserialize<SttPronunciation>(transcript.Pronunciation),
                    Model = transcript.SttModel,
                    DurationSec = sub.AudioDurationSec,
                };
                _logger.LogInformation("reusing persisted transcript (submission {SubmissionId})", submissionId);
            }
            else
            {
                failureCode = SubmissionErrorCodes.SttFailed;               // reading the audio counts too
                var bytes = await LoadAudioAsync();
                var sttStarted = DateTime.UtcNow;
                stt = await _stt.TranscribeAsync(bytes, filename, sub.ReferenceText, ct);
                failureCode = SubmissionErrorCodes.Internal;
                GradingMetrics.RecordStage("transcribe", (DateTime.UtcNow - sttStarted).TotalSeconds);
                var nowT = DateTime.UtcNow;
                transcript = new Transcript
                {
                    Id = Guid.NewGuid(),
                    SubmissionId = sub.Id,
                    Text = stt.Text,                                        // faithful, verbatim
                    Language = stt.Language,
                    WordTimestamps = Serialize(stt.Words),
                    Pronunciation = Serialize(stt.Pronunciation),
                    SttModel = stt.Model,
                    CreatedAt = nowT,
                    UpdatedAt = nowT,
                };
                _db.Transcripts.Add(transcript);
                if (stt.DurationSec is not null && sub.AudioDurationSec is null)
                    sub.AudioDurationSec = stt.DurationSec;                 // only if the client sent none
                await _db.SaveChangesAsync(ct);
            }

            // SHADOWING: pronunciation-only. No LLM call, and no academic Evaluation row.
            if (isShadowing)
            {
                // TODO(orthoepy): best-effort Gemini-audio orthoepy pass on its OWN breaker,
                //   writing pronunciation.orthoepy_errors — deferred.
                sub.Status = SubmissionStatus.Done;
                sub.CompletedAt = DateTime.UtcNow;
                await _db.SaveChangesAsync(ct);
                // The fixed practice XP is granted by GradingJob (IGradingRewarder.RewardShadowingAsync)
                // once this returns Shadowing. NOTE: legacy granted it only when
                // reference_match.on_topic; the rewarder does not check that yet. No route creates a
                // shadowing submission today, so nothing reaches that difference.
                await EmitAsync(submissionId, GradingState.Done, "done", null);
                var shadowTtfs = GradingMetrics.RecordTtfs(sub.CreatedAt, shadowing: true);
                GradingMetrics.RecordOutcome("shadowing");
                _logger.LogInformation(
                    "shadowing done (submission {SubmissionId}) in {TtfsSeconds}s", submissionId, shadowTtfs);
                return AssessmentOutcome.Shadowing;
            }

            await EmitAsync(submissionId, GradingState.Grading, "processing", null);

            // GRADE. Picture tasks feed the image to the grader best-effort: if the fetch fails we
            // grade text-only rather than failing the whole attempt.
            var question = sub.Question;
            byte[]? imageBytes = null;
            string? imageMime = null;
            if (question is not null && question.Type == QuestionType.Image && !string.IsNullOrEmpty(question.MediaKey))
            {
                try
                {
                    imageBytes = await _storage.GetBytesAsync(question.MediaKey, ct);
                    imageMime = ImageMimeFor(question.MediaKey);
                }
                catch (Exception ex)
                {
                    imageBytes = null;                                       // fall back to text-only
                    imageMime = null;
                    _logger.LogWarning(ex, "image fetch failed; grading text-only (submission {SubmissionId})", submissionId);
                }
            }

            failureCode = SubmissionErrorCodes.GraderFailed;
            var graderStarted = DateTime.UtcNow;
            var grade = await _grader.AnalyzeAsync(new GraderRequest
            {
                // TODO(html_to_text): strip HTML from prompt/instruction before sending to the grader.
                QuestionPrompt = question?.PromptText ?? string.Empty,
                TranscriptText = stt.Text,
                Instruction = question?.InstructionText,
                QuestionTitle = question?.Title,
                Level = question?.Level,
                Topic = question?.Topic,
                ImageBytes = imageBytes,
                ImageMime = imageMime,
            }, ct);
            failureCode = SubmissionErrorCodes.Internal;
            GradingMetrics.RecordStage("grade", (DateTime.UtcNow - graderStarted).TotalSeconds);

            await EmitAsync(submissionId, GradingState.Scoring, "processing", null);

            // ORTHOEPY — a separate best-effort AUDIO pass on its own breaker.
            // Deferred; the C5 penalty term is fully implemented and exercised by the fixture test.
            const int orthoepyErrors = 0;

            // C5 SCORING: pronunciation blend + orthoepy penalty. FROZEN — see Scoring.
            var pronScore = stt.Pronunciation?.Pronunciation;
            var overallBand = Scoring.Level(grade.Scores.Overall, pronScore, orthoepyErrors);
            var levelScore = Scoring.Level(grade.Scores.LevelOverall, pronScore, orthoepyErrors);

            var feedback = new
            {
                summary = grade.Summary,
                strengths = grade.Strengths,
                improvements = grade.Improvements,
                vocabulary_suggestions = grade.VocabularySuggestions,
                orthoepy_errors = Array.Empty<object>(),                    // TODO(orthoepy): fill when wired
            };

            var nowE = DateTime.UtcNow;
            var evaluation = new Evaluation
            {
                Id = Guid.NewGuid(),
                SubmissionId = sub.Id,
                FluencyScore = grade.Scores.Fluency,
                LexicalScore = grade.Scores.Lexical,
                GrammarScore = grade.Scores.Grammar,
                RelevanceScore = grade.Scores.Relevance,
                PronunciationScore = pronScore is null ? null : Math.Round(pronScore.Value, 1), // 1 dp
                OverallBand = overallBand,
                LevelScore = levelScore,
                Feedback = JsonSerializer.Serialize(feedback, JsonbOptions),
                Corrections = JsonSerializer.Serialize(grade.Corrections, JsonbOptions),
                LlmModel = grade.Model,                                     // REAL provider (docs §7.9)
                CreatedAt = nowE,
                UpdatedAt = nowE,
            };

            // DELETE-then-INSERT: submission_id is UNIQUE, so a re-run must clear the previous
            // Evaluation first or it would collide. This is what makes re-grading idempotent.
            await _db.Evaluations.Where(e => e.SubmissionId == sub.Id).ExecuteDeleteAsync(ct);
            _db.Evaluations.Add(evaluation);

            sub.Status = SubmissionStatus.Done;                            // only after the Evaluation is staged
            sub.CompletedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
            await EmitAsync(submissionId, GradingState.Done, "done", null);

            // The engagement side-effects — XP, the streak, the spaced-repetition review — are NOT
            // run here: GradingJob hands a Done outcome to IGradingRewarder, so this module never
            // references Engagement. TODO(notifications): legacy also raised a "result ready"
            // notification here (and an assignment-completed one); that is not ported yet.
            // TTFS (docs/08 Faza 3.10). Measured here, at the moment the score becomes visible to the
            // student, and from Submission.CreatedAt — so the queue wait the student also waited
            // through is inside the number, not excluded from it.
            var ttfs = GradingMetrics.RecordTtfs(sub.CreatedAt, shadowing: false);
            GradingMetrics.RecordOutcome("done");
            _logger.LogInformation(
                "graded (submission {SubmissionId}) → level {Level} in {TtfsSeconds}s (model {LlmModel})",
                submissionId, levelScore, ttfs, grade.Model);
            return AssessmentOutcome.Done;
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            // The job's OWN token fired: the worker is shutting down (a deploy, a container restart).
            // That says nothing about this answer, so it must not be recorded as a failure — and it
            // must not be swallowed either. Returning normally would tell Hangfire the job SUCCEEDED,
            // and nothing would ever grade this attempt again: it would sit in `processing` until the
            // stuck-submission sweeper failed it, a quarter of an hour later, for a restart the
            // student had nothing to do with. Rethrown, the cancellation reaches Hangfire while the
            // server is stopping, which leaves the job in its queue for the next worker start. That
            // re-run is cheap and safe: a persisted transcript is reused (STT is not re-billed) and
            // the evaluation is DELETE-then-INSERT. The row stays `processing` until then.
            _logger.LogWarning(
                "grading interrupted by shutdown; the job stays queued for the next worker start (submission {SubmissionId})",
                submissionId);
            GradingMetrics.RecordOutcome("interrupted");
            throw;
        }
        catch (Exception ex)
        {
            // Every other failure is TERMINAL: the row goes `failed` and the student records again.
            // Nothing retries it — the exception does not escape, so Hangfire's retry never sees it.
            //
            // What is stored (and pushed to the client) is the stable CODE for the stage that failed,
            // never ex.Message: that text is English, often a vendor's raw error body, and the
            // student's screen used to print it verbatim. The whole exception goes to the log
            // instead, where the submission id ties it back to the row.
            _logger.LogError(ex, "grading failed: {ErrorCode} (submission {SubmissionId})", failureCode, submissionId);
            GradingMetrics.RecordOutcome("failed");
            await MarkFailedAsync(submissionId, failureCode);
            await EmitAsync(submissionId, GradingState.Failed, "failed", failureCode);
            return AssessmentOutcome.Failed;
        }
    }

    // Best-effort real-time progress emit (docs/08 Faza 3.10). NEVER throws: a dead hub / backplane
    // must never break grading — mirrors the "engagement side-effects must never break the pipeline"
    // rule. Publishes with CancellationToken.None so a terminal (done/failed) event still reaches
    // subscribers even when the job's own token was cancelled.
    private async Task EmitAsync(Guid submissionId, string state, string status, string? message)
    {
        try
        {
            await _events.PublishAsync(
                new GradingProgressEvent(submissionId, state, status, message, DateTime.UtcNow),
                CancellationToken.None);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(
                ex, "grading progress emit failed (state {State}, submission {SubmissionId})", state, submissionId);
        }
    }

    // Mark the submission failed via a direct UPDATE so a poisoned change-tracker (from the failed
    // SaveChanges) can't get in the way: the status write must land even when the tracked entities
    // are unusable, or the attempt would be left stuck in `processing`.
    //
    // CancellationToken.None, deliberately — this is the terminal write, made from a catch block. If
    // the job's token were cancelled by then, passing it would make the UPDATE throw before it ever
    // reached the database, and the attempt would be stranded in `processing` behind a "failed" event.
    private async Task MarkFailedAsync(Guid submissionId, string errorCode)
    {
        try
        {
            await _db.Submissions
                .Where(s => s.Id == submissionId)
                .ExecuteUpdateAsync(setters => setters
                    .SetProperty(s => s.Status, SubmissionStatus.Failed)
                    .SetProperty(s => s.ErrorMessage, errorCode), CancellationToken.None);
        }
        catch (Exception inner)
        {
            _logger.LogError(inner, "could not mark submission {SubmissionId} as failed", submissionId);
        }
    }

    private static string ImageMimeFor(string key)
    {
        var ext = key.Contains('.') ? key[(key.LastIndexOf('.') + 1)..].ToLowerInvariant() : string.Empty;
        return ImageMimes.TryGetValue(ext, out var mime) ? mime : "image/jpeg";
    }

    private static string? Serialize<T>(T? value) where T : class
        => value is null ? null : JsonSerializer.Serialize(value, JsonbOptions);

    private static T? Deserialize<T>(string? json) where T : class
        => string.IsNullOrWhiteSpace(json) ? null : JsonSerializer.Deserialize<T>(json, JsonbOptions);
}
