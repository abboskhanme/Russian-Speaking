using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Govori.Infrastructure.Entities;
using Microsoft.EntityFrameworkCore;

namespace Govori.IntegrationTests;

/// <summary>
/// <c>POST /api/admin/groups/{id}/transfer</c> — handing a class to another teacher (a teacher
/// leaves mid-year). What is pinned here is the CONTRACT of the move, as a student, the new teacher
/// and the old teacher each experience it, not just the one column:
/// <list type="bullet">
///   <item>the group, its roster, its join code and its pending join requests now answer to the new
///     teacher, and the old teacher can no longer open any of it (404, like any group not theirs);</item>
///   <item>the old teacher's assignments set THROUGH the group move (open and answered alike); their
///     one-off assignments and an admin's rows do not;</item>
///   <item>nothing the student did is touched — the answer, its grade and who reviewed it — and the
///   new teacher's review queue now holds it;</item>
///   <item>the old teacher's group module stays theirs, and the student keeps seeing exactly the
///     tasks from it they still hold live homework for — not the rest;</item>
///   <item>each of the three audiences gets one notification;</item>
///   <item>every refusal: 401/403 RBAC, 404 unknown group, 400 <c>same_teacher</c>, and 400
///     <c>invalid_target_teacher</c> for a missing / unknown / student / admin / suspended target —
///     and none of them changed anything.</item>
/// </list>
/// The previous owner is SUSPENDED before the transfer on purpose: "the teacher left and was
/// deactivated" is the real situation this route exists for, so it must not depend on the old owner
/// being able to sign in.
/// </summary>
public sealed partial class AdministrationEndpointsTests
{
    [Fact]
    public async Task Transfer_hands_the_class_to_another_teacher_and_keeps_every_record()
    {
        var adminId = Guid.NewGuid();
        var oldTeacher = Guid.NewGuid();
        var newTeacher = Guid.NewGuid();
        var suspendedTeacher = Guid.NewGuid();
        var member = Guid.NewGuid();
        var applicant = Guid.NewGuid();
        var groupId = Guid.NewGuid();
        var blockId = Guid.NewGuid();
        var qOpen = Guid.NewGuid();        // assigned through the group, not answered yet
        var qAnswered = Guid.NewGuid();    // assigned through the group, answered and reviewed
        var qOther = Guid.NewGuid();       // in the module, only ever assigned one-off (now expired)
        var aOpen = Guid.NewGuid();
        var aAnswered = Guid.NewGuid();
        var aOneOff = Guid.NewGuid();
        var aByAdmin = Guid.NewGuid();
        var submissionId = Guid.NewGuid();
        var joinCode = $"GT{groupId:N}".ToUpperInvariant()[..8];
        var now = DateTime.UtcNow;

        await using (var ctx = NewContext())
        {
            ctx.Users.Add(NewUser(adminId, $"gt-adm-{adminId:N}@example.test", UserRole.Admin, null, "Transfer Admin"));
            var old = NewUser(oldTeacher, $"gt-old-{oldTeacher:N}@example.test", UserRole.Teacher, null, "Old Teacher");
            old.IsActive = false;                                              // the teacher has left
            ctx.Users.Add(old);
            ctx.Users.Add(NewUser(newTeacher, $"gt-new-{newTeacher:N}@example.test", UserRole.Teacher, null, "New Teacher"));
            var suspended = NewUser(suspendedTeacher, $"gt-sus-{suspendedTeacher:N}@example.test", UserRole.Teacher, null);
            suspended.IsActive = false;
            ctx.Users.Add(suspended);
            ctx.Users.Add(NewUser(member, $"gt-m-{member:N}@example.test", UserRole.Student, null, "Member Student"));
            ctx.Users.Add(NewUser(applicant, $"gt-ap-{applicant:N}@example.test", UserRole.Student, null));
            await ctx.SaveChangesAsync();

            ctx.Groups.Add(new Group
            {
                Id = groupId, TeacherId = oldTeacher, Name = "Transfer grp", JoinCode = joinCode,
                CreatedAt = now, UpdatedAt = now,
            });
            ctx.QuestionBlocks.Add(new QuestionBlock
            {
                Id = blockId, TeacherId = oldTeacher, Name = "Old teacher's module", Visibility = "group",
                IsPublished = true, SortOrder = 0, CreatedAt = now, UpdatedAt = now,
            });
            await ctx.SaveChangesAsync();

            ctx.GroupMembers.Add(new GroupMember
            {
                Id = Guid.NewGuid(), GroupId = groupId, StudentId = member, CreatedAt = now, UpdatedAt = now,
            });
            ctx.GroupJoinRequests.Add(new GroupJoinRequest
            {
                Id = Guid.NewGuid(), GroupId = groupId, StudentId = applicant,
                Status = GroupJoinRequest.StatusPending, CreatedAt = now, UpdatedAt = now,
            });
            var order = 0;
            foreach (var q in new[] { qOpen, qAnswered, qOther })
                ctx.Questions.Add(TransferQuestion(q, oldTeacher, blockId, order++, now));
            await ctx.SaveChangesAsync();

            ctx.Assignments.AddRange(
                TransferAssignment(aOpen, oldTeacher, member, qOpen, groupId, now, due: null),
                TransferAssignment(aAnswered, oldTeacher, member, qAnswered, groupId, now.AddMinutes(-10), due: null),
                // One-off (no group) and already expired: neither the group's nor live homework.
                TransferAssignment(aOneOff, oldTeacher, member, qOther, groupId: null, now, due: now.AddDays(-1)),
                // Set through the group by an ADMIN: stays the admin's.
                TransferAssignment(aByAdmin, adminId, member, qOther, groupId, now, due: now.AddDays(-1)));
            ctx.Submissions.Add(new Submission
            {
                Id = submissionId, StudentId = member, QuestionId = qAnswered, AssignmentId = aAnswered,
                AudioKey = "transfer/x.webm", Status = SubmissionStatus.Done,
                ReviewedBy = oldTeacher, ReviewedAt = now, TeacherBand = 80, TeacherComment = "Yaxshi",
                CreatedAt = now.AddMinutes(-5), UpdatedAt = now,
            });
            await ctx.SaveChangesAsync();
        }

        try
        {
            var client = _factory.CreateClient();
            var adminToken = TokenFor(adminId);
            var path = $"/api/admin/groups/{groupId}/transfer";
            Task<HttpResponseMessage> Transfer(object body, string? token = null, string? at = null)
                => Send(client, HttpMethod.Post, at ?? path, token ?? adminToken, Json(body));

            // ── RBAC: anonymous 401; a student 403; a TEACHER 403 (even the receiving one) ──
            Assert.Equal(HttpStatusCode.Unauthorized,
                (await client.PostAsJsonAsync(path, new { teacher_id = newTeacher })).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await Transfer(new { teacher_id = newTeacher }, TokenFor(member))).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await Transfer(new { teacher_id = newTeacher }, TokenFor(newTeacher))).StatusCode);

