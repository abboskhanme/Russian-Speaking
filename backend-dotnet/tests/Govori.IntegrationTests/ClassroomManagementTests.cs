using System.Net;
using System.Text.Json;
using Govori.Classroom;
using Govori.Contracts;
using Govori.Engagement;
using Govori.Infrastructure;
using Govori.Infrastructure.Entities;
using Microsoft.EntityFrameworkCore;

namespace Govori.IntegrationTests;

/// <summary>
/// The after-launch audit's classroom fixes, end to end over the SAME host as the lifecycle test
/// (a partial of <see cref="ClassroomEndpointsTests"/>, so no extra WebApplicationFactory — EF caps
/// the number of internal service providers a test run may build):
/// <list type="bullet">
///   <item><b>No duplicate assignment</b> — the single-task path skips a student who still OWES
///     the task, re-issues one that was answered or expired, and pings each student once per
///     action (a whole module included);</item>
///   <item><b>Taking work back</b> — delete one row, cancel a task across a group, move a group's
///     deadline — with every answer and grade surviving;</item>
///   <item><b>Group management</b> — rename, fresh join code, remove a member, delete the group —
///     and exactly which rows each removes;</item>
///   <item><b>The teacher's premium grant</b> and the A6 student card;</item>
///   <item><b>The teacher scope</b> — a roster student's answer to a PUBLIC catalog question is the
///     teacher's to see, grade and count; a non-roster student's answer to the same question is
///     not;</item>
///   <item><b>The review PATCH</b> — absent vs explicit null, and a confirm that can no longer
///     overwrite what the teacher wrote;</item>
///   <item><b>Notifications</b> — each writer, its link, the recipient's language, the opt-out, and
///     that a failing notifier never fails the action it reports.</item>
/// </list>
/// Every new route is checked for the full RBAC ladder: anonymous 401, student 403, another teacher
/// 404 (never 403 — ids cannot be probed), owner/admin OK.
/// </summary>
public sealed partial class ClassroomEndpointsTests
{
    // ─────────────────────────── 1 · duplicate assignment ───────────────────────────

    [Fact]
    public async Task Assigning_a_task_twice_skips_students_who_still_owe_it_and_pings_once_per_action()
    {
        using var seed = new Seed(this);
        var teacher = await seed.UserAsync(UserRole.Teacher, "Ustoz Karimova");
        var s1 = await seed.UserAsync(UserRole.Student, "Anvar", language: "ru");
        var muted = await seed.UserAsync(UserRole.Student, "Bobur", notifications: false);
        var group = await seed.GroupAsync(teacher, s1, muted);
        var q = await seed.QuestionAsync(teacher, "Мой день");

        var client = _factory.CreateClient();
        var token = TokenFor(teacher);
        var body = new { question_id = q, group_id = group };

        // First assign: both students.
        Assert.Equal(2, await CreatedCount(await Send(client, HttpMethod.Post, "/api/assignments", token, Json(body))));
        // Again, while both still owe it: nothing new, and the body says so (an empty array).
        Assert.Equal(0, await CreatedCount(await Send(client, HttpMethod.Post, "/api/assignments", token, Json(body))));
        await using (var ctx = CreateContext())
            Assert.Equal(2, await ctx.Assignments.CountAsync(a => a.QuestionId == q));

        // One ping for s1, in THEIR language, pointing at the assignments tab; none for the student
        // who switched notifications off — they still got the assignment.
        await using (var ctx = CreateContext())
        {
            var pings = await ctx.Notifications.Where(n => n.UserId == s1).ToListAsync();
            var ping = Assert.Single(pings);
            Assert.Equal("assignment_new", ping.Type);
            Assert.Equal("Новое задание", ping.Title);
            Assert.Contains("Мой день", ping.Body);
            Assert.Contains("Ustoz Karimova", ping.Body);
            Assert.Equal("/practice?tab=assignments", ping.Link);
            Assert.False(await ctx.Notifications.AnyAsync(n => n.UserId == muted));
            Assert.True(await ctx.Assignments.AnyAsync(a => a.StudentId == muted));
        }

        // s1 ANSWERS it; muted's deadline LAPSES. Neither owes the task any more, so a new copy is
        // legitimate for both — re-setting a finished task is what remediation is for. (The answer is
        // stamped NOW — after the first copy, before the next — so it closes only the first one.)
        await using (var ctx = CreateContext())
        {
            seed.Submission(ctx, s1, q, DateTime.UtcNow);
            var mutedRow = await ctx.Assignments.SingleAsync(a => a.StudentId == muted && a.QuestionId == q);
            mutedRow.DueAt = DateTime.UtcNow.AddDays(-1);
            await ctx.SaveChangesAsync();
        }
        Assert.Equal(2, await CreatedCount(await Send(client, HttpMethod.Post, "/api/assignments", token, Json(body))));
        Assert.Equal(0, await CreatedCount(await Send(client, HttpMethod.Post, "/api/assignments", token, Json(body))));
        await using (var ctx = CreateContext())
        {
            Assert.Equal(4, await ctx.Assignments.CountAsync(a => a.QuestionId == q));
            Assert.Equal(2, await ctx.Notifications.CountAsync(n => n.UserId == s1));
        }

        // A whole module: three tasks, ONE ping per student, naming the module.
        var block = await seed.BlockAsync(teacher, "Oila moduli", tasks: 3);
        var moduleResp = await Send(client, HttpMethod.Post, "/api/assignments/module", token,
            Json(new { block_id = block, group_id = group }));
        Assert.Equal(6, await CreatedCount(moduleResp));
        await using (var ctx = CreateContext())
        {
            var pings = await ctx.Notifications.Where(n => n.UserId == s1).OrderBy(n => n.CreatedAt).ToListAsync();
            Assert.Equal(3, pings.Count);
            Assert.Contains("Oila moduli", pings[^1].Body);
        }
        // Re-assigning the module creates nothing and so pings nobody.
        Assert.Equal(0, await CreatedCount(await Send(client, HttpMethod.Post, "/api/assignments/module", token,
            Json(new { block_id = block, group_id = group }))));
        await using (var ctx = CreateContext())
            Assert.Equal(3, await ctx.Notifications.CountAsync(n => n.UserId == s1));
    }

