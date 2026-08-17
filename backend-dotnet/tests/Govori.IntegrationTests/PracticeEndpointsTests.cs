using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Govori.Identity.Security;
using Govori.Infrastructure;
using Govori.Infrastructure.Entities;
using Govori.Platform.Storage;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Govori.IntegrationTests;

/// <summary>
/// Happy + gated paths for the Practice attempt-submit slice (docs/07 §7.2, Faza 3.3): HTTP →
/// PracticeService → EF Core (prod-shaped Postgres) + Govori.Platform.Storage (govori-net MinIO)
/// and back, plus the freemium 402 gate reused from Catalog (the same C4-characterized decision, so
/// the two surfaces can never diverge).
///
/// Seeds a teacher, one official PUBLIC published module with 4 tasks, a PREMIUM student and a FREE
/// student, then asserts:
/// <list type="bullet">
///   <item>a premium student submits to a public task → 201, a <c>pending</c> Submission row, and
///   the audio object lands in MinIO;</item>
///   <item>a free student submitting to a task past the free preview → <b>402</b>, with NO
///   Submission row written (and, structurally, no upload — the gate returns before storing);</item>
///   <item>list-my-attempts returns only the caller's own answers;</item>
///   <item>anonymous submit/list → 401.</item>
/// </list>
/// Every seeded row + uploaded object is removed in a finally so the run is idempotent.
/// </summary>
[Collection(PerRunDatabaseFixture.CollectionName)]
public sealed class PracticeEndpointsTests : IClassFixture<PracticeEndpointsTests.PracticeApiFactory>, IDisposable
{
    private readonly PracticeApiFactory _factory;
    private readonly NpgsqlDataSource _dataSource;

