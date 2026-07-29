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
    /// <summary>An error occurred: submission marked <c>failed</c> with a message.</summary>
    Failed,
    /// <summary>No submission with that id.</summary>
    NotFound,
    /// <summary>No real STT/Grader wired (guard) — attempt left <c>pending</c> for a durable worker.</summary>
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
/// <para><b>Deferred (TODO):</b> the 5 circuit breakers; the best-effort orthoepy audio pass (its own
/// breaker) — orthoepyErrors is 0 for now; the durable queue (Hangfire, Faza 3.9) with
/// terminal-vs-transient retry; gamification/notification side-effects (Stage 6); real
/// Azure/Whisper/Gemini/OpenAI providers.</para>
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
            return AssessmentOutcome.NotFound;

        var isShadowing = !string.IsNullOrWhiteSpace(sub.ReferenceText);

        // GUARD (Faza 3.4/3.9): the prod Azure/Whisper/Gemini/OpenAI providers are TODO stubs with
        // no keys (IsConfigured=false). When nothing real is wired, DEFER — leave the attempt
        // pending for the durable worker (Hangfire) to pick up once providers land, rather than
        // failing it. Fakes (tests) report IsConfigured=true, so the full pipeline runs.
        if (!_stt.IsConfigured || (!isShadowing && !_grader.IsConfigured))
        {
            _logger.LogInformation(
                "grading deferred — no STT/Grader provider configured (submission {SubmissionId})", submissionId);
            return AssessmentOutcome.Deferred;
        }

        // Real-time progress (docs/08 Faza 3.10): the job has been picked up — still pending.
        await EmitAsync(submissionId, GradingState.Queued, "pending", null);

        try
        {
            sub.Status = SubmissionStatus.Processing;                       // claim it before any slow work
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
                var bytes = await LoadAudioAsync();
                stt = await _stt.TranscribeAsync(bytes, filename, sub.ReferenceText, ct);
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
                // TODO(gamification, C8): award_practice (fixed PRACTICE_XP) when reference_match.on_topic.
                await EmitAsync(submissionId, GradingState.Done, "done", null);
                _logger.LogInformation("shadowing done (submission {SubmissionId})", submissionId);
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

            // TODO(Stage 6): gamification (award_submission/schedule_review, C8 xp_for_band) +
            //   notifications — best-effort engagement side-effects, must never break the pipeline.
            _logger.LogInformation("graded (submission {SubmissionId}) → level {Level}", submissionId, levelScore);
            return AssessmentOutcome.Done;
        }
        catch (Exception ex)
        {
            // Hangfire (Faza 3.9): AssessmentService owns the status decision and marks the
            // submission failed here; the pipeline is idempotent (resume-from-transcript +
            // Evaluation DELETE-then-INSERT), so a Hangfire auto-retry (worker crash / transient
            // error) safely re-runs from where it left off without re-billing STT.
            // TODO: terminal-vs-transient split — SoftTimeLimit / CircuitOpen must NOT be retried
            //   (they would hit the same wall); only genuinely transient errors should retry.
            _logger.LogError(ex, "grading failed (submission {SubmissionId})", submissionId);
            await MarkFailedAsync(submissionId, ex.Message, ct);
            var message = ex.Message.Length > 1000 ? ex.Message[..1000] : ex.Message;
            await EmitAsync(submissionId, GradingState.Failed, "failed", message);
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
    private async Task MarkFailedAsync(Guid submissionId, string message, CancellationToken ct)
    {
        try
        {
            var msg = message.Length > 1000 ? message[..1000] : message;
            await _db.Submissions
                .Where(s => s.Id == submissionId)
                .ExecuteUpdateAsync(setters => setters
                    .SetProperty(s => s.Status, SubmissionStatus.Failed)
                    .SetProperty(s => s.ErrorMessage, msg), ct);
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
