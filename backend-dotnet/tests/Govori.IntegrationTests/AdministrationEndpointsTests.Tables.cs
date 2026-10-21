using System.Net;
using Govori.Infrastructure.Entities;
using Microsoft.EntityFrameworkCore;

namespace Govori.IntegrationTests;

/// <summary>
/// The columns of the admin data tables: a student row carries when they were last active, their
/// average band and their groups (with each group's teacher); a teacher row carries how many groups
/// and distinct students they have; and an admin's module list counts each module's reach from its
/// OWNER's roster rather than printing the admin's whole-platform count on every row.
/// </summary>
public sealed partial class AdministrationEndpointsTests
{
    [Fact]
    public async Task Admin_tables_carry_activity_scores_groups_and_per_owner_module_reach()
    {
        var adminId = Guid.NewGuid();
        var t1 = Guid.NewGuid();
        var t2 = Guid.NewGuid();
        var s1 = Guid.NewGuid();
        var s2 = Guid.NewGuid();
        var s3 = Guid.NewGuid();
        var g1 = Guid.NewGuid();
        var g2 = Guid.NewGuid();
        var g3 = Guid.NewGuid();
        var b1 = Guid.NewGuid();
        var b2 = Guid.NewGuid();
        var bDraft = Guid.NewGuid();
        var sub1 = Guid.NewGuid();
        var sub2 = Guid.NewGuid();
        var tag = adminId.ToString("N")[..10];
        var now = DateTime.UtcNow;
        var lastAt = now.AddMinutes(-3);
        var users = new[] { adminId, t1, t2, s1, s2, s3 };
        var groups = new[] { g1, g2, g3 };

        await using (var ctx = NewContext())
        {
            ctx.Users.Add(NewUser(adminId, $"tb-adm-{tag}@example.test", UserRole.Admin, null));
            ctx.Users.Add(NewUser(t1, $"tb-t1-{tag}@example.test", UserRole.Teacher, null, $"Tbl Teacher One {tag}"));
            ctx.Users.Add(NewUser(t2, $"tb-t2-{tag}@example.test", UserRole.Teacher, null, $"Tbl Teacher Two {tag}"));
            ctx.Users.Add(NewUser(s1, $"tb-s1-{tag}@example.test", UserRole.Student, null, $"Tbl Busy {tag}"));
            ctx.Users.Add(NewUser(s2, $"tb-s2-{tag}@example.test", UserRole.Student, null, $"Tbl Quiet {tag}"));
            ctx.Users.Add(NewUser(s3, $"tb-s3-{tag}@example.test", UserRole.Student, null, $"Tbl Loner {tag}"));
            await ctx.SaveChangesAsync();

            Group G(Guid id, Guid teacher, string name) => new()
            {
                Id = id, TeacherId = teacher, Name = name, JoinCode = $"T{id:N}"[..8].ToUpperInvariant(),
                CreatedAt = now, UpdatedAt = now,
            };
            ctx.Groups.AddRange(G(g1, t1, "B group"), G(g2, t1, "A group"), G(g3, t2, "C group"));
            QuestionBlock B(Guid id, Guid teacher, bool published) => new()
            {
                Id = id, TeacherId = teacher, Name = $"Tbl module {tag}", Visibility = "group",
                IsPublished = published, SortOrder = 0, CreatedAt = now, UpdatedAt = now,
            };
            ctx.QuestionBlocks.AddRange(B(b1, t1, true), B(b2, t2, true), B(bDraft, t1, false));
            await ctx.SaveChangesAsync();

            GroupMember M(Guid group, Guid student) => new()
            {
                Id = Guid.NewGuid(), GroupId = group, StudentId = student, CreatedAt = now, UpdatedAt = now,
            };
            // s1 is in both of t1's groups (counts ONCE for t1) and in t2's; s2 only in one of t1's.
            ctx.GroupMembers.AddRange(M(g1, s1), M(g2, s1), M(g3, s1), M(g1, s2));

            Submission S(Guid id, DateTime at) => new()
            {
                Id = id, StudentId = s1, AudioKey = $"tbl/{id:N}.webm", Status = SubmissionStatus.Done,
                CreatedAt = at, UpdatedAt = at,
            };
            ctx.Submissions.AddRange(S(sub1, now.AddDays(-2)), S(sub2, lastAt));
            await ctx.SaveChangesAsync();

            Evaluation E(Guid submission, double band) => new()
            {
                Id = Guid.NewGuid(), SubmissionId = submission, OverallBand = band, CreatedAt = now, UpdatedAt = now,
            };
            ctx.Evaluations.AddRange(E(sub1, 60), E(sub2, 71));
            await ctx.SaveChangesAsync();
        }

        try
        {
            var client = _factory.CreateClient();
            var token = TokenFor(adminId);

            // ── Students ──
            var studentsResp = await Send(client, HttpMethod.Get, $"/api/admin/students?search={tag}", token);
            Assert.Equal(HttpStatusCode.OK, studentsResp.StatusCode);
            var students = (await ReadJson(studentsResp)).EnumerateArray()
                .ToDictionary(r => r.GetProperty("id").GetGuid());
            Assert.Equal(3, students.Count);

            var busy = students[s1];
            Assert.Equal(2, busy.GetProperty("submission_count").GetInt32());
            Assert.Equal(65.5, busy.GetProperty("avg_band").GetDouble());
            Assert.True(Math.Abs((busy.GetProperty("last_active_at").GetDateTime().ToUniversalTime() - lastAt).TotalSeconds) < 1);
            var busyGroups = busy.GetProperty("groups").EnumerateArray().ToList();
            Assert.Equal(new[] { "A group", "B group", "C group" },
                busyGroups.Select(g => g.GetProperty("name").GetString()).ToArray());
            Assert.Equal($"Tbl Teacher Two {tag}", busyGroups[2].GetProperty("teacher_name").GetString());
            Assert.Equal(t2, busyGroups[2].GetProperty("teacher_id").GetGuid());

            // Nothing graded, never active, no group: null and empty — never 0.
            var loner = students[s3];
            Assert.Equal(System.Text.Json.JsonValueKind.Null, loner.GetProperty("avg_band").ValueKind);
            Assert.Equal(System.Text.Json.JsonValueKind.Null, loner.GetProperty("last_active_at").ValueKind);
            Assert.Empty(loner.GetProperty("groups").EnumerateArray());

            // ── Teachers ──
            var teachersResp = await Send(client, HttpMethod.Get, $"/api/admin/teachers?search={tag}", token);
            Assert.Equal(HttpStatusCode.OK, teachersResp.StatusCode);
            var teachers = (await ReadJson(teachersResp)).EnumerateArray()
                .ToDictionary(r => r.GetProperty("id").GetGuid());
            Assert.Equal(2, teachers[t1].GetProperty("group_count").GetInt32());
            Assert.Equal(2, teachers[t1].GetProperty("student_count").GetInt32());   // s1 once + s2
            Assert.Equal(1, teachers[t2].GetProperty("group_count").GetInt32());
            Assert.Equal(1, teachers[t2].GetProperty("student_count").GetInt32());

            // ── Modules: each counts its owner's roster; a draft reaches nobody ──
            var blocksResp = await Send(client, HttpMethod.Get, "/api/blocks", token);
            Assert.Equal(HttpStatusCode.OK, blocksResp.StatusCode);
            var blocks = (await ReadJson(blocksResp)).EnumerateArray()
                .ToDictionary(r => r.GetProperty("id").GetGuid());
            Assert.Equal(2, blocks[b1].GetProperty("student_count").GetInt32());
            Assert.Equal(1, blocks[b2].GetProperty("student_count").GetInt32());
            Assert.Equal(0, blocks[bDraft].GetProperty("student_count").GetInt32());

            var detail = await ReadJson(await Send(client, HttpMethod.Get, $"/api/blocks/{b2}", token));
            Assert.Equal(1, detail.GetProperty("student_count").GetInt32());
        }
        finally
        {
            await using var ctx = NewContext();
            await ctx.Evaluations.Where(e => e.SubmissionId == sub1 || e.SubmissionId == sub2).ExecuteDeleteAsync();
            await ctx.Submissions.Where(s => s.StudentId == s1).ExecuteDeleteAsync();
            await ctx.GroupMembers.Where(gm => groups.Contains(gm.GroupId)).ExecuteDeleteAsync();
            await ctx.Groups.Where(g => groups.Contains(g.Id)).ExecuteDeleteAsync();
            await ctx.QuestionBlocks.Where(b => b.Id == b1 || b.Id == b2 || b.Id == bDraft).ExecuteDeleteAsync();
            await ctx.Users.Where(u => users.Contains(u.Id)).ExecuteDeleteAsync();
        }
    }
}