    public PracticeEndpointsTests(PracticeApiFactory factory)
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
    public async Task Submit_stores_audio_and_gates_free_students_and_lists_own_attempts()
    {
        var teacherId = Guid.NewGuid();
        var premiumId = Guid.NewGuid();
        var freeId = Guid.NewGuid();
        var blockId = Guid.NewGuid();
        var premiumEmail = $"prac-premium-{premiumId:N}@example.test";
        var freeEmail = $"prac-free-{freeId:N}@example.test";
        const string password = "Practice!123";

        // 4 tasks in one public module (free preview = 3 → task index 3 is paywalled).
        var q = Enumerable.Range(0, 4).Select(_ => Guid.NewGuid()).ToArray();

        var hasher = new PasswordHasher();
        using var storage = new MinioObjectStorage(BuildStorageOptions());
        var uploadedKeys = new List<string>();

        await using (var ctx = CreateContext())
        {
            ctx.Users.Add(NewUser(teacherId, $"prac-teacher-{teacherId:N}@example.test", UserRole.Teacher, null, premium: false));
            ctx.Users.Add(NewUser(premiumId, premiumEmail, UserRole.Student, hasher.Hash(password), premium: true));
            ctx.Users.Add(NewUser(freeId, freeEmail, UserRole.Student, hasher.Hash(password), premium: false));
            ctx.QuestionBlocks.Add(NewBlock(blockId, teacherId, "public"));
            for (var i = 0; i < q.Length; i++)
                ctx.Questions.Add(NewQuestion(q[i], teacherId, blockId, sortOrder: i));
            await ctx.SaveChangesAsync();
        }

        try
        {
            var client = _factory.CreateClient();
            var premiumToken = TokenFor(premiumId);
            var freeToken = TokenFor(freeId);

            // ── Anonymous → 401 (RequireAuthorization) ──
            Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/submissions")).StatusCode);
            Assert.Equal(HttpStatusCode.Unauthorized,
                (await client.PostAsync("/api/submissions", BuildAudioForm(q[0]))).StatusCode);

            // ── Premium student submits to the first public task → 201 + pending row + MinIO object ──
            var okResp = await Send(client, HttpMethod.Post, "/api/submissions", premiumToken, BuildAudioForm(q[0]));
            Assert.Equal(HttpStatusCode.Created, okResp.StatusCode);
            using var okDoc = JsonDocument.Parse(await okResp.Content.ReadAsStringAsync());
            var submissionId = okDoc.RootElement.GetProperty("id").GetGuid();
            var audioKey = okDoc.RootElement.GetProperty("audio_key").GetString()!;
            uploadedKeys.Add(audioKey);

            Assert.Equal(premiumId, okDoc.RootElement.GetProperty("student_id").GetGuid());
            Assert.Equal(q[0], okDoc.RootElement.GetProperty("question_id").GetGuid());
            Assert.Equal("pending", okDoc.RootElement.GetProperty("status").GetString());
            Assert.StartsWith("answers/", audioKey);                       // answer audio keeps the "answers/" key prefix

            // The row exists and is pending.
            await using (var ctx = CreateContext())
            {
                var row = await ctx.Submissions.FirstOrDefaultAsync(s => s.Id == submissionId);
                Assert.NotNull(row);
                Assert.Equal(SubmissionStatus.Pending, row!.Status);
                Assert.Equal(audioKey, row.AudioKey);
            }
            // The audio object actually landed in MinIO.
            Assert.True(await storage.ExistsAsync(audioKey), "submitted audio object missing from MinIO");

            // ── Free student submits to the 4th task (index 3 ≥ free preview 3) → 402, NOTHING written ──
            var gatedResp = await Send(client, HttpMethod.Post, "/api/submissions", freeToken, BuildAudioForm(q[3]));
            Assert.Equal(HttpStatusCode.PaymentRequired, gatedResp.StatusCode);
            await using (var ctx = CreateContext())
            {
                var gatedRows = await ctx.Submissions.CountAsync(s => s.StudentId == freeId);
                Assert.Equal(0, gatedRows);                                // no submission for the gated student
            }

            // ── List-my-attempts returns only the caller's own answers ──
            var listResp = await Send(client, HttpMethod.Get, "/api/submissions", premiumToken);
            Assert.Equal(HttpStatusCode.OK, listResp.StatusCode);
            using var listDoc = JsonDocument.Parse(await listResp.Content.ReadAsStringAsync());
            var rows = listDoc.RootElement.EnumerateArray().ToList();
            Assert.Contains(rows, r => r.GetProperty("id").GetGuid() == submissionId);
            Assert.All(rows, r => Assert.Equal(premiumId, r.GetProperty("student_id").GetGuid()));
            // The score fields exist on every LIST row (null until graded) — the teacher panel
            // reads scores from here rather than fetching /detail per attempt.
            Assert.All(rows, r =>
            {
                Assert.True(r.TryGetProperty("overall_band", out _));
                Assert.True(r.TryGetProperty("fluency_score", out _));
                Assert.True(r.TryGetProperty("grammar_score", out _));
                Assert.True(r.TryGetProperty("pronunciation_score", out _));
                Assert.True(r.TryGetProperty("lexical_score", out _));
            });

            // ── ?student_id only NARROWS the caller's scope, never widens it ──
            // Own id → own rows.
            using (var ownDoc = JsonDocument.Parse(await (await Send(
                client, HttpMethod.Get, $"/api/submissions?student_id={premiumId}", premiumToken)).Content.ReadAsStringAsync()))
            {
                Assert.Contains(ownDoc.RootElement.EnumerateArray(), r => r.GetProperty("id").GetGuid() == submissionId);
            }
            // SOMEONE ELSE's id → empty, not their attempts. Asking for another student must not
            // be a way around the per-role scoping.
            using (var otherDoc = JsonDocument.Parse(await (await Send(
                client, HttpMethod.Get, $"/api/submissions?student_id={freeId}", premiumToken)).Content.ReadAsStringAsync()))
            {
                Assert.Empty(otherDoc.RootElement.EnumerateArray());
            }

            // ── Attempt detail: owner reads their own; a different student gets 404 ──
            var detailResp = await Send(client, HttpMethod.Get, $"/api/submissions/{submissionId}", premiumToken);
            Assert.Equal(HttpStatusCode.OK, detailResp.StatusCode);
            var otherResp = await Send(client, HttpMethod.Get, $"/api/submissions/{submissionId}", freeToken);
            Assert.Equal(HttpStatusCode.NotFound, otherResp.StatusCode);
        }
        finally
        {
            foreach (var key in uploadedKeys)
                await storage.DeleteAsync(key);
            await using var ctx = CreateContext();
            await ctx.Submissions.Where(s => s.StudentId == premiumId || s.StudentId == freeId).ExecuteDeleteAsync();
            await ctx.Questions.Where(x => x.BlockId == blockId).ExecuteDeleteAsync();
            await ctx.QuestionBlocks.Where(b => b.Id == blockId).ExecuteDeleteAsync();
            await ctx.Users.Where(u => u.Id == premiumId || u.Id == freeId || u.Id == teacherId).ExecuteDeleteAsync();
        }
    }

