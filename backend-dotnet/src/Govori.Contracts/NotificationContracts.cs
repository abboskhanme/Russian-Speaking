namespace Govori.Contracts;

// ─── In-app notifications raised by classroom events ────────────────────────
// Classroom and Practice RAISE these; Engagement owns the notifications table and WRITES them. The
// seam mirrors IGradingRewarder: the interface lives here (dependency-free, primitives only), the
// implementation (Govori.Engagement.ClassroomNotifier) is wired at the composition root, and neither
// raising module gains a compile edge to Engagement — the ArchTests forbid one.

/// <summary>
/// The <c>notifications.type</c> values. A notification row stores RENDERED text (title + body, in
/// the recipient's <c>preferred_language</c>) plus this machine type and an in-app <c>link</c>; the
/// client renders title/body verbatim and may key an icon or a route off the type. Values are part
/// of the wire contract — never rename one, only add.
/// </summary>
public static class NotificationTypes
{
    /// <summary>A teacher queued question(s) for the student's review. Link <c>/review</c>.</summary>
    public const string ReviewAdded = "review_added";

    /// <summary>The student received new assignment(s) — ONE per student per assign action, however
    /// many tasks it created (a 6-task module is one ping). Link <c>/practice?tab=assignments</c>.</summary>
    public const string AssignmentNew = "assignment_new";

    /// <summary>A teacher saved a review (band and/or comment) on the student's attempt.
    /// Link <c>/results/{submission_id}</c>.</summary>
    public const string ReviewDone = "review_done";

    /// <summary>To the TEACHER: a student asked to join one of their groups.
    /// Link <c>/teacher/classes?tab=requests</c>.</summary>
    public const string JoinRequest = "join_request";

    /// <summary>The student's join request was approved. Link <c>/group</c>.</summary>
    public const string JoinApproved = "join_approved";

    /// <summary>The student's join request was declined. Link <c>/group</c>.</summary>
    public const string JoinRejected = "join_rejected";
}

/// <summary>
/// The seam Classroom and Practice use to tell a student (or a teacher) that something happened in
/// class. Every method takes IDS, not text: the implementation resolves names and titles itself and
/// renders them in each recipient's language, so a raising module never has to know how a
/// notification reads.
///
/// <para><b>Called AFTER the raising write has committed, and best-effort.</b> A notification is a
/// courtesy about a write, never part of it: the assignment, the review, the membership stand
/// whether or not anyone is pinged. Implementations therefore MUST NOT throw (log and swallow, like
/// <see cref="IGradingEvents"/>), and callers still guard the call so an implementation that breaks
/// that promise cannot turn a committed write into a 500.</para>
///
/// <para><b>The opt-out is the implementation's job.</b> <c>users.notifications_enabled = false</c>
/// recipients are resolved once per call (one query per batch, never one per recipient) and skipped
/// — the same rule the <c>review_added</c> writer follows.</para>
/// </summary>
public interface IClassroomNotifier
{
    /// <summary><see cref="NotificationTypes.AssignmentNew"/> to each of
    /// <paramref name="studentIds"/> — the students who got at least one NEW row from this action.
    /// Exactly one of <paramref name="questionId"/> (single task) / <paramref name="blockId"/>
    /// (whole module) names what was assigned.</summary>
    Task AssignmentsCreatedAsync(
        Guid teacherId, IReadOnlyCollection<Guid> studentIds, Guid? questionId, Guid? blockId,
        CancellationToken ct = default);

    /// <summary><see cref="NotificationTypes.ReviewDone"/> to the attempt's student.</summary>
    Task ReviewSavedAsync(Guid submissionId, CancellationToken ct = default);

    /// <summary><see cref="NotificationTypes.JoinRequest"/> to the group's teacher.</summary>
    Task JoinRequestFiledAsync(Guid requestId, CancellationToken ct = default);

    /// <summary><see cref="NotificationTypes.JoinApproved"/> or
    /// <see cref="NotificationTypes.JoinRejected"/> to the requesting student, chosen from the
    /// request's stored status.</summary>
    Task JoinRequestDecidedAsync(Guid requestId, CancellationToken ct = default);
}

/// <summary>The caller's half of the best-effort contract, written once for every raising module.</summary>
public static class ClassroomNotifierExtensions
{
    /// <summary>
    /// Runs one notifier call AFTER the raising write has committed. Implementations promise not to
    /// throw and log their own failures; this guard exists only so one that breaks the promise still
    /// cannot turn a committed assignment, review or membership into a 500. The caller's own
    /// cancellation is the one exception allowed through — the client is gone, there is nobody to
    /// answer.
    /// </summary>
    public static async Task SendBestEffortAsync(
        this IClassroomNotifier notifier, Func<IClassroomNotifier, Task> send, CancellationToken ct)
    {
        try
        {
            await send(notifier);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception)
        {
            // Deliberately swallowed — see the summary. The write this reports on stands.
        }
    }
}

/// <summary>
/// No-op <see cref="IClassroomNotifier"/> — the default for a service constructed directly (tests,
/// tools) rather than resolved from the host's container, so the raising paths never need a null
/// check.
/// </summary>
public sealed class NullClassroomNotifier : IClassroomNotifier
{
    public Task AssignmentsCreatedAsync(
        Guid teacherId, IReadOnlyCollection<Guid> studentIds, Guid? questionId, Guid? blockId,
        CancellationToken ct = default) => Task.CompletedTask;

    public Task ReviewSavedAsync(Guid submissionId, CancellationToken ct = default) => Task.CompletedTask;

    public Task JoinRequestFiledAsync(Guid requestId, CancellationToken ct = default) => Task.CompletedTask;

    public Task JoinRequestDecidedAsync(Guid requestId, CancellationToken ct = default) => Task.CompletedTask;
}
