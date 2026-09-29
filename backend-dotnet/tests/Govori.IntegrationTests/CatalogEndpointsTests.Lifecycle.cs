using System.Net;
using System.Text.Json;
using Govori.Infrastructure.Entities;
using Microsoft.EntityFrameworkCore;

namespace Govori.IntegrationTests;

/// <summary>
/// The content lifecycle a fresh install needs end to end: an admin makes OFFICIAL public modules (a
/// teacher may not), publishing a module publishes its draft tasks so students actually see it,
/// deleting a task or a module removes it from the catalog WITHOUT erasing any student's attempts,
/// and a student's task carries the prompt they are graded against — but only once it is unlocked.
///
/// <para>Every new route (<c>DELETE /api/questions/{id}</c>, <c>DELETE /api/blocks/{id}</c>) is
/// proven RBAC-protected: anonymous → 401, student → 403, another teacher → 404 (never 403, so ids
/// stay unprobeable), owner and admin → 204. Every seeded row is deleted in a finally.</para>
/// </summary>
public sealed partial class CatalogEndpointsTests
{
    // ── Official (public) modules: admin-only; the admin list shows every owner ──

    [Fact]
    public async Task Public_modules_are_admin_only_and_every_student_sees_a_published_one()
    {
        var teacherId = Guid.NewGuid();
        var adminId = Guid.NewGuid();
        var loneStudentId = Guid.NewGuid();            // no teacher, no group: sees official modules only
        var blockIds = new List<Guid>();

        await using (var ctx = CreateContext())
        {
            ctx.Users.Add(Named(NewUser(teacherId, $"pub-t-{teacherId:N}@example.test", UserRole.Teacher, null), "Ustoz Karimov"));
            ctx.Users.Add(Named(NewUser(adminId, $"pub-a-{adminId:N}@example.test", UserRole.Admin, null), "Admin Rahimova"));
            ctx.Users.Add(NewUser(loneStudentId, $"pub-s-{loneStudentId:N}@example.test", UserRole.Student, null));
            await ctx.SaveChangesAsync();
        }

        try
        {
            var client = _factory.CreateClient();
            var tokenT = AuthToken(teacherId);
            var tokenA = AuthToken(adminId);

            // ── A teacher cannot CREATE a public module: 403 with a code, and nothing is written ──
            var refused = await Api(client, HttpMethod.Post, "/api/blocks", tokenT, Body(new { name = "Rasmiy?", visibility = "public" }));
            Assert.Equal(HttpStatusCode.Forbidden, refused.StatusCode);
            Assert.Equal("public_requires_admin", (await ReadJson(refused)).GetProperty("code").GetString());
            await using (var ctx = CreateContext())
                Assert.Equal(0, await ctx.QuestionBlocks.CountAsync(b => b.TeacherId == teacherId));

            // ── ...nor PATCH one to public; group/private still work as before ──
            var own = await ReadJson(await Api(client, HttpMethod.Post, "/api/blocks", tokenT, Body(new { name = "O'z moduli" })));
            var ownId = own.GetProperty("id").GetGuid();
            blockIds.Add(ownId);
            Assert.Equal("group", own.GetProperty("visibility").GetString());
            Assert.Equal("Ustoz Karimov", own.GetProperty("owner_name").GetString());

            var patchRefused = await Api(client, HttpMethod.Patch, $"/api/blocks/{ownId}", tokenT, Body(new { visibility = "public" }));
            Assert.Equal(HttpStatusCode.Forbidden, patchRefused.StatusCode);
            Assert.Equal("public_requires_admin", (await ReadJson(patchRefused)).GetProperty("code").GetString());
            var toPrivate = await ReadJson(await Api(client, HttpMethod.Patch, $"/api/blocks/{ownId}", tokenT, Body(new { visibility = "private" })));
            Assert.Equal("private", toPrivate.GetProperty("visibility").GetString());

            // ── An admin creates an official module ──
            var official = await Api(client, HttpMethod.Post, "/api/blocks", tokenA,
                Body(new { name = "Rasmiy: Salomlashish", visibility = "public", level = "A1" }));
            Assert.Equal(HttpStatusCode.Created, official.StatusCode);
            var officialBody = await ReadJson(official);
            var officialId = officialBody.GetProperty("id").GetGuid();
            blockIds.Add(officialId);
            Assert.Equal("public", officialBody.GetProperty("visibility").GetString());
            Assert.Equal("Admin Rahimova", officialBody.GetProperty("owner_name").GetString());

            // ── The admin's list is EVERY module, each with its owner; the teacher's is their own ──
            var adminList = (await ReadJson(await Api(client, HttpMethod.Get, "/api/blocks", tokenA)))
                .EnumerateArray().ToDictionary(b => b.GetProperty("id").GetGuid());
            Assert.Equal("Ustoz Karimov", adminList[ownId].GetProperty("owner_name").GetString());
            Assert.Equal("private", adminList[ownId].GetProperty("visibility").GetString());
            Assert.Equal("Admin Rahimova", adminList[officialId].GetProperty("owner_name").GetString());
            Assert.Equal("public", adminList[officialId].GetProperty("visibility").GetString());
            var teacherList = (await ReadJson(await Api(client, HttpMethod.Get, "/api/blocks", tokenT)))
                .EnumerateArray().Select(b => b.GetProperty("id").GetGuid()).ToList();
            Assert.Contains(ownId, teacherList);
            Assert.DoesNotContain(officialId, teacherList);

            // ── An admin may promote a teacher's module to official ──
            var promoted = await ReadJson(await Api(client, HttpMethod.Patch, $"/api/blocks/{ownId}", tokenA, Body(new { visibility = "public" })));
            Assert.Equal("public", promoted.GetProperty("visibility").GetString());
            Assert.Equal("Ustoz Karimov", promoted.GetProperty("owner_name").GetString());   // still theirs

            // ── End to end: a task + publish → a student with NO teacher now sees the official module ──
            Assert.DoesNotContain(await StudentModuleIds(client, AuthToken(loneStudentId)), id => id == officialId);
            Assert.Equal(HttpStatusCode.Created, (await Api(client, HttpMethod.Post, "/api/questions", tokenA,
                Body(new { title = "Tanishuv", prompt_text = "Представьтесь.", block_id = officialId }))).StatusCode);
            Assert.Equal(HttpStatusCode.OK,
                (await Api(client, HttpMethod.Patch, $"/api/blocks/{officialId}", tokenA, Body(new { is_published = true }))).StatusCode);
            var seen = (await StudentModules(client, AuthToken(loneStudentId))).Single(m => m.GetProperty("id").GetGuid() == officialId);
            Assert.Equal("public", seen.GetProperty("visibility").GetString());
            Assert.Equal(1, seen.GetProperty("total").GetInt32());
        }
        finally
        {
            await using var ctx = CreateContext();
            await ctx.Questions.Where(q => q.BlockId != null && blockIds.Contains(q.BlockId.Value)).ExecuteDeleteAsync();
            await ctx.QuestionBlocks.Where(b => blockIds.Contains(b.Id)).ExecuteDeleteAsync();
            await ctx.Users.Where(u => u.Id == teacherId || u.Id == adminId || u.Id == loneStudentId).ExecuteDeleteAsync();
        }
    }