    /// <summary>
    /// D3's "Urinish" budget end to end: the cap is enforced at submit, a FAILED attempt does not
    /// spend one, and an assignment with no budget stays unlimited — which is what every assignment
    /// written before the column existed says.
    /// </summary>
    [Fact]
    public async Task Assignment_attempt_budget_is_enforced_and_a_failed_attempt_costs_nothing()
    {
        var teacherId = Guid.NewGuid();
        var studentId = Guid.NewGuid();
        var blockId = Guid.NewGuid();
        var cappedQ = Guid.NewGuid();          // assignment with max_attempts = 2
        var openQ = Guid.NewGuid();            // assignment with max_attempts = null
        var cappedAssignment = Guid.NewGuid();
        var openAssignment = Guid.NewGuid();

        using var storage = new MinioObjectStorage(BuildStorageOptions());
        var uploadedKeys = new List<string>();

        await using (var ctx = CreateContext())
        {
            ctx.Users.Add(NewUser(teacherId, $"cap-teacher-{teacherId:N}@example.test", UserRole.Teacher, null, premium: false));
            // Premium so the freemium gate can never be the thing that refuses a submit here.
            ctx.Users.Add(NewUser(studentId, $"cap-student-{studentId:N}@example.test", UserRole.Student, null, premium: true));
            ctx.QuestionBlocks.Add(NewBlock(blockId, teacherId, "public"));
            ctx.Questions.Add(NewQuestion(cappedQ, teacherId, blockId, sortOrder: 0));
            ctx.Questions.Add(NewQuestion(openQ, teacherId, blockId, sortOrder: 1));
            ctx.Assignments.Add(NewAssignment(cappedAssignment, teacherId, studentId, cappedQ, maxAttempts: 2));
            ctx.Assignments.Add(NewAssignment(openAssignment, teacherId, studentId, openQ, maxAttempts: null));
            await ctx.SaveChangesAsync();
        }

        try
        {
            var client = _factory.CreateClient();
            var token = TokenFor(studentId);

            async Task<HttpResponseMessage> SubmitTo(Guid questionId)
            {
                var resp = await Send(client, HttpMethod.Post, "/api/submissions", token, BuildAudioForm(questionId));
                if (resp.StatusCode == HttpStatusCode.Created)
                {
                    using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
                    uploadedKeys.Add(doc.RootElement.GetProperty("audio_key").GetString()!);
                }
                return resp;
            }

            // ── Both attempts of the budget are accepted, and both attach to the assignment ──
            Assert.Equal(HttpStatusCode.Created, (await SubmitTo(cappedQ)).StatusCode);
            Assert.Equal(HttpStatusCode.Created, (await SubmitTo(cappedQ)).StatusCode);
            await using (var ctx = CreateContext())
                Assert.Equal(2, await ctx.Submissions.CountAsync(s => s.AssignmentId == cappedAssignment));

            // ── The third is refused, and NOTHING is written for it ──
            var refused = await SubmitTo(cappedQ);
            Assert.Equal(HttpStatusCode.Forbidden, refused.StatusCode);
            using (var doc = JsonDocument.Parse(await refused.Content.ReadAsStringAsync()))
            {
                // The limit itself is in the message — "no attempts left" alone does not say how
                // many there were, and the student cannot see the assignment row.
                Assert.Contains("2", doc.RootElement.GetProperty("detail").GetString()!);
            }
            await using (var ctx = CreateContext())
                Assert.Equal(2, await ctx.Submissions.CountAsync(s => s.AssignmentId == cappedAssignment));

            // ── A FAILED attempt is refunded: grading fell over on our side ──
            await using (var ctx = CreateContext())
            {
                var first = await ctx.Submissions
                    .Where(s => s.AssignmentId == cappedAssignment)
                    .OrderBy(s => s.CreatedAt)
                    .FirstAsync();
                first.Status = SubmissionStatus.Failed;
                await ctx.SaveChangesAsync();
            }
            Assert.Equal(HttpStatusCode.Created, (await SubmitTo(cappedQ)).StatusCode);

            // ── /assignments/mine reports the budget and the spend, by the same rule ──
            var mineResp = await Send(client, HttpMethod.Get, "/api/assignments/mine", token);
            Assert.Equal(HttpStatusCode.OK, mineResp.StatusCode);
            using (var mineDoc = JsonDocument.Parse(await mineResp.Content.ReadAsStringAsync()))
            {
                var capped = mineDoc.RootElement.EnumerateArray()
                    .Single(r => r.GetProperty("id").GetGuid() == cappedAssignment);
                Assert.Equal(2, capped.GetProperty("max_attempts").GetInt32());
                Assert.Equal(2, capped.GetProperty("attempts_used").GetInt32());   // 3 rows, one failed

                var open = mineDoc.RootElement.EnumerateArray()
                    .Single(r => r.GetProperty("id").GetGuid() == openAssignment);
                Assert.Equal(JsonValueKind.Null, open.GetProperty("max_attempts").ValueKind);
                Assert.Equal(0, open.GetProperty("attempts_used").GetInt32());
            }

            // ── No budget ⇒ unlimited: past where the capped one had already stopped ──
            for (var i = 0; i < 3; i++)
                Assert.Equal(HttpStatusCode.Created, (await SubmitTo(openQ)).StatusCode);
        }
        finally
        {
            foreach (var key in uploadedKeys)
                await storage.DeleteAsync(key);
            await using var ctx = CreateContext();
            await ctx.Submissions.Where(s => s.StudentId == studentId).ExecuteDeleteAsync();
            await ctx.Assignments.Where(a => a.StudentId == studentId).ExecuteDeleteAsync();
            await ctx.Questions.Where(x => x.BlockId == blockId).ExecuteDeleteAsync();
            await ctx.QuestionBlocks.Where(b => b.Id == blockId).ExecuteDeleteAsync();
            await ctx.Users.Where(u => u.Id == studentId || u.Id == teacherId).ExecuteDeleteAsync();
        }
    }

