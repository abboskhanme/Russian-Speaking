using Govori.Infrastructure.Entities;
using Microsoft.EntityFrameworkCore;

namespace Govori.Infrastructure;

/// <summary>
/// THE definition of an OPEN assignment — one a student still owes — and the one thing an open
/// assignment grants: access to its task.
///
/// <code>unanswered  ==  no answer by that student to that task given at or after the assignment was set
/// open        ==  unanswered  AND  (no deadline  OR  deadline not passed)</code>
///
/// <para><b>Who uses it.</b> Classroom decides with it who "already has this task" (the single-task
/// dedupe and the F6 remediation audience) and what a dismantled arrangement may delete. Catalog
/// (the student module view) and Practice (submit) decide with it what an assignment UNLOCKS. It
/// lived privately in Classroom until the unlock needed it too; it moved here, unchanged, rather
/// than being copied into two more modules — a Catalog/Practice→Classroom reference is a
/// domain→domain edge the ArchTests forbid, and a second copy is how "the task you were given" and
/// "the task you may open" come to disagree.</para>
///
/// <para><b>The unlock rule — a LIVE assignment for a task unlocks THAT task for THAT student.</b>
/// Official modules are freemium-gated positionally and every module is sequence-locked; an
/// assignment used to change neither, so a teacher could set task 7 of an official module and the
/// student met a padlock (and, at submit, a 402). With a live assignment the task is neither
/// <c>locked</c> nor <c>premium_locked</c> in the module view, its content is served, and submit
/// does not refuse it with a 402. Nothing else unlocks.</para>
///
/// <para><b>Live, not open.</b> <see cref="Live"/> is "deadline not passed" — exactly the rule
/// submit uses to ATTRIBUTE an answer to an assignment — and it deliberately ignores whether the
/// student has answered. The first version keyed the unlock on <see cref="Open"/> (unanswered), so
/// the task re-locked the moment the first answer arrived: a teacher who allowed three attempts got
/// one, and an answer whose grading failed on OUR side could never be redone, although the attempt
/// budget exists precisely to allow retries and says a failed attempt costs nothing. What bounds
/// the retries is that budget (<c>max_attempts</c>, checked at submit before the 402), not the
/// padlock. <see cref="Open"/> stays what Classroom means by "still owes it" — the dedupe and the
/// remediation audience — which is a different question.</para>
///
/// <para><b>Why this opens no new bypass.</b> A teacher can already grant premium to their own
/// students outright (<c>PATCH /api/classroom/students/{id}/premium</c>), which unlocks far more
/// than one task; and an assignment can only reach a student on the teacher's own roster (the S1
/// filter). Homework a student cannot open is worse than useless — it reads as a broken product to
/// both the teacher and the student.</para>
/// </summary>
public static class AssignmentAccess
{
    /// <summary>
    /// Assignments the student has not answered yet — by the SAME rule
    /// <c>AssignmentResponse.Completed</c> reports (any answer to that question given at or after
    /// the assignment was set closes it). Deadline-blind on purpose: this is "what is not the
    /// student's record", used when an arrangement is dismantled.
    /// </summary>
    public static IQueryable<Assignment> Unanswered(GovoriDbContext db)
        => db.Assignments.Where(a => !db.Submissions.Any(
            s => s.StudentId == a.StudentId
                 && s.QuestionId == a.QuestionId
                 && s.CreatedAt >= a.CreatedAt));

    /// <summary>
    /// OPEN assignments: <see cref="Unanswered"/> AND the deadline has not passed. A lapsed deadline
    /// is not open: submit no longer attributes answers to it, so it is not something the student
    /// can still do.
    /// </summary>
    public static IQueryable<Assignment> Open(GovoriDbContext db, DateTime nowUtc)
        => Unanswered(db).Where(a => a.DueAt == null || a.DueAt >= nowUtc);

    /// <summary>
    /// LIVE assignments: the deadline has not passed (or there is none), answered or not — the rule
    /// submit uses to attribute an answer to an assignment, and so the rule the unlock uses (see the
    /// class remarks for why not <see cref="Open"/>).
    /// </summary>
    public static IQueryable<Assignment> Live(GovoriDbContext db, DateTime nowUtc)
        => db.Assignments.Where(a => a.DueAt == null || a.DueAt >= nowUtc);

    /// <summary>The question ids <paramref name="studentId"/> holds a LIVE assignment for — the
    /// tasks the unlock rule opens for them. Composable; the caller materialises it once.</summary>
    public static IQueryable<Guid> LiveQuestionIds(GovoriDbContext db, Guid studentId, DateTime nowUtc)
        => Live(db, nowUtc).Where(a => a.StudentId == studentId).Select(a => a.QuestionId);
}