            // ── 404 unknown group (checked before the target, so it says nothing about teachers) ──
            Assert.Equal(HttpStatusCode.NotFound,
                (await Transfer(new { teacher_id = newTeacher }, at: $"/api/admin/groups/{Guid.NewGuid()}/transfer")).StatusCode);

            // ── 400s, each with its code ──
            await AssertTransferCode(await Transfer(new { }), "invalid_target_teacher");
            await AssertTransferCode(await Transfer(new { teacher_id = oldTeacher }), "same_teacher");
            await AssertTransferCode(await Transfer(new { teacher_id = Guid.NewGuid() }), "invalid_target_teacher");
            await AssertTransferCode(await Transfer(new { teacher_id = member }), "invalid_target_teacher");
            await AssertTransferCode(await Transfer(new { teacher_id = adminId }), "invalid_target_teacher");
            await AssertTransferCode(await Transfer(new { teacher_id = suspendedTeacher }), "invalid_target_teacher");
            await using (var ctx = NewContext())
            {
                Assert.Equal(oldTeacher, await ctx.Groups.Where(g => g.Id == groupId).Select(g => g.TeacherId).SingleAsync());
                Assert.Equal(0, await ctx.Notifications.CountAsync(n => n.UserId == member));
            }

            // Before: the member sees the old teacher's whole module (they are its teacher's student).
            Assert.Equal(new List<Guid> { qOpen, qAnswered, qOther }, await ModuleTaskIds(client, member, blockId));

