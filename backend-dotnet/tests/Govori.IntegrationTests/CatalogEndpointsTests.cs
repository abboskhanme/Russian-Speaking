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
[Collection(PerRunDatabaseFixture.CollectionName)]
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


    /// <summary>
    /// The TEACHER AUTHORING surface (Kontent board C1 · C2 · C4 · C5): create a module and a task
    /// over the existing question_blocks / questions tables, attach and detach, publish, and prove
    /// the OWNERSHIP boundary in both directions.
    ///
    /// <para><b>The boundary is the point.</b> Authoring is the first write surface a teacher has
    /// over content, so a second teacher must be unable to read OR mutate any of it, and must get
    /// <b>404 rather than 403</b> — a 403 would confirm the id exists. A student is refused outright.
    /// Attaching a task to someone else's module is likewise a 404, not a silent cross-owner
    /// attachment.</para>
    /// </summary>
    [Fact]
    public async Task Teacher_authoring_creates_attaches_publishes_and_stays_owner_scoped()
    {
        var teacherAId = Guid.NewGuid();
        var teacherBId = Guid.NewGuid();
        var studentId = Guid.NewGuid();
        var hasher = new PasswordHasher();
        const string password = "Authoring!123";

        await using (var ctx = CreateContext())
        {
            ctx.Users.Add(NewUser(teacherAId, $"auth-tA-{teacherAId:N}@example.test", UserRole.Teacher, null));
            ctx.Users.Add(NewUser(teacherBId, $"auth-tB-{teacherBId:N}@example.test", UserRole.Teacher, null));
            ctx.Users.Add(NewUser(studentId, $"auth-s-{studentId:N}@example.test", UserRole.Student, hasher.Hash(password)));
            await ctx.SaveChangesAsync();
        }

        var createdBlockIds = new List<Guid>();
        var createdQuestionIds = new List<Guid>();

        try
        {
            var client = _factory.CreateClient();
            var tokenA = AuthToken(teacherAId);
            var tokenB = AuthToken(teacherBId);
            var tokenS = AuthToken(studentId);

            // ── Anonymous → 401; student → 403 on every authoring route ──
            Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/blocks")).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await Api(client, HttpMethod.Get, "/api/blocks", tokenS)).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden,
                (await Api(client, HttpMethod.Post, "/api/blocks", tokenS, Body(new { name = "nope" }))).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await Api(client, HttpMethod.Get, "/api/questions", tokenS)).StatusCode);

            // ── A blank name is refused rather than creating an unidentifiable module ──
            Assert.Equal(HttpStatusCode.BadRequest,
                (await Api(client, HttpMethod.Post, "/api/blocks", tokenA, Body(new { name = "   " }))).StatusCode);

            // ── Teacher A creates a module → 201, and it starts as a DRAFT ──
            var mkBlock = await Api(client, HttpMethod.Post, "/api/blocks", tokenA,
                Body(new { name = "  Kundalik muloqot  ", level = "A2", topic = "kundalik" }));
            Assert.Equal(HttpStatusCode.Created, mkBlock.StatusCode);
            Guid blockId;
            using (var doc = JsonDocument.Parse(await mkBlock.Content.ReadAsStringAsync()))
            {
                blockId = doc.RootElement.GetProperty("id").GetGuid();
                createdBlockIds.Add(blockId);
                Assert.Equal("Kundalik muloqot", doc.RootElement.GetProperty("name").GetString());  // trimmed
                Assert.False(doc.RootElement.GetProperty("is_published").GetBoolean());
                Assert.Equal(0, doc.RootElement.GetProperty("task_count").GetInt32());
                // A draft reaches nobody, so claiming a student count would be a lie.
                Assert.Equal(0, doc.RootElement.GetProperty("student_count").GetInt32());
                Assert.Empty(doc.RootElement.GetProperty("tasks").EnumerateArray());
            }

            // ── A task needs a prompt: title alone is not answerable ──
            Assert.Equal(HttpStatusCode.BadRequest,
                (await Api(client, HttpMethod.Post, "/api/questions", tokenA, Body(new { title = "Bo'sh" }))).StatusCode);

            // ── Create a task straight into the module (the C4 "+ Yangi vazifa" path) ──
            var mkQ = await Api(client, HttpMethod.Post, "/api/questions", tokenA, Body(new
            {
                title = "Do'konda xarid",
                prompt_text = "Расскажите, что вы вчера купили в магазине.",
                level = "A2",
                block_id = blockId,
            }));
            Assert.Equal(HttpStatusCode.Created, mkQ.StatusCode);
            Guid questionId;
            using (var doc = JsonDocument.Parse(await mkQ.Content.ReadAsStringAsync()))
            {
                questionId = doc.RootElement.GetProperty("id").GetGuid();
                createdQuestionIds.Add(questionId);
                Assert.Equal(blockId, doc.RootElement.GetProperty("block_id").GetGuid());
                Assert.False(doc.RootElement.GetProperty("is_published").GetBoolean());
                Assert.Equal(0, doc.RootElement.GetProperty("submission_count").GetInt32());
            }

            // ── An UNATTACHED task, for the C5 library picker ──
            var mkLoose = await Api(client, HttpMethod.Post, "/api/questions", tokenA,
                Body(new { title = "Telefon suhbati", prompt_text = "Позвоните и запишитесь." , level = "A2" }));
            Guid looseId;
            using (var doc = JsonDocument.Parse(await mkLoose.Content.ReadAsStringAsync()))
            {
                looseId = doc.RootElement.GetProperty("id").GetGuid();
                createdQuestionIds.Add(looseId);
                Assert.True(doc.RootElement.TryGetProperty("block_id", out var bid) && bid.ValueKind == JsonValueKind.Null);
            }

            // ?unassigned=true offers ONLY the loose one — the picker must not let a task end up
            // in two modules at once.
            using (var doc = JsonDocument.Parse(await (await Api(client, HttpMethod.Get, "/api/questions?unassigned=true", tokenA)).Content.ReadAsStringAsync()))
            {
                var ids = doc.RootElement.EnumerateArray().Select(x => x.GetProperty("id").GetGuid()).ToList();
                Assert.Contains(looseId, ids);
                Assert.DoesNotContain(questionId, ids);
            }

            // Search matches the PROMPT as well as the title.
            using (var doc = JsonDocument.Parse(await (await Api(client, HttpMethod.Get, "/api/questions?q=%D0%B7%D0%B0%D0%BF%D0%B8%D1%88%D0%B8%D1%82%D0%B5%D1%81%D1%8C", tokenA)).Content.ReadAsStringAsync()))
                Assert.Contains(doc.RootElement.EnumerateArray(), x => x.GetProperty("id").GetGuid() == looseId);

            // ── Attach the loose task via PATCH (C5 "Mavjuddan tanlash") ──
            Assert.Equal(HttpStatusCode.OK,
                (await Api(client, HttpMethod.Patch, $"/api/questions/{looseId}", tokenA, Body(new { block_id = blockId }))).StatusCode);
            using (var doc = JsonDocument.Parse(await (await Api(client, HttpMethod.Get, $"/api/blocks/{blockId}", tokenA)).Content.ReadAsStringAsync()))
            {
                Assert.Equal(2, doc.RootElement.GetProperty("task_count").GetInt32());
                var order = doc.RootElement.GetProperty("tasks").EnumerateArray()
                    .Select(x => x.GetProperty("sort_order").GetInt32()).ToList();
                Assert.Equal(new[] { 0, 1 }, order);                        // appended, not stacked at 0
            }

            // ── Task media (C2's optional "Rasm yoki video yuklash") ──
            {
                var mediaPath = $"/api/questions/{looseId}/media";

                // A task starts with none, and the url is null rather than an empty string.
                using (var doc = JsonDocument.Parse(await (await Api(
                    client, HttpMethod.Get, $"/api/questions?unassigned=false", tokenA)).Content.ReadAsStringAsync()))
                {
                    var row = doc.RootElement.EnumerateArray().First(x => x.GetProperty("id").GetGuid() == looseId);
                    Assert.Equal(JsonValueKind.Null, row.GetProperty("media_url").ValueKind);
                }

                // SVG is refused even though it is an image: it can carry script and would be a
                // stored-XSS vector the moment its presigned url is opened.
                Assert.Equal(HttpStatusCode.BadRequest,
                    (await Api(client, HttpMethod.Post, mediaPath, tokenA, MediaForm("image/svg+xml", "x.svg", 32))).StatusCode);
                // …as is an arbitrary type, and an empty body.
                Assert.Equal(HttpStatusCode.BadRequest,
                    (await Api(client, HttpMethod.Post, mediaPath, tokenA, MediaForm("application/zip", "x.zip", 32))).StatusCode);
                Assert.Equal(HttpStatusCode.BadRequest,
                    (await Api(client, HttpMethod.Post, mediaPath, tokenA, MediaForm("image/png", "x.png", 0))).StatusCode);

                // None of those rejects wrote anything.
                await using (var ctx = CreateContext())
                    Assert.Null((await ctx.Questions.SingleAsync(q => q.Id == looseId)).MediaKey);

                // A real image lands, and the response carries a presigned url immediately.
                var up = await Api(client, HttpMethod.Post, mediaPath, tokenA, MediaForm("image/png", "cover.png", 64));
                Assert.Equal(HttpStatusCode.OK, up.StatusCode);
                string firstKey;
                using (var doc = JsonDocument.Parse(await up.Content.ReadAsStringAsync()))
                    Assert.False(string.IsNullOrEmpty(doc.RootElement.GetProperty("media_url").GetString()));
                await using (var ctx = CreateContext())
                {
                    firstKey = (await ctx.Questions.SingleAsync(q => q.Id == looseId)).MediaKey!;
                    // The client's filename is ignored entirely — the key is random, under questions/,
                    // with the extension taken from the VALIDATED content-type.
                    Assert.StartsWith("questions/", firstKey);
                    Assert.EndsWith(".png", firstKey);
                    Assert.DoesNotContain("cover", firstKey);
                }

                // Replacing swaps the key rather than appending a second object.
                Assert.Equal(HttpStatusCode.OK,
                    (await Api(client, HttpMethod.Post, mediaPath, tokenA, MediaForm("video/mp4", "clip.mp4", 128))).StatusCode);
                await using (var ctx = CreateContext())
                {
                    var key = (await ctx.Questions.SingleAsync(q => q.Id == looseId)).MediaKey!;
                    Assert.NotEqual(firstKey, key);
                    Assert.EndsWith(".mp4", key);
                }

                // Another teacher gets 404, NOT 403 — task ids must not be probeable.
                Assert.Equal(HttpStatusCode.NotFound,
                    (await Api(client, HttpMethod.Post, mediaPath, tokenB, MediaForm("image/png", "x.png", 32))).StatusCode);
                Assert.Equal(HttpStatusCode.NotFound,
                    (await Api(client, HttpMethod.Delete, mediaPath, tokenB)).StatusCode);
                // A student may not author at all.
                Assert.Equal(HttpStatusCode.Forbidden,
                    (await Api(client, HttpMethod.Delete, mediaPath, tokenS)).StatusCode);

                // Clearing works, and is idempotent — "make sure this has none" is the intent.
                Assert.Equal(HttpStatusCode.OK, (await Api(client, HttpMethod.Delete, mediaPath, tokenA)).StatusCode);
                var again = await Api(client, HttpMethod.Delete, mediaPath, tokenA);
                Assert.Equal(HttpStatusCode.OK, again.StatusCode);
                using (var doc = JsonDocument.Parse(await again.Content.ReadAsStringAsync()))
                    Assert.Equal(JsonValueKind.Null, doc.RootElement.GetProperty("media_url").ValueKind);
                await using (var ctx = CreateContext())
                    Assert.Null((await ctx.Questions.SingleAsync(q => q.Id == looseId)).MediaKey);
            }

            // ── detach_block: true removes the link (absent block_id would leave it alone) ──
            Assert.Equal(HttpStatusCode.OK,
                (await Api(client, HttpMethod.Patch, $"/api/questions/{looseId}", tokenA, Body(new { detach_block = true }))).StatusCode);
            await using (var ctx = CreateContext())
                Assert.Null((await ctx.Questions.SingleAsync(q => q.Id == looseId)).BlockId);

            // ── Publishing the module gives it real reach ──
            await using (var ctx = CreateContext())
            {
                var gid = Guid.NewGuid();
                ctx.Groups.Add(new Group { Id = gid, TeacherId = teacherAId, Name = "Auth grp", JoinCode = $"AU{gid:N}".ToUpperInvariant()[..6], CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow });
                await ctx.SaveChangesAsync();
                ctx.GroupMembers.Add(new GroupMember { Id = Guid.NewGuid(), GroupId = gid, StudentId = studentId, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow });
                await ctx.SaveChangesAsync();
            }
            using (var doc = JsonDocument.Parse(await (await Api(client, HttpMethod.Patch, $"/api/blocks/{blockId}", tokenA, Body(new { is_published = true }))).Content.ReadAsStringAsync()))
            {
                Assert.True(doc.RootElement.GetProperty("is_published").GetBoolean());
                Assert.Equal(1, doc.RootElement.GetProperty("student_count").GetInt32());
                // A partial PATCH must not blank the untouched fields.
                Assert.Equal("Kundalik muloqot", doc.RootElement.GetProperty("name").GetString());
                Assert.Equal("A2", doc.RootElement.GetProperty("level").GetString());
            }

            // Blanking the name is refused — an unnamed module is unrecoverable in the list.
            Assert.Equal(HttpStatusCode.BadRequest,
                (await Api(client, HttpMethod.Patch, $"/api/blocks/{blockId}", tokenA, Body(new { name = "  " }))).StatusCode);

            // ── OWNERSHIP: teacher B can neither see nor touch any of it, and gets 404 not 403 ──
            using (var doc = JsonDocument.Parse(await (await Api(client, HttpMethod.Get, "/api/blocks", tokenB)).Content.ReadAsStringAsync()))
                Assert.DoesNotContain(doc.RootElement.EnumerateArray(), x => x.GetProperty("id").GetGuid() == blockId);
            using (var doc = JsonDocument.Parse(await (await Api(client, HttpMethod.Get, "/api/questions", tokenB)).Content.ReadAsStringAsync()))
                Assert.DoesNotContain(doc.RootElement.EnumerateArray(), x => x.GetProperty("id").GetGuid() == questionId);

            Assert.Equal(HttpStatusCode.NotFound, (await Api(client, HttpMethod.Get, $"/api/blocks/{blockId}", tokenB)).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound,
                (await Api(client, HttpMethod.Patch, $"/api/blocks/{blockId}", tokenB, Body(new { name = "hijack" }))).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound,
                (await Api(client, HttpMethod.Patch, $"/api/questions/{questionId}", tokenB, Body(new { title = "hijack" }))).StatusCode);

            // Teacher B creating a task INTO teacher A's module is a 404, not a cross-owner attach.
            Assert.Equal(HttpStatusCode.NotFound,
                (await Api(client, HttpMethod.Post, "/api/questions", tokenB,
                    Body(new { title = "x", prompt_text = "y", block_id = blockId }))).StatusCode);

            // None of the hijack attempts changed anything.
            await using (var ctx = CreateContext())
            {
                Assert.Equal("Kundalik muloqot", (await ctx.QuestionBlocks.SingleAsync(x => x.Id == blockId)).Name);
                Assert.Equal("Do'konda xarid", (await ctx.Questions.SingleAsync(x => x.Id == questionId)).Title);
                Assert.Equal(0, await ctx.Questions.CountAsync(x => x.TeacherId == teacherBId));
            }
        }
        finally
        {
            await using var ctx = CreateContext();
            await ctx.Questions.Where(q => createdQuestionIds.Contains(q.Id)).ExecuteDeleteAsync();
            await ctx.QuestionBlocks.Where(b => createdBlockIds.Contains(b.Id)).ExecuteDeleteAsync();
            await ctx.GroupMembers.Where(gm => gm.StudentId == studentId).ExecuteDeleteAsync();
            await ctx.Groups.Where(g => g.TeacherId == teacherAId).ExecuteDeleteAsync();
            await ctx.Users.Where(u => u.Id == teacherAId || u.Id == teacherBId || u.Id == studentId).ExecuteDeleteAsync();
        }
    }

    private static string AuthToken(Guid userId) =>
        new TokenService(new IdentityAuthOptions { SecretKey = CatalogApiFactory.TestSecretKey })
            .CreateAccessToken(userId.ToString());

    private static Task<HttpResponseMessage> Api(
        HttpClient client, HttpMethod method, string url, string token, HttpContent? content = null)
    {
        var req = new HttpRequestMessage(method, url) { Content = content };
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client.SendAsync(req);
    }

    // Property names AS WRITTEN (snake_case) — the API deserializes with a snake_case policy.
    private static HttpContent Body(object body) => JsonContent.Create(body);

    /// <summary>A multipart body for the task-media endpoint. The bytes are arbitrary: validation is
    /// by DECLARED content-type and length, so a "png" here need not be a real image — what is under
    /// test is the allow-list and the ceiling, not image decoding.</summary>
    private static HttpContent MediaForm(string contentType, string fileName, int bytes)
    {
        var form = new MultipartFormDataContent();
        var part = new ByteArrayContent(new byte[bytes]);
        part.Headers.ContentType = new MediaTypeHeaderValue(contentType);
        form.Add(part, "media", fileName);
        return form;
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
        // The per-run throwaway database (see TestDatabase) — never the shared dev one.
        public string ConnectionString { get; } = TestDatabase.ConnectionString;

        internal const string TestSecretKey =
            "catalog-domain-integration-test-secret-key-do-not-use-in-prod";

        public CatalogApiFactory()
        {
            Environment.SetEnvironmentVariable("SECRET_KEY", TestSecretKey);
            Environment.SetEnvironmentVariable("GOVORI_DB", ConnectionString);
        }
    }
}
