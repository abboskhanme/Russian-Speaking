using System.Net;
using System.Text.Json;
using Govori.Infrastructure.Entities;
using Govori.Platform.Storage;
using Microsoft.EntityFrameworkCore;

namespace Govori.IntegrationTests;

/// <summary>
/// Homework from the official catalog must be doable. A partial of
/// <see cref="PracticeEndpointsTests"/> — it needs that host's in-process grading queue and MinIO
/// wiring to submit for real, and must not boot another WebApplicationFactory.
///
/// <para>The rule under test (<c>AssignmentAccess</c>): an OPEN assignment for a task unlocks THAT
/// task for THAT student — in the module view (neither <c>locked</c> nor <c>premium_locked</c>, its
/// content served) and at submit (no 402). Nothing else unlocks: the untouched neighbour still
/// 402s, and an assignment whose deadline has passed is not open, so it unlocks nothing.</para>
/// </summary>
public sealed partial class PracticeEndpointsTests
{
    [Fact]
    public async Task An_open_assignment_unlocks_its_official_task_past_the_free_preview_and_the_sequence()
    {
        var authorId = Guid.NewGuid();      // owns the official module (an admin)
        var teacherId = Guid.NewGuid();     // did not write it, teaches the student
        var studentId = Guid.NewGuid();     // free (non-premium), has done nothing yet
        var groupId = Guid.NewGuid();
        var blockId = Guid.NewGuid();
        var expiredAssignment = Guid.NewGuid();
        var userIds = new[] { authorId, teacherId, studentId };

        // Six tasks in one official module; free preview 3 ⇒ q[3..5] are premium-locked, and with
        // nothing done q[1..5] are sequence-locked too.
        var q = Enumerable.Range(0, 6).Select(_ => Guid.NewGuid()).ToArray();

        using var storage = new MinioObjectStorage(BuildStorageOptions());
        var uploadedKeys = new List<string>();

        await using (var ctx = CreateContext())
        {
            ctx.Users.Add(NewUser(authorId, $"unl-a-{authorId:N}@example.test", UserRole.Admin, null, premium: false));
            ctx.Users.Add(NewUser(teacherId, $"unl-t-{teacherId:N}@example.test", UserRole.Teacher, null, premium: false));
            ctx.Users.Add(NewUser(studentId, $"unl-s-{studentId:N}@example.test", UserRole.Student, null, premium: false));
            ctx.Groups.Add(new Group
            {
                Id = groupId, TeacherId = teacherId, Name = "Unlock guruh",
                JoinCode = $"UN{groupId:N}".ToUpperInvariant()[..10],
                CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow,
            });
            ctx.QuestionBlocks.Add(NewBlock(blockId, authorId, "public"));
            for (var i = 0; i < q.Length; i++)
            {
                var task = NewQuestion(q[i], authorId, blockId, sortOrder: i);
                task.PromptText = $"Prompt {i}";
                ctx.Questions.Add(task);
            }
            await ctx.SaveChangesAsync();
            ctx.GroupMembers.Add(new GroupMember
            {
                Id = Guid.NewGuid(), GroupId = groupId, StudentId = studentId,
                CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow,
            });
            // q[5] was assigned once, but its deadline has PASSED — not open, so it unlocks nothing.
            var expired = NewAssignment(expiredAssignment, teacherId, studentId, q[5], maxAttempts: null);
            expired.CreatedAt = DateTime.UtcNow.AddDays(-3);
            expired.DueAt = DateTime.UtcNow.AddDays(-1);
            ctx.Assignments.Add(expired);
            await ctx.SaveChangesAsync();
        }

        try
        {
            var client = _factory.CreateClient();
            var studentToken = TokenFor(studentId);

            async Task<Dictionary<Guid, JsonElement>> StudentTasks()
            {
                var resp = await Send(client, HttpMethod.Get, "/api/blocks/student", studentToken);
                Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
                using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
                return doc.RootElement.EnumerateArray()
                    .Single(m => m.GetProperty("id").GetGuid() == blockId)
                    .GetProperty("tasks").EnumerateArray()
                    .ToDictionary(t => t.GetProperty("id").GetGuid(), t => t.Clone());
            }

            async Task<HttpResponseMessage> SubmitTo(Guid questionId)
            {
                var resp = await Send(client, HttpMethod.Post, "/api/submissions", studentToken, BuildAudioForm(questionId));
                if (resp.StatusCode == HttpStatusCode.Created)
                {
                    using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
                    uploadedKeys.Add(doc.RootElement.GetProperty("audio_key").GetString()!);
                }
                return resp;
            }

            // ── Before: q[4] is behind BOTH locks, and shows no content ──
            var before = await StudentTasks();
            AssertLocks(before[q[4]], locked: true, premium: true);
            Assert.Equal(JsonValueKind.Null, before[q[4]].GetProperty("prompt_text").ValueKind);

            // ── The teacher (not the author) assigns official task q[4] to the student ──
            var assign = await Send(client, HttpMethod.Post, "/api/assignments", TokenFor(teacherId),
                JsonContent(new { question_id = q[4], student_ids = new[] { studentId } }));
            Assert.Equal(HttpStatusCode.Created, assign.StatusCode);
            Guid assignmentId;
            using (var doc = JsonDocument.Parse(await assign.Content.ReadAsStringAsync()))
                assignmentId = Assert.Single(doc.RootElement.EnumerateArray()).GetProperty("id").GetGuid();

            // ── After: q[4] is open to THIS student — neither lock, content served ──
            var after = await StudentTasks();
            AssertLocks(after[q[4]], locked: false, premium: false);
            Assert.Equal("Prompt 4", after[q[4]].GetProperty("prompt_text").GetString());
            // …and nothing else moved: the free first task, the sequence-locked free ones, the
            // untouched paid neighbour, and the task whose assignment has lapsed.
            AssertLocks(after[q[0]], locked: false, premium: false);
            AssertLocks(after[q[1]], locked: true, premium: false);
            AssertLocks(after[q[3]], locked: true, premium: true);
            AssertLocks(after[q[5]], locked: true, premium: true);
            Assert.Equal(JsonValueKind.Null, after[q[5]].GetProperty("prompt_text").ValueKind);

            // ── Submit agrees with the view: the neighbours still 402 and write nothing… ──
            Assert.Equal(HttpStatusCode.PaymentRequired, (await SubmitTo(q[3])).StatusCode);
            Assert.Equal(HttpStatusCode.PaymentRequired, (await SubmitTo(q[5])).StatusCode);
            await using (var ctx = CreateContext())
                Assert.Equal(0, await ctx.Submissions.CountAsync(s => s.StudentId == studentId));

            // ── …and the assigned task is accepted, attributed to its assignment ──
            var ok = await SubmitTo(q[4]);
            Assert.Equal(HttpStatusCode.Created, ok.StatusCode);
            await using (var ctx = CreateContext())
            {
                var row = await ctx.Submissions.SingleAsync(s => s.StudentId == studentId);
                Assert.Equal(q[4], row.QuestionId);
                Assert.Equal(assignmentId, row.AssignmentId);
            }

            // ── Answering does NOT re-lock it. The unlock is the LIVE assignment (deadline not
            // passed), the same rule that attributes answers — so a retry is a retry, not a 402. ──
            AssertLocks((await StudentTasks())[q[4]], locked: false, premium: false);
            Assert.Equal(HttpStatusCode.Created, (await SubmitTo(q[4])).StatusCode);

            // ── What bounds retries is the teacher's attempt budget, and running out of it is the
            // honest 403 "attempts used", never a paywall. ──
            await using (var ctx = CreateContext())
                await ctx.Assignments.Where(a => a.Id == assignmentId)
                    .ExecuteUpdateAsync(set => set.SetProperty(a => a.MaxAttempts, 2));
            var exhausted = await SubmitTo(q[4]);
            Assert.Equal(HttpStatusCode.Forbidden, exhausted.StatusCode);
            Assert.Contains("attempts", await exhausted.Content.ReadAsStringAsync());

            // ── An answer whose grading failed on OUR side costs nothing, so it can be redone. ──
            await using (var ctx = CreateContext())
            {
                var first = await ctx.Submissions.Where(s => s.StudentId == studentId)
                    .OrderBy(s => s.CreatedAt).FirstAsync();
                await ctx.Submissions.Where(s => s.Id == first.Id)
                    .ExecuteUpdateAsync(set => set.SetProperty(s => s.Status, SubmissionStatus.Failed));
            }
            Assert.Equal(HttpStatusCode.Created, (await SubmitTo(q[4])).StatusCode);
        }
        finally
        {
            foreach (var key in uploadedKeys)
                await storage.DeleteAsync(key);
            await using var ctx = CreateContext();
            await ctx.Submissions.Where(s => s.StudentId == studentId).ExecuteDeleteAsync();
            await ctx.Assignments.Where(a => a.StudentId == studentId).ExecuteDeleteAsync();
            await ctx.GroupMembers.Where(gm => gm.GroupId == groupId).ExecuteDeleteAsync();
            await ctx.Groups.Where(g => g.Id == groupId).ExecuteDeleteAsync();
            await ctx.Questions.Where(x => x.BlockId == blockId).ExecuteDeleteAsync();
            await ctx.QuestionBlocks.Where(b => b.Id == blockId).ExecuteDeleteAsync();
            await ctx.Users.Where(u => userIds.Contains(u.Id)).ExecuteDeleteAsync();
        }

        static void AssertLocks(JsonElement task, bool locked, bool premium)
        {
            Assert.Equal(locked, task.GetProperty("locked").GetBoolean());
            Assert.Equal(premium, task.GetProperty("premium_locked").GetBoolean());
        }

        // Property names AS WRITTEN (snake_case) — the API deserializes with a snake_case policy.
        static HttpContent JsonContent(object body) => System.Net.Http.Json.JsonContent.Create(body);
    }
}
