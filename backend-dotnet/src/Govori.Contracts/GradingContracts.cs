namespace Govori.Contracts;

/// <summary>
/// The seam Practice uses to hand a freshly-created <c>pending</c> submission off for grading
/// (docs/07 §7.7, Faza 3.4) — the C# equivalent of Python's <c>process_submission.delay(sub.id)</c>
/// (submissions.py:157). The abstraction lives in <c>Govori.Contracts</c> (dependency-free) so
/// Practice depends on the interface, not on the Assessment module; the implementation
/// (<c>Govori.Assessment.InlineGradingQueue</c>) and the durable Hangfire version
/// (<c>Govori.Realtime.HangfireGradingQueue</c>, Faza 3.9) are wired at the composition root.
/// </summary>
public interface IGradingQueue
{
    /// <summary>Hand submission <paramref name="submissionId"/> to the grading pipeline. The default
    /// in-process implementation runs it synchronously; the durable implementation enqueues a job.</summary>
    Task EnqueueAsync(Guid submissionId, CancellationToken ct = default);
}

/// <summary>
/// The finite set of progress states a grading run reports over the real-time channel (docs/08
/// Faza 3.10, <c>/attempts/{id}/events</c>). The Python pipeline exposes only the four DB
/// <c>submission_status</c> labels via 2 s polling (pending → processing → done/failed,
/// submissions.py:255-274 + SubmissionResult.tsx); SignalR upgrades that to the finer per-stage
/// timeline the pipeline actually walks (docs/07 §7.7): the terminal <c>Done</c>/<c>Failed</c> match
/// the DB labels, and the intermediate stages refine <c>processing</c>. Emitted as the
/// <see cref="GradingProgressEvent.State"/> string (snake_case, matching the wire).
/// </summary>
public static class GradingState
{
    /// <summary>Job accepted / picked up — submission is still <c>pending</c>.</summary>
    public const string Queued = "queued";
    /// <summary>STT stage (Stage 1) — submission flips to <c>processing</c>.</summary>
    public const string Transcribing = "transcribing";
    /// <summary>Grader/LLM analysis stage (Stage 4).</summary>
    public const string Grading = "grading";
    /// <summary>C5 scoring + persistence stage (Stage 5).</summary>
    public const string Scoring = "scoring";
    /// <summary>Terminal success — Transcript (+ Evaluation) persisted, submission <c>done</c>.</summary>
    public const string Done = "done";
    /// <summary>Terminal failure — submission <c>failed</c> with a message.</summary>
    public const string Failed = "failed";
}

/// <summary>
/// One real-time grading-progress event pushed to the attempt's SignalR group (docs/08 Faza 3.10).
/// Serialized snake_case (<c>submission_id</c>, <c>state</c>, <c>status</c>, <c>message</c>,
/// <c>at</c>) so the wire shape mirrors what Python's polled <c>SubmissionOut</c> already exposes.
/// </summary>
/// <param name="SubmissionId">The attempt this event is about.</param>
/// <param name="State">One of <see cref="GradingState"/> — the fine-grained pipeline stage.</param>
/// <param name="Status">The coarse PG <c>submission_status</c> label (pending/processing/done/failed).</param>
/// <param name="Message">Human-readable detail; the error text on <see cref="GradingState.Failed"/>, else null.</param>
/// <param name="At">UTC timestamp the event was emitted.</param>
public sealed record GradingProgressEvent(
    Guid SubmissionId,
    string State,
    string Status,
    string? Message,
    DateTime At);

/// <summary>
/// The seam the grading pipeline uses to EMIT progress (docs/08 Faza 3.10). Lives in
/// <c>Govori.Contracts</c> (dependency-free) so <c>Govori.Assessment</c> stays testable and does NOT
/// hard-depend on SignalR types; the real implementation
/// (<c>Govori.Realtime.SignalRGradingEvents</c>) fans out via <c>IHubContext</c> over the Redis
/// backplane. Implementations MUST be best-effort — a publish failure must never break grading.
/// </summary>
public interface IGradingEvents
{
    /// <summary>Publish one progress event to the attempt's subscribers. Never throws.</summary>
    Task PublishAsync(GradingProgressEvent evt, CancellationToken ct = default);
}

/// <summary>
/// No-op <see cref="IGradingEvents"/> — the safe default when no real-time transport is wired (a
/// host without SignalR, or a unit test constructing <c>AssessmentService</c> directly). Keeps the
/// pipeline running with events simply going nowhere.
/// </summary>
public sealed class NullGradingEvents : IGradingEvents
{
    public Task PublishAsync(GradingProgressEvent evt, CancellationToken ct = default) => Task.CompletedTask;
}
