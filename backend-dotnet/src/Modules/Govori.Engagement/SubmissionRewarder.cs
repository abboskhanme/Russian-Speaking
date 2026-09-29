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
///
/// <para><b>The graded reward includes the spaced-repetition review.</b> The legacy worker ran
/// <c>award_submission</c> and then, for an answered attempt, <c>schedule_review</c> — one step,
/// back to back. The port kept <see cref="EngagementService.ScheduleReviewAsync"/> but nothing ever
/// called it, so a weak answer never reached the review queue; it is called from here now, in the
/// legacy order and under the legacy condition.</para>
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
        //
        // The same XP event is the receipt for the review below. review_items has no submission
        // column to key a second guard on (and adding one is a migration bought for a guard), and
        // ScheduleReviewAsync is NOT safe to repeat: it supersedes every open review for the
        // question, so a re-run would complete the item the first run created and enqueue a copy —
        // or, if the student had already climbed the drill ladder meanwhile, knock that item back to
        // round one. Gating both on one receipt makes the pair at-most-once per submission.
        var alreadyRewarded = await _db.XpEvents.AnyAsync(
            x => x.SubmissionId == submissionId && x.Reason == "submission", ct);
        if (alreadyRewarded) return;

        // answered = the student actually spoke: a persisted Transcript with non-blank text. A skipped
        // attempt earns nothing (AwardSubmissionAsync enforces the same rule for the amount).
        var transcript = await _db.Transcripts.FirstOrDefaultAsync(t => t.SubmissionId == submissionId, ct);
        var answered = transcript is not null && !string.IsNullOrWhiteSpace(transcript.Text);

        await _engagement.AwardSubmissionAsync(sub, sub.Evaluation, answered, today: null, ct);

        // SRS (legacy `if answered: schedule_review(...)`): a silent attempt gets no review, exactly as
        // it gets no XP — there is no weakness to replay in an answer that was never given. A non-student
        // is a no-op inside ScheduleReviewAsync. It runs AFTER the XP commit, as it did in legacy, so if
        // this step fails the XP stands and the review for this one attempt is skipped (the caller logs
        // it): best-effort, never at the price of the reward. Since the XP receipt now exists, a re-run
        // will not retry it — the next graded answer to the same question re-evaluates the weakness anyway.
        //
        // NOT gated on review_drill_enabled, deliberately. That flag gates the drill SURFACE
        // (/api/review/drill and the Daily step) — it is read only where a drill is served — while
        // the plain queue (/api/review) is always on. Scheduling only while the flag is on would leave
        // the queue empty on the day the drill is switched on and permanently missing every weakness
        // graded while it was off.
        if (answered)
            await _engagement.ScheduleReviewAsync(sub, sub.Evaluation, ct);
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