    // ── helpers ──

    // Auth is phone-OTP now (no email/password login). These non-auth tests only need a bearer for a
    // seeded user, so mint the SAME access token login used to return (sub = user id, type = access)
    // directly with the host's test secret — hermetic, no OTP/Redis round-trip.
    private static string TokenFor(Guid userId) =>
        new TokenService(new IdentityAuthOptions { SecretKey = PracticeApiFactory.TestSecretKey })
            .CreateAccessToken(userId.ToString());

    private static Task<HttpResponseMessage> Send(
        HttpClient client, HttpMethod method, string url, string token, HttpContent? content = null)
    {
        var req = new HttpRequestMessage(method, url) { Content = content };
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client.SendAsync(req);
    }

    private static MultipartFormDataContent BuildAudioForm(Guid questionId)
    {
        var form = new MultipartFormDataContent
        {
            { new StringContent(questionId.ToString()), "question_id" },
            { new StringContent(3.5.ToString(CultureInfo.InvariantCulture)), "audio_duration_sec" },
        };
        var audio = new ByteArrayContent(Encoding.UTF8.GetBytes($"fake-webm-audio-{Guid.NewGuid():N}"));
        audio.Headers.ContentType = new MediaTypeHeaderValue("audio/webm");
        form.Add(audio, "audio", "answer.webm");
        return form;
    }

