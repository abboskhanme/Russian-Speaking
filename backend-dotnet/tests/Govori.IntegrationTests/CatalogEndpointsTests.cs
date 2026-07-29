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
/// Happy path for the Catalog student read slice (docs/07 §7.2, Faza 3.2): HTTP → CatalogService
/// → EF Core → the real prod-shaped Postgres → the two-layer lock and back.
///
/// Seeds a student who belongs to a teacher's group, that teacher's GROUP module, and an official
/// PUBLIC module, plus a few completed submissions, then asserts <c>GET /api/blocks/student</c>
/// returns the exact SEQUENTIAL + FREEMIUM lock state per task:
/// <list type="bullet">
///   <item>group (teacher) modules sort before public ones, and are NEVER premium-locked;</item>
///   <item>a task is sequentially locked until the previous one is done;</item>
///   <item>a non-premium student is premium-locked past the free preview of a PUBLIC module;</item>
///   <item><c>next_task_id</c> is the first done-able task (null when only locked tasks remain).</item>
/// </list>
/// Every seeded row is deleted in a finally so the run is idempotent.
/// </summary>
public sealed class CatalogEndpointsTests : IClassFixture<CatalogEndpointsTests.CatalogApiFactory>, IDisposable
{
    private readonly CatalogApiFactory _factory;
    private readonly NpgsqlDataSource _dataSource;

