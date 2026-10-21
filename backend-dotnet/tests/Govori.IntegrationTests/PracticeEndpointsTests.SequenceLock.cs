using System.Net;
using System.Text.Json;
using Govori.Infrastructure.Entities;
using Govori.Platform.Storage;
using Microsoft.EntityFrameworkCore;

namespace Govori.IntegrationTests;

/// <summary>
/// The module order is enforced at submit, not only drawn by the module view. A partial of
/// <see cref="PracticeEndpointsTests"/> for the same reason as the assignment-unlock suite: it
/// submits for real and must not boot a second WebApplicationFactory.
///
/// <para>The rule under test: a student's answer to a task whose predecessor they have not answered
/// is a 403 that writes nothing. Any non-failed answer to the predecessor opens it (grading runs
/// off-request, so "graded" would race the next tap); a failed one does not. A live assignment for
/// the task opens it regardless, exactly as it does in the view.</para>
/// </summary>
public sealed partial class PracticeEndpointsTests
{
    [Fact]
    public async Task Submit_refuses_a_task_whose_predecessor_is_unanswered()
    {
        var authorId = Guid.NewGuid();
        var teacherId = Guid.NewGuid();
        var studentId = Guid.NewGuid();     // free, inside the free preview the whole time
        var groupId = Guid.NewGuid();
        var blockId = Guid.NewGuid();
        var userIds = new[] { authorId, teacherId, studentId };

        // Three tasks — all inside the default free preview, so the 402 never gets in the way and
        // every refusal below is the sequence lock alone.
        var q = Enumerable.Range(0, 3).Select(_ => Guid.NewGuid()).ToArray();

        using var storage = new MinioObjectStorage(BuildStorageOptions());
        var uploadedKeys = new List<string>();

        await using (var ctx = CreateContext())
        {
            ctx.Users.Add(NewUser(authorId, $"seq-a-{authorId:N}@example.test", UserRole.Admin, null, premium: false));
            ctx.Users.Add(NewUser(teacherId, $"seq-t-{teacherId:N}@example.test", UserRole.Teacher, null, premium: false));
            ctx.Users.Add(NewUser(studentId, $"seq-s-{studentId:N}@example.test", UserRole.Student, null, premium: false));
            ctx.Groups.Add(new Group
            {
                Id = groupId, TeacherId = teacherId, Name = "Seq guruh",
                JoinCode = $"SQ{groupId:N}".ToUpperInvariant()[..10],
                CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow,
            });
            ctx.QuestionBlocks.Add(NewBlock(blockId, authorId, "public"));
            for (var i = 0; i < q.Length; i++)
                ctx.Questions.Add(NewQuestion(q[i], authorId, blockId, sortOrder: i));
            await ctx.SaveChangesAsync();
            ctx.GroupMembers.Add(new GroupMember
            {
                Id = Guid.NewGuid(), GroupId = groupId, StudentId = studentId,
                CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow,
            });
            await ctx.SaveChangesAsync();
        }

        try
        {
            var client = _factory.CreateClient();
            var studentToken = TokenFor(studentId);

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

            // ── Skipping ahead is refused, says why, and stores nothing ──
            var skipped = await SubmitTo(q[1]);
            Assert.Equal(HttpStatusCode.Forbidden, skipped.StatusCode);
            Assert.Contains("previous task", await skipped.Content.ReadAsStringAsync());
            await using (var ctx = CreateContext())
                Assert.Equal(0, await ctx.Submissions.CountAsync(s => s.StudentId == studentId));

            // ── The first task is always open; answering it opens the next, before it is graded ──
            Assert.Equal(HttpStatusCode.Created, (await SubmitTo(q[0])).StatusCode);
            Assert.Equal(HttpStatusCode.Created, (await SubmitTo(q[1])).StatusCode);

            // ── A predecessor answer whose grading FAILED does not count ──
            await using (var ctx = CreateContext())
                await ctx.Submissions
                    .Where(s => s.StudentId == studentId && s.QuestionId == q[1])
                    .ExecuteUpdateAsync(set => set.SetProperty(s => s.Status, SubmissionStatus.Failed));
            Assert.Equal(HttpStatusCode.Forbidden, (await SubmitTo(q[2])).StatusCode);

            // ── A live assignment opens its task out of order, as it does in the module view ──
            var assign = await Send(client, HttpMethod.Post, "/api/assignments", TokenFor(teacherId),
                System.Net.Http.Json.JsonContent.Create(new { question_id = q[2], student_ids = new[] { studentId } }));
            Assert.Equal(HttpStatusCode.Created, assign.StatusCode);
            Assert.Equal(HttpStatusCode.Created, (await SubmitTo(q[2])).StatusCode);
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
    }
}