    private static StorageOptions BuildStorageOptions()
    {
        var endpoint = Environment.GetEnvironmentVariable("GOVORI_S3_ENDPOINT") ?? "http://govori-minio:9000";
        return new StorageOptions
        {
            Endpoint = endpoint,
            PublicUrl = endpoint,
            AccessKey = Environment.GetEnvironmentVariable("GOVORI_S3_ACCESS_KEY") ?? "minioadmin",
            SecretKey = Environment.GetEnvironmentVariable("GOVORI_S3_SECRET_KEY") ?? "minioadmin",
            Bucket = Environment.GetEnvironmentVariable("GOVORI_S3_BUCKET") ?? "govori-audio",
            Region = "us-east-1",
        };
    }

    private static User NewUser(Guid id, string email, UserRole role, string? passwordHash, bool premium) => new()
    {
        Id = id,
        Email = email,
        FullName = "Practice Seed",
        PasswordHash = passwordHash,
        Role = role,
        IsActive = true,
        IsPremium = premium,
        PreferredLanguage = "uz",
        CreatedAt = DateTime.UtcNow,
        UpdatedAt = DateTime.UtcNow,
    };

    private static QuestionBlock NewBlock(Guid id, Guid teacherId, string visibility) => new()
    {
        Id = id,
        TeacherId = teacherId,
        Name = "Practice Module",
        Visibility = visibility,
        IsPublished = true,
        SortOrder = 0,
        CreatedAt = DateTime.UtcNow,
        UpdatedAt = DateTime.UtcNow,
    };

    private static Assignment NewAssignment(
        Guid id, Guid teacherId, Guid studentId, Guid questionId, int? maxAttempts) => new()
    {
        Id = id,
        TeacherId = teacherId,
        StudentId = studentId,
        QuestionId = questionId,
        DueAt = null,                        // open, so SubmitAsync attributes answers to it
        MaxAttempts = maxAttempts,
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
        CreatedAt = new DateTime(2024, 1, 1, 0, 0, 0, DateTimeKind.Utc).AddSeconds(sortOrder),
        UpdatedAt = DateTime.UtcNow,
    };

    public void Dispose() => _dataSource.Dispose();

    /// <summary>Boots Govori.Api against the schema DB with a fixed test SECRET_KEY (same pattern as
    /// AuthEndpointsTests/CatalogEndpointsTests). MinIO config reaches Program.cs via the
    /// GOVORI_S3_ENDPOINT process env var supplied by the test runner.</summary>
    public sealed class PracticeApiFactory : WebApplicationFactory<Program>
    {
        // The per-run throwaway database (see TestDatabase) — never the shared dev one.
        public string ConnectionString { get; } = TestDatabase.ConnectionString;

        internal const string TestSecretKey =
            "practice-domain-integration-test-secret-key-do-not-use-in-prod";

        public PracticeApiFactory()
        {
            Environment.SetEnvironmentVariable("SECRET_KEY", TestSecretKey);
            Environment.SetEnvironmentVariable("GOVORI_DB", ConnectionString);
        }

        // Practice submit enqueues grading through IGradingQueue; keep the in-process queue (no
        // Hangfire Postgres storage) and in-memory SignalR (no Redis backplane) so this slice stays
        // hermetic and asserts a freshly-created attempt is still `pending`, exactly as before.
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseSetting("GOVORI_HANGFIRE", "false");
            builder.UseSetting("GOVORI_SIGNALR_BACKPLANE", "false");
        }
    }
}
