using System.Net;
using System.Text.Json;
using Govori.Contracts;
using Govori.Infrastructure.Entities;
using Govori.Platform.Ai;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Govori.IntegrationTests;

/// <summary>
/// <c>POST /api/submissions/{id}/regrade</c> — retrying a FAILED attempt's grading on the same row.
/// Proves: the owner (and an admin) can retry and the row goes back to <c>pending</c> with its
/// error cleared and NO new row; a second tap, a graded attempt and an expired recording are 409s
/// with their codes; somebody else's attempt is a 404; a regrade that would push an assignment past
/// its attempt budget is refused; a closed AI budget answers 503 and leaves the row failed.
/// (No AI provider is configured in this host, so the re-enqueued job defers and the row stays
/// pending — exactly the state a client sees right after the tap.)
/// </summary>
public sealed partial class PracticeEndpointsTests
{
    [Fact]
    public async Task Regrade_retries_a_failed_attempt_in_place_and_respects_budgets()
    {
        var teacherId = Guid.NewGuid();
        var adminId = Guid.NewGuid();
        var studentId = Guid.NewGuid();
        var otherId = Guid.NewGuid();
        var blockId = Guid.NewGuid();
        var q0 = Guid.NewGuid();
        var q1 = Guid.NewGuid();
        var assignmentId = Guid.NewGuid();

        var failed = Guid.NewGuid();          // ai_unavailable, plain module answer
        var done = Guid.NewGuid();            // graded
        var expired = Guid.NewGuid();         // failed, audio reclaimed, no transcript
        var capDone = Guid.NewGuid();         // assignment (max 1): the graded one
        var capFailed = Guid.NewGuid();       // assignment (max 1): the failed one
        var adminRetry = Guid.NewGuid();      // failed, retried by an admin
        var paused = Guid.NewGuid();          // failed, retried while the AI budget is closed

        await using (var ctx = CreateContext())
        {
            ctx.Users.Add(NewUser(teacherId, $"rg-t-{teacherId:N}@example.test", UserRole.Teacher, null, premium: false));
            ctx.Users.Add(NewUser(adminId, $"rg-a-{adminId:N}@example.test", UserRole.Admin, null, premium: false));
            ctx.Users.Add(NewUser(studentId, $"rg-s-{studentId:N}@example.test", UserRole.Student, null, premium: true));
            ctx.Users.Add(NewUser(otherId, $"rg-o-{otherId:N}@example.test", UserRole.Student, null, premium: true));
            ctx.QuestionBlocks.Add(NewBlock(blockId, teacherId, "public"));
            ctx.Questions.Add(NewQuestion(q0, teacherId, blockId, sortOrder: 0));
            ctx.Questions.Add(NewQuestion(q1, teacherId, blockId, sortOrder: 1));
            ctx.Assignments.Add(NewAssignment(assignmentId, teacherId, studentId, q1, maxAttempts: 1));

            Submission Row(Guid id, Guid q, SubmissionStatus status, string? error, Guid? assignment = null) => new()
            {
                Id = id, StudentId = studentId, QuestionId = q, AssignmentId = assignment,
                AudioKey = $"answers/rg-{id:N}.webm", Status = status, ErrorMessage = error,
                CreatedAt = DateTime.UtcNow.AddMinutes(-30), UpdatedAt = DateTime.UtcNow.AddMinutes(-30),
            };
            ctx.Submissions.Add(Row(failed, q0, SubmissionStatus.Failed, SubmissionErrorCodes.AiUnavailable));
            ctx.Submissions.Add(Row(done, q0, SubmissionStatus.Done, null));
            var ex = Row(expired, q0, SubmissionStatus.Failed, SubmissionErrorCodes.GradingTimeout);
            ex.AudioDeletedAt = DateTime.UtcNow;
            ctx.Submissions.Add(ex);
            ctx.Submissions.Add(Row(capDone, q1, SubmissionStatus.Done, null, assignmentId));
            ctx.Submissions.Add(Row(capFailed, q1, SubmissionStatus.Failed, SubmissionErrorCodes.GraderFailed, assignmentId));
            ctx.Submissions.Add(Row(adminRetry, q0, SubmissionStatus.Failed, SubmissionErrorCodes.GradingTimeout));
            ctx.Submissions.Add(Row(paused, q0, SubmissionStatus.Failed, SubmissionErrorCodes.AiUnavailable));
            await ctx.SaveChangesAsync();
        }

        try
        {
            var client = _factory.CreateClient();
            var token = TokenFor(studentId);
            Task<HttpResponseMessage> Regrade(Guid id, string as_) =>
                Send(client, HttpMethod.Post, $"/api/submissions/{id}/regrade", as_);
            async Task<string?> CodeOf(HttpResponseMessage r)
            {
                using var d = JsonDocument.Parse(await r.Content.ReadAsStringAsync());
                return d.RootElement.TryGetProperty("code", out var c) ? c.GetString() : null;
            }

            int before;
            await using (var ctx = CreateContext())
                before = await ctx.Submissions.CountAsync(s => s.StudentId == studentId);

            // ── The owner retries: 202, back to pending, error cleared, same row ──
            var ok = await Regrade(failed, token);
            Assert.Equal(HttpStatusCode.Accepted, ok.StatusCode);
            using (var d = JsonDocument.Parse(await ok.Content.ReadAsStringAsync()))
            {
                Assert.Equal(failed, d.RootElement.GetProperty("id").GetGuid());
                Assert.Equal("pending", d.RootElement.GetProperty("status").GetString());
                Assert.Equal(JsonValueKind.Null, d.RootElement.GetProperty("error_message").ValueKind);
            }
            await using (var ctx = CreateContext())
            {
                Assert.Equal(before, await ctx.Submissions.CountAsync(s => s.StudentId == studentId));
                var row = await ctx.Submissions.SingleAsync(s => s.Id == failed);
                Assert.Equal(SubmissionStatus.Pending, row.Status);
                Assert.Null(row.ErrorMessage);
            }

            // ── A second tap: it is no longer failed ──
            var again = await Regrade(failed, token);
            Assert.Equal(HttpStatusCode.Conflict, again.StatusCode);
            Assert.Equal(RegradeErrorCodes.NotFailed, await CodeOf(again));

            // ── A graded attempt has nothing to retry ──
            var graded = await Regrade(done, token);
            Assert.Equal(HttpStatusCode.Conflict, graded.StatusCode);
            Assert.Equal(RegradeErrorCodes.NotFailed, await CodeOf(graded));

            // ── The recording is gone and nothing was transcribed ──
            var gone = await Regrade(expired, token);
            Assert.Equal(HttpStatusCode.Conflict, gone.StatusCode);
            Assert.Equal(RegradeErrorCodes.AudioExpired, await CodeOf(gone));

            // ── Someone else's attempt does not exist for this caller ──
            Assert.Equal(HttpStatusCode.NotFound, (await Regrade(adminRetry, TokenFor(otherId))).StatusCode);
            // …nor for a teacher whose roster does not hold the student.
            Assert.Equal(HttpStatusCode.NotFound, (await Regrade(adminRetry, TokenFor(teacherId))).StatusCode);

            // ── The assignment's single attempt is already spent by the graded answer ──
            var capped = await Regrade(capFailed, token);
            Assert.Equal(HttpStatusCode.Conflict, capped.StatusCode);
            Assert.Equal(RegradeErrorCodes.AttemptsExhausted, await CodeOf(capped));
            await using (var ctx = CreateContext())
                Assert.Equal(SubmissionStatus.Failed, (await ctx.Submissions.SingleAsync(s => s.Id == capFailed)).Status);

            // ── An admin may retry anyone's ──
            Assert.Equal(HttpStatusCode.Accepted, (await Regrade(adminRetry, TokenFor(adminId))).StatusCode);

            // ── AI budget closed: 503 ai_unavailable, and the row is left exactly as it was ──
            using var closedHost = _factory.WithWebHostBuilder(b => b.ConfigureTestServices(s =>
                s.AddScoped<IAiBudget>(_ => new ClosedBudget())));
            var closedClient = closedHost.CreateClient();
            var refused = await Send(closedClient, HttpMethod.Post, $"/api/submissions/{paused}/regrade", token);
            Assert.Equal(HttpStatusCode.ServiceUnavailable, refused.StatusCode);
            Assert.Equal(RegradeErrorCodes.AiUnavailable, await CodeOf(refused));
            await using (var ctx = CreateContext())
            {
                var row = await ctx.Submissions.SingleAsync(s => s.Id == paused);
                Assert.Equal(SubmissionStatus.Failed, row.Status);
                Assert.Equal(SubmissionErrorCodes.AiUnavailable, row.ErrorMessage);
            }

            // ── ?status=failed narrows the list to failed rows (the admin dashboard's alert list) ──
            var list = await Send(client, HttpMethod.Get, $"/api/submissions?status=failed&student_id={studentId}", TokenFor(adminId));
            Assert.Equal(HttpStatusCode.OK, list.StatusCode);
            using (var d = JsonDocument.Parse(await list.Content.ReadAsStringAsync()))
            {
                var ids = d.RootElement.EnumerateArray().Select(r => r.GetProperty("id").GetGuid()).ToHashSet();
                Assert.Equal(new HashSet<Guid> { expired, capFailed, paused }, ids);
            }
            Assert.Equal(HttpStatusCode.BadRequest,
                (await Send(client, HttpMethod.Get, "/api/submissions?status=bogus", TokenFor(adminId))).StatusCode);
        }
        finally
        {
            await using var ctx = CreateContext();
            await ctx.Submissions.Where(s => s.StudentId == studentId).ExecuteDeleteAsync();
            await ctx.Assignments.Where(a => a.StudentId == studentId).ExecuteDeleteAsync();
            await ctx.Questions.Where(x => x.BlockId == blockId).ExecuteDeleteAsync();
            await ctx.QuestionBlocks.Where(b => b.Id == blockId).ExecuteDeleteAsync();
            await ctx.Users.Where(u => u.Id == studentId || u.Id == otherId || u.Id == teacherId || u.Id == adminId)
                .ExecuteDeleteAsync();
        }
    }

    private sealed class ClosedBudget : IAiBudget
    {
        public Task<AiBudgetCheck> CheckAsync(CancellationToken ct = default)
            => Task.FromResult(new AiBudgetCheck(AiBudgetBlock.Paused));

        public Task RecordAsync(AiUsage usage, CancellationToken ct = default) => Task.CompletedTask;
    }
}
