using Govori.Contracts;
using Microsoft.Extensions.DependencyInjection;

namespace Govori.Assessment;

/// <summary>
/// The IN-PROCESS <see cref="IGradingQueue"/> (docs/07 §7.7, Faza 3.4): grades the submission right
/// there, inside the submit request. It is NOT the production path — the API enqueues a durable
/// Hangfire job by default (<c>Govori.Realtime.HangfireGradingQueue</c>) — and is selected only with
/// <c>GOVORI_HANGFIRE=false</c>, which is how the integration suites grade synchronously and assert
/// the result inline.
///
/// <para><b>It runs the very same job the Worker runs.</b> It resolves <see cref="GradingJob"/> and
/// calls it, rather than calling <see cref="AssessmentService"/> directly, because the job is more
/// than the pipeline: it also hands a finished grade to <see cref="IGradingRewarder"/> (XP, streak,
/// spaced-repetition review). Calling the service directly — as this class once did — silently
/// graded without rewarding, so any test running on this queue was asserting a pipeline production
/// does not have. The job opens its own DI scope (a fresh <c>GovoriDbContext</c>, decoupled from the
/// request's change-tracker), exactly as it does under Hangfire.</para>
///
/// <para>When no real provider is wired, <see cref="AssessmentService"/> short-circuits
/// (<see cref="AssessmentOutcome.Deferred"/>) and the attempt stays <c>pending</c> — so this is safe
/// to call unconditionally from the submit path.</para>
/// </summary>
public sealed class InlineGradingQueue : IGradingQueue
{
    private readonly IServiceScopeFactory _scopeFactory;

    public InlineGradingQueue(IServiceScopeFactory scopeFactory) => _scopeFactory = scopeFactory;

    public async Task EnqueueAsync(Guid submissionId, CancellationToken ct = default)
    {
        using var scope = _scopeFactory.CreateScope();
        var job = scope.ServiceProvider.GetRequiredService<GradingJob>();
        await job.RunAsync(submissionId, ct);   // logs the outcome itself
    }
}
