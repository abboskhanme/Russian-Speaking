using Govori.Contracts;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Govori.Assessment;

/// <summary>
/// The durable background job that grades ONE submission (docs/07 §7.7, Faza 3.9). Kept
/// Hangfire-AGNOSTIC on purpose: it carries
/// no Hangfire attributes and takes no Hangfire types, so it is trivially invokable directly (unit /
/// integration tests, or an in-process fallback) as well as from a Hangfire worker. The durable
/// enqueue + retry policy lives one layer out in <c>Govori.Realtime.HangfireGradingQueue</c>.
///
/// <para>It opens its OWN DI scope (fresh scoped <c>GovoriDbContext</c>, decoupled from any request
/// context) exactly like <see cref="InlineGradingQueue"/>, so it resolves cleanly whether Hangfire
/// hands it a per-job scope or a test resolves it from the root provider.</para>
///
/// <para><b>At-least-once delivery / idempotency (docs/07 §7.7):</b> Hangfire re-runs the job on a
/// worker crash (invisibility timeout) and on transient failure (automatic retry). That is safe because
/// <see cref="AssessmentService"/> is idempotent — a persisted <c>Transcript</c> is reused (STT is
/// skipped, Azure is not re-billed) and the <c>Evaluation</c> is DELETE-then-INSERT — so a re-run
/// resumes from where it left off and converges on the same result.</para>
/// </summary>
public sealed class GradingJob
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<GradingJob> _logger;

    public GradingJob(IServiceScopeFactory scopeFactory, ILogger<GradingJob> logger)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    /// <summary>Run the grading pipeline for one submission (Hangfire's job entry point).</summary>
    public async Task RunAsync(Guid submissionId, CancellationToken ct = default)
    {
        using var scope = _scopeFactory.CreateScope();
        var service = scope.ServiceProvider.GetRequiredService<AssessmentService>();
        var outcome = await service.RunAsync(submissionId, ct);
        _logger.LogInformation(
            "grading job outcome {Outcome} (submission {SubmissionId})", outcome, submissionId);

        // Gamification side-effect (Stage 6): award XP + roll the streak once grading succeeds. Runs
        // through IGradingRewarder (Govori.Contracts) whose implementation lives in the Engagement
        // module, so grading never compile-references Engagement. The reward is idempotent, so a
        // Hangfire re-run never double-awards; and it is BEST-EFFORT — grading is already durably
        // committed, so a reward failure is logged and swallowed rather than failing (and re-queuing)
        // the whole job. A later grade of the same submission re-attempts the (idempotent) award.
        try
        {
            var rewarder = scope.ServiceProvider.GetRequiredService<IGradingRewarder>();
            switch (outcome)
            {
                case AssessmentOutcome.Done:
                    await rewarder.RewardGradedAsync(submissionId, ct);
                    break;
                case AssessmentOutcome.Shadowing:
                    await rewarder.RewardShadowingAsync(submissionId, ct);
                    break;
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex,
                "XP reward failed for submission {SubmissionId} (grading already committed; will retry on re-grade)",
                submissionId);
        }
    }
}