    // ─────────────────────────── 2 · taking work back ───────────────────────────

    [Fact]
    public async Task Assignments_can_be_deleted_cancelled_and_rescheduled_and_answers_survive()
    {
        using var seed = new Seed(this);
        var teacher = await seed.UserAsync(UserRole.Teacher);
        var other = await seed.UserAsync(UserRole.Teacher);
        var admin = await seed.UserAsync(UserRole.Admin);
        var s1 = await seed.UserAsync(UserRole.Student);
        var s2 = await seed.UserAsync(UserRole.Student);
        var group = await seed.GroupAsync(teacher, s1, s2);
        var q = await seed.QuestionAsync(teacher);

        var client = _factory.CreateClient();
        var token = TokenFor(teacher);
        Assert.Equal(2, await CreatedCount(await Send(client, HttpMethod.Post, "/api/assignments", token,
            Json(new { question_id = q, group_id = group }))));

        Guid a1, subId;
        await using (var ctx = CreateContext())
        {
            a1 = (await ctx.Assignments.SingleAsync(a => a.StudentId == s1 && a.QuestionId == q)).Id;
            // s1 answered it — the answer is attributed to the assignment and graded.
            subId = seed.Submission(ctx, s1, q, DateTime.UtcNow.AddMinutes(1), assignmentId: a1, band: 72);
            await ctx.SaveChangesAsync();
        }

        // ── DELETE /api/assignments/{id} — the RBAC ladder ──
        var path = $"/api/assignments/{a1}";
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.DeleteAsync(path)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(client, HttpMethod.Delete, path, TokenFor(s1))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Send(client, HttpMethod.Delete, path, TokenFor(other))).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await Send(client, HttpMethod.Delete, path, token)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Send(client, HttpMethod.Delete, path, token)).StatusCode);
        await using (var ctx = CreateContext())
        {
            Assert.False(await ctx.Assignments.AnyAsync(a => a.Id == a1));
            // The student's answer and its grade outlive the assignment; only the link is gone.
            var sub = await ctx.Submissions.Include(s => s.Evaluation).SingleAsync(s => s.Id == subId);
            Assert.Null(sub.AssignmentId);
            Assert.NotNull(sub.Evaluation);
        }

        // ── PATCH /api/assignments/group — the deadline across the group ──
        const string due = "/api/assignments/group";
        var future = DateTime.UtcNow.AddDays(3);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PatchAsync(due,
            Json(new { question_id = q, group_id = group, due_at = future }))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(client, HttpMethod.Patch, due, TokenFor(s1),
            Json(new { question_id = q, group_id = group, due_at = future }))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Send(client, HttpMethod.Patch, due, TokenFor(other),
            Json(new { question_id = q, group_id = group, due_at = future }))).StatusCode);
        // No due_at key at all is refused, NOT read as "remove the deadline".
        await AssertCode(await Send(client, HttpMethod.Patch, due, token,
            Json(new { question_id = q, group_id = group })), "due_at_required");
        await AssertCode(await Send(client, HttpMethod.Patch, due, token,
            Json(new { question_id = q, group_id = group, due_at = DateTime.UtcNow.AddHours(-1) })), "due_in_past");

        // An offset instant is stored as the same moment in UTC.
        var withOffset = await Send(client, HttpMethod.Patch, due, token, new StringContent(
            $$"""{"question_id":"{{q}}","group_id":"{{group}}","due_at":"2031-03-01T12:00:00+05:00"}""",
            System.Text.Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.OK, withOffset.StatusCode);
        using (var doc = JsonDocument.Parse(await withOffset.Content.ReadAsStringAsync()))
            Assert.Equal(1, doc.RootElement.GetProperty("updated").GetInt32());   // s2's row; s1's was deleted
        await using (var ctx = CreateContext())
            Assert.Equal(new DateTime(2031, 3, 1, 7, 0, 0, DateTimeKind.Utc),
                (await ctx.Assignments.SingleAsync(a => a.StudentId == s2 && a.QuestionId == q)).DueAt);

        // An explicit null removes the deadline.
        Assert.Equal(HttpStatusCode.OK, (await Send(client, HttpMethod.Patch, due, token,
            Json(new { question_id = q, group_id = group, due_at = (DateTime?)null }))).StatusCode);
        await using (var ctx = CreateContext())
            Assert.Null((await ctx.Assignments.SingleAsync(a => a.StudentId == s2 && a.QuestionId == q)).DueAt);

        // ── POST /api/assignments/cancel — the task, across the group ──
        const string cancel = "/api/assignments/cancel";
        var cancelBody = new { question_id = q, group_id = group };
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsync(cancel, Json(cancelBody))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(client, HttpMethod.Post, cancel, TokenFor(s1), Json(cancelBody))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Send(client, HttpMethod.Post, cancel, TokenFor(other), Json(cancelBody))).StatusCode);
        Assert.Equal(1, await Cancelled(await Send(client, HttpMethod.Post, cancel, token, Json(cancelBody))));
        Assert.Equal(0, await Cancelled(await Send(client, HttpMethod.Post, cancel, token, Json(cancelBody))));   // idempotent
        await using (var ctx = CreateContext())
            Assert.False(await ctx.Assignments.AnyAsync(a => a.QuestionId == q));

        // ── An admin may withdraw any teacher's assignment ──
        Guid a3;
        await using (var ctx = CreateContext())
        {
            a3 = seed.Assignment(ctx, teacher, s2, q, group);
            await ctx.SaveChangesAsync();
        }
        Assert.Equal(HttpStatusCode.NoContent,
            (await Send(client, HttpMethod.Delete, $"/api/assignments/{a3}", TokenFor(admin))).StatusCode);

        static async Task<int> Cancelled(HttpResponseMessage resp)
        {
            Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
            using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
            return doc.RootElement.GetProperty("cancelled").GetInt32();
        }
    }

    // ─────────────────────────── 3 · group management ───────────────────────────

    [Fact]
    public async Task Groups_can_be_renamed_rekeyed_trimmed_and_deleted_without_losing_history()
    {
        using var seed = new Seed(this);
        var teacher = await seed.UserAsync(UserRole.Teacher);
        var other = await seed.UserAsync(UserRole.Teacher);
        var admin = await seed.UserAsync(UserRole.Admin);
        var s1 = await seed.UserAsync(UserRole.Student);
        var s2 = await seed.UserAsync(UserRole.Student);
        var s3 = await seed.UserAsync(UserRole.Student);
        var group = await seed.GroupAsync(teacher, s1, s2);
        var q = await seed.QuestionAsync(teacher);
        var q2 = await seed.QuestionAsync(teacher);

        var client = _factory.CreateClient();
        var token = TokenFor(teacher);
        var groupPath = $"/api/groups/{group}";

        // ── PATCH /api/groups/{id} ──
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PatchAsync(groupPath, Json(new { name = "x" }))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(client, HttpMethod.Patch, groupPath, TokenFor(s1), Json(new { name = "x" }))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Send(client, HttpMethod.Patch, groupPath, TokenFor(other), Json(new { name = "x" }))).StatusCode);
        await AssertCode(await Send(client, HttpMethod.Patch, groupPath, token, Json(new { name = "   " })), "name_required");
        await AssertCode(await Send(client, HttpMethod.Patch, groupPath, token, Json(new { name = new string('a', 129) })), "name_too_long");
        await AssertCode(await Send(client, HttpMethod.Patch, groupPath, token, Json(new { level = "B1" })), "level_not_supported");
        var renamed = await Send(client, HttpMethod.Patch, groupPath, token, Json(new { name = "  Kechki-3  " }));
        Assert.Equal(HttpStatusCode.OK, renamed.StatusCode);
        using (var doc = JsonDocument.Parse(await renamed.Content.ReadAsStringAsync()))
            Assert.Equal("Kechki-3", doc.RootElement.GetProperty("name").GetString());

        // ── POST /api/groups/{id}/regenerate-code ──
        var regen = $"{groupPath}/regenerate-code";
        string oldCode;
        await using (var ctx = CreateContext())
            oldCode = (await ctx.Groups.SingleAsync(g => g.Id == group)).JoinCode;
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsync(regen, null)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(client, HttpMethod.Post, regen, TokenFor(s1))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Send(client, HttpMethod.Post, regen, TokenFor(other))).StatusCode);
        var regenResp = await Send(client, HttpMethod.Post, regen, token);
        Assert.Equal(HttpStatusCode.OK, regenResp.StatusCode);
        string newCode;
        using (var doc = JsonDocument.Parse(await regenResp.Content.ReadAsStringAsync()))
            newCode = doc.RootElement.GetProperty("join_code").GetString()!;
        Assert.NotEqual(oldCode, newCode);
        // The old code is dead at once; the new one files a request.
        Assert.Equal(HttpStatusCode.NotFound, (await Send(client, HttpMethod.Post, "/api/groups/join", TokenFor(s3), Json(new { code = oldCode }))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Send(client, HttpMethod.Post, "/api/groups/join", TokenFor(s3), Json(new { code = newCode }))).StatusCode);

        // ── DELETE /api/groups/{id}/members/{studentId} ──
        Guid open1, done1, individual1, sub1;
        await using (var ctx = CreateContext())
        {
            open1 = seed.Assignment(ctx, teacher, s1, q, group);                  // unanswered, from this group
            done1 = seed.Assignment(ctx, teacher, s1, q2, group);                 // answered, from this group
            individual1 = seed.Assignment(ctx, teacher, s1, q, groupId: null);    // not this group's
            await ctx.SaveChangesAsync();
            sub1 = seed.Submission(ctx, s1, q2, DateTime.UtcNow.AddMinutes(1), assignmentId: done1, band: 64);
            await ctx.SaveChangesAsync();
        }
        var memberPath = $"{groupPath}/members/{s1}";
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.DeleteAsync(memberPath)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(client, HttpMethod.Delete, memberPath, TokenFor(s2))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Send(client, HttpMethod.Delete, memberPath, TokenFor(other))).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await Send(client, HttpMethod.Delete, memberPath, token)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Send(client, HttpMethod.Delete, memberPath, token)).StatusCode);   // no longer a member
        await using (var ctx = CreateContext())
        {
            Assert.False(await ctx.GroupMembers.AnyAsync(gm => gm.GroupId == group && gm.StudentId == s1));
            Assert.True(await ctx.GroupMembers.AnyAsync(gm => gm.GroupId == group && gm.StudentId == s2));
            Assert.False(await ctx.Assignments.AnyAsync(a => a.Id == open1));   // an obligation — gone
            Assert.True(await ctx.Assignments.AnyAsync(a => a.Id == done1));    // the record of work — kept
            Assert.True(await ctx.Assignments.AnyAsync(a => a.Id == individual1));
            Assert.True(await ctx.Submissions.AnyAsync(s => s.Id == sub1 && s.AssignmentId == done1));
        }

        // ── DELETE /api/groups/{id} ──
        Guid open2, done2, sub2;
        await using (var ctx = CreateContext())
        {
            open2 = seed.Assignment(ctx, teacher, s2, q, group);
            done2 = seed.Assignment(ctx, teacher, s2, q2, group);
            await ctx.SaveChangesAsync();
            sub2 = seed.Submission(ctx, s2, q2, DateTime.UtcNow.AddMinutes(1), assignmentId: done2, band: 58);
            await ctx.SaveChangesAsync();
            Assert.True(await ctx.GroupJoinRequests.AnyAsync(r => r.GroupId == group && r.Status == "pending"));
        }
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.DeleteAsync(groupPath)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(client, HttpMethod.Delete, groupPath, TokenFor(s2))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Send(client, HttpMethod.Delete, groupPath, TokenFor(other))).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await Send(client, HttpMethod.Delete, groupPath, token)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Send(client, HttpMethod.Get, groupPath, token)).StatusCode);
        await using (var ctx = CreateContext())
        {
            Assert.False(await ctx.Groups.AnyAsync(g => g.Id == group));
            Assert.False(await ctx.GroupMembers.AnyAsync(gm => gm.GroupId == group));
            Assert.False(await ctx.GroupJoinRequests.AnyAsync(r => r.GroupId == group));
            Assert.False(await ctx.Assignments.AnyAsync(a => a.Id == open2));
            // The answered assignment stays as the record of that work, detached from the dead group…
            var kept = await ctx.Assignments.SingleAsync(a => a.Id == done2);
            Assert.Null(kept.GroupId);
            // …and every answer and grade is untouched.
            var sub = await ctx.Submissions.Include(s => s.Evaluation).SingleAsync(s => s.Id == sub2);
            Assert.Equal(done2, sub.AssignmentId);
            Assert.NotNull(sub.Evaluation);
            Assert.True(await ctx.Submissions.AnyAsync(s => s.Id == sub1));
        }

        // ── An admin may manage any teacher's group ──
        var foreign = await seed.GroupAsync(other);
        Assert.Equal(HttpStatusCode.OK, (await Send(client, HttpMethod.Patch, $"/api/groups/{foreign}", TokenFor(admin), Json(new { name = "Admin tuzatdi" }))).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await Send(client, HttpMethod.Delete, $"/api/groups/{foreign}", TokenFor(admin))).StatusCode);
    }

    // ─────────────────────────── 4 · premium + the A6 card ───────────────────────────

    [Fact]
    public async Task A_teacher_grants_premium_only_to_students_on_their_own_roster()
    {
        using var seed = new Seed(this);
        var teacher = await seed.UserAsync(UserRole.Teacher);
        var other = await seed.UserAsync(UserRole.Teacher);
        var admin = await seed.UserAsync(UserRole.Admin);
        var s1 = await seed.UserAsync(UserRole.Student, "Premium Nomzod");
        var outsider = await seed.UserAsync(UserRole.Student);
        var teacherMember = await seed.UserAsync(UserRole.Teacher);   // a non-student who joined the group
        var group = await seed.GroupAsync(teacher, s1, teacherMember);
        await seed.GroupAsync(other, outsider);

        var client = _factory.CreateClient();
        var token = TokenFor(teacher);
        var premium = $"/api/classroom/students/{s1}/premium";
        var on = Json(new { is_premium = true });

        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PatchAsync(premium, on)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(client, HttpMethod.Patch, premium, TokenFor(s1), Json(new { is_premium = true }))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Send(client, HttpMethod.Patch, premium, TokenFor(other), Json(new { is_premium = true }))).StatusCode);
        await AssertCode(await Send(client, HttpMethod.Patch, premium, token, Json(new { })), "is_premium_required");

        var granted = await Send(client, HttpMethod.Patch, premium, token, Json(new { is_premium = true }));
        Assert.Equal(HttpStatusCode.OK, granted.StatusCode);
        using (var doc = JsonDocument.Parse(await granted.Content.ReadAsStringAsync()))
        {
            Assert.Equal(s1, doc.RootElement.GetProperty("id").GetGuid());
            Assert.True(doc.RootElement.GetProperty("is_premium").GetBoolean());
            Assert.True(doc.RootElement.GetProperty("has_premium").GetBoolean());
        }
        await using (var ctx = CreateContext())
            Assert.True((await ctx.Users.SingleAsync(u => u.Id == s1)).IsPremium);

        // Not on this teacher's roster, or not a student at all → 404, never a write.
        Assert.Equal(HttpStatusCode.NotFound, (await Send(client, HttpMethod.Patch,
            $"/api/classroom/students/{outsider}/premium", token, Json(new { is_premium = true }))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Send(client, HttpMethod.Patch,
            $"/api/classroom/students/{teacherMember}/premium", token, Json(new { is_premium = true }))).StatusCode);
        await using (var ctx = CreateContext())
            Assert.False((await ctx.Users.SingleAsync(u => u.Id == outsider)).IsPremium);

        // An admin reaches any student.
        Assert.Equal(HttpStatusCode.OK, (await Send(client, HttpMethod.Patch,
            $"/api/classroom/students/{outsider}/premium", TokenFor(admin), Json(new { is_premium = true }))).StatusCode);

        // ── GET /api/classroom/students/{id} — the A6 header ──
        var card = $"/api/classroom/students/{s1}";
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync(card)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(client, HttpMethod.Get, card, TokenFor(s1))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Send(client, HttpMethod.Get, card, TokenFor(other))).StatusCode);
        var cardResp = await Send(client, HttpMethod.Get, card, token);
        Assert.Equal(HttpStatusCode.OK, cardResp.StatusCode);
        using (var doc = JsonDocument.Parse(await cardResp.Content.ReadAsStringAsync()))
        {
            Assert.Equal("Premium Nomzod", doc.RootElement.GetProperty("full_name").GetString());
            Assert.True(doc.RootElement.GetProperty("is_premium").GetBoolean());
            var groups = doc.RootElement.GetProperty("groups").EnumerateArray().ToList();
            Assert.Equal(group, Assert.Single(groups).GetProperty("id").GetGuid());
        }
        Assert.Equal(HttpStatusCode.OK, (await Send(client, HttpMethod.Get, card, TokenFor(admin))).StatusCode);

        // Revoke.
        using (var doc = JsonDocument.Parse(await (await Send(client, HttpMethod.Patch, premium, token,
                   Json(new { is_premium = false }))).Content.ReadAsStringAsync()))
            Assert.False(doc.RootElement.GetProperty("is_premium").GetBoolean());
    }

    // ─────────────────────────── 5 · the teacher scope ───────────────────────────

    /// <summary>
    /// A class on the PUBLIC catalog is still the teacher's class. The roster student's answer to a
    /// question the teacher did not write reaches every teacher surface — list, ?student_id, queue,
    /// detail, review, gradebook, insights — and a non-roster student's answer to the very same
    /// question reaches none of them.
    /// </summary>
    [Fact]
    public async Task A_roster_students_answer_to_a_public_question_is_the_teachers_and_an_outsiders_is_not()
    {
        using var seed = new Seed(this);
        var teacher = await seed.UserAsync(UserRole.Teacher);
        var otherTeacher = await seed.UserAsync(UserRole.Teacher);
        var author = await seed.UserAsync(UserRole.Admin);            // owns the official public module
        var rosterStudent = await seed.UserAsync(UserRole.Student, "Roster Student");
        var outsider = await seed.UserAsync(UserRole.Student, "Outsider Student");
        await seed.GroupAsync(teacher, rosterStudent);
        await seed.GroupAsync(otherTeacher, outsider);
        var publicQ = await seed.QuestionAsync(author, "Ommaviy savol", publicBlock: true);

        Guid mine, theirs;
        await using (var ctx = CreateContext())
        {
            mine = seed.Submission(ctx, rosterStudent, publicQ, DateTime.UtcNow, band: 70);
            theirs = seed.Submission(ctx, outsider, publicQ, DateTime.UtcNow, band: 40);
            await ctx.SaveChangesAsync();
        }

        var client = _factory.CreateClient();
        var token = TokenFor(teacher);

        var list = await Ids(client, "/api/submissions", token);
        Assert.Contains(mine, list);
        Assert.DoesNotContain(theirs, list);
        Assert.Contains(mine, await Ids(client, $"/api/submissions?student_id={rosterStudent}", token));
        Assert.Empty(await Ids(client, $"/api/submissions?student_id={outsider}", token));   // IDOR: nothing
        Assert.Contains(mine, await Ids(client, "/api/submissions?needs_review=true", token));

        Assert.Equal(HttpStatusCode.OK, (await Send(client, HttpMethod.Get, $"/api/submissions/{mine}", token)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Send(client, HttpMethod.Get, $"/api/submissions/{mine}/detail", token)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Send(client, HttpMethod.Get, $"/api/submissions/{theirs}", token)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Send(client, HttpMethod.Get, $"/api/submissions/{theirs}/detail", token)).StatusCode);

        Assert.Equal(HttpStatusCode.NoContent, (await Send(client, HttpMethod.Patch, $"/api/submissions/{mine}/review", token,
            Json(new { teacher_band = 75 }))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Send(client, HttpMethod.Patch, $"/api/submissions/{theirs}/review", token,
            Json(new { teacher_band = 75 }))).StatusCode);
        await using (var ctx = CreateContext())
            Assert.Null((await ctx.Submissions.SingleAsync(s => s.Id == theirs)).TeacherBand);

        using (var gb = JsonDocument.Parse(await (await Send(client, HttpMethod.Get, "/api/reports/gradebook", token)).Content.ReadAsStringAsync()))
        {
            var rows = gb.RootElement.EnumerateArray().ToList();
            var row = rows.Single(r => r.GetProperty("student_id").GetGuid() == rosterStudent);
            Assert.Equal(75, row.GetProperty("best_band").GetDouble());           // the teacher's verdict
            Assert.DoesNotContain(rows, r => r.GetProperty("student_id").GetGuid() == outsider);
        }
        using (var ins = JsonDocument.Parse(await (await Send(client, HttpMethod.Get, "/api/reports/insights", token)).Content.ReadAsStringAsync()))
        {
            Assert.Equal(1, ins.RootElement.GetProperty("total_students").GetInt32());
            Assert.Equal(1, ins.RootElement.GetProperty("active_students").GetInt32());
            Assert.Equal(75, ins.RootElement.GetProperty("class_avg").GetDouble());
        }

        // The mirror image: the outsider's own teacher sees theirs and not ours.
        var otherList = await Ids(client, "/api/submissions", TokenFor(otherTeacher));
        Assert.Contains(theirs, otherList);
        Assert.DoesNotContain(mine, otherList);

        static async Task<List<Guid>> Ids(HttpClient client, string url, string token)
        {
            var resp = await Send(client, HttpMethod.Get, url, token);
            Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
            using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
            return doc.RootElement.EnumerateArray().Select(r => r.GetProperty("id").GetGuid()).ToList();
        }
    }

    // ─────────────────────────── 6 · the review PATCH ───────────────────────────

    [Fact]
    public async Task Review_patch_is_absent_unchanged_null_clears_and_confirm_never_overwrites_a_comment()
    {
        using var seed = new Seed(this);
        var teacher = await seed.UserAsync(UserRole.Teacher);
        var student = await seed.UserAsync(UserRole.Student);
        await seed.GroupAsync(teacher, student);
        var q = await seed.QuestionAsync(teacher, "Sayohat");

        Guid sub, fresh;
        await using (var ctx = CreateContext())
        {
            sub = seed.Submission(ctx, student, q, DateTime.UtcNow, band: 70);
            fresh = seed.Submission(ctx, student, q, DateTime.UtcNow, band: 66);
            await ctx.SaveChangesAsync();
        }

        var client = _factory.CreateClient();
        var token = TokenFor(teacher);
        var path = $"/api/submissions/{sub}/review";

        await AssertCode(await Send(client, HttpMethod.Patch, path, token, Json(new { })), "empty_review");
        await AssertCode(await Send(client, HttpMethod.Patch, path, token, Json(new { teacher_band = 140 })), "band_out_of_range");
        await AssertCode(await Send(client, HttpMethod.Patch, path, token, Json(new { confirm = true, teacher_band = 80 })), "confirm_with_band");

        // A real verdict: band + comment. The student is told, with a link to the result.
        Assert.Equal(HttpStatusCode.NoContent, (await Send(client, HttpMethod.Patch, path, token,
            Json(new { teacher_band = 60, teacher_comment = "Fe'llarni takrorlang" }))).StatusCode);
        await using (var ctx = CreateContext())
        {
            var ping = Assert.Single(await ctx.Notifications.Where(n => n.UserId == student).ToListAsync());
            Assert.Equal("review_done", ping.Type);
            Assert.Equal($"/results/{sub}", ping.Link);
            Assert.Equal("Javobingiz tekshirildi", ping.Title);
            Assert.Contains("Sayohat", ping.Body);
        }

        // THE LEAK: "✓ Tasdiqlash" on an already-reviewed attempt must not replace the teacher's words
        // with the canned note, and must not touch the band. Nothing changed, so nobody is pinged.
        Assert.Equal(HttpStatusCode.NoContent, (await Send(client, HttpMethod.Patch, path, token,
            Json(new { confirm = true, teacher_comment = "AI bahosi tasdiqlandi" }))).StatusCode);
        await using (var ctx = CreateContext())
        {
            var row = await ctx.Submissions.SingleAsync(s => s.Id == sub);
            Assert.Equal("Fe'llarni takrorlang", row.TeacherComment);
            Assert.Equal(60, row.TeacherBand);
            Assert.Equal(1, await ctx.Notifications.CountAsync(n => n.UserId == student));
        }

        // Absent = unchanged; explicit null = cleared. Clearing the band hands the grade back to the AI.
        Assert.Equal(HttpStatusCode.NoContent, (await Send(client, HttpMethod.Patch, path, token,
            Json(new { teacher_band = (double?)null }))).StatusCode);
        await using (var ctx = CreateContext())
        {
            var row = await ctx.Submissions.SingleAsync(s => s.Id == sub);
            Assert.Null(row.TeacherBand);
            Assert.Equal("Fe'llarni takrorlang", row.TeacherComment);          // absent ⇒ untouched
        }
        Assert.Equal(HttpStatusCode.NoContent, (await Send(client, HttpMethod.Patch, path, token,
            Json(new { teacher_comment = (string?)null }))).StatusCode);
        await using (var ctx = CreateContext())
            Assert.Null((await ctx.Submissions.SingleAsync(s => s.Id == sub)).TeacherComment);

        // With the slot EMPTY, a confirm's note does fill it.
        Assert.Equal(HttpStatusCode.NoContent, (await Send(client, HttpMethod.Patch, path, token,
            Json(new { confirm = true, teacher_comment = "AI bahosi tasdiqlandi" }))).StatusCode);
        await using (var ctx = CreateContext())
            Assert.Equal("AI bahosi tasdiqlandi", (await ctx.Submissions.SingleAsync(s => s.Id == sub)).TeacherComment);

        // A bare confirm is a decision on an unreviewed attempt: stamped, band left to the AI, pinged.
        Assert.Equal(HttpStatusCode.NoContent, (await Send(client, HttpMethod.Patch, $"/api/submissions/{fresh}/review", token,
            Json(new { confirm = true }))).StatusCode);
        await using (var ctx = CreateContext())
        {
            var row = await ctx.Submissions.SingleAsync(s => s.Id == fresh);
            Assert.NotNull(row.ReviewedAt);
            Assert.Null(row.TeacherBand);
            Assert.True(await ctx.Notifications.AnyAsync(n => n.UserId == student && n.Link == $"/results/{fresh}"));

            // Opted out ⇒ the review still saves, the ping does not.
            (await ctx.Users.SingleAsync(u => u.Id == student)).NotificationsEnabled = false;
            await ctx.SaveChangesAsync();
        }
        var before = await NotificationCount(student);
        Assert.Equal(HttpStatusCode.NoContent, (await Send(client, HttpMethod.Patch, $"/api/submissions/{fresh}/review", token,
            Json(new { teacher_comment = "Yana bir izoh" }))).StatusCode);
        Assert.Equal(before, await NotificationCount(student));
    }

    // ─────────────────────────── 7 · join-request notifications ───────────────────────────

    [Fact]
    public async Task Join_requests_ping_the_teacher_and_decisions_ping_the_student()
    {
        using var seed = new Seed(this);
        var teacher = await seed.UserAsync(UserRole.Teacher, "Ms Teacher", language: "en");
        var s1 = await seed.UserAsync(UserRole.Student, "Dilnoza");
        var s2 = await seed.UserAsync(UserRole.Student, "Eldor");
        var s3 = await seed.UserAsync(UserRole.Student, "Farrux");
        var group = await seed.GroupAsync(teacher);
        string code;
        await using (var ctx = CreateContext())
        {
            var g = await ctx.Groups.SingleAsync(x => x.Id == group);
            g.Name = "Kechki-5";
            code = g.JoinCode;
            await ctx.SaveChangesAsync();
        }

        var client = _factory.CreateClient();
        var token = TokenFor(teacher);

        // A request pings the teacher — in THEIR language, pointing at the requests tab. Asking again
        // while it waits is not news.
        Assert.Equal(HttpStatusCode.OK, (await Send(client, HttpMethod.Post, "/api/groups/join", TokenFor(s1), Json(new { code }))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Send(client, HttpMethod.Post, "/api/groups/join", TokenFor(s1), Json(new { code }))).StatusCode);
        await using (var ctx = CreateContext())
        {
            var ping = Assert.Single(await ctx.Notifications.Where(n => n.UserId == teacher).ToListAsync());
            Assert.Equal("join_request", ping.Type);
            Assert.Equal("Request to join", ping.Title);
            Assert.Contains("Dilnoza", ping.Body);
            Assert.Contains("Kechki-5", ping.Body);
            Assert.Equal("/teacher/classes?tab=requests", ping.Link);
        }

        Assert.Equal(HttpStatusCode.OK, (await Send(client, HttpMethod.Post, "/api/groups/join", TokenFor(s2), Json(new { code }))).StatusCode);
        Guid req1, req2;
        await using (var ctx = CreateContext())
        {
            req1 = (await ctx.GroupJoinRequests.SingleAsync(r => r.StudentId == s1)).Id;
            req2 = (await ctx.GroupJoinRequests.SingleAsync(r => r.StudentId == s2)).Id;
        }
        Assert.Equal(HttpStatusCode.NoContent, (await Send(client, HttpMethod.Post, $"/api/groups/requests/{req1}/approve", token)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await Send(client, HttpMethod.Post, $"/api/groups/requests/{req2}/reject", token)).StatusCode);
        await using (var ctx = CreateContext())
        {
            var approved = Assert.Single(await ctx.Notifications.Where(n => n.UserId == s1).ToListAsync());
            Assert.Equal("join_approved", approved.Type);
            Assert.Equal("So‘rovingiz qabul qilindi", approved.Title);
            Assert.Equal("/group", approved.Link);
            var rejected = Assert.Single(await ctx.Notifications.Where(n => n.UserId == s2).ToListAsync());
            Assert.Equal("join_rejected", rejected.Type);
            Assert.Equal("/group", rejected.Link);

            // The teacher turns notifications off.
            (await ctx.Users.SingleAsync(u => u.Id == teacher)).NotificationsEnabled = false;
            await ctx.SaveChangesAsync();
        }
        var before = await NotificationCount(teacher);
        Assert.Equal(HttpStatusCode.OK, (await Send(client, HttpMethod.Post, "/api/groups/join", TokenFor(s3), Json(new { code }))).StatusCode);
        Assert.Equal(before, await NotificationCount(teacher));
        await using (var ctx = CreateContext())
            Assert.True(await ctx.GroupJoinRequests.AnyAsync(r => r.StudentId == s3 && r.Status == "pending"));   // the request itself stands
    }

    // ─────────────────────────── 8 · best-effort ───────────────────────────

    /// <summary>A notifier that fails must not fail the action it reports: the assignment and the
    /// join request are committed and the call returns normally. Checked at both layers — the
    /// caller's guard (a notifier that breaks its no-throw promise) and the implementation's own
    /// (a write that fails inside Engagement's notifier).</summary>
    [Fact]
    public async Task A_failing_notification_never_fails_the_action_it_reports()
    {
        using var seed = new Seed(this);
        var teacher = await seed.UserAsync(UserRole.Teacher);
        var student = await seed.UserAsync(UserRole.Student);
        var joiner = await seed.UserAsync(UserRole.Student);
        var group = await seed.GroupAsync(teacher, student);
        var q = await seed.QuestionAsync(teacher);

        // Caller's guard: the notifier throws on every call.
        await using (var ctx = CreateContext())
        {
            var svc = new ClassroomService(ctx, config: null, notifier: new ThrowingNotifier());
            var created = await svc.CreateAssignmentsAsync(teacher, new CreateAssignmentRequest(q, null, group, null));
            Assert.Equal(ClassroomOutcome.Ok, created.Outcome);
            Assert.Single(created.Value!);

            string code = (await ctx.Groups.SingleAsync(g => g.Id == group)).JoinCode;
            var joined = await svc.JoinGroupAsync(joiner, new JoinGroupRequest(code));
            Assert.Equal(ClassroomOutcome.Ok, joined.Outcome);
        }
        await using (var ctx = CreateContext())
        {
            Assert.True(await ctx.Assignments.AnyAsync(a => a.StudentId == student && a.QuestionId == q));
            Assert.True(await ctx.GroupJoinRequests.AnyAsync(r => r.StudentId == joiner && r.GroupId == group));
        }

        // Implementation's guard: the notifier's own save fails (a broken row is already pending in
        // the shared change tracker). It must not throw, and must leave no half-written ping behind.
        await using (var ctx = CreateContext())
        {
            ctx.GroupMembers.Add(new GroupMember
            {
                Id = Guid.NewGuid(), GroupId = Guid.NewGuid(), StudentId = student,   // FK violation
                CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow,
            });
            var notifier = new ClassroomNotifier(ctx);
            await notifier.AssignmentsCreatedAsync(teacher, [student], q, blockId: null);
            Assert.Empty(ctx.ChangeTracker.Entries<Notification>());
        }
        Assert.Equal(0, await NotificationCount(student));
    }

    // ─────────────────────────── 9 · withdrawn content ───────────────────────────

    /// <summary>A soft-deleted task is gone (404 like a missing one), a draft is refused with a code
    /// the UI can act on, and a module hands out only its live tasks. Nothing is written for either
    /// refusal — an assignment to a task submit would refuse is a task the student can see and not
    /// do.</summary>
    [Fact]
    public async Task Deleted_or_unpublished_tasks_are_never_assigned()
    {
        using var seed = new Seed(this);
        var teacher = await seed.UserAsync(UserRole.Teacher);
        var student = await seed.UserAsync(UserRole.Student);
        var group = await seed.GroupAsync(teacher, student);
        var deleted = await seed.QuestionAsync(teacher);
        var draft = await seed.QuestionAsync(teacher);
        var block = await seed.BlockAsync(teacher, "Aralash modul", tasks: 3);
        await using (var ctx = CreateContext())
        {
            var d = await ctx.Questions.SingleAsync(x => x.Id == deleted);
            d.IsDeleted = true;
            d.IsPublished = false;                        // what the Catalog soft delete writes
            (await ctx.Questions.SingleAsync(x => x.Id == draft)).IsPublished = false;
            var inBlock = await ctx.Questions.Where(x => x.BlockId == block).OrderBy(x => x.SortOrder).ToListAsync();
            inBlock[0].IsDeleted = true;
            inBlock[0].IsPublished = false;
            inBlock[1].IsPublished = false;
            await ctx.SaveChangesAsync();
        }

        var client = _factory.CreateClient();
        var token = TokenFor(teacher);

        Assert.Equal(HttpStatusCode.NotFound, (await Send(client, HttpMethod.Post, "/api/assignments", token,
            Json(new { question_id = deleted, group_id = group }))).StatusCode);
        await AssertCode(await Send(client, HttpMethod.Post, "/api/assignments", token,
            Json(new { question_id = draft, group_id = group })), "question_not_published");

        // The module: of three tasks only the one live task is handed out.
        Assert.Equal(1, await CreatedCount(await Send(client, HttpMethod.Post, "/api/assignments/module", token,
            Json(new { block_id = block, group_id = group }))));

        await using (var ctx = CreateContext())
        {
            var assigned = await ctx.Assignments.Where(a => a.StudentId == student).Select(a => a.QuestionId).ToListAsync();
            var live = await ctx.Questions.Where(x => x.BlockId == block && !x.IsDeleted && x.IsPublished).Select(x => x.Id).SingleAsync();
            Assert.Equal(live, Assert.Single(assigned));
        }
    }

    // ── helpers for this file ──

    private sealed class ThrowingNotifier : IClassroomNotifier
    {
        public Task AssignmentsCreatedAsync(Guid teacherId, IReadOnlyCollection<Guid> studentIds, Guid? questionId, Guid? blockId, CancellationToken ct = default)
            => throw new InvalidOperationException("notifier down");
        public Task ReviewSavedAsync(Guid submissionId, CancellationToken ct = default)
            => throw new InvalidOperationException("notifier down");
        public Task JoinRequestFiledAsync(Guid requestId, CancellationToken ct = default)
            => throw new InvalidOperationException("notifier down");
        public Task JoinRequestDecidedAsync(Guid requestId, CancellationToken ct = default)
            => throw new InvalidOperationException("notifier down");
    }

    private async Task<int> NotificationCount(Guid userId)
    {
        await using var ctx = CreateContext();
        return await ctx.Notifications.CountAsync(n => n.UserId == userId);
    }

    private static async Task<int> CreatedCount(HttpResponseMessage resp)
    {
        Assert.Equal(HttpStatusCode.Created, resp.StatusCode);
        using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
        return doc.RootElement.GetArrayLength();
    }

    /// <summary>A 400 whose body carries this machine code beside a human detail.</summary>
    private static async Task AssertCode(HttpResponseMessage resp, string code)
    {
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
        using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
        Assert.Equal(code, doc.RootElement.GetProperty("code").GetString());
        Assert.False(string.IsNullOrWhiteSpace(doc.RootElement.GetProperty("detail").GetString()));
    }

    /// <summary>
    /// Seeds one test's world and removes all of it on dispose, in FK order — including every
    /// notification the routes under test wrote (they cascade with their user anyway; deleting them
    /// explicitly keeps the cleanup readable).
    /// </summary>
    private sealed class Seed(ClassroomEndpointsTests owner) : IDisposable
    {
        private readonly List<Guid> _users = [];
        private readonly List<Guid> _groups = [];
        private readonly List<Guid> _questions = [];
        private readonly List<Guid> _blocks = [];

        public async Task<Guid> UserAsync(
            UserRole role, string? name = null, string language = "uz", bool notifications = true)
        {
            var id = Guid.NewGuid();
            await using var ctx = owner.CreateContext();
            var user = NewUser(id, $"mgmt-{id:N}@example.test", role, null, name ?? $"{role} {id.ToString()[..4]}");
            user.PreferredLanguage = language;
            user.NotificationsEnabled = notifications;
            ctx.Users.Add(user);
            await ctx.SaveChangesAsync();
            _users.Add(id);
            return id;
        }

        public async Task<Guid> GroupAsync(Guid teacherId, params Guid[] members)
        {
            var id = Guid.NewGuid();
            await using var ctx = owner.CreateContext();
            ctx.Groups.Add(new Group
            {
                Id = id,
                TeacherId = teacherId,
                Name = "Mgmt guruh",
                JoinCode = $"{id:N}"[..8].ToUpperInvariant(),
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow,
            });
            foreach (var m in members)
                ctx.GroupMembers.Add(new GroupMember
                {
                    Id = Guid.NewGuid(), GroupId = id, StudentId = m,
                    CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow,
                });
            await ctx.SaveChangesAsync();
            _groups.Add(id);
            return id;
        }

        public async Task<Guid> QuestionAsync(Guid teacherId, string title = "Mgmt topshiriq", bool publicBlock = false)
        {
            var id = Guid.NewGuid();
            await using var ctx = owner.CreateContext();
            Guid? blockId = null;
            if (publicBlock)
            {
                blockId = Guid.NewGuid();
                ctx.QuestionBlocks.Add(NewBlock(blockId.Value, teacherId, "Official", "public"));
                _blocks.Add(blockId.Value);
            }
            var q = NewQuestion(id, teacherId);
            q.Title = title;
            q.BlockId = blockId;
            ctx.Questions.Add(q);
            await ctx.SaveChangesAsync();
            _questions.Add(id);
            return id;
        }

        public async Task<Guid> BlockAsync(Guid teacherId, string name, int tasks)
        {
            var id = Guid.NewGuid();
            await using var ctx = owner.CreateContext();
            ctx.QuestionBlocks.Add(NewBlock(id, teacherId, name, "private"));
            for (var i = 0; i < tasks; i++)
            {
                var qid = Guid.NewGuid();
                var q = NewQuestion(qid, teacherId);
                q.BlockId = id;
                q.SortOrder = i;
                ctx.Questions.Add(q);
                _questions.Add(qid);
            }
            await ctx.SaveChangesAsync();
            _blocks.Add(id);
            return id;
        }

        /// <summary>An answer (Done), graded when <paramref name="band"/> is given. Added to
        /// <paramref name="ctx"/>; the caller saves.</summary>
        public Guid Submission(
            GovoriDbContext ctx, Guid studentId, Guid questionId, DateTime at,
            Guid? assignmentId = null, double? band = null)
        {
            var id = Guid.NewGuid();
            var sub = new Submission
            {
                Id = id,
                StudentId = studentId,
                QuestionId = questionId,
                AssignmentId = assignmentId,
                AudioKey = $"answers/{id:N}.webm",
                Status = SubmissionStatus.Done,
                CreatedAt = at,
                UpdatedAt = at,
            };
            ctx.Submissions.Add(sub);
            if (band is { } b)
                ctx.Evaluations.Add(new Evaluation
                {
                    Id = Guid.NewGuid(),
                    Submission = sub,
                    FluencyScore = b, LexicalScore = b, GrammarScore = b,
                    OverallBand = b,
                    CreatedAt = at, UpdatedAt = at,
                });
            return id;
        }

        /// <summary>An unanswered, deadline-free assignment. Added to <paramref name="ctx"/>; the
        /// caller saves.</summary>
        public Guid Assignment(GovoriDbContext ctx, Guid teacherId, Guid studentId, Guid questionId, Guid? groupId)
        {
            var id = Guid.NewGuid();
            ctx.Assignments.Add(new Assignment
            {
                Id = id,
                TeacherId = teacherId,
                StudentId = studentId,
                QuestionId = questionId,
                GroupId = groupId,
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow,
            });
            return id;
        }

        public void Dispose()
        {
            using var ctx = owner.CreateContext();
            var users = _users;
            ctx.Submissions.Where(s => users.Contains(s.StudentId)).ExecuteDelete();   // evaluations cascade
            ctx.Assignments.Where(a => users.Contains(a.StudentId) || users.Contains(a.TeacherId)).ExecuteDelete();
            ctx.GroupJoinRequests.Where(r => users.Contains(r.StudentId)).ExecuteDelete();
            ctx.GroupMembers.Where(gm => users.Contains(gm.StudentId)).ExecuteDelete();
            ctx.Groups.Where(g => users.Contains(g.TeacherId)).ExecuteDelete();
            ctx.Questions.Where(q => users.Contains(q.TeacherId)).ExecuteDelete();
            ctx.QuestionBlocks.Where(b => users.Contains(b.TeacherId)).ExecuteDelete();
            ctx.Notifications.Where(n => users.Contains(n.UserId)).ExecuteDelete();
            ctx.Users.Where(u => users.Contains(u.Id)).ExecuteDelete();
        }

        private static QuestionBlock NewBlock(Guid id, Guid teacherId, string name, string visibility) => new()
        {
            Id = id,
            TeacherId = teacherId,
            Name = name,
            Visibility = visibility,
            IsPublished = true,
            SortOrder = 0,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
        };
    }
}
