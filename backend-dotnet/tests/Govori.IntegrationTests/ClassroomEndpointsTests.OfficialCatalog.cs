using System.Net;
using System.Text.Json;
using Govori.Infrastructure.Entities;
using Microsoft.EntityFrameworkCore;

namespace Govori.IntegrationTests;

/// <summary>
/// Assigning from the OFFICIAL catalog (D3 "Rasmiy katalog"). A partial of
/// <see cref="ClassroomEndpointsTests"/> on the same host — no extra WebApplicationFactory.
///
/// <para>What widened, and what did not. A teacher may now hand out official live content they did
/// not author — a single task or a whole module — and the row is theirs (<c>teacher_id</c> = the
/// assigning teacher), so every list, cancel and deadline move works on it as on their own. What
/// did NOT widen: another teacher's group/private content is still a 404 (never 403, ids stay
/// unprobeable); an official module that is still a draft is a 404; the roster filter (S1) and the
/// OPEN-assignment dedupe apply exactly as before.</para>
/// </summary>
public sealed partial class ClassroomEndpointsTests
{
    [Fact]
    public async Task A_teacher_assigns_official_content_but_never_another_teachers_group_content()
    {
        using var seed = new Seed(this);
        var author = await seed.UserAsync(UserRole.Admin, "Rasmiy muallif");      // owns the official catalog
        var teacher = await seed.UserAsync(UserRole.Teacher, "Ustoz Aliyeva");
        var otherTeacher = await seed.UserAsync(UserRole.Teacher, "Boshqa ustoz");
        var student = await seed.UserAsync(UserRole.Student, "Anvar");
        var outsider = await seed.UserAsync(UserRole.Student, "Begona");          // another teacher's student
        var group = await seed.GroupAsync(teacher, student);
        await seed.GroupAsync(otherTeacher, outsider);

        var officialTask = await seed.QuestionAsync(author, "Rasmiy vazifa", publicBlock: true);
        var officialModule = await seed.BlockAsync(author, "Rasmiy modul", tasks: 3);
        var draftOfficial = await seed.BlockAsync(author, "Rasmiy qoralama", tasks: 1);
        var foreignGroupModule = await seed.BlockAsync(otherTeacher, "Boshqa guruh moduli", tasks: 2);
        Guid draftOfficialTask, foreignTask;
        await using (var ctx = CreateContext())
        {
            (await ctx.QuestionBlocks.SingleAsync(b => b.Id == officialModule)).Visibility = "public";
            var draft = await ctx.QuestionBlocks.SingleAsync(b => b.Id == draftOfficial);
            draft.Visibility = "public";
            draft.IsPublished = false;                     // an official module nobody can see yet
            (await ctx.QuestionBlocks.SingleAsync(b => b.Id == foreignGroupModule)).Visibility = "group";
            await ctx.SaveChangesAsync();
            // The task itself is published — only its module is a draft, and that alone must keep it
            // out of reach.
            draftOfficialTask = await ctx.Questions.Where(q => q.BlockId == draftOfficial).Select(q => q.Id).SingleAsync();
            foreignTask = await ctx.Questions.Where(q => q.BlockId == foreignGroupModule)
                .OrderBy(q => q.SortOrder).Select(q => q.Id).FirstAsync();
        }

        var client = _factory.CreateClient();
        var token = TokenFor(teacher);

        // ── An official task the teacher did not write → 201, one row, and the row is THEIRS ──
        Assert.Equal(1, await CreatedCount(await Send(client, HttpMethod.Post, "/api/assignments", token,
            Json(new { question_id = officialTask, group_id = group }))));
        await using (var ctx = CreateContext())
        {
            var row = await ctx.Assignments.SingleAsync(a => a.QuestionId == officialTask);
            Assert.Equal(teacher, row.TeacherId);                 // the assigning teacher, not the author
            Assert.Equal(student, row.StudentId);
        }
        // …so it is on the teacher's own list like any other assignment.
        using (var mine = JsonDocument.Parse(await (await Send(client, HttpMethod.Get, "/api/assignments", token)).Content.ReadAsStringAsync()))
            Assert.Contains(mine.RootElement.EnumerateArray(), a => a.GetProperty("question_id").GetGuid() == officialTask);

        // ── Dedupe still holds: the student still owes it, so a second press writes nothing ──
        Assert.Equal(0, await CreatedCount(await Send(client, HttpMethod.Post, "/api/assignments", token,
            Json(new { question_id = officialTask, group_id = group }))));
        // ── The roster filter still holds: an outsider named explicitly gets nothing ──
        Assert.Equal(0, await CreatedCount(await Send(client, HttpMethod.Post, "/api/assignments", token,
            Json(new { question_id = officialTask, student_ids = new[] { outsider } }))));
        await using (var ctx = CreateContext())
        {
            Assert.Equal(1, await ctx.Assignments.CountAsync(a => a.QuestionId == officialTask));
            Assert.Equal(0, await ctx.Assignments.CountAsync(a => a.StudentId == outsider));
        }

        // ── Another teacher's GROUP content is still not theirs: 404, not 403, nothing written ──
        Assert.Equal(HttpStatusCode.NotFound, (await Send(client, HttpMethod.Post, "/api/assignments", token,
            Json(new { question_id = foreignTask, group_id = group }))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Send(client, HttpMethod.Post, "/api/assignments/module", token,
            Json(new { block_id = foreignGroupModule, group_id = group }))).StatusCode);

        // ── An official module that is still a draft is not official LIVE content: 404 both ways ──
        Assert.Equal(HttpStatusCode.NotFound, (await Send(client, HttpMethod.Post, "/api/assignments/module", token,
            Json(new { block_id = draftOfficial, group_id = group }))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Send(client, HttpMethod.Post, "/api/assignments", token,
            Json(new { question_id = draftOfficialTask, group_id = group }))).StatusCode);

        // ── A whole official module → every live task, once; a repeat hands out nothing new ──
        Assert.Equal(3, await CreatedCount(await Send(client, HttpMethod.Post, "/api/assignments/module", token,
            Json(new { block_id = officialModule, group_id = group }))));
        Assert.Equal(0, await CreatedCount(await Send(client, HttpMethod.Post, "/api/assignments/module", token,
            Json(new { block_id = officialModule, group_id = group }))));

        await using (var ctx = CreateContext())
        {
            var moduleTasks = await ctx.Questions.Where(q => q.BlockId == officialModule).Select(q => q.Id).ToListAsync();
            var assigned = await ctx.Assignments.Where(a => a.StudentId == student && moduleTasks.Contains(a.QuestionId)).ToListAsync();
            Assert.Equal(3, assigned.Count);
            Assert.All(assigned, a => Assert.Equal(teacher, a.TeacherId));
            // Nothing from the refused requests above.
            Assert.Equal(0, await ctx.Assignments.CountAsync(a => a.QuestionId == foreignTask || a.QuestionId == draftOfficialTask));
        }

        // A student still may not assign anything, official or not.
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(client, HttpMethod.Post, "/api/assignments", TokenFor(student),
            Json(new { question_id = officialTask, student_ids = new[] { student } }))).StatusCode);
    }
}
