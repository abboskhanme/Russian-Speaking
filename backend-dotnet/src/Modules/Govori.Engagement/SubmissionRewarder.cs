using Govori.Contracts;
using Govori.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace Govori.Engagement;

/// <summary>
/// The <see cref="IGradingRewarder"/> implementation (docs/07 §3.6, Stage 6 gamification side-effect).
/// It is the seam that lets the grading pipeline grant the engagement reward without either module
/// referencing the other: <c>Govori.Assessment.GradingJob</c> depends on the <see cref="IGradingRewarder"/>
/// interface in <c>Govori.Contracts</c>, and this concrete reward logic lives HERE in the engagement
/// module (which already owns the entities + the frozen award curve) and is wired in at the composition
/// root. That keeps grading and XP as separate domains with no compile edge between them.
///
/// <para>It reuses the frozen <see cref="EngagementService"/> award methods verbatim (their C8 XP curve
/// and streak logic are characterization-frozen). The ONLY thing added here is the idempotency guard:
/// the durable grading job is re-run on a worker crash / retry and grading is idempotent, so the reward
/// must be too. The guard lives in this rewarder — NOT inside the frozen award methods — so those keep
/// their exact contract while a job re-run never double-awards.</para>
/// </summary>
public sealed class SubmissionRewarder : IGradingRewarder
{
    private readonly GovoriDbContext _db;
    private readonly EngagementService _engagement;

    public SubmissionRewarder(GovoriDbContext db, EngagementService engagement)
    {
        _db = db;
        _engagement = engagement;
    }

    /// <inheritdoc />
    public async Task RewardGradedAsync(Guid submissionId, CancellationToken ct = default)
    {
        var sub = await _db.Submissions
            .Include(s => s.Evaluation)
            .FirstOrDefaultAsync(s => s.Id == submissionId, ct);
        if (sub is null || sub.Evaluation is null) return;      // missing submission / not graded ⇒ no-op

        // IDEMPOTENCY GUARD: if this submission already earned its academic XP, a re-run (Hangfire
        // retry / crash resume) must not award it again. The frozen AwardSubmissionAsync stays untouched.
        var alreadyRewarded = await _db.XpEvents.AnyAsync(
            x => x.SubmissionId == submissionId && x.Reason == "submission", ct);
        if (alreadyRewarded) return;

        // answered = the student actually spoke: a persisted Transcript with non-blank text. A skipped
        // attempt earns nothing (AwardSubmissionAsync enforces the same rule for the amount).
        var transcript = await _db.Transcripts.FirstOrDefaultAsync(t => t.SubmissionId == submissionId, ct);
        var answered = transcript is not null && !string.IsNullOrWhiteSpace(transcript.Text);

        await _engagement.AwardSubmissionAsync(sub, sub.Evaluation, answered, today: null, ct);
    }

    /// <inheritdoc />
    public async Task RewardShadowingAsync(Guid submissionId, CancellationToken ct = default)
    {
        var sub = await _db.Submissions.FirstOrDefaultAsync(s => s.Id == submissionId, ct);
        if (sub is null) return;                                // missing submission ⇒ no-op

        // IDEMPOTENCY GUARD: mirror the academic path for the fixed practice grant.
        var alreadyRewarded = await _db.XpEvents.AnyAsync(
            x => x.SubmissionId == submissionId && x.Reason == "practice", ct);
        if (alreadyRewarded) return;

        await _engagement.AwardPracticeAsync(sub, today: null, ct);
    }
}
