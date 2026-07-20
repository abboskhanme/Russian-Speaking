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
/// and back, plus the freemium 402 gate reused from Catalog (submissions.py:99-274, access.py:78-89).
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
            Assert.StartsWith("answers/", audioKey);                       // Python new_key("answers", …) scheme

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
        public string ConnectionString { get; } =
            Environment.GetEnvironmentVariable("GOVORI_TEST_DB")
            ?? GovoriDataSourceFactory.DefaultConnectionString;

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
