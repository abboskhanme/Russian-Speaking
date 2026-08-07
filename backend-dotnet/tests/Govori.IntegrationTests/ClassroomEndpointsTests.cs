using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Govori.Identity.Security;
using Govori.Infrastructure;
using Govori.Infrastructure.Entities;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Govori.IntegrationTests;

/// <summary>
/// End-to-end coverage for the Classroom slice (docs/07 §3.5, Faza 3.5): HTTP → ClassroomService →
/// EF Core (prod-shaped Postgres) and back. Drives the full lifecycle in one flow so the seed is a
/// single idempotent unit:
/// <list type="bullet">
///   <item>a teacher creates a group and gets a join code (201);</item>
///   <item><b>join is a REQUEST, not a membership</b>: a student's join by code files a pending
///   request (idempotently) and moves the roster not at all; the OWNING teacher's approve is what
///   creates the membership. The queue is owner-scoped — another teacher neither sees nor can decide
///   the request (404, never 403, so its existence is not leaked), and a student is 403 outright.
///   Rejecting admits nobody, records who decided, and still lets the student ask again;</item>
///   <item><b>the S1 roster-bug fix</b>: the teacher assigns a task to [rostered student, OUTSIDER
///   student]; only the rostered student gets an assignment — the outsider (another teacher's
///   student) is filtered out, and NO assignment row is written for them;</item>
///   <item>after a graded submission, the rostered student appears in the teacher's gradebook with the
///   right band, and the outsider (even with a submission to the teacher's own question) never does;</item>
///   <item><b>analytics inherit the same scoping</b>: <c>/reports/insights</c> summarises exactly the
///   answers the gradebook shows (its headline IS the mean of those rows' <c>avg_band</c>), a student
///   is 403, and a teacher passing another teacher's <c>group_id</c> learns nothing about it — not
///   even its size, since the group filter intersects with the caller's roster instead of replacing
///   it;</item>
///   <item>authorization negatives: a student can't create a group (403); a non-owner teacher can't
///   read the group (404); anonymous calls are 401.</item>
/// </list>
///
/// <para><b>Why the S1 case matters.</b> The historical assignment-creation bug (§7.8) filtered
/// targets ONLY by <c>role == student</c> — never through the acting teacher's roster — so any
/// teacher could push work onto any student in the system. This test is the regression guard: the
/// outsider must NOT receive an assignment. Assignment creation must therefore keep applying the
/// same roster filter the review path uses; dropping it silently reopens S1.</para>
///
/// Every seeded row is removed in a finally so the run is idempotent.
/// </summary>
public sealed class ClassroomEndpointsTests : IClassFixture<ClassroomEndpointsTests.ClassroomApiFactory>, IDisposable
{
    private readonly ClassroomApiFactory _factory;
    private readonly NpgsqlDataSource _dataSource;

    public ClassroomEndpointsTests(ClassroomApiFactory factory)
    {
        _factory = factory;
        _dataSource = GovoriDataSourceFactory.Build(factory.ConnectionString);
    }

    private GovoriDbContext CreateContext()
    {
        var builder = new DbContextOptionsBuilder<GovoriDbContext>();
        builder.UseGovori(_dataSource);
        return new GovoriDbContext(builder.Options);
    }

