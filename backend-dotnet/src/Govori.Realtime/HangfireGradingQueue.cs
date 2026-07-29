using Govori.Assessment;
using Govori.Contracts;
using Hangfire;

namespace Govori.Realtime;

/// <summary>
/// The durable <see cref="IGradingQueue"/> (docs/07 §7.7, Faza 3.9) — the durable background
/// grading queue. Instead of running the pipeline in-process, it enqueues a
/// Hangfire <see cref="GradingJob"/> so submit returns immediately and the Worker's Hangfire server
/// grades off-request, with bounded automatic retry and, because a job is only acknowledged once
/// it completes, re-queue of anything a crashed worker was mid-way through.
/// </summary>
public sealed class HangfireGradingQueue : IGradingQueue
{
    private readonly IBackgroundJobClient _jobs;

    public HangfireGradingQueue(IBackgroundJobClient jobs) => _jobs = jobs;

    public Task EnqueueAsync(Guid submissionId, CancellationToken ct = default)
    {
        // Hangfire substitutes a real shutdown-linked token for the CancellationToken argument at
        // run time; CancellationToken.None here is just the serialized placeholder.
        _jobs.Enqueue<GradingJob>(job => job.RunAsync(submissionId, CancellationToken.None));
        return Task.CompletedTask;
    }
}