    // ── Publishing cascade ───────────────────────────────────────────────────

    [Fact]
    public async Task Publishing_a_module_publishes_its_draft_tasks_and_the_student_then_sees_it()
    {
        var teacherId = Guid.NewGuid();
        var studentId = Guid.NewGuid();
        var groupId = Guid.NewGuid();
        Guid blockId = Guid.Empty;

        await using (var ctx = CreateContext())
        {
            ctx.Users.Add(NewUser(teacherId, $"pc-t-{teacherId:N}@example.test", UserRole.Teacher, null));
            ctx.Users.Add(NewUser(studentId, $"pc-s-{studentId:N}@example.test", UserRole.Student, null));
            await ctx.SaveChangesAsync();
            await AddGroupAsync(ctx, groupId, teacherId, studentId);
        }

        try
        {
            var client = _factory.CreateClient();
            var tokenT = AuthToken(teacherId);
            var tokenS = AuthToken(studentId);

            blockId = (await ReadJson(await Api(client, HttpMethod.Post, "/api/blocks", tokenT, Body(new { name = "Nashr sinovi" }))))
                .GetProperty("id").GetGuid();

            // Rule 1 · a task created inside a DRAFT module inherits draft.
            async Task<JsonElement> NewTask(string title)
                => await ReadJson(await Api(client, HttpMethod.Post, "/api/questions", tokenT,
                    Body(new { title, prompt_text = "Расскажите о себе.", block_id = blockId })));
            var t1 = await NewTask("Birinchi");
            var t2 = await NewTask("Ikkinchi");
            Assert.False(t1.GetProperty("is_published").GetBoolean());
            Assert.False(t2.GetProperty("is_published").GetBoolean());
            Assert.DoesNotContain(await StudentModuleIds(client, tokenS), id => id == blockId);

            // Rule 2 · false → true publishes every draft task in the SAME save.
            var published = await ReadJson(await Api(client, HttpMethod.Patch, $"/api/blocks/{blockId}", tokenT, Body(new { is_published = true })));
            Assert.True(published.GetProperty("is_published").GetBoolean());
            Assert.All(published.GetProperty("tasks").EnumerateArray(), t => Assert.True(t.GetProperty("is_published").GetBoolean()));

            // ...and the student now actually sees the module, with both tasks.
            Assert.Equal(2, (await StudentModule(client, tokenS, blockId)).GetProperty("total").GetInt32());

            // Rule 1 again · a task created inside a PUBLISHED module is live at once.
            var t3 = await NewTask("Uchinchi");
            Assert.True(t3.GetProperty("is_published").GetBoolean());
            Assert.Equal(3, (await StudentModule(client, tokenS, blockId)).GetProperty("total").GetInt32());

            // The per-task toggle still works inside a live module.
            var t3Id = t3.GetProperty("id").GetGuid();
            Assert.Equal(HttpStatusCode.OK,
                (await Api(client, HttpMethod.Patch, $"/api/questions/{t3Id}", tokenT, Body(new { is_published = false }))).StatusCode);
            Assert.Equal(2, (await StudentModule(client, tokenS, blockId)).GetProperty("total").GetInt32());

            // Rule 3 · unpublishing the module does NOT touch the tasks' own flags; the module
            // flag alone hides them.
            Assert.Equal(HttpStatusCode.OK,
                (await Api(client, HttpMethod.Patch, $"/api/blocks/{blockId}", tokenT, Body(new { is_published = false }))).StatusCode);
            await using (var ctx = CreateContext())
            {
                var flags = await ctx.Questions.Where(q => q.BlockId == blockId)
                    .ToDictionaryAsync(q => q.Id, q => q.IsPublished);
                Assert.True(flags[t1.GetProperty("id").GetGuid()]);
                Assert.True(flags[t2.GetProperty("id").GetGuid()]);
                Assert.False(flags[t3Id]);
            }
            Assert.DoesNotContain(await StudentModuleIds(client, tokenS), id => id == blockId);

            // Re-publishing is a false → true edge again, so the draft task goes live with it.
            Assert.Equal(HttpStatusCode.OK,
                (await Api(client, HttpMethod.Patch, $"/api/blocks/{blockId}", tokenT, Body(new { is_published = true }))).StatusCode);
            Assert.Equal(3, (await StudentModule(client, tokenS, blockId)).GetProperty("total").GetInt32());
        }
        finally
        {
            await using var ctx = CreateContext();
            await ctx.Questions.Where(q => q.TeacherId == teacherId).ExecuteDeleteAsync();
            await ctx.QuestionBlocks.Where(b => b.TeacherId == teacherId).ExecuteDeleteAsync();
            await ctx.GroupMembers.Where(m => m.GroupId == groupId).ExecuteDeleteAsync();
            await ctx.Groups.Where(g => g.Id == groupId).ExecuteDeleteAsync();
            await ctx.Users.Where(u => u.Id == teacherId || u.Id == studentId).ExecuteDeleteAsync();
        }
    }

