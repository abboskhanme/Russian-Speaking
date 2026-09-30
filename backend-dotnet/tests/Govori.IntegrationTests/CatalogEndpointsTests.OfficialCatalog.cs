using System.Net;
using System.Text.Json;
using Govori.Infrastructure.Entities;
using Microsoft.EntityFrameworkCore;

namespace Govori.IntegrationTests;

/// <summary>
/// <c>GET /api/catalog/official</c> — the official live catalog a teacher may assign from (D3's
/// "Rasmiy katalog"). A partial of <see cref="CatalogEndpointsTests"/>, so it shares that class's
/// one host rather than booting another (EF caps the internal service providers a run may build).
///
/// <para>Two things are pinned: the RBAC ladder (anonymous 401, student 403, teacher and admin 200)
/// and exactly WHAT counts as official live content. Everything the list offers is something the
/// assign routes accept from any teacher, so a draft, a deleted task, an unpublished official
/// module, or another teacher's group/private module leaking in here would be a picker row whose
/// confirm then 404s — or, worse, homework the student cannot open.</para>
/// </summary>
public sealed partial class CatalogEndpointsTests
{
    [Fact]
    public async Task Official_catalog_lists_only_live_public_content_and_only_to_teachers()
    {
        var adminId = Guid.NewGuid();
        var teacherId = Guid.NewGuid();
        var studentId = Guid.NewGuid();
        var userIds = new[] { adminId, teacherId, studentId };

        var live = Guid.NewGuid();          // public + published → listed
        var liveLater = Guid.NewGuid();     // public + published, higher sort_order → listed after `live`
        var draftModule = Guid.NewGuid();   // public but UNPUBLISHED → omitted
        var noLiveTasks = Guid.NewGuid();   // public + published, but every task is a draft → omitted
        var groupModule = Guid.NewGuid();   // a teacher's group module → never official
        var privateModule = Guid.NewGuid(); // a teacher's private module → never official

        var first = Guid.NewGuid();         // sort 0 in `live`
        var second = Guid.NewGuid();        // sort 1 in `live` — inserted FIRST, so order is by key, not insert
        var draftTask = Guid.NewGuid();     // unpublished, in `live`
        var deletedTask = Guid.NewGuid();   // soft-deleted, in `live`
        var laterTask = Guid.NewGuid();
        var inDraftModule = Guid.NewGuid();
        var onlyDraft = Guid.NewGuid();
        var inGroup = Guid.NewGuid();
        var inPrivate = Guid.NewGuid();

        await using (var ctx = CreateContext())
        {
            ctx.Users.Add(NewUser(adminId, $"off-a-{adminId:N}@example.test", UserRole.Admin, null));
            ctx.Users.Add(NewUser(teacherId, $"off-t-{teacherId:N}@example.test", UserRole.Teacher, null));
            ctx.Users.Add(NewUser(studentId, $"off-s-{studentId:N}@example.test", UserRole.Student, null));

            ctx.QuestionBlocks.Add(Official(live, adminId, "Kundalik hayot", sortOrder: 9_000, published: true));
            ctx.QuestionBlocks.Add(Official(liveLater, adminId, "Sayohat", sortOrder: 9_001, published: true));
            ctx.QuestionBlocks.Add(Official(draftModule, adminId, "Qoralama modul", sortOrder: 9_002, published: false));
            ctx.QuestionBlocks.Add(Official(noLiveTasks, adminId, "Bo'sh modul", sortOrder: 9_003, published: true));
            var grp = NewBlock(groupModule, teacherId, "group");
            var prv = NewBlock(privateModule, teacherId, "private");
            ctx.QuestionBlocks.AddRange(grp, prv);

            ctx.Questions.Add(Item(second, adminId, live, 1, "Ikkinchi"));
            ctx.Questions.Add(Item(first, adminId, live, 0, "Birinchi"));
            ctx.Questions.Add(Item(draftTask, adminId, live, 2, "Qoralama", published: false));
            ctx.Questions.Add(Item(deletedTask, adminId, live, 3, "O'chirilgan", published: false, deleted: true));
            ctx.Questions.Add(Item(laterTask, adminId, liveLater, 0, "Aeroportda"));
            ctx.Questions.Add(Item(inDraftModule, adminId, draftModule, 0, "Qoralama moduldagi"));
            ctx.Questions.Add(Item(onlyDraft, adminId, noLiveTasks, 0, "Yolg'iz qoralama", published: false));
            ctx.Questions.Add(Item(inGroup, teacherId, groupModule, 0, "Guruh vazifasi"));
            ctx.Questions.Add(Item(inPrivate, teacherId, privateModule, 0, "Shaxsiy vazifa"));
            await ctx.SaveChangesAsync();
        }

        try
        {
            var client = _factory.CreateClient();
            const string path = "/api/catalog/official";

            // ── RBAC ladder ──
            Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync(path)).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden,
                (await Api(client, HttpMethod.Get, path, AuthToken(studentId))).StatusCode);
            var adminResp = await Api(client, HttpMethod.Get, path, AuthToken(adminId));
            Assert.Equal(HttpStatusCode.OK, adminResp.StatusCode);

