using System.Text;
using System.Text.Json;
using Govori.Assessment;
using Govori.Contracts;
using Govori.Infrastructure;
using Govori.Infrastructure.Entities;
using Govori.Platform.Grader;
using Govori.Platform.Storage;
using Govori.Platform.Stt;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Npgsql;

namespace Govori.IntegrationTests;

/// <summary>
/// The grading pipeline end-to-end (docs/07 §7.7, Faza 3.4): IGradingQueue → AssessmentService →
/// STT (Fake) → Grader (Fake) → C5 scoring → EF Core (prod-shaped Postgres) writing the
/// <c>transcripts</c> + <c>evaluations</c> JSONB rows and flipping the submission to <c>done</c>.
/// Fake providers are swapped in via <c>ConfigureTestServices</c> (never in prod DI).
///
/// <para>Asserts (1) a normal answer is fully graded and the score equals the frozen C5 formula for
/// the fakes' numbers, and (2) resume-from-transcript reuses a persisted <c>Transcript</c>, SKIPS
/// STT, and scores from the STORED pronunciation. Every seeded row + MinIO object is removed in a
/// finally so the run is idempotent.</para>
/// </summary>
[Collection(PerRunDatabaseFixture.CollectionName)]
public sealed class AssessmentPipelineTests
    : IClassFixture<AssessmentPipelineTests.AssessmentApiFactory>, IDisposable
{
    private readonly AssessmentApiFactory _factory;
    private readonly NpgsqlDataSource _dataSource;

    public AssessmentPipelineTests(AssessmentApiFactory factory)
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
    public async Task Pipeline_transcribes_grades_scores_and_persists_a_done_evaluation()
    {
        var teacherId = Guid.NewGuid();
        var studentId = Guid.NewGuid();
        var blockId = Guid.NewGuid();
        var questionId = Guid.NewGuid();
        var submissionId = Guid.NewGuid();

        using var storage = new MinioObjectStorage(BuildStorageOptions());
        var audioKey = storage.NewKey("answers", "webm");
        var uploadedKeys = new List<string> { audioKey };

        // Fake STT reports PronScore 70; Fake grader reports overall 80 / level 90.
        //   overall_band = (80*4 + 70)/5 = 78.0 ; level_score = (90*4 + 70)/5 = 86.0.
        var fakeStt = new FakeSttProvider(text: "привет как дела", pronScore: 70.0);
        var fakeGrader = new FakeGraderProvider();

        await SeedAsync(teacherId, studentId, blockId, questionId, submissionId, audioKey, referenceText: null);
        await using var upload = new MemoryStream(Encoding.UTF8.GetBytes($"fake-webm-{Guid.NewGuid():N}"));
        await storage.PutAsync(audioKey, upload, "audio/webm");

        try
        {
            await using var host = HostWithFakes(fakeStt, fakeGrader);
            var queue = host.Services.GetRequiredService<IGradingQueue>();

            await queue.EnqueueAsync(submissionId);

            Assert.Equal(1, fakeStt.TranscribeCalls);                       // STT actually ran (no resume)
            Assert.Equal(1, fakeGrader.AnalyzeCalls);

            await using var ctx = CreateContext();
            var sub = await ctx.Submissions.FirstAsync(s => s.Id == submissionId);
            Assert.Equal(SubmissionStatus.Done, sub.Status);
            Assert.NotNull(sub.CompletedAt);

            var transcript = await ctx.Transcripts.FirstOrDefaultAsync(t => t.SubmissionId == submissionId);
            Assert.NotNull(transcript);
            Assert.Equal("привет как дела", transcript!.Text);
            Assert.Equal("fake-stt", transcript.SttModel);
            // JSONB round-trips as valid JSON with the wire-contract snake_case keys.
            using (var pron = JsonDocument.Parse(transcript.Pronunciation!))
                Assert.Equal(70.0, pron.RootElement.GetProperty("pronunciation").GetDouble());
            using (var words = JsonDocument.Parse(transcript.WordTimestamps!))
                Assert.Equal(JsonValueKind.Array, words.RootElement.ValueKind);

            var eval = await ctx.Evaluations.FirstOrDefaultAsync(e => e.SubmissionId == submissionId);
            Assert.NotNull(eval);
            Assert.Equal(78.0, eval!.OverallBand, 6);                       // C5: (80*4+70)/5
            Assert.Equal(86.0, eval.LevelScore!.Value, 6);                  // C5: (90*4+70)/5
            Assert.Equal(70.0, eval.PronunciationScore!.Value, 6);
            Assert.Equal("fake-grader", eval.LlmModel);
            using (var fb = JsonDocument.Parse(eval.Feedback!))
                Assert.True(fb.RootElement.TryGetProperty("summary", out _));
            using (var corr = JsonDocument.Parse(eval.Corrections!))
                Assert.Equal(JsonValueKind.Array, corr.RootElement.ValueKind);
        }
        finally
        {
            await CleanupAsync(uploadedKeys, storage, teacherId, studentId, blockId, questionId, submissionId);
        }
    }

    [Fact]
    public async Task Pipeline_resumes_from_an_existing_transcript_and_skips_STT()
    {
        var teacherId = Guid.NewGuid();
        var studentId = Guid.NewGuid();
        var blockId = Guid.NewGuid();
        var questionId = Guid.NewGuid();
        var submissionId = Guid.NewGuid();

        using var storage = new MinioObjectStorage(BuildStorageOptions());
        var audioKey = storage.NewKey("answers", "webm");
        var uploadedKeys = new List<string> { audioKey };

        var fakeStt = new FakeSttProvider(text: "SHOULD NOT BE USED", pronScore: 999);
        var fakeGrader = new FakeGraderProvider();

        await SeedAsync(teacherId, studentId, blockId, questionId, submissionId, audioKey, referenceText: null);
        // Pre-seed a Transcript with a stored PronScore of 92 → the pipeline must reuse THIS, not STT.
        await using (var ctx = CreateContext())
        {
            var now = DateTime.UtcNow;
            ctx.Transcripts.Add(new Transcript
            {
                Id = Guid.NewGuid(),
                SubmissionId = submissionId,
                Text = "resumed transcript text",
                Language = "ru-RU",
                Pronunciation = "{\"pronunciation\": 92.0}",
                SttModel = "persisted-stt",
                CreatedAt = now,
                UpdatedAt = now,
            });
            await ctx.SaveChangesAsync();
        }

        try
        {
            await using var host = HostWithFakes(fakeStt, fakeGrader);
            var queue = host.Services.GetRequiredService<IGradingQueue>();

            await queue.EnqueueAsync(submissionId);

            Assert.Equal(0, fakeStt.TranscribeCalls);                       // STT SKIPPED (resume)

            await using var ctx = CreateContext();
            var sub = await ctx.Submissions.FirstAsync(s => s.Id == submissionId);
            Assert.Equal(SubmissionStatus.Done, sub.Status);

            var transcript = await ctx.Transcripts.FirstAsync(t => t.SubmissionId == submissionId);
            Assert.Equal("resumed transcript text", transcript.Text);       // untouched
            Assert.Equal("persisted-stt", transcript.SttModel);

            var eval = await ctx.Evaluations.FirstAsync(e => e.SubmissionId == submissionId);
            Assert.Equal(82.4, eval.OverallBand, 6);                        // C5 with stored pron 92: (80*4+92)/5
            Assert.Equal(90.4, eval.LevelScore!.Value, 6);                  // (90*4+92)/5
            Assert.Equal(92.0, eval.PronunciationScore!.Value, 6);
        }
        finally
        {
            await CleanupAsync(uploadedKeys, storage, teacherId, studentId, blockId, questionId, submissionId);
        }
    }

    // ── helpers ──

    private WebApplicationFactory<Program> HostWithFakes(ISttProvider stt, IGraderProvider grader)
        => _factory.WithWebHostBuilder(b => b.ConfigureTestServices(services =>
        {
            services.RemoveAll<ISttProvider>();
            services.AddSingleton(stt);
            services.RemoveAll<IGraderProvider>();
            services.AddSingleton(grader);
        }));

    private async Task SeedAsync(
        Guid teacherId, Guid studentId, Guid blockId, Guid questionId, Guid submissionId,
        string audioKey, string? referenceText)
    {
        await using var ctx = CreateContext();
        var now = DateTime.UtcNow;
        ctx.Users.Add(NewUser(teacherId, $"asmt-teacher-{teacherId:N}@example.test", UserRole.Teacher));
        ctx.Users.Add(NewUser(studentId, $"asmt-student-{studentId:N}@example.test", UserRole.Student));
        ctx.QuestionBlocks.Add(new QuestionBlock
        {
            Id = blockId,
            TeacherId = teacherId,
            Name = "Assessment Module",
            Visibility = "public",
            IsPublished = true,
            SortOrder = 0,
            CreatedAt = now,
            UpdatedAt = now,
        });
        ctx.Questions.Add(new Question
        {
            Id = questionId,
            TeacherId = teacherId,
            BlockId = blockId,
            Type = QuestionType.Text,
            Title = "Assessment Task",
            PromptText = "Расскажите о себе.",
            InstructionText = null,
            Level = "A2",
            Topic = "О себе",
            IsPublished = true,
            IsDeleted = false,
            IsPublic = false,
            PrepTimeSec = 0,
            AnswerTimeLimitSec = 0,
            SortOrder = 0,
            CreatedAt = now,
            UpdatedAt = now,
        });
        ctx.Submissions.Add(new Submission
        {
            Id = submissionId,
            StudentId = studentId,
            QuestionId = questionId,
            AudioKey = audioKey,
            ReferenceText = referenceText,
            Status = SubmissionStatus.Pending,
            CreatedAt = now,
            UpdatedAt = now,
        });
        await ctx.SaveChangesAsync();
    }

    private async Task CleanupAsync(
        List<string> uploadedKeys, MinioObjectStorage storage,
        Guid teacherId, Guid studentId, Guid blockId, Guid questionId, Guid submissionId)
    {
        foreach (var key in uploadedKeys)
            await storage.DeleteAsync(key);
        await using var ctx = CreateContext();
        await ctx.Evaluations.Where(e => e.SubmissionId == submissionId).ExecuteDeleteAsync();
        await ctx.Transcripts.Where(t => t.SubmissionId == submissionId).ExecuteDeleteAsync();
        await ctx.Submissions.Where(s => s.Id == submissionId).ExecuteDeleteAsync();
        await ctx.Questions.Where(q => q.Id == questionId).ExecuteDeleteAsync();
        await ctx.QuestionBlocks.Where(b => b.Id == blockId).ExecuteDeleteAsync();
        await ctx.Users.Where(u => u.Id == teacherId || u.Id == studentId).ExecuteDeleteAsync();
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

    private static User NewUser(Guid id, string email, UserRole role) => new()
    {
        Id = id,
        Email = email,
        FullName = "Assessment Seed",
        Role = role,
        IsActive = true,
        IsPremium = false,
        PreferredLanguage = "uz",
        CreatedAt = DateTime.UtcNow,
        UpdatedAt = DateTime.UtcNow,
    };

    public void Dispose() => _dataSource.Dispose();

    /// <summary>Boots Govori.Api against the schema DB with a fixed test SECRET_KEY (same pattern as
    /// PracticeEndpointsTests). MinIO config reaches Program.cs via the GOVORI_S3_ENDPOINT env var.</summary>
    public sealed class AssessmentApiFactory : WebApplicationFactory<Program>
    {
        // The per-run throwaway database (see TestDatabase) — never the shared dev one.
        public string ConnectionString { get; } = TestDatabase.ConnectionString;

        private const string TestSecretKey =
            "assessment-domain-integration-test-secret-key-do-not-use-in-prod";

        public AssessmentApiFactory()
        {
            Environment.SetEnvironmentVariable("SECRET_KEY", TestSecretKey);
            Environment.SetEnvironmentVariable("GOVORI_DB", ConnectionString);
        }

        // This slice drives the pipeline synchronously via IGradingQueue and asserts the result
        // inline, so keep the in-process queue (no Hangfire Postgres storage) and in-memory SignalR
        // (no Redis backplane) — the durable/real-time paths are covered by AttemptEventsTests.
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseSetting("GOVORI_HANGFIRE", "false");
            builder.UseSetting("GOVORI_SIGNALR_BACKPLANE", "false");
        }
    }
}
