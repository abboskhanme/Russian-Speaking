using System.Diagnostics.Metrics;

namespace Govori.Assessment;

/// <summary>
/// Instruments the grading pipeline so its latency is a MEASUREMENT rather than a claim
/// (docs/08 Faza 3.10).
///
/// <para>The plan sets an exit condition of <b>TTFS p95 &lt; 20s</b> — Time To First Score, the wall
/// clock from the moment a student's recording is accepted to the moment their score reaches them.
/// That number had never been observed: nothing in the pipeline recorded a duration, so the target
/// could be neither met nor missed, only asserted. This type is what makes it falsifiable.</para>
///
/// <para><b>TTFS is measured from <c>Submission.CreatedAt</c>, not from the start of this job.</b>
/// The two differ by however long the attempt waited in the queue, and the queue wait is part of
/// what the student experiences. Measuring from job start would report a comfortable number for a
/// pipeline that is in fact twenty minutes behind — the exact failure this metric exists to catch.</para>
///
/// <para><b>Where it lands.</b> The meter is exported over the API's existing OpenTelemetry →
/// Prometheus <c>/metrics</c> endpoint. The Worker host has no HTTP surface and therefore no
/// scrape endpoint, so grading that runs there is captured in the structured log line instead
/// (<c>ttfs_seconds</c> on the "graded" event). Both paths record the same value; only the
/// transport differs. Closing that gap means giving the Worker a metrics endpoint — a deliberate
/// piece of deferred work, not an oversight.</para>
/// </summary>
public static class GradingMetrics
{
    /// <summary>Meter name — must match the <c>AddMeter(...)</c> call in the composition root, or
    /// the instruments below are recorded and silently never exported.</summary>
    public const string MeterName = "Govori.Assessment";

    private static readonly Meter Meter = new(MeterName, "1.0.0");

    /// <summary>End-to-end latency a student actually feels: submission accepted → score delivered.
    /// A histogram rather than an average because the target is a p95: averages hide precisely the
    /// tail that makes an app feel broken.</summary>
    private static readonly Histogram<double> Ttfs = Meter.CreateHistogram<double>(
        "govori.grading.ttfs", unit: "s",
        description: "Time to first score: Submission.CreatedAt → the score reaching the student.");

    /// <summary>Per-stage duration, tagged <c>stage</c> (<c>transcribe</c> / <c>grade</c>). When TTFS
    /// regresses, this is what says which vendor to look at instead of guessing between them.</summary>
    private static readonly Histogram<double> Stage = Meter.CreateHistogram<double>(
        "govori.grading.stage.duration", unit: "s",
        description: "Duration of one pipeline stage.");

    /// <summary>How runs ended, tagged <c>outcome</c> (<c>done</c> / <c>shadowing</c> / <c>failed</c> /
    /// <c>deferred</c> / <c>not_found</c> / <c>interrupted</c> — the last is a run cut short by a worker
    /// shutdown and left queued for a re-run, so it is not an end state of the ATTEMPT). Latency
    /// without an outcome mix is misleading: a pipeline that fails fast posts an excellent p95.</summary>
    private static readonly Counter<long> Outcomes = Meter.CreateCounter<long>(
        "govori.grading.outcome",
        description: "Grading runs by terminal outcome.");

    /// <summary>Record the student-visible latency for one graded submission.</summary>
    /// <param name="createdAtUtc">When the submission was accepted. A default/unset value is
    /// skipped rather than recorded as a decades-long duration — one bad row would otherwise
    /// dominate the histogram and make the p95 meaningless.</param>
    public static double? RecordTtfs(DateTime createdAtUtc, bool shadowing)
    {
        if (createdAtUtc == default)
            return null;

        var seconds = (DateTime.UtcNow - DateTime.SpecifyKind(createdAtUtc, DateTimeKind.Utc)).TotalSeconds;
        if (seconds < 0)
            return null;                       // clock skew between hosts; a negative latency is noise

        // Shadowing skips the grader entirely, so its latency is a different distribution. Tagging
        // rather than splitting keeps one instrument while still allowing the two to be read apart.
        Ttfs.Record(seconds, new KeyValuePair<string, object?>("kind", shadowing ? "shadowing" : "graded"));
        return seconds;
    }

    /// <summary>Record how long one stage took.</summary>
    public static void RecordStage(string stage, double seconds)
        => Stage.Record(seconds, new KeyValuePair<string, object?>("stage", stage));

    /// <summary>Record how a run ended.</summary>
    public static void RecordOutcome(string outcome)
        => Outcomes.Add(1, new KeyValuePair<string, object?>("outcome", outcome));
}
