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
///   <item>a student joins by code and the roster is exactly that student (join is idempotent);</item>
///   <item><b>the S1 roster-bug fix</b>: the teacher assigns a task to [rostered student, OUTSIDER
///   student]; only the rostered student gets an assignment — the outsider (another teacher's
///   student) is filtered out, and NO assignment row is written for them;</item>
///   <item>after a graded submission, the rostered student appears in the teacher's gradebook with the
///   right band, and the outsider (even with a submission to the teacher's own question) never does;</item>
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

            // ── Students join by code (lowercase to prove normalization) ──
            var joinResp = await Send(client, HttpMethod.Post, "/api/groups/join", tokenRoster, Json(new { code = joinCodeA.ToLowerInvariant() }));
            Assert.Equal(HttpStatusCode.OK, joinResp.StatusCode);
            using (var joinDoc = JsonDocument.Parse(await joinResp.Content.ReadAsStringAsync()))
                Assert.Equal(1, joinDoc.RootElement.GetProperty("member_count").GetInt32());

            // Idempotent: joining again keeps a single membership.
            Assert.Equal(HttpStatusCode.OK,
                (await Send(client, HttpMethod.Post, "/api/groups/join", tokenRoster, Json(new { code = joinCodeA }))).StatusCode);

            Assert.Equal(HttpStatusCode.OK,
                (await Send(client, HttpMethod.Post, "/api/groups/join", tokenOutsider, Json(new { code = joinCodeB }))).StatusCode);

            // Invalid code → 404.
            Assert.Equal(HttpStatusCode.NotFound,
                (await Send(client, HttpMethod.Post, "/api/groups/join", tokenOutsider, Json(new { code = "ZZZZZZ" }))).StatusCode);

            // ── /groups/mine reflects the join for the student, and NOT the teacher ──
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
