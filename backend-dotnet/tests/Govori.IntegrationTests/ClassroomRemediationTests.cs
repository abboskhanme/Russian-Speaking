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
/// F6 · "Mashq ber" — the one-tap remediation on Analitika · Insaytlar
/// (docs/01 F6, docs/08 Faza 6.7), behind <c>class_insights_enabled</c>.
///
/// <para>Four things can go wrong here and only one of them is visible in review, which is why they
/// are pinned end-to-end rather than unit-tested against a fake:</para>
/// <list type="bullet">
///   <item><b>A task the teacher cannot actually assign.</b> The drill is chosen from the questions
///   the error occurred on; an unpublished (or deleted, or another teacher's) one would render a live
///   button whose confirm is then refused. It must come back as no drill at all.</item>
///   <item><b>Fan-out to the wrong people.</b> The whole promise is "to the students who made THIS
///   error". A roster-mate who never made it, and an outsider who made it on this teacher's own
///   question, must both be absent — the second is the S1 hole in a new shape.</item>
///   <item><b>A rare error dressed as a class insight.</b> Under
///   <see cref="Govori.Classroom.ClassroomService.RemediationMinStudents"/> the row must still SHOW
///   (the teacher should know) with no drill offered.</item>
///   <item><b>The same task sent twice.</b> A teacher who presses again — or reloads and presses —
///   must not pile a second copy onto students who still owe the first.</item>
/// </list>
///
/// <para>The write half deliberately goes through the EXISTING <c>POST /api/assignments</c>: F6 adds
/// no second way to create an assignment, so the S1 roster filter it enforces keeps covering this
/// path too. What the plan promises and what that endpoint writes are asserted to be the same rows.</para>
/// </summary>
[Collection(PerRunDatabaseFixture.CollectionName)]
public sealed class ClassroomRemediationTests
    : IClassFixture<ClassroomRemediationTests.RemediationApiFactory>, IDisposable
{
    private readonly RemediationApiFactory _factory;
    private readonly NpgsqlDataSource _dataSource;

    public ClassroomRemediationTests(RemediationApiFactory factory)
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
    public async Task Remediation_picks_a_real_task_and_only_the_students_who_made_the_error()
    {
        var teacherId = Guid.NewGuid();
        var otherTeacherId = Guid.NewGuid();
        var groupId = Guid.NewGuid();
        var otherGroupId = Guid.NewGuid();

        // Three made the error, one is a roster-mate who never did, one is another teacher's student.
        var s1 = Guid.NewGuid();
        var s2 = Guid.NewGuid();
        var s3 = Guid.NewGuid();
        var innocent = Guid.NewGuid();
        var outsider = Guid.NewGuid();

        var published = Guid.NewGuid();     // word_order happened here → the drill
        var draft = Guid.NewGuid();         // case_error happened here, but it is UNPUBLISHED
        var rareQ = Guid.NewGuid();         // style happened here, but only 2 students

        var userIds = new[] { teacherId, otherTeacherId, s1, s2, s3, innocent, outsider };
        var questionIds = new[] { published, draft, rareQ };

        await using (var ctx = CreateContext())
        {
            ctx.Users.Add(NewUser(teacherId, UserRole.Teacher, "Ustoz"));
            ctx.Users.Add(NewUser(otherTeacherId, UserRole.Teacher, "Boshqa ustoz"));
            ctx.Users.Add(NewUser(s1, UserRole.Student, "Anvar A."));
            ctx.Users.Add(NewUser(s2, UserRole.Student, "Bobur B."));
            ctx.Users.Add(NewUser(s3, UserRole.Student, "Charos C."));
            ctx.Users.Add(NewUser(innocent, UserRole.Student, "Dilnoza D."));
            ctx.Users.Add(NewUser(outsider, UserRole.Student, "Eldor E."));

            ctx.Groups.Add(NewGroup(groupId, teacherId, "F6A"));
            ctx.Groups.Add(NewGroup(otherGroupId, otherTeacherId, "F6B"));
            foreach (var sid in new[] { s1, s2, s3, innocent })
                ctx.GroupMembers.Add(NewMember(groupId, sid));
            ctx.GroupMembers.Add(NewMember(otherGroupId, outsider));

            ctx.Questions.Add(NewQuestion(published, teacherId, "Мой обычный день", isPublished: true));
            ctx.Questions.Add(NewQuestion(draft, teacherId, "Черновик", isPublished: false));
            ctx.Questions.Add(NewQuestion(rareQ, teacherId, "Приветствие", isPublished: true));
            await ctx.SaveChangesAsync();

            // word_order — three roster students, on a question the teacher can hand out.
            foreach (var sid in new[] { s1, s2, s3 })
                Grade(ctx, sid, published, "word_order");
            // …and the outsider makes the SAME error on the SAME (teacher-owned) question. They are
            // not on this teacher's roster, so they must not reach the plan — the S1 rule, applied
            // where a fan-out is composed rather than only where it is written.
            Grade(ctx, outsider, published, "word_order");

            // case_error — three students, but the only question carrying it is an unpublished draft.
            foreach (var sid in new[] { s1, s2, s3 })
                Grade(ctx, sid, draft, "case_error");

            // style — a published question, but only two students. Below the floor.
            foreach (var sid in new[] { s1, s2 })
                Grade(ctx, sid, rareQ, "style");

            await ctx.SaveChangesAsync();
        }

        try
        {
            var client = _factory.CreateClient();
            var token = TokenFor(teacherId);

            // ── Flag OFF (the default): the error rows are there, the feature is not ──
            using (var doc = await ReadInsights(client, token))
            {
                var root = doc.RootElement;
                Assert.False(root.GetProperty("remediation_enabled").GetBoolean());
                Assert.Equal(0, root.GetProperty("remediation_min_students").GetInt32());

                var errors = root.GetProperty("errors").EnumerateArray().ToList();
                Assert.Contains(errors, e => e.GetProperty("type").GetString() == "word_order");
                // Not "an empty plan" — no plan at all, so the client draws no button rather than a
                // disabled one for a feature this deployment does not have.
                Assert.All(errors, e =>
                    Assert.Equal(JsonValueKind.Null, e.GetProperty("remediation").ValueKind));
            }

            await SetFlag(true);

            // ── Flag ON ──
            using (var doc = await ReadInsights(client, token))
            {
                var root = doc.RootElement;
                Assert.True(root.GetProperty("remediation_enabled").GetBoolean());
                Assert.Equal(3, root.GetProperty("remediation_min_students").GetInt32());

                var errors = root.GetProperty("errors").EnumerateArray().ToList();

                // word_order → the published question it actually happened on, and EXACTLY the three
                // students who made it. Not the roster-mate who did not, not the outsider who did.
                var wordOrder = Single(errors, "word_order");
                var plan = wordOrder.GetProperty("remediation");
                Assert.Equal(JsonValueKind.Object, plan.ValueKind);
                Assert.Equal(published, plan.GetProperty("question_id").GetGuid());
                Assert.Equal("Мой обычный день", plan.GetProperty("question_title").GetString());
                Assert.Equal(
                    new[] { s1, s2, s3 }.OrderBy(x => x).ToList(),
                    StudentIds(plan).OrderBy(x => x).ToList());

                // case_error → the error is real and stays on screen, but its only question is an
                // unpublished draft, so there is nothing to assign. A live button here would open a
                // confirm the API would then refuse.
                var caseError = Single(errors, "case_error");
                Assert.Equal(3, caseError.GetProperty("student_count").GetInt32());
                Assert.Equal(JsonValueKind.Null, caseError.GetProperty("remediation").ValueKind);

                // style → two students. Under the floor: the row shows, the drill does not.
                var style = Single(errors, "style");
                Assert.Equal(2, style.GetProperty("student_count").GetInt32());
                Assert.Equal(JsonValueKind.Null, style.GetProperty("remediation").ValueKind);
            }

            // ── A student who already owes this task drops out of the plan ──
            await using (var ctx = CreateContext())
            {
                ctx.Assignments.Add(NewAssignment(teacherId, s1, published));
                await ctx.SaveChangesAsync();
            }
            using (var doc = await ReadInsights(client, token))
            {
                var plan = Single(doc.RootElement.GetProperty("errors").EnumerateArray().ToList(), "word_order")
                    .GetProperty("remediation");
                Assert.Equal(
                    new[] { s2, s3 }.OrderBy(x => x).ToList(),
                    StudentIds(plan).OrderBy(x => x).ToList());
            }

            // ── Sending it: the EXISTING assignment endpoint, with exactly the planned ids ──
            var sent = await Send(client, HttpMethod.Post, "/api/assignments", token,
                JsonContent.Create(new { question_id = published, student_ids = new[] { s2, s3 } }));
            Assert.Equal(HttpStatusCode.Created, sent.StatusCode);
            using (var sentDoc = JsonDocument.Parse(await sent.Content.ReadAsStringAsync()))
                Assert.Equal(2, sentDoc.RootElement.GetArrayLength());

            // Proof at the data layer — rows added, and only for the two the plan named. This is the
            // assertion the acceptance criterion asks for: not "the button was pressed", but "the
            // table grew, by exactly this much".
            await using (var ctx = CreateContext())
            {
                var rows = await ctx.Assignments
                    .Where(a => a.QuestionId == published)
                    .Select(a => a.StudentId)
                    .ToListAsync();
                Assert.Equal(3, rows.Count);                       // s1's pre-existing one + the two new
                Assert.Equal(1, rows.Count(id => id == s2));
                Assert.Equal(1, rows.Count(id => id == s3));
                Assert.DoesNotContain(innocent, rows);
                Assert.DoesNotContain(outsider, rows);
            }

            // ── And now everyone affected owes it, so the plan survives with an EMPTY audience ──
            // (the task still exists — that is a disabled button with "they all have it", not a
            // missing drill).
            using (var doc = await ReadInsights(client, token))
            {
                var plan = Single(doc.RootElement.GetProperty("errors").EnumerateArray().ToList(), "word_order")
                    .GetProperty("remediation");
                Assert.Equal(JsonValueKind.Object, plan.ValueKind);
                Assert.Empty(StudentIds(plan));
            }
        }
        finally
        {
            await SetFlag(null);
            await using var ctx = CreateContext();
            await ctx.Evaluations.Where(e => userIds.Contains(e.Submission.StudentId)).ExecuteDeleteAsync();
            await ctx.Submissions.Where(s => userIds.Contains(s.StudentId)).ExecuteDeleteAsync();
            await ctx.Assignments.Where(a => a.TeacherId == teacherId).ExecuteDeleteAsync();
            await ctx.GroupMembers.Where(gm => userIds.Contains(gm.StudentId)).ExecuteDeleteAsync();
            await ctx.Groups.Where(g => g.Id == groupId || g.Id == otherGroupId).ExecuteDeleteAsync();
            await ctx.Questions.Where(q => questionIds.Contains(q.Id)).ExecuteDeleteAsync();
            await ctx.Users.Where(u => userIds.Contains(u.Id)).ExecuteDeleteAsync();
        }
    }

    // ── helpers ──

    /// <summary>Writes (or clears) the <c>class_insights_enabled</c> override. The service reads the
    /// table directly and uncached, so a row is the whole switch.</summary>
    private async Task SetFlag(bool? on)
    {
        await using var ctx = CreateContext();
        var row = await ctx.AppSettings.FirstOrDefaultAsync(s => s.Key == "class_insights_enabled");
        if (on is null)
        {
            if (row is not null) ctx.AppSettings.Remove(row);
        }
        else if (row is null)
        {
            ctx.AppSettings.Add(new AppSetting
            {
                Key = "class_insights_enabled",
                Value = on.Value ? "true" : "false",
                IsSecret = false,
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow,
            });
        }
        else
        {
            row.Value = on.Value ? "true" : "false";
            row.UpdatedAt = DateTime.UtcNow;
        }
        await ctx.SaveChangesAsync();
    }

    private static async Task<JsonDocument> ReadInsights(HttpClient client, string token)
    {
        var resp = await Send(client, HttpMethod.Get, "/api/reports/insights", token);
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        return JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
    }

    private static JsonElement Single(List<JsonElement> errors, string type)
        => errors.Single(e => e.GetProperty("type").GetString() == type);

    private static List<Guid> StudentIds(JsonElement plan)
        => plan.GetProperty("students").EnumerateArray()
            .Select(s => s.GetProperty("id").GetGuid())
            .ToList();

    /// <summary>One graded answer carrying exactly one correction of <paramref name="type"/> — the
    /// shape the grader writes into <c>evaluations.corrections</c>.</summary>
    private static void Grade(GovoriDbContext ctx, Guid studentId, Guid questionId, string type)
    {
        var subId = Guid.NewGuid();
        var sub = new Submission
        {
            Id = subId,
            StudentId = studentId,
            QuestionId = questionId,
            AudioKey = $"answers/{subId:N}.webm",
            Status = SubmissionStatus.Done,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
        };
        ctx.Submissions.Add(sub);
        ctx.Evaluations.Add(new Evaluation
        {
            Id = Guid.NewGuid(),
            // The navigation, not just the id: it makes the insert order explicit rather than relying
            // on EF's dependency sort, so one SaveChanges can carry both rows.
            Submission = sub,
            FluencyScore = 70, LexicalScore = 70, GrammarScore = 70,
            OverallBand = 70,
            Corrections =
                $$"""[{"original":"a","corrected":"b","type":"{{type}}","explanation":"x"}]""",
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
        });
    }

    private static string TokenFor(Guid userId) =>
        new TokenService(new IdentityAuthOptions { SecretKey = RemediationApiFactory.TestSecretKey })
            .CreateAccessToken(userId.ToString());

    private static Task<HttpResponseMessage> Send(
        HttpClient client, HttpMethod method, string url, string token, HttpContent? content = null)
    {
        var req = new HttpRequestMessage(method, url) { Content = content };
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client.SendAsync(req);
    }

    private static User NewUser(Guid id, UserRole role, string fullName) => new()
    {
        Id = id,
        Email = $"f6-{id:N}@example.test",
        FullName = fullName,
        Role = role,
        IsActive = true,
        IsPremium = false,
        PreferredLanguage = "uz",
        CreatedAt = DateTime.UtcNow,
        UpdatedAt = DateTime.UtcNow,
    };

    private static Group NewGroup(Guid id, Guid teacherId, string name) => new()
    {
        Id = id,
        TeacherId = teacherId,
        Name = name,
        JoinCode = $"{id:N}"[..6].ToUpperInvariant(),
        CreatedAt = DateTime.UtcNow,
        UpdatedAt = DateTime.UtcNow,
    };

    private static GroupMember NewMember(Guid groupId, Guid studentId) => new()
    {
        Id = Guid.NewGuid(),
        GroupId = groupId,
        StudentId = studentId,
        CreatedAt = DateTime.UtcNow,
        UpdatedAt = DateTime.UtcNow,
    };

    private static Question NewQuestion(Guid id, Guid teacherId, string title, bool isPublished) => new()
    {
        Id = id,
        TeacherId = teacherId,
        Type = QuestionType.Text,
        Title = title,
        Topic = "daily",
        Level = "A2",
        PromptText = "p",
        IsPublished = isPublished,
        IsDeleted = false,
        IsPublic = false,
        PrepTimeSec = 0,
        AnswerTimeLimitSec = 0,
        SortOrder = 0,
        CreatedAt = DateTime.UtcNow,
        UpdatedAt = DateTime.UtcNow,
    };

    private static Assignment NewAssignment(Guid teacherId, Guid studentId, Guid questionId) => new()
    {
        Id = Guid.NewGuid(),
        TeacherId = teacherId,
        StudentId = studentId,
        QuestionId = questionId,
        // AFTER the seeded answers, so the existing submission does not close it — this is an
        // OUTSTANDING assignment, which is the state that must suppress a second copy.
        CreatedAt = DateTime.UtcNow.AddMinutes(5),
        UpdatedAt = DateTime.UtcNow.AddMinutes(5),
    };

    public void Dispose() => _dataSource.Dispose();

    /// <summary>Boots Govori.Api against the per-run schema DB with a fixed test SECRET_KEY.</summary>
    public sealed class RemediationApiFactory : WebApplicationFactory<Program>
    {
        public string ConnectionString { get; } = TestDatabase.ConnectionString;

        internal const string TestSecretKey =
            "classroom-remediation-integration-test-secret-key-do-not-use";

        public RemediationApiFactory()
        {
            Environment.SetEnvironmentVariable("SECRET_KEY", TestSecretKey);
            Environment.SetEnvironmentVariable("GOVORI_DB", ConnectionString);
        }
    }
}