            // ── The transfer ──
            var resp = await Transfer(new { teacher_id = newTeacher });
            Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
            using (var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync()))
            {
                var r = doc.RootElement;
                Assert.Equal(groupId, r.GetProperty("group_id").GetGuid());
                Assert.Equal("Transfer grp", r.GetProperty("group_name").GetString());
                Assert.Equal(oldTeacher, r.GetProperty("from_teacher_id").GetGuid());
                Assert.Equal("Old Teacher", r.GetProperty("from_teacher_name").GetString());
                Assert.Equal(newTeacher, r.GetProperty("to_teacher_id").GetGuid());
                Assert.Equal("New Teacher", r.GetProperty("to_teacher_name").GetString());
                Assert.Equal(1, r.GetProperty("member_count").GetInt32());
                Assert.Equal(2, r.GetProperty("assignments_moved").GetInt32());
            }

            await using (var ctx = NewContext())
            {
                var g = await ctx.Groups.AsNoTracking().SingleAsync(x => x.Id == groupId);
                Assert.Equal(newTeacher, g.TeacherId);
                Assert.Equal(joinCode, g.JoinCode);                                   // invites keep working
                Assert.Equal("Transfer grp", g.Name);

                var owners = await ctx.Assignments.AsNoTracking()
                    .Where(a => a.StudentId == member)
                    .ToDictionaryAsync(a => a.Id, a => a.TeacherId);
                Assert.Equal(newTeacher, owners[aOpen]);
                Assert.Equal(newTeacher, owners[aAnswered]);
                Assert.Equal(oldTeacher, owners[aOneOff]);                           // never the group's
                Assert.Equal(adminId, owners[aByAdmin]);                             // the admin's own row

                // The student's record, untouched: the answer, its link, its grade, its reviewer.
                var sub = await ctx.Submissions.AsNoTracking().SingleAsync(s => s.Id == submissionId);
                Assert.Equal(aAnswered, sub.AssignmentId);
                Assert.Equal(oldTeacher, sub.ReviewedBy);
                Assert.Equal(80, sub.TeacherBand);

                // Content stays with its author.
                Assert.Equal(oldTeacher, await ctx.QuestionBlocks.Where(b => b.Id == blockId).Select(b => b.TeacherId).SingleAsync());
                Assert.Equal(3, await ctx.Questions.CountAsync(q => q.BlockId == blockId && q.TeacherId == oldTeacher));

                // One ping per audience, each with its own destination.
                Assert.Equal("/group", await NotificationLink(ctx, member, "group_teacher_changed"));
                Assert.Equal($"/teacher/classes/{groupId}", await NotificationLink(ctx, newTeacher, "group_handover"));
                Assert.Equal("/teacher/classes", await NotificationLink(ctx, oldTeacher, "group_handover"));
            }

            // ── The new teacher runs the class; the old one (reactivated to look) no longer can ──
            var newToken = TokenFor(newTeacher);
            Assert.Equal(HttpStatusCode.OK, (await Send(client, HttpMethod.Get, $"/api/groups/{groupId}", newToken)).StatusCode);
            Assert.Contains(groupId, await IdsAt(client, newToken, "/api/groups"));
            Assert.Contains(applicant, await IdsAt(client, newToken, "/api/groups/requests", "student_id"));
            Assert.Contains(aOpen, await IdsAt(client, newToken, "/api/assignments"));
            Assert.Contains(submissionId, await IdsAt(client, newToken, "/api/submissions"));

            await using (var ctx = NewContext())
                await ctx.Users.Where(u => u.Id == oldTeacher).ExecuteUpdateAsync(s => s.SetProperty(u => u.IsActive, true));
            var oldToken = TokenFor(oldTeacher);
            Assert.Equal(HttpStatusCode.NotFound, (await Send(client, HttpMethod.Get, $"/api/groups/{groupId}", oldToken)).StatusCode);
            Assert.DoesNotContain(groupId, await IdsAt(client, oldToken, "/api/groups"));
            Assert.DoesNotContain(aOpen, await IdsAt(client, oldToken, "/api/assignments"));
            Assert.DoesNotContain(submissionId, await IdsAt(client, oldToken, "/api/submissions"));

            // ── The student keeps their homework from the old teacher's module, and only that ──
            Assert.Equal(new List<Guid> { qOpen, qAnswered }, await ModuleTaskIds(client, member, blockId));

            // The motivating dead end is gone: owning no group, the old teacher can now be demoted.
            Assert.Equal(HttpStatusCode.OK,
                (await Send(client, HttpMethod.Patch, $"/api/admin/users/{oldTeacher}/role", adminToken,
                    Json(new { role = "student" }))).StatusCode);
        }
        finally
        {
            await using var ctx = NewContext();
            var users = new[] { adminId, oldTeacher, newTeacher, suspendedTeacher, member, applicant };
            await ctx.Notifications.Where(n => users.Contains(n.UserId)).ExecuteDeleteAsync();
            await ctx.Submissions.Where(s => s.Id == submissionId).ExecuteDeleteAsync();
            await ctx.Assignments.Where(a => a.StudentId == member).ExecuteDeleteAsync();
            await ctx.GroupJoinRequests.Where(r => r.GroupId == groupId).ExecuteDeleteAsync();
            await ctx.GroupMembers.Where(gm => gm.GroupId == groupId).ExecuteDeleteAsync();
            await ctx.Groups.Where(g => g.Id == groupId).ExecuteDeleteAsync();
            await ctx.Questions.Where(q => q.BlockId == blockId).ExecuteDeleteAsync();
            await ctx.QuestionBlocks.Where(b => b.Id == blockId).ExecuteDeleteAsync();
            await ctx.Users.Where(u => users.Contains(u.Id)).ExecuteDeleteAsync();
        }
    }

    // ── helpers for this file ──

    private static async Task AssertTransferCode(HttpResponseMessage resp, string code)
    {
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
        using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
        Assert.Equal(code, doc.RootElement.GetProperty("code").GetString());
    }

    /// <summary>The task ids the student's module view lists for one module, in order — empty when
    /// the module is not shown at all.</summary>
    private static async Task<List<Guid>> ModuleTaskIds(HttpClient client, Guid studentId, Guid blockId)
    {
        var resp = await Send(client, HttpMethod.Get, "/api/blocks/student", TokenFor(studentId));
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
        var module = doc.RootElement.EnumerateArray()
            .FirstOrDefault(m => m.GetProperty("id").GetGuid() == blockId);
        return module.ValueKind == JsonValueKind.Undefined
            ? []
            : module.GetProperty("tasks").EnumerateArray().Select(t => t.GetProperty("id").GetGuid()).ToList();
    }

    private static async Task<List<Guid>> IdsAt(HttpClient client, string token, string path, string field = "id")
    {
        var resp = await Send(client, HttpMethod.Get, path, token);
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
        return doc.RootElement.EnumerateArray().Select(e => e.GetProperty(field).GetGuid()).ToList();
    }

    private static Task<string?> NotificationLink(Govori.Infrastructure.GovoriDbContext ctx, Guid userId, string type)
        => ctx.Notifications.Where(n => n.UserId == userId && n.Type == type).Select(n => n.Link).SingleAsync();

    private static Question TransferQuestion(Guid id, Guid teacherId, Guid blockId, int order, DateTime now) => new()
    {
        Id = id, TeacherId = teacherId, BlockId = blockId, Type = QuestionType.Text,
        Title = $"Transfer task {order}", PromptText = "Расскажите о себе.", Level = "A2", Topic = "О себе",
        IsPublished = true, IsDeleted = false, IsPublic = false, PrepTimeSec = 0, AnswerTimeLimitSec = 0,
        SortOrder = order, CreatedAt = now.AddSeconds(order), UpdatedAt = now,
    };

    private static Assignment TransferAssignment(
        Guid id, Guid teacherId, Guid studentId, Guid questionId, Guid? groupId, DateTime createdAt, DateTime? due) => new()
    {
        Id = id, TeacherId = teacherId, StudentId = studentId, QuestionId = questionId, GroupId = groupId,
        DueAt = due, CreatedAt = createdAt, UpdatedAt = createdAt,
    };
}