    // ── DELETE /api/questions/{id} ───────────────────────────────────────────

    [Fact]
    public async Task Deleting_a_task_hides_it_everywhere_and_keeps_the_students_history()
    {
        var teacherId = Guid.NewGuid();
        var otherTeacherId = Guid.NewGuid();
        var adminId = Guid.NewGuid();
        var studentId = Guid.NewGuid();
        var groupId = Guid.NewGuid();
        var blockId = Guid.NewGuid();
        var q1 = Guid.NewGuid();
        var q2 = Guid.NewGuid();
        var submission = NewDoneSubmission(studentId, q1, durationSec: 30);
        var assignmentId = Guid.NewGuid();

        await using (var ctx = CreateContext())
        {
            ctx.Users.Add(NewUser(teacherId, $"dq-t-{teacherId:N}@example.test", UserRole.Teacher, null));
            ctx.Users.Add(NewUser(otherTeacherId, $"dq-o-{otherTeacherId:N}@example.test", UserRole.Teacher, null));
            ctx.Users.Add(NewUser(adminId, $"dq-a-{adminId:N}@example.test", UserRole.Admin, null));
            ctx.Users.Add(NewUser(studentId, $"dq-s-{studentId:N}@example.test", UserRole.Student, null));
            await ctx.SaveChangesAsync();
            await AddGroupAsync(ctx, groupId, teacherId, studentId);
            ctx.QuestionBlocks.Add(NewBlock(blockId, teacherId, "group"));
            ctx.Questions.Add(NewQuestion(q1, teacherId, blockId, sortOrder: 0));
            ctx.Questions.Add(NewQuestion(q2, teacherId, blockId, sortOrder: 1));
            ctx.Submissions.Add(submission);
            ctx.Evaluations.Add(NewEvaluation(submission.Id, 72));
            ctx.Assignments.Add(new Assignment
            {
                Id = assignmentId, TeacherId = teacherId, StudentId = studentId, QuestionId = q1, GroupId = groupId,
                CreatedAt = DateTime.UtcNow.AddMinutes(-5), UpdatedAt = DateTime.UtcNow,
            });
            await ctx.SaveChangesAsync();
        }

        try
        {
            var client = _factory.CreateClient();
            var tokenT = AuthToken(teacherId);
            var tokenS = AuthToken(studentId);
            var path = $"/api/questions/{q1}";

            // ── RBAC: anonymous 401 · student 403 · another teacher 404 (not 403) ──
            Assert.Equal(HttpStatusCode.Unauthorized, (await client.DeleteAsync(path)).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await Api(client, HttpMethod.Delete, path, tokenS)).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, (await Api(client, HttpMethod.Delete, path, AuthToken(otherTeacherId))).StatusCode);
            await using (var ctx = CreateContext())
                Assert.False((await ctx.Questions.AsNoTracking().SingleAsync(q => q.Id == q1)).IsDeleted);

            // ── The owner deletes it → 204, and it is a SOFT delete ──
            Assert.Equal(HttpStatusCode.NoContent, (await Api(client, HttpMethod.Delete, path, tokenT)).StatusCode);
            await using (var ctx = CreateContext())
            {
                var row = await ctx.Questions.AsNoTracking().SingleAsync(q => q.Id == q1);
                Assert.True(row.IsDeleted);
                Assert.False(row.IsPublished);
                Assert.Equal(blockId, row.BlockId);                       // lineage kept
                // The student's attempt and its grade are untouched.
                Assert.True(await ctx.Submissions.AnyAsync(s => s.Id == submission.Id));
                Assert.True(await ctx.Evaluations.AnyAsync(e => e.SubmissionId == submission.Id));
                Assert.True(await ctx.Assignments.AnyAsync(a => a.Id == assignmentId));
            }

            // ── Gone from every catalog listing ──
            var library = (await ReadJson(await Api(client, HttpMethod.Get, "/api/questions", tokenT)))
                .EnumerateArray().Select(x => x.GetProperty("id").GetGuid()).ToList();
            Assert.DoesNotContain(q1, library);
            Assert.Contains(q2, library);
            var editor = await ReadJson(await Api(client, HttpMethod.Get, $"/api/blocks/{blockId}", tokenT));
            Assert.Equal(1, editor.GetProperty("task_count").GetInt32());
            Assert.DoesNotContain(editor.GetProperty("tasks").EnumerateArray(), t => t.GetProperty("id").GetGuid() == q1);
            var module = await StudentModule(client, tokenS, blockId);
            Assert.Equal(new[] { q2 }, module.GetProperty("tasks").EnumerateArray().Select(t => t.GetProperty("id").GetGuid()));

            // ── The student's assignment list still renders the (now deleted) task's assignment ──
            var mine = await Api(client, HttpMethod.Get, "/api/assignments/mine", tokenS);
            Assert.Equal(HttpStatusCode.OK, mine.StatusCode);
            var assignment = (await ReadJson(mine)).EnumerateArray().Single(a => a.GetProperty("id").GetGuid() == assignmentId);
            Assert.Equal("Task 0", assignment.GetProperty("question_title").GetString());

            // ── Already deleted = does not exist: 404 on a second delete and on edit ──
            Assert.Equal(HttpStatusCode.NotFound, (await Api(client, HttpMethod.Delete, path, tokenT)).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound,
                (await Api(client, HttpMethod.Patch, path, tokenT, Body(new { title = "revive" }))).StatusCode);

            // ── An admin may delete any teacher's task; the module, now empty, leaves the student view ──
            Assert.Equal(HttpStatusCode.NoContent, (await Api(client, HttpMethod.Delete, $"/api/questions/{q2}", AuthToken(adminId))).StatusCode);
            Assert.DoesNotContain(await StudentModuleIds(client, tokenS), id => id == blockId);
        }
        finally
        {
            await using var ctx = CreateContext();
            await ctx.Assignments.Where(a => a.Id == assignmentId).ExecuteDeleteAsync();
            await ctx.Evaluations.Where(e => e.SubmissionId == submission.Id).ExecuteDeleteAsync();
            await ctx.Submissions.Where(s => s.StudentId == studentId).ExecuteDeleteAsync();
            await ctx.Questions.Where(q => q.Id == q1 || q.Id == q2).ExecuteDeleteAsync();
            await ctx.QuestionBlocks.Where(b => b.Id == blockId).ExecuteDeleteAsync();
            await ctx.GroupMembers.Where(m => m.GroupId == groupId).ExecuteDeleteAsync();
            await ctx.Groups.Where(g => g.Id == groupId).ExecuteDeleteAsync();
            await ctx.Users.Where(u => u.Id == teacherId || u.Id == otherTeacherId || u.Id == adminId || u.Id == studentId)
                .ExecuteDeleteAsync();
        }
    }

    // ── DELETE /api/blocks/{id} ──────────────────────────────────────────────

    [Fact]
    public async Task Deleting_a_module_soft_deletes_its_tasks_removes_the_row_and_keeps_the_history()
    {
        var teacherId = Guid.NewGuid();
        var otherTeacherId = Guid.NewGuid();
        var adminId = Guid.NewGuid();
        var studentId = Guid.NewGuid();
        var groupId = Guid.NewGuid();
        var blockId = Guid.NewGuid();
        var secondBlockId = Guid.NewGuid();
        var q1 = Guid.NewGuid();
        var q2 = Guid.NewGuid();
        var alreadyDeleted = Guid.NewGuid();
        var submission = NewDoneSubmission(studentId, q1, durationSec: 40);

        await using (var ctx = CreateContext())
        {
            ctx.Users.Add(NewUser(teacherId, $"db-t-{teacherId:N}@example.test", UserRole.Teacher, null));
            ctx.Users.Add(NewUser(otherTeacherId, $"db-o-{otherTeacherId:N}@example.test", UserRole.Teacher, null));
            ctx.Users.Add(NewUser(adminId, $"db-a-{adminId:N}@example.test", UserRole.Admin, null));
            ctx.Users.Add(NewUser(studentId, $"db-s-{studentId:N}@example.test", UserRole.Student, null));
            await ctx.SaveChangesAsync();
            await AddGroupAsync(ctx, groupId, teacherId, studentId);
            ctx.QuestionBlocks.Add(NewBlock(blockId, teacherId, "group"));
            ctx.QuestionBlocks.Add(NewBlock(secondBlockId, teacherId, "group"));
            ctx.Questions.Add(NewQuestion(q1, teacherId, blockId, sortOrder: 0));
            ctx.Questions.Add(NewQuestion(q2, teacherId, blockId, sortOrder: 1));
            var gone = NewQuestion(alreadyDeleted, teacherId, blockId, sortOrder: 2);
            gone.IsDeleted = true;
            gone.IsPublished = false;
            ctx.Questions.Add(gone);
            ctx.Submissions.Add(submission);
            ctx.Evaluations.Add(NewEvaluation(submission.Id, 64));
            await ctx.SaveChangesAsync();
        }

        try
        {
            var client = _factory.CreateClient();
            var tokenT = AuthToken(teacherId);
            var tokenS = AuthToken(studentId);
            var path = $"/api/blocks/{blockId}";
            Assert.Contains(await StudentModuleIds(client, tokenS), id => id == blockId);

            // ── RBAC: anonymous 401 · student 403 · another teacher 404 (not 403) ──
            Assert.Equal(HttpStatusCode.Unauthorized, (await client.DeleteAsync(path)).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await Api(client, HttpMethod.Delete, path, tokenS)).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, (await Api(client, HttpMethod.Delete, path, AuthToken(otherTeacherId))).StatusCode);
            await using (var ctx = CreateContext())
                Assert.True(await ctx.QuestionBlocks.AnyAsync(b => b.Id == blockId));

            // ── The owner deletes it → 204 ──
            Assert.Equal(HttpStatusCode.NoContent, (await Api(client, HttpMethod.Delete, path, tokenT)).StatusCode);
            await using (var ctx = CreateContext())
            {
                // The module row is gone...
                Assert.False(await ctx.QuestionBlocks.AnyAsync(b => b.Id == blockId));
                // ...its tasks survive, soft-deleted and detached by the FK's SET NULL (including the
                // one that was already deleted and never loaded)...
                var tasks = await ctx.Questions.AsNoTracking()
                    .Where(q => q.Id == q1 || q.Id == q2 || q.Id == alreadyDeleted).ToListAsync();
                Assert.Equal(3, tasks.Count);
                Assert.All(tasks, q =>
                {
                    Assert.True(q.IsDeleted);
                    Assert.False(q.IsPublished);
                    Assert.Null(q.BlockId);
                });
                // ...and the student's attempt and grade are untouched.
                Assert.True(await ctx.Submissions.AnyAsync(s => s.Id == submission.Id && s.QuestionId == q1));
                Assert.True(await ctx.Evaluations.AnyAsync(e => e.SubmissionId == submission.Id));
            }

            // ── Gone from the teacher's lists and the student's view ──
            Assert.DoesNotContain((await ReadJson(await Api(client, HttpMethod.Get, "/api/blocks", tokenT)))
                .EnumerateArray(), b => b.GetProperty("id").GetGuid() == blockId);
            Assert.Equal(HttpStatusCode.NotFound, (await Api(client, HttpMethod.Get, path, tokenT)).StatusCode);
            var library = (await ReadJson(await Api(client, HttpMethod.Get, "/api/questions", tokenT)))
                .EnumerateArray().Select(x => x.GetProperty("id").GetGuid()).ToList();
            Assert.DoesNotContain(q1, library);
            Assert.DoesNotContain(q2, library);
            Assert.DoesNotContain(await StudentModuleIds(client, tokenS), id => id == blockId);
            Assert.Equal(HttpStatusCode.NotFound, (await Api(client, HttpMethod.Delete, path, tokenT)).StatusCode);

            // ── An admin may delete any teacher's module ──
            Assert.Equal(HttpStatusCode.NoContent,
                (await Api(client, HttpMethod.Delete, $"/api/blocks/{secondBlockId}", AuthToken(adminId))).StatusCode);
            await using (var ctx = CreateContext())
                Assert.False(await ctx.QuestionBlocks.AnyAsync(b => b.Id == secondBlockId));
        }
        finally
        {
            await using var ctx = CreateContext();
            await ctx.Evaluations.Where(e => e.SubmissionId == submission.Id).ExecuteDeleteAsync();
            await ctx.Submissions.Where(s => s.StudentId == studentId).ExecuteDeleteAsync();
            await ctx.Questions.Where(q => q.Id == q1 || q.Id == q2 || q.Id == alreadyDeleted).ExecuteDeleteAsync();
            await ctx.QuestionBlocks.Where(b => b.Id == blockId || b.Id == secondBlockId).ExecuteDeleteAsync();
            await ctx.GroupMembers.Where(m => m.GroupId == groupId).ExecuteDeleteAsync();
            await ctx.Groups.Where(g => g.Id == groupId).ExecuteDeleteAsync();
            await ctx.Users.Where(u => u.Id == teacherId || u.Id == otherTeacherId || u.Id == adminId || u.Id == studentId)
                .ExecuteDeleteAsync();
        }
    }

    // ── The student's task carries the prompt it is graded against ───────────

    [Fact]
    public async Task Student_task_carries_prompt_instruction_media_and_limits_only_when_unlocked()
    {
        var teacherId = Guid.NewGuid();
        var studentId = Guid.NewGuid();
        var groupId = Guid.NewGuid();
        var groupBlockId = Guid.NewGuid();
        var publicBlockId = Guid.NewGuid();
        var g = Enumerable.Range(0, 2).Select(_ => Guid.NewGuid()).ToArray();
        var p = Enumerable.Range(0, 4).Select(_ => Guid.NewGuid()).ToArray();

        await using (var ctx = CreateContext())
        {
            ctx.Users.Add(NewUser(teacherId, $"stc-t-{teacherId:N}@example.test", UserRole.Teacher, null));
            ctx.Users.Add(NewUser(studentId, $"stc-s-{studentId:N}@example.test", UserRole.Student, null));
            await ctx.SaveChangesAsync();
            await AddGroupAsync(ctx, groupId, teacherId, studentId);
            ctx.QuestionBlocks.Add(NewBlock(groupBlockId, teacherId, "group"));
            ctx.QuestionBlocks.Add(NewBlock(publicBlockId, teacherId, "public"));

            // g0: open (first task), with everything the task screen needs.
            var open = NewQuestion(g[0], teacherId, groupBlockId, sortOrder: 0);
            open.PromptText = "Посчитайте вслух от одного до десяти.";
            open.InstructionText = "Sekin va aniq gapiring.";
            open.ModelAnswerText = "Один, два, три…";
            open.MediaKey = "questions/numbers.png";
            open.PrepTimeSec = 15;
            open.AnswerTimeLimitSec = 90;
            ctx.Questions.Add(open);

            // g1: SEQUENTIALLY locked (g0 is not done), with media of its own.
            var seqLocked = NewQuestion(g[1], teacherId, groupBlockId, sortOrder: 1);
            seqLocked.PromptText = "Секрет, который нельзя показывать.";
            seqLocked.InstructionText = "Yashirin.";
            seqLocked.MediaKey = "questions/clip.mp4";
            seqLocked.PrepTimeSec = 20;
            seqLocked.AnswerTimeLimitSec = 60;
            ctx.Questions.Add(seqLocked);

            // Public module: p0..p2 done (the free preview), p3 PREMIUM-locked but not sequentially.
            for (var i = 0; i < p.Length; i++)
            {
                var q = NewQuestion(p[i], teacherId, publicBlockId, sortOrder: i);
                q.PromptText = $"Public prompt {i}";
                q.InstructionText = $"Public instruction {i}";
                ctx.Questions.Add(q);
            }
            ctx.Submissions.AddRange(
                NewDoneSubmission(studentId, p[0]), NewDoneSubmission(studentId, p[1]), NewDoneSubmission(studentId, p[2]));
            await ctx.SaveChangesAsync();
        }

        try
        {
            var client = _factory.CreateClient();
            var modules = await StudentModules(client, AuthToken(studentId));
            var gTasks = TasksById(modules.Single(m => m.GetProperty("id").GetGuid() == groupBlockId));
            var pTasks = TasksById(modules.Single(m => m.GetProperty("id").GetGuid() == publicBlockId));

            // ── Unlocked: the prompt, the instruction, a presigned media url + its kind, the limits ──
            var t = gTasks[g[0]];
            AssertTask(t, done: false, locked: false, premium: false);
            Assert.Equal("Посчитайте вслух от одного до десяти.", t.GetProperty("prompt_text").GetString());
            Assert.Equal("Sekin va aniq gapiring.", t.GetProperty("instruction_text").GetString());
            var mediaUrl = t.GetProperty("media_url").GetString();
            Assert.False(string.IsNullOrEmpty(mediaUrl));
            Assert.Contains("numbers.png", mediaUrl);                       // presigned for THAT object
            // A signed absolute GET url (the signature rides in the query), never the bare storage key.
            Assert.True(Uri.TryCreate(mediaUrl, UriKind.Absolute, out var signed));
            Assert.False(string.IsNullOrEmpty(signed!.Query));
            Assert.Equal("image", t.GetProperty("media_type").GetString());
            Assert.Equal(15, t.GetProperty("prep_time_sec").GetInt32());
            Assert.Equal(90, t.GetProperty("answer_time_limit_sec").GetInt32());
            // The model answer is revealed only after an attempt — never here.
            Assert.False(t.TryGetProperty("model_answer_text", out _));

            // ── Sequentially locked: the teaser only; nothing to answer from ──
            AssertContentHidden(gTasks[g[1]], locked: true, premium: false);
            Assert.Equal(20, gTasks[g[1]].GetProperty("prep_time_sec").GetInt32());   // limits are not content
            Assert.Equal(60, gTasks[g[1]].GetProperty("answer_time_limit_sec").GetInt32());

            // ── Premium-locked (but not sequentially): hidden as well ──
            AssertContentHidden(pTasks[p[3]], locked: false, premium: true);

            // ── A done, free task shows its content; a task without media has null media fields ──
            var free = pTasks[p[0]];
            AssertTask(free, done: true, locked: false, premium: false);
            Assert.Equal("Public prompt 0", free.GetProperty("prompt_text").GetString());
            Assert.Equal("Public instruction 0", free.GetProperty("instruction_text").GetString());
            Assert.Equal(JsonValueKind.Null, free.GetProperty("media_url").ValueKind);
            Assert.Equal(JsonValueKind.Null, free.GetProperty("media_type").ValueKind);
        }
        finally
        {
            await using var ctx = CreateContext();
            await ctx.Submissions.Where(s => s.StudentId == studentId).ExecuteDeleteAsync();
            await ctx.Questions.Where(q => q.BlockId == groupBlockId || q.BlockId == publicBlockId).ExecuteDeleteAsync();
            await ctx.QuestionBlocks.Where(b => b.Id == groupBlockId || b.Id == publicBlockId).ExecuteDeleteAsync();
            await ctx.GroupMembers.Where(m => m.GroupId == groupId).ExecuteDeleteAsync();
            await ctx.Groups.Where(gr => gr.Id == groupId).ExecuteDeleteAsync();
            await ctx.Users.Where(u => u.Id == teacherId || u.Id == studentId).ExecuteDeleteAsync();
        }
    }

    // ── helpers (lifecycle tests) ────────────────────────────────────────────

    private static void AssertContentHidden(JsonElement task, bool locked, bool premium)
    {
        Assert.Equal(locked, task.GetProperty("locked").GetBoolean());
        Assert.Equal(premium, task.GetProperty("premium_locked").GetBoolean());
        Assert.False(string.IsNullOrEmpty(task.GetProperty("title").GetString()));      // the teaser stays
        foreach (var field in new[] { "prompt_text", "instruction_text", "media_url", "media_type" })
            Assert.Equal(JsonValueKind.Null, task.GetProperty(field).ValueKind);
    }

    private static User Named(User user, string fullName)
    {
        user.FullName = fullName;
        return user;
    }

    private static async Task AddGroupAsync(Govori.Infrastructure.GovoriDbContext ctx, Guid groupId, Guid teacherId, Guid studentId)
    {
        ctx.Groups.Add(new Group
        {
            Id = groupId,
            TeacherId = teacherId,
            Name = "Lifecycle grp",
            JoinCode = $"LC{groupId:N}".ToUpperInvariant()[..10],
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
        });
        await ctx.SaveChangesAsync();
        ctx.GroupMembers.Add(new GroupMember
        {
            Id = Guid.NewGuid(),
            GroupId = groupId,
            StudentId = studentId,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
        });
        await ctx.SaveChangesAsync();
    }

    private static async Task<List<JsonElement>> StudentModules(HttpClient client, string token)
    {
        var resp = await Api(client, HttpMethod.Get, "/api/blocks/student", token);
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        return (await ReadJson(resp)).EnumerateArray().ToList();
    }

    private static async Task<List<Guid>> StudentModuleIds(HttpClient client, string token)
        => (await StudentModules(client, token)).Select(m => m.GetProperty("id").GetGuid()).ToList();

    private static async Task<JsonElement> StudentModule(HttpClient client, string token, Guid blockId)
        => (await StudentModules(client, token)).Single(m => m.GetProperty("id").GetGuid() == blockId);

    private static async Task<JsonElement> ReadJson(HttpResponseMessage resp)
    {
        using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
        return doc.RootElement.Clone();
    }
}
