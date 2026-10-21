namespace Govori.Contracts;

/// <summary>
/// The seam Practice uses to hand a freshly-created <c>pending</c> submission off for grading
/// (docs/07 §7.7, Faza 3.4). The abstraction lives in <c>Govori.Contracts</c> (dependency-free) so
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
/// The seam the grading pipeline uses to grant the engagement reward (XP + streak roll, and for a
/// graded answer the spaced-repetition review of its weakest skill) AFTER a submission has graded.
/// Mirrors <see cref="IGradingQueue"/>: the abstraction lives in
/// <c>Govori.Contracts</c> (dependency-free, primitives only) so the grading module
/// (<c>Govori.Assessment.GradingJob</c>) depends on the INTERFACE and NOT on the engagement module —
/// XP and grading stay separate domains with no compile edge between them (the ArchTests forbid one).
/// The implementation (<c>Govori.Engagement.SubmissionRewarder</c>) is wired at the composition root.
///
/// <para>Every method MUST be idempotent: the durable grading job is re-run on a worker crash / retry
/// and grading itself is idempotent, so the reward must be too — a re-run must not double-award or
/// enqueue a second review. The caller treats the reward as best-effort (grading is already
/// committed): a failure is logged and swallowed rather than failing — and re-running — the job.</para>
/// </summary>
public interface IGradingRewarder
{
    /// <summary>Award XP + roll the streak for an ACADEMIC submission that just graded (produced an
    /// Evaluation), then — when the student actually spoke — schedule a spaced-repetition review for
    /// its weakest skill below the review threshold (and retire the question's older open reviews).
    /// Idempotent — safe to call again on a job re-run.</summary>
    Task RewardGradedAsync(Guid submissionId, CancellationToken ct = default);

    /// <summary>Award the fixed practice XP + roll the streak for a SHADOWING attempt that just
    /// completed. Idempotent.</summary>
    Task RewardShadowingAsync(Guid submissionId, CancellationToken ct = default);
}

/// <summary>
/// The finite set of progress states a grading run reports over the real-time channel (docs/08
/// Faza 3.10, <c>/attempts/{id}/events</c>). The DB carries only the four coarse
/// <c>submission_status</c> labels (pending → processing → done/failed), which clients used to
/// discover by 2 s polling; SignalR upgrades that to the finer per-stage timeline the pipeline
/// actually walks (docs/07 §7.7): the terminal <c>Done</c>/<c>Failed</c> match
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
    /// <summary>Terminal failure — submission <c>failed</c> with a <see cref="SubmissionErrorCodes">code</see>.</summary>
    public const string Failed = "failed";
}

/// <summary>
/// What a FAILED attempt carries in <c>submissions.error_message</c> — and therefore in
/// <see cref="SubmissionResponse.ErrorMessage"/> (<c>error_message</c>) and in the
/// <see cref="GradingProgressEvent.Message"/> of a <see cref="GradingState.Failed"/> event.
///
/// <para><b>A machine code, never prose.</b> The column used to hold <c>ex.Message</c>: English,
/// frequently a vendor's raw error body ("All 2 configured grader backend(s) failed…"), and the
/// student screen printed it verbatim to an Uzbek- or Russian-speaking learner. It now holds one of
/// the snake_case values below, which the client maps to text in the student's own language; the
/// full exception goes to the server log. The field name and type are unchanged — only the content
/// is — so no client breaks, but a client should treat an unrecognised value (including the
/// free-text messages rows failed before this change still hold) as <see cref="Internal"/>.</para>
///
/// <para>The set is deliberately small and stage-shaped: it says WHICH step failed, which is all a
/// student can act on ("record again" vs "try later"), and nothing about why, which is ours.</para>
/// </summary>
public static class SubmissionErrorCodes
{
    /// <summary>The recording could not be read from storage or transcribed (every configured STT
    /// backend failed). Recording again is the natural next step.</summary>
    public const string SttFailed = "stt_failed";

    /// <summary>The answer was transcribed but every configured grader backend failed to score it.
    /// Usually a vendor outage or quota — trying again later is the natural next step.</summary>
    public const string GraderFailed = "grader_failed";

    /// <summary>The attempt sat unfinished — never picked up, or abandoned mid-grade — until the
    /// stuck-submission sweeper gave up on it (20 min pending / 15 min processing). Also what an
    /// attempt deferred for lack of any configured AI provider ends as.</summary>
    public const string GradingTimeout = "grading_timeout";

    /// <summary>AI grading is switched off right now — an operator paused it, or the platform's
    /// daily/monthly AI budget is spent. The recording is kept; trying again later is the next step,
    /// and the attempt does not count against an assignment's attempt budget (it is failed).</summary>
    public const string AiUnavailable = "ai_unavailable";

    /// <summary>Anything else: a database write, an unexpected bug. Not the student's doing.</summary>
    public const string Internal = "internal";
}

/// <summary>
/// One real-time grading-progress event pushed to the attempt's SignalR group (docs/08 Faza 3.10).
/// Serialized snake_case (<c>submission_id</c>, <c>state</c>, <c>status</c>, <c>message</c>,
/// <c>at</c>) so the pushed shape matches the polled <see cref="SubmissionResponse"/> fields the
/// client already knows.
/// </summary>
/// <param name="SubmissionId">The attempt this event is about.</param>
/// <param name="State">One of <see cref="GradingState"/> — the fine-grained pipeline stage.</param>
/// <param name="Status">The coarse PG <c>submission_status</c> label (pending/processing/done/failed).</param>
/// <param name="Message">On <see cref="GradingState.Failed"/>, the same <see cref="SubmissionErrorCodes">code</see>
/// stored in <c>error_message</c> (never exception text); null for every other state.</param>
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