    public CatalogEndpointsTests(CatalogApiFactory factory)
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
    public async Task Student_modules_returns_the_two_layer_lock_state()
    {
        var teacherId = Guid.NewGuid();
        var studentId = Guid.NewGuid();
        var groupId = Guid.NewGuid();
        var groupModuleId = Guid.NewGuid();
        var publicModuleId = Guid.NewGuid();
        var studentEmail = $"cat-student-{studentId:N}@example.test";
        const string password = "Catalog!123";

        // 4 group-module tasks, 5 public-module tasks, ordered by sort_order.
        var g = Enumerable.Range(0, 4).Select(_ => Guid.NewGuid()).ToArray();
        var p = Enumerable.Range(0, 5).Select(_ => Guid.NewGuid()).ToArray();

        var hasher = new PasswordHasher();

        await using (var ctx = CreateContext())
        {
            ctx.Users.Add(NewUser(teacherId, $"cat-teacher-{teacherId:N}@example.test", UserRole.Teacher, null));
            ctx.Users.Add(NewUser(studentId, studentEmail, UserRole.Student, hasher.Hash(password)));

            ctx.Groups.Add(new Group
            {
                Id = groupId,
                TeacherId = teacherId,
                Name = "Parity Group",
                JoinCode = groupId.ToString("N")[..10],
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow,
            });
            ctx.GroupMembers.Add(new GroupMember
            {
                Id = Guid.NewGuid(),
                GroupId = groupId,
                StudentId = studentId,
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow,
            });

            ctx.QuestionBlocks.Add(NewBlock(groupModuleId, teacherId, "group"));
            ctx.QuestionBlocks.Add(NewBlock(publicModuleId, teacherId, "public"));
            for (var i = 0; i < g.Length; i++)
                ctx.Questions.Add(NewQuestion(g[i], teacherId, groupModuleId, sortOrder: i));
            for (var i = 0; i < p.Length; i++)
                ctx.Questions.Add(NewQuestion(p[i], teacherId, publicModuleId, sortOrder: i));

            // Completed WITH durations + graded bands so the additive band/spent_sec fields carry
            // real values: group g0, public p0/p1/p2 (the 3 free ones). p0 has TWO graded
            // submissions so its band is the MAX of them; p2 is done but never graded (band → null).
            // Durations: g0=60 · p0=20+25 · p1=30 · p2=40  ⇒ group spent 60, public spent 115.
            var g0a = NewDoneSubmission(studentId, g[0], durationSec: 60);
            var p0a = NewDoneSubmission(studentId, p[0], durationSec: 20);
            var p0b = NewDoneSubmission(studentId, p[0], durationSec: 25);
            var p1a = NewDoneSubmission(studentId, p[1], durationSec: 30);
            var p2a = NewDoneSubmission(studentId, p[2], durationSec: 40);
            ctx.Submissions.AddRange(g0a, p0a, p0b, p1a, p2a);

            // Graded: g0 band 65; p0 best of {55, 81} = 81; p1 band 70; p2 stays ungraded (null).
            ctx.Evaluations.AddRange(
                NewEvaluation(g0a.Id, 65.0),
                NewEvaluation(p0a.Id, 55.4),
                NewEvaluation(p0b.Id, 80.6),
                NewEvaluation(p1a.Id, 70.0));

            await ctx.SaveChangesAsync();
        }

        try
        {
            var client = _factory.CreateClient();

            // Auth is phone-OTP now (no email/password login). This non-auth test only needs a bearer
            // for the seeded student, so mint the same access token (sub = user id) with the test secret.
            var accessToken = new TokenService(new IdentityAuthOptions { SecretKey = CatalogApiFactory.TestSecretKey })
                .CreateAccessToken(studentId.ToString());

            // Anonymous → 401 (RequireAuthorization).
            Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/blocks/student")).StatusCode);

            var req = new HttpRequestMessage(HttpMethod.Get, "/api/blocks/student");
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
            var resp = await client.SendAsync(req);
            Assert.Equal(HttpStatusCode.OK, resp.StatusCode);

            using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
            var modules = doc.RootElement.EnumerateArray().ToList();

            var groupIdx = modules.FindIndex(m => m.GetProperty("id").GetGuid() == groupModuleId);
            var publicIdx = modules.FindIndex(m => m.GetProperty("id").GetGuid() == publicModuleId);
            Assert.True(groupIdx >= 0, "seeded group module missing from student view");
            Assert.True(publicIdx >= 0, "seeded public module missing from student view");
            // Group (teacher) modules sort before official public ones (visibility asc).
            Assert.True(groupIdx < publicIdx, "group module must precede public module");

            // ── Group module: sequential lock only; NEVER premium-locked (teacher content) ──
            var group = modules[groupIdx];
            Assert.Equal("group", group.GetProperty("visibility").GetString());
            Assert.Equal(4, group.GetProperty("total").GetInt32());
            Assert.Equal(1, group.GetProperty("done_count").GetInt32());
            Assert.Equal(g[1], group.GetProperty("next_task_id").GetGuid());   // first not-done, unlocked task
            var gTasks = TasksById(group);
            AssertTask(gTasks[g[0]], done: true, locked: false, premium: false);
            AssertTask(gTasks[g[1]], done: false, locked: false, premium: false);
            AssertTask(gTasks[g[2]], done: false, locked: true, premium: false);
            AssertTask(gTasks[g[3]], done: false, locked: true, premium: false);  // idx 3 but group → not paywalled

            // Additive fields: a done+graded task carries its best band; spent_sec sums the module's
            // submission durations; an untouched task's band is null.
            Assert.Equal(65, gTasks[g[0]].GetProperty("band").GetInt32());
            Assert.Equal(JsonValueKind.Null, gTasks[g[1]].GetProperty("band").ValueKind);
            Assert.Equal(60, group.GetProperty("spent_sec").GetInt32());   // only g0 has audio here

            // ── Public module: free preview then the freemium paywall ──
            var pub = modules[publicIdx];
            Assert.Equal("public", pub.GetProperty("visibility").GetString());
            Assert.Equal(5, pub.GetProperty("total").GetInt32());
            Assert.Equal(3, pub.GetProperty("done_count").GetInt32());
            Assert.Equal(JsonValueKind.Null, pub.GetProperty("next_task_id").ValueKind);  // remaining tasks are premium-locked
            var pTasks = TasksById(pub);
            AssertTask(pTasks[p[0]], done: true, locked: false, premium: false);
            AssertTask(pTasks[p[1]], done: true, locked: false, premium: false);
            AssertTask(pTasks[p[2]], done: true, locked: false, premium: false);
            AssertTask(pTasks[p[3]], done: false, locked: false, premium: true);   // premium lock, NOT sequential
            AssertTask(pTasks[p[4]], done: false, locked: true, premium: true);    // both layers

            // Additive fields: best band is the MAX across a task's submissions; a done-but-ungraded
            // task and an untouched task both read null; spent_sec sums the module's durations.
            Assert.Equal(81, pTasks[p[0]].GetProperty("band").GetInt32());   // max(55.4, 80.6) → 81
            Assert.Equal(70, pTasks[p[1]].GetProperty("band").GetInt32());
            Assert.Equal(JsonValueKind.Null, pTasks[p[2]].GetProperty("band").ValueKind);   // done, never graded
            Assert.Equal(JsonValueKind.Null, pTasks[p[3]].GetProperty("band").ValueKind);   // untouched
            Assert.Equal(115, pub.GetProperty("spent_sec").GetInt32());      // 45 + 30 + 40

            // Task type carries the lowercase PG enum label.
            Assert.Equal("text", pTasks[p[0]].GetProperty("type").GetString());
        }
        finally
        {
            await using var ctx = CreateContext();
            await ctx.Evaluations.Where(e => e.Submission.StudentId == studentId).ExecuteDeleteAsync();
            await ctx.Submissions.Where(s => s.StudentId == studentId).ExecuteDeleteAsync();
            await ctx.Questions.Where(q => q.BlockId == groupModuleId || q.BlockId == publicModuleId).ExecuteDeleteAsync();
            await ctx.QuestionBlocks.Where(b => b.Id == groupModuleId || b.Id == publicModuleId).ExecuteDeleteAsync();
            await ctx.GroupMembers.Where(m => m.GroupId == groupId).ExecuteDeleteAsync();
            await ctx.Groups.Where(gr => gr.Id == groupId).ExecuteDeleteAsync();
            await ctx.Users.Where(u => u.Id == studentId || u.Id == teacherId).ExecuteDeleteAsync();
        }
    }

