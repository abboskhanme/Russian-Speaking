using Govori.Contracts;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Govori.Assessment;

/// <summary>
/// Default <see cref="IGradingQueue"/> — runs the grading pipeline IN-PROCESS (docs/07 §7.7,
/// Faza 3.4). The C# stand-in for <c>process_submission.delay(...)</c> until the durable queue
/// lands.
///
/// <para>It runs the pipeline SYNCHRONOUSLY in a FRESH DI scope (its own scoped
/// <c>GovoriDbContext</c>, decoupled from the request's context and change-tracker) so grading is
/// deterministic and testable. When no real provider is wired, <see cref="AssessmentService"/>
/// short-circuits (<see cref="AssessmentOutcome.Deferred"/>) and the attempt stays <c>pending</c> —
/// so this is safe to call unconditionally from the submit path.</para>
///
/// <para>TODO(Hangfire, Faza 3.9): replace with a durable background job (BackgroundJob.Enqueue),
/// giving <c>task_acks_late</c> semantics + automatic retry, so submit returns before grading runs.</para>
/// </summary>
public sealed class InlineGradingQueue : IGradingQueue
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<InlineGradingQueue> _logger;

    public InlineGradingQueue(IServiceScopeFactory scopeFactory, ILogger<InlineGradingQueue> logger)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    public async Task EnqueueAsync(Guid submissionId, CancellationToken ct = default)
    {
        using var scope = _scopeFactory.CreateScope();
        var service = scope.ServiceProvider.GetRequiredService<AssessmentService>();
        var outcome = await service.RunAsync(submissionId, ct);
        _logger.LogInformation(
            "grading pipeline outcome {Outcome} (submission {SubmissionId})", outcome, submissionId);
    }
}
