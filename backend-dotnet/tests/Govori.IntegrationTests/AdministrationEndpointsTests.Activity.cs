using System.Net;
using System.Text.Json;
using Govori.Administration;
using Govori.Contracts;
using Govori.Infrastructure.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Govori.IntegrationTests;

/// <summary>
/// <c>GET /api/admin/stats/activity</c> — the admin dashboard's trend series. Driven through the
/// service with a fixed clock in 2020 so rows other suites write "now" cannot land in the window:
/// exactly 14 product days, oldest first, zeros for empty days, answers bucketed by TASHKENT day,
/// graded/failed/active/new-student/AI-spend counted per day; and the route is admin-only.
/// </summary>
public sealed partial class AdministrationEndpointsTests
{
    [Fact]
    public async Task Activity_series_is_fourteen_Tashkent_days_with_per_day_counts()
    {
        var adminId = Guid.NewGuid();
        var studentA = Guid.NewGuid();
        var studentB = Guid.NewGuid();
        // "Now" = 2020-06-15 12:00 Tashkent (07:00Z). Window = 2020-06-02 .. 2020-06-15.
        var now = new DateTime(2020, 6, 15, 7, 0, 0, DateTimeKind.Utc);
        var today = new DateOnly(2020, 6, 15);
        var subIds = new List<Guid>();

        await using (var ctx = NewContext())
        {
            ctx.Users.Add(NewUser(adminId, $"act-adm-{adminId:N}@example.test", UserRole.Admin, null));
            var a = NewUser(studentA, $"act-a-{studentA:N}@example.test", UserRole.Student, null);
            a.CreatedAt = new DateTime(2020, 6, 14, 20, 0, 0, DateTimeKind.Utc);       // 01:00 on the 15th, local
            ctx.Users.Add(a);
            var b = NewUser(studentB, $"act-b-{studentB:N}@example.test", UserRole.Student, null);
            b.CreatedAt = new DateTime(2019, 1, 1, 0, 0, 0, DateTimeKind.Utc);         // outside the window
            ctx.Users.Add(b);

            void Sub(Guid student, DateTime createdUtc, SubmissionStatus status)
            {
                var id = Guid.NewGuid();
                subIds.Add(id);
                ctx.Submissions.Add(new Submission
                {
                    Id = id, StudentId = student, AudioKey = $"answers/act-{id:N}.webm",
                    Status = status, CreatedAt = createdUtc, UpdatedAt = createdUtc,
                });
            }
            // Today (local): 19:30Z on the 14th is 00:30 on the 15th in Tashkent.
            Sub(studentA, new DateTime(2020, 6, 14, 19, 30, 0, DateTimeKind.Utc), SubmissionStatus.Done);
            Sub(studentA, new DateTime(2020, 6, 15, 5, 0, 0, DateTimeKind.Utc), SubmissionStatus.Failed);
            Sub(studentB, new DateTime(2020, 6, 15, 6, 0, 0, DateTimeKind.Utc), SubmissionStatus.Pending);
            // 18:59Z on the 14th is still the 14th locally.
            Sub(studentB, new DateTime(2020, 6, 14, 18, 59, 0, DateTimeKind.Utc), SubmissionStatus.Done);
            // Before the window.
            Sub(studentB, new DateTime(2020, 5, 1, 0, 0, 0, DateTimeKind.Utc), SubmissionStatus.Done);

            ctx.AiSpendDaily.Add(new AiSpendDay
            {
                Day = today, Provider = "act-test", Operation = "grader", Calls = 2, CostUsd = 0.125m, UpdatedAt = now,
            });
            await ctx.SaveChangesAsync();
        }

        try
        {
            using (var scope = _factory.Services.CreateScope())
            {
                var svc = scope.ServiceProvider.GetRequiredService<AdministrationService>();
                var r = await svc.ActivityAsync(adminId, now);
                Assert.Equal(AdminOutcome.Ok, r.Outcome);
                var days = r.Value!.Days;

                Assert.Equal(AdministrationService.ActivityDays, days.Count);
                Assert.Equal(today.AddDays(-13), days[0].Date);
                Assert.Equal(today, days[^1].Date);

                var t = days[^1];
                Assert.Equal(3, t.Submissions);
                Assert.Equal(1, t.Graded);
                Assert.Equal(1, t.Failed);
                Assert.Equal(2, t.ActiveStudents);
                Assert.Equal(1, t.NewStudents);
                Assert.Equal(0.125, t.AiCostUsd, 4);

                var y = days[^2];
                Assert.Equal(1, y.Submissions);
                Assert.Equal(1, y.Graded);
                Assert.Equal(0, y.NewStudents);
                Assert.Equal(0, y.AiCostUsd);

                Assert.All(days.Take(12), d => Assert.Equal(0, d.Submissions));
            }

            // Over HTTP: admin-only, and the wire shape is snake_case with 14 rows.
            var client = _factory.CreateClient();
            Assert.Equal(HttpStatusCode.Forbidden,
                (await Send(client, HttpMethod.Get, "/api/admin/stats/activity", TokenFor(studentA))).StatusCode);
            var ok = await Send(client, HttpMethod.Get, "/api/admin/stats/activity", TokenFor(adminId));
            Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
            using var doc = JsonDocument.Parse(await ok.Content.ReadAsStringAsync());
            var wire = doc.RootElement.GetProperty("days");
            Assert.Equal(14, wire.GetArrayLength());
            Assert.True(wire[0].TryGetProperty("ai_cost_usd", out _));
            Assert.True(wire[0].TryGetProperty("active_students", out _));
        }
        finally
        {
            await using var ctx = NewContext();
            await ctx.Submissions.Where(s => subIds.Contains(s.Id)).ExecuteDeleteAsync();
            await ctx.AiSpendDaily.Where(r => r.Provider == "act-test").ExecuteDeleteAsync();
            await ctx.Users.Where(u => u.Id == adminId || u.Id == studentA || u.Id == studentB).ExecuteDeleteAsync();
        }
    }
}
