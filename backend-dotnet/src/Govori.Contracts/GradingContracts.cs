namespace Govori.Contracts;

/// <summary>
/// The seam Practice uses to hand a freshly-created <c>pending</c> submission off for grading
/// (docs/07 §7.7, Faza 3.4) — the C# equivalent of Python's <c>process_submission.delay(sub.id)</c>
/// (submissions.py:157). The abstraction lives in <c>Govori.Contracts</c> (dependency-free) so
/// Practice depends on the interface, not on the Assessment module; the implementation
/// (<c>Govori.Assessment.InlineGradingQueue</c>) and the durable Hangfire version (Faza 3.9) are
/// wired at the composition root.
/// </summary>
public interface IGradingQueue
{
    /// <summary>Hand submission <paramref name="submissionId"/> to the grading pipeline. The default
    /// in-process implementation runs it synchronously; the durable implementation enqueues a job.</summary>
    Task EnqueueAsync(Guid submissionId, CancellationToken ct = default);
}