            var resp = await Api(client, HttpMethod.Get, path, AuthToken(teacherId));
            Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
            var modules = (await ReadJson(resp)).EnumerateArray().ToList();
            var ids = modules.Select(m => m.GetProperty("id").GetGuid()).ToList();

            // The teacher did not author a single one of these — official content is readable, and
            // assignable, by every teacher. The admin reads the same list.
            var adminIds = (await ReadJson(adminResp)).EnumerateArray().Select(m => m.GetProperty("id").GetGuid()).ToList();
            Assert.Contains(live, adminIds);
            Assert.Contains(liveLater, adminIds);

            // ── Which modules are official LIVE ──
            Assert.Contains(live, ids);
            Assert.Contains(liveLater, ids);
            Assert.DoesNotContain(draftModule, ids);      // unpublished official module
            Assert.DoesNotContain(noLiveTasks, ids);      // nothing live to assign from it
            Assert.DoesNotContain(groupModule, ids);      // a teacher's group module is never official
            Assert.DoesNotContain(privateModule, ids);
            // Ordered like the student catalog: (sort_order, created_at).
            Assert.True(ids.IndexOf(live) < ids.IndexOf(liveLater));

            // ── The module's shape, and exactly its LIVE tasks in (sort_order, created_at) order ──
            var m = modules.Single(x => x.GetProperty("id").GetGuid() == live);
            Assert.Equal("Kundalik hayot", m.GetProperty("name").GetString());
            Assert.Equal("A2", m.GetProperty("level").GetString());
            Assert.Equal("daily", m.GetProperty("topic").GetString());
            var tasks = m.GetProperty("tasks").EnumerateArray().ToList();
            Assert.Equal(new[] { first, second }, tasks.Select(t => t.GetProperty("id").GetGuid()).ToArray());
            Assert.Equal("Birinchi", tasks[0].GetProperty("title").GetString());
            Assert.Equal("B1", tasks[0].GetProperty("level").GetString());
            Assert.Equal("shop", tasks[0].GetProperty("topic").GetString());
            // Picker rows carry no prompt — only what identifies the task.
            Assert.False(tasks[0].TryGetProperty("prompt_text", out _));

            // No draft / deleted / foreign task anywhere in the list.
            var allTaskIds = modules.SelectMany(x => x.GetProperty("tasks").EnumerateArray())
                .Select(t => t.GetProperty("id").GetGuid()).ToList();
            foreach (var hidden in new[] { draftTask, deletedTask, inDraftModule, onlyDraft, inGroup, inPrivate })
                Assert.DoesNotContain(hidden, allTaskIds);
        }
        finally
        {
            await using var ctx = CreateContext();
            await ctx.Questions.Where(q => userIds.Contains(q.TeacherId)).ExecuteDeleteAsync();
            await ctx.QuestionBlocks.Where(b => userIds.Contains(b.TeacherId)).ExecuteDeleteAsync();
            await ctx.Users.Where(u => userIds.Contains(u.Id)).ExecuteDeleteAsync();
        }

        static QuestionBlock Official(Guid id, Guid adminId, string name, int sortOrder, bool published)
        {
            var b = NewBlock(id, adminId, "public");
            b.Name = name;
            b.Level = "A2";
            b.Topic = "daily";
            b.SortOrder = sortOrder;
            b.IsPublished = published;
            return b;
        }

        static Question Item(
            Guid id, Guid ownerId, Guid blockId, int sortOrder, string title,
            bool published = true, bool deleted = false)
        {
            var q = NewQuestion(id, ownerId, blockId, sortOrder);
            q.Title = title;
            q.Level = "B1";
            q.Topic = "shop";
            q.IsPublished = published;
            q.IsDeleted = deleted;
            return q;
        }
    }
}
