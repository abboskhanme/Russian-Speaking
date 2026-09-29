using Govori.Infrastructure.Entities;
using Microsoft.EntityFrameworkCore;

namespace Govori.Infrastructure;

/// <summary>
/// THE definition of "which student work may this teacher see". One rule, one implementation:
///
/// <code>teacher sees a submission  ==  its student is a member of a group the teacher OWNS</code>
///
/// <para><b>Why the rule changed, and why it is no longer "own questions AND own roster".</b> The
/// first cut let a teacher see only answers to questions they AUTHORED. A class that practises the
/// official public catalog — which is most classes — then produced an empty review queue, an empty
/// gradebook, empty insights and an empty student profile, although every answer came from the
/// teacher's own students. What a teacher is responsible for is their STUDENTS, not their
/// authorship, so the roster is the whole test: a roster student's answer to any question is in
/// scope.</para>
///
/// <para><b>Why "answers to my own questions" is NOT a second way in.</b> Unioning it in would hand a
/// teacher every answer any student in the system gives to a question they wrote — for the author of
/// a public module, that is every learner on the platform — and it is exactly the leak the
/// Classroom suites pin shut ("an outsider's answer to the teacher's OWN question is invisible", the
/// S1 hole in its read-side shape). Everything the union could add on top of the roster rule is a
/// student in no group of this teacher's, and that student must stay a 404.</para>
///
/// <para><b>Why it is here and not in a module.</b> Classroom (gradebook, insights, remediation,
/// student profile) and Practice (attempt list, detail, review) both apply it, and a
/// Classroom↔Practice reference is a domain→domain edge the ArchTests forbid. Copying it into both is
/// the failure this class exists to prevent — the day the two copies disagree, the queue shows an
/// attempt the detail screen then 404s. It is a query over tables this project already owns, which is
/// what Infrastructure is for (the same reasoning as <see cref="PremiumAccess"/>).</para>
///
/// <para>Admins see everything and students see their own; both are unchanged and live here too so a
/// caller never re-derives the role split.</para>
/// </summary>
public static class TeacherScope
{
    /// <summary>
    /// The student ids on <paramref name="teacherId"/>'s roster: members of any group that teacher
    /// owns. A composable query — callers use it inside <c>Contains</c>/<c>Any</c> so it runs as one
    /// SQL sub-select, never as a materialised list.
    /// </summary>
    public static IQueryable<Guid> RosterStudentIds(GovoriDbContext db, Guid teacherId)
        => db.GroupMembers
            .Where(gm => gm.Group.TeacherId == teacherId)
            .Select(gm => gm.StudentId);

    /// <summary>Is <paramref name="studentId"/> in at least one group <paramref name="teacherId"/>
    /// owns? The per-row form of <see cref="RosterStudentIds"/>, for single-id reads (a detail
    /// screen, a review, a student profile).</summary>
    public static Task<bool> TeachesAsync(
        GovoriDbContext db, Guid teacherId, Guid studentId, CancellationToken ct = default)
        => db.GroupMembers.AnyAsync(
            gm => gm.StudentId == studentId && gm.Group.TeacherId == teacherId, ct);

    /// <summary>
    /// Narrows <paramref name="source"/> to what <paramref name="viewer"/> may see: an admin sees
    /// every row, a teacher the rows of their roster (any question), anyone else only their own.
    /// Purely a filter — it composes with every other <c>Where</c> the caller adds, and none of those
    /// can widen it.
    /// </summary>
    public static IQueryable<Submission> VisibleTo(
        this IQueryable<Submission> source, GovoriDbContext db, User viewer)
        => viewer.Role switch
        {
            UserRole.Admin => source,
            UserRole.Teacher => source.Where(s => db.GroupMembers.Any(
                gm => gm.StudentId == s.StudentId && gm.Group.TeacherId == viewer.Id)),
            _ => source.Where(s => s.StudentId == viewer.Id),
        };

    /// <summary>
    /// The single-row form of <see cref="VisibleTo"/>. The OWNER always sees their own attempt, and
    /// that check comes first on purpose: a teacher's own shadowing practice has no question and no
    /// group, and must not trip the roster test.
    /// </summary>
    public static async Task<bool> CanSeeAsync(
        GovoriDbContext db, User viewer, Submission submission, CancellationToken ct = default)
    {
        if (submission.StudentId == viewer.Id) return true;
        return viewer.Role switch
        {
            UserRole.Admin => true,
            UserRole.Teacher => await TeachesAsync(db, viewer.Id, submission.StudentId, ct),
            _ => false,
        };
    }
}
