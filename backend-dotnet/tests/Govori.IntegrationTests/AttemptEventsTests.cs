using System.Collections.Concurrent;
using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Govori.Assessment;
using Govori.Contracts;
using Govori.Identity.Security;
using Govori.Infrastructure;
using Govori.Infrastructure.Entities;
using Govori.Platform.Grader;
using Govori.Platform.Storage;
using Govori.Platform.Stt;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.SignalR;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Npgsql;

namespace Govori.IntegrationTests;

/// <summary>
/// The real-time grading-progress slice (docs/08 Faza 3.10): HTTP submit → the enqueue seam
/// (<see cref="IGradingQueue"/>) → the durable <see cref="GradingJob"/> → <c>AssessmentService</c>
/// emitting progress through <see cref="IGradingEvents"/> → the <c>/hubs/attempts</c> SignalR hub →
/// a connected client. The Hangfire job is exercised by invoking the job class DIRECTLY (the
/// sanctioned inline substitute — no Postgres Hangfire storage is touched), with Fake STT/Grader.
///
/// Asserts:
/// <list type="bullet">
///   <item>submit calls the enqueue seam and leaves the attempt <c>pending</c> (grading deferred);</item>
///   <item>the owner's SignalR client streams the full state timeline
///   (queued → transcribing → grading → scoring → done) and the submission ends <c>done</c> with a
///   Transcript + Evaluation (frozen C5 numbers);</item>
///   <item>re-running the job is IDEMPOTENT — still <c>done</c>, a single Evaluation row, a second
///   terminal event;</item>
///   <item>OWNERSHIP: a different student cannot subscribe (HubException), an anonymous client can't
///   even connect ([Authorize]), and the owner can.</item>
/// </list>
/// Every seeded row + MinIO object is removed in a finally so the run is idempotent.
/// </summary>
public sealed class AttemptEventsTests
    : IClassFixture<AttemptEventsTests.AttemptEventsFactory>, IDisposable
{
    private readonly AttemptEventsFactory _factory;
    private readonly NpgsqlDataSource _dataSource;

    public AttemptEventsTests(AttemptEventsFactory factory)
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
    public async Task Grading_job_streams_progress_to_the_owner_and_ends_done_idempotently()
    {
        var teacherId = Guid.NewGuid();
        var ownerId = Guid.NewGuid();
        var blockId = Guid.NewGuid();
        var questionId = Guid.NewGuid();
        const string password = "Attempt!123";
        var ownerEmail = $"evt-owner-{ownerId:N}@example.test";

        var hasher = new PasswordHasher();
        using var storage = new MinioObjectStorage(BuildStorageOptions());
        var uploadedKeys = new List<string>();

        await using (var ctx = CreateContext())
        {
            ctx.Users.Add(NewUser(teacherId, $"evt-teacher-{teacherId:N}@example.test", UserRole.Teacher, null, false));
            ctx.Users.Add(NewUser(ownerId, ownerEmail, UserRole.Student, hasher.Hash(password), premium: true));
            ctx.QuestionBlocks.Add(NewBlock(blockId, teacherId));
            ctx.Questions.Add(NewQuestion(questionId, teacherId, blockId, sortOrder: 0));
            await ctx.SaveChangesAsync();
        }

        try
        {
            var client = _factory.CreateClient();
            var token = TokenFor(ownerId);

            // ── Submit (proves the enqueue seam; RecordingGradingQueue does NOT grade) ──
            var resp = await Send(client, HttpMethod.Post, "/api/submissions", token, BuildAudioForm(questionId));
            Assert.Equal(HttpStatusCode.Created, resp.StatusCode);
            using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
            var submissionId = doc.RootElement.GetProperty("id").GetGuid();
            var audioKey = doc.RootElement.GetProperty("audio_key").GetString()!;
            uploadedKeys.Add(audioKey);
            Assert.Equal("pending", doc.RootElement.GetProperty("status").GetString());
            Assert.Contains(submissionId, _factory.Queue.Enqueued);          // submit hit IGradingQueue.EnqueueAsync

            // ── Owner connects + subscribes to the attempt's group ──
            var events = new ConcurrentQueue<(string State, Guid SubmissionId, string Status)>();
            await using var connection = BuildConnection(token);
            connection.On<JsonElement>("progress", evt => events.Enqueue((
                evt.GetProperty("state").GetString()!,
                evt.GetProperty("submission_id").GetGuid(),
                evt.GetProperty("status").GetString()!)));
            await connection.StartAsync();
            await connection.InvokeAsync("SubscribeToAttempt", submissionId);

            // ── Run the grading job directly (inline Hangfire substitute) ──
            await RunJobAsync(submissionId);
            await WaitForTerminalAsync(events, 1);

            var round1 = events.ToArray();
            var states = round1.Select(e => e.State).ToList();
            Assert.Contains(GradingState.Queued, states);
            Assert.Contains(GradingState.Transcribing, states);
            Assert.Contains(GradingState.Grading, states);
            Assert.Contains(GradingState.Scoring, states);
            Assert.Equal(GradingState.Done, round1[^1].State);              // final = done
            Assert.Equal("done", round1[^1].Status);
            Assert.All(round1, e => Assert.Equal(submissionId, e.SubmissionId));

            // ── DB: graded, done, Transcript + Evaluation (frozen C5: (80*4+70)/5 = 78) ──
            await using (var ctx = CreateContext())
            {
                var sub = await ctx.Submissions.FirstAsync(s => s.Id == submissionId);
                Assert.Equal(SubmissionStatus.Done, sub.Status);
                Assert.NotNull(sub.CompletedAt);
                Assert.NotNull(await ctx.Transcripts.FirstOrDefaultAsync(t => t.SubmissionId == submissionId));
                var eval = await ctx.Evaluations.FirstOrDefaultAsync(e => e.SubmissionId == submissionId);
                Assert.NotNull(eval);
                Assert.Equal(78.0, eval!.OverallBand, 6);
                Assert.Equal(86.0, eval.LevelScore!.Value, 6);
            }

            // ── Idempotent re-run: still done, single Evaluation, a second terminal event ──
            await RunJobAsync(submissionId);
            await WaitForTerminalAsync(events, 2);
            Assert.Equal(GradingState.Done, events.ToArray()[^1].State);
            await using (var ctx = CreateContext())
            {
                Assert.Equal(1, await ctx.Evaluations.CountAsync(e => e.SubmissionId == submissionId));
                var sub = await ctx.Submissions.FirstAsync(s => s.Id == submissionId);
                Assert.Equal(SubmissionStatus.Done, sub.Status);
            }

            await connection.StopAsync();
        }
        finally
        {
            await CleanupAsync(uploadedKeys, storage, blockId, new[] { teacherId, ownerId });
        }
    }

    [Fact]
    public async Task Only_the_owner_may_subscribe_and_anonymous_is_rejected()
    {
        var teacherId = Guid.NewGuid();
        var ownerId = Guid.NewGuid();
        var otherId = Guid.NewGuid();
        var blockId = Guid.NewGuid();
        var questionId = Guid.NewGuid();
        var submissionId = Guid.NewGuid();
        const string password = "Attempt!123";
        var ownerEmail = $"evt2-owner-{ownerId:N}@example.test";
        var otherEmail = $"evt2-other-{otherId:N}@example.test";

        var hasher = new PasswordHasher();
        using var storage = new MinioObjectStorage(BuildStorageOptions());
        var audioKey = storage.NewKey("answers", "webm");

        await using (var ctx = CreateContext())
        {
            ctx.Users.Add(NewUser(teacherId, $"evt2-teacher-{teacherId:N}@example.test", UserRole.Teacher, null, false));
            ctx.Users.Add(NewUser(ownerId, ownerEmail, UserRole.Student, hasher.Hash(password), premium: true));
            ctx.Users.Add(NewUser(otherId, otherEmail, UserRole.Student, hasher.Hash(password), premium: true));
            ctx.QuestionBlocks.Add(NewBlock(blockId, teacherId));
            ctx.Questions.Add(NewQuestion(questionId, teacherId, blockId, sortOrder: 0));
            var now = DateTime.UtcNow;
            ctx.Submissions.Add(new Submission
            {
                Id = submissionId,
                StudentId = ownerId,
                QuestionId = questionId,
                AudioKey = audioKey,
                Status = SubmissionStatus.Pending,
                CreatedAt = now,
                UpdatedAt = now,
            });
            await ctx.SaveChangesAsync();
        }

        try
        {
            var client = _factory.CreateClient();

            // ── A DIFFERENT student cannot subscribe to the owner's attempt ──
            var otherToken = TokenFor(otherId);
            await using (var otherConn = BuildConnection(otherToken))
            {
                await otherConn.StartAsync();
                var ex = await Assert.ThrowsAsync<HubException>(
                    () => otherConn.InvokeAsync("SubscribeToAttempt", submissionId));
                Assert.Contains("forbidden", ex.Message, StringComparison.OrdinalIgnoreCase);
                await otherConn.StopAsync();
            }

            // ── Anonymous can't even connect (hub is [Authorize]) ──
            await using (var anonConn = BuildConnection(token: null))
            {
                await Assert.ThrowsAnyAsync<Exception>(() => anonConn.StartAsync());
            }

            // ── The owner CAN subscribe (positive control) ──
            var ownerToken = TokenFor(ownerId);
            await using (var ownerConn = BuildConnection(ownerToken))
            {
                await ownerConn.StartAsync();
                await ownerConn.InvokeAsync("SubscribeToAttempt", submissionId); // must not throw
                await ownerConn.StopAsync();
            }
        }
        finally
        {
            await using var ctx = CreateContext();
            await ctx.Submissions.Where(s => s.Id == submissionId).ExecuteDeleteAsync();
            await ctx.Questions.Where(q => q.BlockId == blockId).ExecuteDeleteAsync();
            await ctx.QuestionBlocks.Where(b => b.Id == blockId).ExecuteDeleteAsync();
            await ctx.Users.Where(u => u.Id == teacherId || u.Id == ownerId || u.Id == otherId).ExecuteDeleteAsync();
        }
    }

    // ── helpers ──

    private async Task RunJobAsync(Guid submissionId)
    {
        using var scope = _factory.Services.CreateScope();
        var job = scope.ServiceProvider.GetRequiredService<GradingJob>();
        await job.RunAsync(submissionId);
    }

    private HubConnection BuildConnection(string? token)
        => new HubConnectionBuilder()
            .WithUrl(new Uri(_factory.Server.BaseAddress, "hubs/attempts"), options =>
            {
                // LongPolling routes cleanly through the in-memory TestServer handler; auth travels on
                // the Authorization header the AccessTokenProvider supplies.
                options.Transports = HttpTransportType.LongPolling;
                options.HttpMessageHandlerFactory = _ => _factory.Server.CreateHandler();
                if (token is not null)
                    options.AccessTokenProvider = () => Task.FromResult<string?>(token);
            })
            .Build();

    private static async Task WaitForTerminalAsync(
        ConcurrentQueue<(string State, Guid SubmissionId, string Status)> events, int minTerminal)
    {
        var deadline = DateTime.UtcNow.AddSeconds(20);
        while (DateTime.UtcNow < deadline)
        {
            if (events.Count(e => e.State is GradingState.Done or GradingState.Failed) >= minTerminal)
                return;
            await Task.Delay(50);
        }
        Assert.Fail($"timed out waiting for {minTerminal} terminal grading event(s)");
    }

    private async Task CleanupAsync(
        List<string> uploadedKeys, MinioObjectStorage storage, Guid blockId, Guid[] userIds)
    {
        foreach (var key in uploadedKeys)
            await storage.DeleteAsync(key);
        await using var ctx = CreateContext();
        var subIds = await ctx.Submissions.Where(s => userIds.Contains(s.StudentId)).Select(s => s.Id).ToListAsync();
        await ctx.Evaluations.Where(e => subIds.Contains(e.SubmissionId)).ExecuteDeleteAsync();
        await ctx.Transcripts.Where(t => subIds.Contains(t.SubmissionId)).ExecuteDeleteAsync();
        await ctx.Submissions.Where(s => userIds.Contains(s.StudentId)).ExecuteDeleteAsync();
        await ctx.Questions.Where(q => q.BlockId == blockId).ExecuteDeleteAsync();
        await ctx.QuestionBlocks.Where(b => b.Id == blockId).ExecuteDeleteAsync();
        await ctx.Users.Where(u => userIds.Contains(u.Id)).ExecuteDeleteAsync();
    }

    // Auth is phone-OTP now (no email/password login). These non-auth tests only need a bearer for a
    // seeded user, so mint the SAME access token login used to return (sub = user id) with the test secret.
    private static string TokenFor(Guid userId) =>
        new TokenService(new IdentityAuthOptions { SecretKey = AttemptEventsFactory.TestSecretKey })
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
        FullName = "Attempt Events Seed",
        PasswordHash = passwordHash,
        Role = role,
        IsActive = true,
        IsPremium = premium,
        PreferredLanguage = "uz",
        CreatedAt = DateTime.UtcNow,
        UpdatedAt = DateTime.UtcNow,
    };

    private static QuestionBlock NewBlock(Guid id, Guid teacherId) => new()
    {
        Id = id,
        TeacherId = teacherId,
        Name = "Attempt Events Module",
        Visibility = "public",
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
        PromptText = "Расскажите о себе.",
        Level = "A2",
        Topic = "О себе",
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

    /// <summary>
    /// Boots Govori.Api with Fake STT/Grader + a recording (non-grading) queue, the in-process
    /// grading path (GOVORI_HANGFIRE=false — no Postgres Hangfire storage) and in-memory SignalR
    /// (GOVORI_SIGNALR_BACKPLANE=false — single process, no Redis backplane needed).
    /// </summary>
    public sealed class AttemptEventsFactory : WebApplicationFactory<Program>
    {
        public string ConnectionString { get; } =
            Environment.GetEnvironmentVariable("GOVORI_TEST_DB")
            ?? GovoriDataSourceFactory.DefaultConnectionString;

        public FakeSttProvider Stt { get; } = new(text: "привет как дела", pronScore: 70.0);
        public FakeGraderProvider Grader { get; } = new();
        public RecordingGradingQueue Queue { get; } = new();

        internal const string TestSecretKey =
            "attempt-events-integration-test-secret-key-do-not-use-in-prod";

        public AttemptEventsFactory()
        {
            Environment.SetEnvironmentVariable("SECRET_KEY", TestSecretKey);
            Environment.SetEnvironmentVariable("GOVORI_DB", ConnectionString);
        }

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseSetting("GOVORI_HANGFIRE", "false");
            builder.UseSetting("GOVORI_SIGNALR_BACKPLANE", "false");
            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll<ISttProvider>();
                services.AddSingleton<ISttProvider>(Stt);
                services.RemoveAll<IGraderProvider>();
                services.AddSingleton<IGraderProvider>(Grader);
                // The submit path enqueues here (recorded, NOT graded) so the test controls WHEN the
                // job runs — after the SignalR client has joined the attempt's group.
                services.RemoveAll<IGradingQueue>();
                services.AddSingleton<IGradingQueue>(Queue);
            });
        }
    }

    /// <summary>A no-op <see cref="IGradingQueue"/> that just records the ids submit hands it.</summary>
    public sealed class RecordingGradingQueue : IGradingQueue
    {
        public ConcurrentQueue<Guid> Enqueued { get; } = new();

        public Task EnqueueAsync(Guid submissionId, CancellationToken ct = default)
        {
            Enqueued.Enqueue(submissionId);
            return Task.CompletedTask;
        }
    }
}
