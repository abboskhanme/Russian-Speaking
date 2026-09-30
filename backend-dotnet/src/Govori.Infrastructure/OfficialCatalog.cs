using Govori.Infrastructure.Entities;

namespace Govori.Infrastructure;

/// <summary>
/// THE definition of "official, live content" — the catalog an admin publishes and every student
/// sees. One rule, one implementation:
///
/// <code>official live module  ==  visibility = "public"  AND  is_published
/// official live task    ==  is_published  AND  NOT is_deleted  AND  in an official live module</code>
///
/// <para><b>Why it exists.</b> A teacher used to be able to hand out only what they AUTHORED, yet
/// the product's main content is the official catalog. A class working through it could not be
/// given homework from it, although the same teacher already sees and grades every roster answer
/// to it (<see cref="TeacherScope"/>). Assigning official live content is therefore allowed to any
/// teacher, and this is the predicate that says which content that is.</para>
///
/// <para><b>Why it is here and not in a module.</b> Catalog lists it (the D3 "Rasmiy katalog"
/// picker) and Classroom accepts it (assign, module assign, the F6 remediation target). A
/// Classroom→Catalog reference is a domain→domain edge the ArchTests forbid, and two copies of
/// "what is official" are exactly how the picker comes to offer something the assign route then
/// 404s. It is a query over tables this project already owns — the same reasoning as
/// <see cref="TeacherScope"/> and <see cref="PremiumAccess"/>.</para>
///
/// <para><b>Both halves of "live" are load-bearing.</b> A task in a public module that is itself
/// a draft, deleted, or sitting in an unpublished module reaches no student: submit refuses it, so
/// an assignment to it would be homework that cannot be done. Another teacher's
/// <c>group</c>/<c>private</c> content is never official, whatever its publish state.</para>
/// </summary>
public static class OfficialCatalog
{
    /// <summary>The <c>question_blocks.visibility</c> value of an official module.</summary>
    public const string PublicVisibility = "public";

    /// <summary>Is this loaded module an official live one?</summary>
    public static bool IsLiveModule(QuestionBlock block)
        => block.Visibility == PublicVisibility && block.IsPublished;

    /// <summary>Official live modules, as a composable query (no ordering imposed).</summary>
    public static IQueryable<QuestionBlock> LiveModules(GovoriDbContext db)
        => db.QuestionBlocks.Where(b => b.Visibility == PublicVisibility && b.IsPublished);

    /// <summary>Official live tasks, as a composable query (no ordering imposed). The module test
    /// rides the <c>Block</c> navigation, so it is one join, not a query per task.</summary>
    public static IQueryable<Question> LiveTasks(GovoriDbContext db)
        => db.Questions.Where(q => q.IsPublished
                                   && !q.IsDeleted
                                   && q.Block != null
                                   && q.Block.Visibility == PublicVisibility
                                   && q.Block.IsPublished);

    /// <summary>
    /// The ids of <see cref="LiveTasks"/>. Meant to be used inside <c>Contains</c>/<c>Any</c> so it
    /// runs as one SQL sub-select beside the caller's own predicate — the same shape as
    /// <see cref="TeacherScope.RosterStudentIds"/> — never as a materialised list.
    /// </summary>
    public static IQueryable<Guid> LiveTaskIds(GovoriDbContext db)
        => LiveTasks(db).Select(q => q.Id);
}