    [Fact]
    public async Task Group_lifecycle_roster_S1_fix_and_gradebook()
    {
        var teacherAId = Guid.NewGuid();
        var teacherBId = Guid.NewGuid();
        var rosterStudentId = Guid.NewGuid();   // joins teacher A's group → in A's roster
        var outsiderStudentId = Guid.NewGuid();  // joins teacher B's group → NOT in A's roster
        var questionAId = Guid.NewGuid();        // owned by teacher A
        var submissionId = Guid.NewGuid();
        var evaluationId = Guid.NewGuid();
        const string password = "Classroom!123";

        var teacherAEmail = $"cls-tA-{teacherAId:N}@example.test";
        var teacherBEmail = $"cls-tB-{teacherBId:N}@example.test";
        var rosterEmail = $"cls-s1-{rosterStudentId:N}@example.test";
        var outsiderEmail = $"cls-s2-{outsiderStudentId:N}@example.test";

        var hasher = new PasswordHasher();
        var createdGroupIds = new List<Guid>();

        await using (var ctx = CreateContext())
        {
            ctx.Users.Add(NewUser(teacherAId, teacherAEmail, UserRole.Teacher, hasher.Hash(password)));
            ctx.Users.Add(NewUser(teacherBId, teacherBEmail, UserRole.Teacher, hasher.Hash(password)));
            ctx.Users.Add(NewUser(rosterStudentId, rosterEmail, UserRole.Student, hasher.Hash(password), "Anvar Student"));
            ctx.Users.Add(NewUser(outsiderStudentId, outsiderEmail, UserRole.Student, hasher.Hash(password), "Bekzod Outsider"));
            ctx.Questions.Add(NewQuestion(questionAId, teacherAId));
            await ctx.SaveChangesAsync();
        }

        try
        {
            var client = _factory.CreateClient();
            var tokenA = TokenFor(teacherAId);
            var tokenB = TokenFor(teacherBId);
            var tokenRoster = TokenFor(rosterStudentId);
            var tokenOutsider = TokenFor(outsiderStudentId);

            // ── Anonymous → 401 ──
            Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/groups/mine")).StatusCode);
            Assert.Equal(HttpStatusCode.Unauthorized,
                (await client.PostAsJsonAsync("/api/groups", new { name = "x" })).StatusCode);
            Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/reports/gradebook")).StatusCode);

            // ── Teacher A creates a group → 201 + join code ──
            var createResp = await Send(client, HttpMethod.Post, "/api/groups", tokenA, Json(new { name = "Guruh A" }));
            Assert.Equal(HttpStatusCode.Created, createResp.StatusCode);
            using var createDoc = JsonDocument.Parse(await createResp.Content.ReadAsStringAsync());
            var groupAId = createDoc.RootElement.GetProperty("id").GetGuid();
            createdGroupIds.Add(groupAId);
            var joinCodeA = createDoc.RootElement.GetProperty("join_code").GetString()!;
            Assert.False(string.IsNullOrWhiteSpace(joinCodeA));
            Assert.Equal(0, createDoc.RootElement.GetProperty("member_count").GetInt32());
            Assert.Equal(teacherAId, createDoc.RootElement.GetProperty("teacher_id").GetGuid());

            // ── Student CANNOT create a group → 403 ──
            var studentCreate = await Send(client, HttpMethod.Post, "/api/groups", tokenRoster, Json(new { name = "nope" }));
            Assert.Equal(HttpStatusCode.Forbidden, studentCreate.StatusCode);

            // ── Teacher B creates their own group (so the outsider has a real "other teacher") ──
            var createBResp = await Send(client, HttpMethod.Post, "/api/groups", tokenB, Json(new { name = "Guruh B" }));
            Assert.Equal(HttpStatusCode.Created, createBResp.StatusCode);
            using var createBDoc = JsonDocument.Parse(await createBResp.Content.ReadAsStringAsync());
            var groupBId = createBDoc.RootElement.GetProperty("id").GetGuid();
            createdGroupIds.Add(groupBId);
            var joinCodeB = createBDoc.RootElement.GetProperty("join_code").GetString()!;

            // ── Students REQUEST to join by code (lowercase to prove normalization) ──
            // Joining no longer grants membership: it files a request the owning teacher decides.
            var joinResp = await Send(client, HttpMethod.Post, "/api/groups/join", tokenRoster, Json(new { code = joinCodeA.ToLowerInvariant() }));
            Assert.Equal(HttpStatusCode.OK, joinResp.StatusCode);
            using (var joinDoc = JsonDocument.Parse(await joinResp.Content.ReadAsStringAsync()))
            {
                Assert.True(joinDoc.RootElement.GetProperty("pending").GetBoolean());
                // The roster must NOT have moved — approval is what admits a student.
                Assert.Equal(0, joinDoc.RootElement.GetProperty("member_count").GetInt32());
            }

            // Idempotent: asking again does NOT queue a second request.
            Assert.Equal(HttpStatusCode.OK,
                (await Send(client, HttpMethod.Post, "/api/groups/join", tokenRoster, Json(new { code = joinCodeA }))).StatusCode);
            await using (var ctx = CreateContext())
            {
                Assert.Equal(1, await ctx.GroupJoinRequests.CountAsync(
                    r => r.GroupId == groupAId && r.StudentId == rosterStudentId && r.Status == "pending"));
                Assert.Equal(0, await ctx.GroupMembers.CountAsync(gm => gm.GroupId == groupAId));
            }

            // The student can see their own pending request (drives Home's "waiting" state).
            using (var mineReqDoc = JsonDocument.Parse(await (await Send(client, HttpMethod.Get, "/api/groups/requests/mine", tokenRoster)).Content.ReadAsStringAsync()))
                Assert.Contains(mineReqDoc.RootElement.EnumerateArray(), r => r.GetProperty("group_id").GetGuid() == groupAId);

            // ── The request queue is OWNER-SCOPED ──
            Guid requestId;
            using (var reqDoc = JsonDocument.Parse(await (await Send(client, HttpMethod.Get, "/api/groups/requests", tokenA)).Content.ReadAsStringAsync()))
            {
                var mine = reqDoc.RootElement.EnumerateArray()
                    .Where(r => r.GetProperty("group_id").GetGuid() == groupAId).ToList();
                Assert.Single(mine);
                Assert.Equal(rosterStudentId, mine[0].GetProperty("student_id").GetGuid());
                Assert.Equal(joinCodeA, mine[0].GetProperty("join_code").GetString());
                requestId = mine[0].GetProperty("id").GetGuid();
            }
            // Teacher B never sees another teacher's request…
            using (var reqBDoc = JsonDocument.Parse(await (await Send(client, HttpMethod.Get, "/api/groups/requests", tokenB)).Content.ReadAsStringAsync()))
                Assert.DoesNotContain(reqBDoc.RootElement.EnumerateArray(), r => r.GetProperty("id").GetGuid() == requestId);
            // …and cannot decide it — 404, not 403, so its existence is never leaked.
            Assert.Equal(HttpStatusCode.NotFound,
                (await Send(client, HttpMethod.Post, $"/api/groups/requests/{requestId}/approve", tokenB)).StatusCode);
            // A student has no business in the queue at all.
            Assert.Equal(HttpStatusCode.Forbidden,
                (await Send(client, HttpMethod.Get, "/api/groups/requests", tokenRoster)).StatusCode);
            // Still nobody in the group after those rejected attempts.
            await using (var ctx = CreateContext())
                Assert.Equal(0, await ctx.GroupMembers.CountAsync(gm => gm.GroupId == groupAId));

            // ── The OWNER approves → membership appears, request leaves the queue ──
            Assert.Equal(HttpStatusCode.NoContent,
                (await Send(client, HttpMethod.Post, $"/api/groups/requests/{requestId}/approve", tokenA)).StatusCode);
            await using (var ctx = CreateContext())
            {
                Assert.Equal(1, await ctx.GroupMembers.CountAsync(
                    gm => gm.GroupId == groupAId && gm.StudentId == rosterStudentId));
                Assert.Equal(0, await ctx.GroupJoinRequests.CountAsync(
                    r => r.Id == requestId && r.Status == "pending"));
            }
            // Deciding twice is a no-op the caller cannot act on → 404.
            Assert.Equal(HttpStatusCode.NotFound,
                (await Send(client, HttpMethod.Post, $"/api/groups/requests/{requestId}/reject", tokenA)).StatusCode);

            // Re-joining once already a member reports pending:false, not a fresh request.
            using (var reJoinDoc = JsonDocument.Parse(await (await Send(client, HttpMethod.Post, "/api/groups/join", tokenRoster, Json(new { code = joinCodeA }))).Content.ReadAsStringAsync()))
            {
                Assert.False(reJoinDoc.RootElement.GetProperty("pending").GetBoolean());
                Assert.Equal(1, reJoinDoc.RootElement.GetProperty("member_count").GetInt32());
            }

            // ── REJECT: the outsider asks to join group A and is declined ──
            Assert.Equal(HttpStatusCode.OK,
                (await Send(client, HttpMethod.Post, "/api/groups/join", tokenOutsider, Json(new { code = joinCodeA }))).StatusCode);
            Guid rejectId;
            using (var reqDoc = JsonDocument.Parse(await (await Send(client, HttpMethod.Get, "/api/groups/requests", tokenA)).Content.ReadAsStringAsync()))
                rejectId = reqDoc.RootElement.EnumerateArray()
                    .Single(r => r.GetProperty("student_id").GetGuid() == outsiderStudentId).GetProperty("id").GetGuid();
            Assert.Equal(HttpStatusCode.NoContent,
                (await Send(client, HttpMethod.Post, $"/api/groups/requests/{rejectId}/reject", tokenA)).StatusCode);
            await using (var ctx = CreateContext())
            {
                // Rejection admits nobody…
                Assert.Equal(0, await ctx.GroupMembers.CountAsync(
                    gm => gm.GroupId == groupAId && gm.StudentId == outsiderStudentId));
                // …and is attributable, not anonymous.
                var decided = await ctx.GroupJoinRequests.SingleAsync(r => r.Id == rejectId);
                Assert.Equal("rejected", decided.Status);
                Assert.Equal(teacherAId, decided.DecidedBy);
                Assert.NotNull(decided.DecidedAt);
            }
            // A rejected student may ask again — the partial unique index must not lock them out.
            Assert.Equal(HttpStatusCode.OK,
                (await Send(client, HttpMethod.Post, "/api/groups/join", tokenOutsider, Json(new { code = joinCodeA }))).StatusCode);
            await using (var ctx = CreateContext())
            {
                Assert.Equal(1, await ctx.GroupJoinRequests.CountAsync(
                    r => r.GroupId == groupAId && r.StudentId == outsiderStudentId && r.Status == "pending"));
                // Cleared so the outsider stays OUT of group A for the S1 assertions below.
                var pending = await ctx.GroupJoinRequests.SingleAsync(
                    r => r.GroupId == groupAId && r.StudentId == outsiderStudentId && r.Status == "pending");
                ctx.GroupJoinRequests.Remove(pending);
                await ctx.SaveChangesAsync();
            }

            // ── The outsider becomes teacher B's student, via the same request→approve path ──
            Assert.Equal(HttpStatusCode.OK,
                (await Send(client, HttpMethod.Post, "/api/groups/join", tokenOutsider, Json(new { code = joinCodeB }))).StatusCode);
            using (var reqBDoc = JsonDocument.Parse(await (await Send(client, HttpMethod.Get, "/api/groups/requests", tokenB)).Content.ReadAsStringAsync()))
            {
                var id = reqBDoc.RootElement.EnumerateArray()
                    .Single(r => r.GetProperty("group_id").GetGuid() == groupBId).GetProperty("id").GetGuid();
                Assert.Equal(HttpStatusCode.NoContent,
                    (await Send(client, HttpMethod.Post, $"/api/groups/requests/{id}/approve", tokenB)).StatusCode);
            }

            // Invalid code → 404.
            Assert.Equal(HttpStatusCode.NotFound,
                (await Send(client, HttpMethod.Post, "/api/groups/join", tokenOutsider, Json(new { code = "ZZZZZZ" }))).StatusCode);

            // ── /groups/mine reflects the approved membership for the student, and NOT the teacher ──
            using (var mineDoc = JsonDocument.Parse(await (await Send(client, HttpMethod.Get, "/api/groups/mine", tokenRoster)).Content.ReadAsStringAsync()))
                Assert.Contains(mineDoc.RootElement.EnumerateArray(), g => g.GetProperty("id").GetGuid() == groupAId);

            // ── Roster: teacher A sees exactly the rostered student ──
            var detailResp = await Send(client, HttpMethod.Get, $"/api/groups/{groupAId}", tokenA);
            Assert.Equal(HttpStatusCode.OK, detailResp.StatusCode);
            using (var detailDoc = JsonDocument.Parse(await detailResp.Content.ReadAsStringAsync()))
            {
                Assert.Equal(1, detailDoc.RootElement.GetProperty("member_count").GetInt32());
                var members = detailDoc.RootElement.GetProperty("members").EnumerateArray().ToList();
                Assert.Single(members);
                Assert.Equal(rosterStudentId, members[0].GetProperty("id").GetGuid());
                Assert.DoesNotContain(members, m => m.GetProperty("id").GetGuid() == outsiderStudentId);
            }

            // ── Non-owner teacher B → 404 (never leaks existence); student → 403 (require_teacher) ──
            Assert.Equal(HttpStatusCode.NotFound, (await Send(client, HttpMethod.Get, $"/api/groups/{groupAId}", tokenB)).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await Send(client, HttpMethod.Get, $"/api/groups/{groupAId}", tokenRoster)).StatusCode);

            // ── S1 FIX: assign teacher A's task to BOTH students; only the rostered one is created ──
            var assignBody = Json(new { question_id = questionAId, student_ids = new[] { rosterStudentId, outsiderStudentId } });
            var assignResp = await Send(client, HttpMethod.Post, "/api/assignments", tokenA, assignBody);
            Assert.Equal(HttpStatusCode.Created, assignResp.StatusCode);
            using (var assignDoc = JsonDocument.Parse(await assignResp.Content.ReadAsStringAsync()))
            {
                var rows = assignDoc.RootElement.EnumerateArray().ToList();
                Assert.Single(rows);                                             // outsider filtered out
                Assert.Equal(rosterStudentId, rows[0].GetProperty("student_id").GetGuid());
                Assert.Equal(questionAId, rows[0].GetProperty("question_id").GetGuid());
                Assert.False(rows[0].GetProperty("completed").GetBoolean());
            }
            // Proof at the data layer: no assignment row exists for the outsider.
            await using (var ctx = CreateContext())
            {
                Assert.Equal(0, await ctx.Assignments.CountAsync(a => a.StudentId == outsiderStudentId));
                Assert.Equal(1, await ctx.Assignments.CountAsync(a => a.StudentId == rosterStudentId && a.TeacherId == teacherAId));
            }

            // ── Seed a graded submission for the rostered student (level_score = 80) ──
            await using (var ctx = CreateContext())
            {
                ctx.Submissions.Add(new Submission
                {
                    Id = submissionId,
                    StudentId = rosterStudentId,
                    QuestionId = questionAId,
                    AudioKey = $"answers/{submissionId:N}.webm",
                    Status = SubmissionStatus.Done,
                    CreatedAt = DateTime.UtcNow.AddMinutes(1),                    // after the assignment
                    UpdatedAt = DateTime.UtcNow,
                });
                await ctx.SaveChangesAsync();
                ctx.Evaluations.Add(new Evaluation
                {
                    Id = evaluationId,
                    SubmissionId = submissionId,
                    FluencyScore = 75, LexicalScore = 75, GrammarScore = 75,
                    OverallBand = 70, LevelScore = 80,                           // effective_band → 80
                    CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow,
                });
                // An outsider submission to teacher A's OWN question — must still be invisible to A.
                var outsiderSub = new Submission
                {
                    Id = Guid.NewGuid(),
                    StudentId = outsiderStudentId,
                    QuestionId = questionAId,
                    AudioKey = $"answers/out-{Guid.NewGuid():N}.webm",
                    Status = SubmissionStatus.Done,
                    CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow,
                };
                ctx.Submissions.Add(outsiderSub);
                await ctx.SaveChangesAsync();
            }

            // ── Gradebook: only the rostered student, with the C3 band ──
            var gradebookResp = await Send(client, HttpMethod.Get, "/api/reports/gradebook", tokenA);
            Assert.Equal(HttpStatusCode.OK, gradebookResp.StatusCode);
            using (var gbDoc = JsonDocument.Parse(await gradebookResp.Content.ReadAsStringAsync()))
            {
                var rows = gbDoc.RootElement.EnumerateArray().ToList();
                var mine = rows.Single(r => r.GetProperty("student_id").GetGuid() == rosterStudentId);
                Assert.Equal(80, mine.GetProperty("best_band").GetDouble());
                Assert.Equal(80, mine.GetProperty("avg_band").GetDouble());
                Assert.True(mine.GetProperty("attempts").GetInt32() >= 1);
                Assert.DoesNotContain(rows, r => r.GetProperty("student_id").GetGuid() == outsiderStudentId);

                // The per-skill columns (D2 Jurnal) describe the SAME answers as avg_band above.
                // Pronunciation is null on this evaluation and must stay null — not 0, which would
                // read as "scored zero" and drag any average built on it down.
                Assert.Equal(75, mine.GetProperty("fluency").GetDouble());
                Assert.Equal(75, mine.GetProperty("grammar").GetDouble());
                Assert.Equal(75, mine.GetProperty("lexical").GetDouble());
                Assert.Equal(JsonValueKind.Null, mine.GetProperty("pronunciation").ValueKind);
            }

            // ── Insights (D1): the composed analytics read, on the same scoped set ──
            var insightsResp = await Send(client, HttpMethod.Get, "/api/reports/insights", tokenA);
            Assert.Equal(HttpStatusCode.OK, insightsResp.StatusCode);
            using (var inDoc = JsonDocument.Parse(await insightsResp.Content.ReadAsStringAsync()))
            {
                var root = inDoc.RootElement;

                // The headline is the mean of the gradebook's own avg_band values, so the number on
                // the Insaytlar card can never disagree with the Jurnal table under it.
                Assert.Equal(80, root.GetProperty("class_avg").GetDouble());
                Assert.Equal("B2", root.GetProperty("class_level").GetString());

                // Only the ROSTERED student counts — the outsider has a submission to teacher A's own
                // question and must move none of these numbers.
                Assert.Equal(1, root.GetProperty("total_students").GetInt32());
                Assert.Equal(1, root.GetProperty("active_students").GetInt32());

                // Fixed-length series, so the chart's axes never shrink with the data.
                Assert.Equal(3, root.GetProperty("trend").GetArrayLength());
                Assert.Equal(7, root.GetProperty("week").GetArrayLength());
                var thisMonth = root.GetProperty("trend").EnumerateArray().Last();
                Assert.Equal(DateTime.UtcNow.Month, thisMonth.GetProperty("month").GetInt32());
                Assert.Equal(80, thisMonth.GetProperty("avg").GetDouble());
                // Only one month has anything graded, so there is no movement to report — one data
                // point is not a trend, and the chip must stay absent rather than read "+0".
                Assert.Equal(JsonValueKind.Null, root.GetProperty("trend_delta").ValueKind);
                var today = root.GetProperty("week").EnumerateArray().Last();
                Assert.Equal(DateOnly.FromDateTime(DateTime.UtcNow).ToString("yyyy-MM-dd"), today.GetProperty("date").GetString());
                Assert.True(today.GetProperty("attempts").GetInt32() >= 1);

                Assert.Equal(75, root.GetProperty("skills").GetProperty("fluency").GetDouble());
                Assert.Equal(JsonValueKind.Null, root.GetProperty("skills").GetProperty("pronunciation").ValueKind);

                // The assignment written above is the one the completion rate describes.
                Assert.Equal(1, root.GetProperty("assignments_total").GetInt32());
                Assert.Equal(1, root.GetProperty("assignments_done").GetInt32());

                // Nothing reviewed yet, and this evaluation carries no corrections — both read as
                // genuinely empty rather than as a zero-filled card.
                Assert.Equal(0, root.GetProperty("reviewed_week").GetInt32());
                Assert.Equal(0, root.GetProperty("errors").GetArrayLength());
            }

            // A student may not read the analytics at all.
            Assert.Equal(HttpStatusCode.Forbidden, (await Send(client, HttpMethod.Get, "/api/reports/insights", tokenRoster)).StatusCode);

            // Teacher B asking about teacher A's group learns NOTHING about it — not even its size.
            // The group filter intersects with the caller's own roster; it never replaces it.
            using (var foreignDoc = JsonDocument.Parse(await (await Send(
                client, HttpMethod.Get, $"/api/reports/insights?group_id={groupAId}", tokenB)).Content.ReadAsStringAsync()))
            {
                Assert.Equal(0, foreignDoc.RootElement.GetProperty("total_students").GetInt32());
                Assert.Equal(JsonValueKind.Null, foreignDoc.RootElement.GetProperty("class_avg").ValueKind);
            }

            // ── The assignment now reads as completed with the same band ──
            using (var listDoc = JsonDocument.Parse(await (await Send(client, HttpMethod.Get, "/api/assignments", tokenA)).Content.ReadAsStringAsync()))
            {
                var mine = listDoc.RootElement.EnumerateArray()
                    .Single(a => a.GetProperty("student_id").GetGuid() == rosterStudentId && a.GetProperty("question_id").GetGuid() == questionAId);
                Assert.True(mine.GetProperty("completed").GetBoolean());
                Assert.Equal(submissionId, mine.GetProperty("submission_id").GetGuid());
                Assert.Equal(80, mine.GetProperty("overall_band").GetDouble());
            }

            // ── Student can read their own assignments; a student hitting the gradebook → 403 ──
            using (var mineAsg = JsonDocument.Parse(await (await Send(client, HttpMethod.Get, "/api/assignments/mine", tokenRoster)).Content.ReadAsStringAsync()))
                Assert.Contains(mineAsg.RootElement.EnumerateArray(), a => a.GetProperty("question_id").GetGuid() == questionAId);
            Assert.Equal(HttpStatusCode.Forbidden, (await Send(client, HttpMethod.Get, "/api/reports/gradebook", tokenRoster)).StatusCode);

            // ── PATCH /submissions/{id}/review — the manual verdict, and who may write it ──
            // The rostered student's graded attempt is the one under review (seeded below as
            // `submissionId`); it is reachable by teacher A only.
            {
                var reviewPath = $"/api/submissions/{submissionId}/review";

                // A student may never grade — not even their own attempt.
                Assert.Equal(HttpStatusCode.Forbidden,
                    (await Send(client, HttpMethod.Patch, reviewPath, tokenRoster,
                        Json(new { teacher_band = 80 }))).StatusCode);

                // Another teacher gets 404, NOT 403 — submission ids must not be probeable.
                Assert.Equal(HttpStatusCode.NotFound,
                    (await Send(client, HttpMethod.Patch, reviewPath, tokenB,
                        Json(new { teacher_band = 80 }))).StatusCode);

                // An empty body is refused: it would stamp reviewed_at and clear the queue row
                // while recording no decision at all.
                Assert.Equal(HttpStatusCode.BadRequest,
                    (await Send(client, HttpMethod.Patch, reviewPath, tokenA, Json(new { }))).StatusCode);

                // Out-of-range band is refused.
                Assert.Equal(HttpStatusCode.BadRequest,
                    (await Send(client, HttpMethod.Patch, reviewPath, tokenA,
                        Json(new { teacher_band = 140 }))).StatusCode);

                // Nothing above may have written anything.
                await using (var ctx = CreateContext())
                {
                    var untouched = await ctx.Submissions.SingleAsync(s => s.Id == submissionId);
                    Assert.Null(untouched.TeacherBand);
                    Assert.Null(untouched.ReviewedAt);
                }

                // The owning teacher writes the verdict → 204, all four fields set.
                Assert.Equal(HttpStatusCode.NoContent,
                    (await Send(client, HttpMethod.Patch, reviewPath, tokenA,
                        Json(new { teacher_band = 77.5, teacher_comment = "  Yaxshi urinish!  " }))).StatusCode);
                await using (var ctx = CreateContext())
                {
                    var reviewed = await ctx.Submissions.SingleAsync(s => s.Id == submissionId);
                    Assert.Equal(77.5, reviewed.TeacherBand);
                    Assert.Equal("Yaxshi urinish!", reviewed.TeacherComment);   // trimmed
                    Assert.Equal(teacherAId, reviewed.ReviewedBy);              // attributable
                    Assert.NotNull(reviewed.ReviewedAt);
                }

                // Reviewing drops it out of the ?needs_review queue.
                using (var qDoc = JsonDocument.Parse(await (await Send(
                    client, HttpMethod.Get, "/api/submissions?needs_review=true", tokenA)).Content.ReadAsStringAsync()))
                {
                    Assert.DoesNotContain(qDoc.RootElement.EnumerateArray(),
                        r => r.GetProperty("id").GetGuid() == submissionId);
                }

                // A comment-only PATCH leaves the band alone (confirm-the-AI-but-add-a-note).
                Assert.Equal(HttpStatusCode.NoContent,
                    (await Send(client, HttpMethod.Patch, reviewPath, tokenA,
                        Json(new { teacher_comment = "Ikkinchi izoh" }))).StatusCode);
                await using (var ctx = CreateContext())
                {
                    var again = await ctx.Submissions.SingleAsync(s => s.Id == submissionId);
                    Assert.Equal(77.5, again.TeacherBand);                      // untouched
                    Assert.Equal("Ikkinchi izoh", again.TeacherComment);
                }

                // A teacher's verdict OVERRIDES the AI's band everywhere downstream — the gradebook
                // now reports 77.5, not the evaluation's 80. This is the point of a manual review,
                // and it is asserted here so a future change to the roll-up cannot quietly ignore it.
                using (var gbAfter = JsonDocument.Parse(await (await Send(
                    client, HttpMethod.Get, "/api/reports/gradebook", tokenA)).Content.ReadAsStringAsync()))
                {
                    var row = gbAfter.RootElement.EnumerateArray()
                        .Single(r => r.GetProperty("student_id").GetGuid() == rosterStudentId);
                    Assert.Equal(77.5, row.GetProperty("best_band").GetDouble());
                }
            }
        }
        finally
        {
            await using var ctx = CreateContext();
            var userIds = new[] { teacherAId, teacherBId, rosterStudentId, outsiderStudentId };
            await ctx.Evaluations.Where(e => e.Submission.StudentId == rosterStudentId || e.Submission.StudentId == outsiderStudentId).ExecuteDeleteAsync();
            await ctx.Submissions.Where(s => userIds.Contains(s.StudentId)).ExecuteDeleteAsync();
            await ctx.Assignments.Where(a => a.TeacherId == teacherAId || a.TeacherId == teacherBId).ExecuteDeleteAsync();
            await ctx.GroupMembers.Where(gm => userIds.Contains(gm.StudentId) || createdGroupIds.Contains(gm.GroupId)).ExecuteDeleteAsync();
            await ctx.Groups.Where(g => g.TeacherId == teacherAId || g.TeacherId == teacherBId).ExecuteDeleteAsync();
            await ctx.Questions.Where(q => q.Id == questionAId).ExecuteDeleteAsync();
            await ctx.Users.Where(u => userIds.Contains(u.Id)).ExecuteDeleteAsync();
        }
    }

    // ── helpers ──

    // Auth is phone-OTP now (no email/password login). These non-auth tests only need a bearer for a
    // seeded user, so mint the SAME access token login used to return (sub = user id) with the test secret.
    private static string TokenFor(Guid userId) =>
        new TokenService(new IdentityAuthOptions { SecretKey = ClassroomApiFactory.TestSecretKey })
            .CreateAccessToken(userId.ToString());

    private static Task<HttpResponseMessage> Send(
        HttpClient client, HttpMethod method, string url, string token, HttpContent? content = null)
    {
        var req = new HttpRequestMessage(method, url) { Content = content };
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client.SendAsync(req);
    }

    // Serialize with the property names AS WRITTEN (snake_case identifiers) — the API deserializes
    // with a snake_case policy, so { question_id, student_ids } must reach the wire unchanged.
    private static HttpContent Json(object body) => JsonContent.Create(body);

    private static User NewUser(Guid id, string email, UserRole role, string? passwordHash, string fullName = "Classroom Seed") => new()
    {
        Id = id,
        Email = email,
        FullName = fullName,
        PasswordHash = passwordHash,
        Role = role,
        IsActive = true,
        IsPremium = false,
        PreferredLanguage = "uz",
        CreatedAt = DateTime.UtcNow,
        UpdatedAt = DateTime.UtcNow,
    };

    private static Question NewQuestion(Guid id, Guid teacherId) => new()
    {
        Id = id,
        TeacherId = teacherId,
        Type = QuestionType.Text,
        Title = "Klass topshirig'i",
        Topic = "family",
        Level = "A2",
        PromptText = "p",
        IsPublished = true,
        IsDeleted = false,
        IsPublic = false,
        PrepTimeSec = 0,
        AnswerTimeLimitSec = 0,
        SortOrder = 0,
        CreatedAt = DateTime.UtcNow,
        UpdatedAt = DateTime.UtcNow,
    };

    public void Dispose() => _dataSource.Dispose();

    /// <summary>Boots Govori.Api against the schema DB with a fixed test SECRET_KEY (same pattern as
    /// the other endpoint suites).</summary>
    public sealed class ClassroomApiFactory : WebApplicationFactory<Program>
    {
        public string ConnectionString { get; } =
            Environment.GetEnvironmentVariable("GOVORI_TEST_DB")
            ?? GovoriDataSourceFactory.DefaultConnectionString;

        internal const string TestSecretKey =
            "classroom-domain-integration-test-secret-key-do-not-use-in-prod";

        public ClassroomApiFactory()
        {
            Environment.SetEnvironmentVariable("SECRET_KEY", TestSecretKey);
            Environment.SetEnvironmentVariable("GOVORI_DB", ConnectionString);
        }
    }
}