    private static Dictionary<Guid, JsonElement> TasksById(JsonElement module)
        => module.GetProperty("tasks").EnumerateArray().ToDictionary(t => t.GetProperty("id").GetGuid());

    private static void AssertTask(JsonElement task, bool done, bool locked, bool premium)
    {
        Assert.Equal(done, task.GetProperty("done").GetBoolean());
        Assert.Equal(locked, task.GetProperty("locked").GetBoolean());
        Assert.Equal(premium, task.GetProperty("premium_locked").GetBoolean());
    }

    private static User NewUser(Guid id, string email, UserRole role, string? passwordHash) => new()
    {
        Id = id,
        Email = email,
        FullName = "Catalog Seed",
        PasswordHash = passwordHash,
        Role = role,
        IsActive = true,
        IsPremium = false,
        PreferredLanguage = "uz",
        CreatedAt = DateTime.UtcNow,
        UpdatedAt = DateTime.UtcNow,
    };

    private static QuestionBlock NewBlock(Guid id, Guid teacherId, string visibility) => new()
    {
        Id = id,
        TeacherId = teacherId,
        Name = "Parity Module",
        Visibility = visibility,
        IsPublished = true,
        SortOrder = 0,
        CreatedAt = DateTime.UtcNow,
        UpdatedAt = DateTime.UtcNow,
    };

    private static Question NewQuestion(Guid id, Guid teacherId, Guid blockId, int sortOrder) => new()
    {
        Id = id,
        TeacherId = teacherId,
        BlockId = blockId,
        Type = QuestionType.Text,
        Title = $"Task {sortOrder}",
        PromptText = "p",
        IsPublished = true,
        IsDeleted = false,
        IsPublic = false,
        PrepTimeSec = 0,
        AnswerTimeLimitSec = 0,
        SortOrder = sortOrder,
        // Distinct created_at so the (sort_order, created_at) order is unambiguous.
        CreatedAt = new DateTime(2024, 1, 1, 0, 0, 0, DateTimeKind.Utc).AddSeconds(sortOrder),
        UpdatedAt = DateTime.UtcNow,
    };

    private static Submission NewDoneSubmission(Guid studentId, Guid questionId, double? durationSec = null) => new()
    {
        Id = Guid.NewGuid(),
        StudentId = studentId,
        QuestionId = questionId,
        AudioKey = "parity/done.webm",
        AudioDurationSec = durationSec,
        Status = SubmissionStatus.Done,
        CreatedAt = DateTime.UtcNow,
        UpdatedAt = DateTime.UtcNow,
    };

    private static Evaluation NewEvaluation(Guid submissionId, double overallBand) => new()
    {
        Id = Guid.NewGuid(),
        SubmissionId = submissionId,
        FluencyScore = overallBand,
        LexicalScore = overallBand,
        GrammarScore = overallBand,
        OverallBand = overallBand,
        CreatedAt = DateTime.UtcNow,
        UpdatedAt = DateTime.UtcNow,
    };

    public void Dispose() => _dataSource.Dispose();

    /// <summary>Boots Govori.Api against the schema DB with a fixed test SECRET_KEY (same pattern
    /// as AuthEndpointsTests). Config goes through env vars because Program.cs reads them at
    /// WebApplication.CreateBuilder, before any test-server config override runs.</summary>
    public sealed class CatalogApiFactory : WebApplicationFactory<Program>
    {
        public string ConnectionString { get; } =
            Environment.GetEnvironmentVariable("GOVORI_TEST_DB")
            ?? GovoriDataSourceFactory.DefaultConnectionString;

        internal const string TestSecretKey =
            "catalog-domain-integration-test-secret-key-do-not-use-in-prod";

        public CatalogApiFactory()
        {
            Environment.SetEnvironmentVariable("SECRET_KEY", TestSecretKey);
            Environment.SetEnvironmentVariable("GOVORI_DB", ConnectionString);
        }
    }
}
