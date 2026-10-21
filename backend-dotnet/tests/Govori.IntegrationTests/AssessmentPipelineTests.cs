using System.Text;
using System.Text.Json;
using Govori.Assessment;
using Govori.Contracts;
using Govori.Engagement;
using Govori.Infrastructure;
using Govori.Infrastructure.Entities;
using Govori.Platform.Ai;
using Govori.Platform.Grader;
using Govori.Platform.Storage;
using Govori.Platform.Stt;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging.Abstractions;
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
            {
                Assert.True(fb.RootElement.TryGetProperty("summary", out _));
                Assert.Equal("uz", fb.RootElement.GetProperty("lang").GetString());   // seeded student is uz
            }
            using (var corr = JsonDocument.Parse(eval.Corrections!))
                Assert.Equal(JsonValueKind.Array, corr.RootElement.ValueKind);

            // The in-process queue runs the SAME GradingJob the Worker runs, so the engagement reward
            // happened too (it used to call AssessmentService directly and silently skip it). All four
            // fake scores are >= 67, so there is nothing to review.
            var xp = await ctx.XpEvents.SingleAsync(e => e.SubmissionId == submissionId);
            Assert.Equal(EngagementService.XpForBand(eval.LevelScore), xp.Amount);
            Assert.False(await ctx.ReviewItems.AnyAsync(r => r.StudentId == studentId));
        }
        finally
        {
            await CleanupAsync(uploadedKeys, storage, teacherId, studentId, blockId, questionId, submissionId);
        }
    }

    [Fact]
    public async Task A_weak_answer_graded_through_the_pipeline_lands_on_the_review_queue()
    {
        // End to end: grade → GradingJob → IGradingRewarder → ScheduleReviewAsync. Lexical (50) is
        // the weakest of the two dimensions under 67.
        var teacherId = Guid.NewGuid();
        var studentId = Guid.NewGuid();
        var blockId = Guid.NewGuid();
        var questionId = Guid.NewGuid();
        var submissionId = Guid.NewGuid();
        using var storage = new MinioObjectStorage(BuildStorageOptions());

        var grader = new FakeGraderProvider(new GraderScores(
            Fluency: 60, Lexical: 50, Grammar: 70, Relevance: 90, Overall: 65, LevelOverall: 70));
        await SeedAsync(teacherId, studentId, blockId, questionId, submissionId, "answers/unused.webm", referenceText: null);
        await SeedTranscriptAsync(submissionId, "я люблю читать книги");   // resume path: no audio needed

        try
        {
            await using var host = HostWithFakes(new FakeSttProvider(), grader);
            await host.Services.GetRequiredService<IGradingQueue>().EnqueueAsync(submissionId);

            await using var ctx = CreateContext();
            var review = await ctx.ReviewItems.SingleAsync(r => r.StudentId == studentId);
            Assert.Equal("lexical", review.WeaknessDim);
            Assert.Equal(questionId, review.QuestionId);
            Assert.False(review.Completed);
        }
        finally
        {
            await CleanupAsync([], storage, teacherId, studentId, blockId, questionId, submissionId);
        }
    }

    // ─── Feedback language ──────────────────────────────────────────────────

    [Theory]
    [InlineData("ru", "ru", "Хороший ответ.")]
    [InlineData("en", "en", "Good answer.")]
    [InlineData("de", "uz", "Yaxshi javob.")]     // a locale the UI does not ship grades in Uzbek
    public async Task Feedback_is_written_in_the_students_language_and_the_language_is_recorded(
        string preferred, string expectedLang, string expectedSummary)
    {
        // The language is read at GRADING time, not copied from somewhere at submit time — so it is
        // set here, after seeding, exactly like a student switching the app between the two.
        var ids = await SeedResumableAsync();
        await using (var ctx = CreateContext())
            await ctx.Users.Where(u => u.Id == ids.Student)
                .ExecuteUpdateAsync(set => set.SetProperty(u => u.PreferredLanguage, preferred));

        var grader = new FakeGraderProvider();
        try
        {
            await using (var ctx = CreateContext())
                Assert.Equal(AssessmentOutcome.Done,
                    await Service(ctx, new FakeSttProvider(), grader, new RecordingGradingEvents()).RunAsync(ids.SubmissionId));

            Assert.Equal(expectedLang, grader.LastFeedbackLanguage);

            await using var check = CreateContext();
            var eval = await check.Evaluations.SingleAsync(e => e.SubmissionId == ids.SubmissionId);
            using var fb = JsonDocument.Parse(eval.Feedback!);
            Assert.Equal(expectedLang, fb.RootElement.GetProperty("lang").GetString());
            Assert.Equal(expectedSummary, fb.RootElement.GetProperty("summary").GetString());
        }
        finally
        {
            await CleanupSeedAsync(ids);
        }
    }

    // ─── How a run ends: a stable code on failure, a re-queue on shutdown ─────

    [Fact]
    public async Task A_grader_failure_stores_a_code_not_the_exception_text()
    {
        var ids = await SeedResumableAsync();
        var events = new RecordingGradingEvents();
        var grader = new ThrowingGrader(new AggregateException(
            "All 2 configured grader backend(s) failed.", new InvalidOperationException("429 quota exceeded for key AIza…")));

        try
        {
            await using (var ctx = CreateContext())
            {
                var outcome = await Service(ctx, new FakeSttProvider(), grader, events).RunAsync(ids.SubmissionId);
                Assert.Equal(AssessmentOutcome.Failed, outcome);
            }

            await using (var ctx = CreateContext())
            {
                var sub = await ctx.Submissions.SingleAsync(s => s.Id == ids.SubmissionId);
                Assert.Equal(SubmissionStatus.Failed, sub.Status);
                Assert.Equal(SubmissionErrorCodes.GraderFailed, sub.ErrorMessage);
            }
            // The live channel carries the same code — never the vendor's words.
            var failed = Assert.Single(events.Events, e => e.State == GradingState.Failed);
            Assert.Equal(SubmissionErrorCodes.GraderFailed, failed.Message);
        }
        finally
        {
            await CleanupSeedAsync(ids);
        }
    }

    [Fact]
    public async Task An_STT_failure_stores_the_stt_code()
    {
        var ids = await SeedResumableAsync(withTranscript: false);

        try
        {
            await using (var ctx = CreateContext())
            {
                var outcome = await Service(ctx, new ThrowingStt(), new FakeGraderProvider(), new RecordingGradingEvents())
                    .RunAsync(ids.SubmissionId);
                Assert.Equal(AssessmentOutcome.Failed, outcome);
            }

            await using (var ctx = CreateContext())
                Assert.Equal(SubmissionErrorCodes.SttFailed,
                    await ctx.Submissions.Where(s => s.Id == ids.SubmissionId).Select(s => s.ErrorMessage).SingleAsync());
        }
        finally
        {
            await CleanupSeedAsync(ids);
        }
    }

    // ─── The global AI budget: paused or capped ────────────────────────────────

    [Theory]
    [InlineData(AiBudgetBlock.Paused)]
    [InlineData(AiBudgetBlock.DailyCap)]
    [InlineData(AiBudgetBlock.MonthlyCap)]
    public async Task A_closed_AI_budget_fails_the_attempt_at_once_with_its_own_code_and_calls_no_vendor(AiBudgetBlock block)
    {
        // Not DEFERRED: a deferred attempt sits pending until the sweeper fails it twenty minutes
        // later. A closed budget is known now, so the student is told now ("try again later").
        var ids = await SeedResumableAsync(withTranscript: false);
        var events = new RecordingGradingEvents();
        var stt = new FakeSttProvider();
        var grader = new FakeGraderProvider();

        try
        {
            await using (var ctx = CreateContext())
            {
                var outcome = await Service(ctx, stt, grader, events, block).RunAsync(ids.SubmissionId);
                Assert.Equal(AssessmentOutcome.Failed, outcome);
            }

            Assert.Equal(0, stt.TranscribeCalls);
            Assert.Equal(0, grader.AnalyzeCalls);

            await using (var ctx = CreateContext())
            {
                var sub = await ctx.Submissions.SingleAsync(s => s.Id == ids.SubmissionId);
                Assert.Equal(SubmissionStatus.Failed, sub.Status);
                Assert.Equal(SubmissionErrorCodes.AiUnavailable, sub.ErrorMessage);
                Assert.False(string.IsNullOrEmpty(sub.AudioKey));               // the recording is kept
            }
            var failed = Assert.Single(events.Events, e => e.State == GradingState.Failed);
            Assert.Equal(SubmissionErrorCodes.AiUnavailable, failed.Message);
        }
        finally
        {
            await CleanupSeedAsync(ids);
        }
    }

    [Fact]
    public async Task A_budget_that_closes_mid_run_fails_with_the_same_code_and_keeps_the_transcript()
    {
        // The cap is reached between STT and the grader: the chain refuses the grader call. The
        // transcript already paid for stays, so a later re-grade does not buy it twice.
        var ids = await SeedResumableAsync(withTranscript: false);
        var grader = new ThrowingGrader(new AiBudgetExceededException(AiBudgetBlock.DailyCap));

        try
        {
            await using (var ctx = CreateContext())
            {
                var outcome = await Service(ctx, new FakeSttProvider(), grader, new RecordingGradingEvents())
                    .RunAsync(ids.SubmissionId);
                Assert.Equal(AssessmentOutcome.Failed, outcome);
            }

            await using (var ctx = CreateContext())
            {
                Assert.Equal(SubmissionErrorCodes.AiUnavailable,
                    await ctx.Submissions.Where(s => s.Id == ids.SubmissionId).Select(s => s.ErrorMessage).SingleAsync());
                Assert.True(await ctx.Transcripts.AnyAsync(t => t.SubmissionId == ids.SubmissionId));
            }
        }
        finally
        {
            await CleanupSeedAsync(ids);
        }
    }

    [Fact]
    public async Task A_shutdown_mid_grade_rethrows_leaves_the_row_processing_and_a_rerun_finishes_it()
    {
        // A deploy restarts the worker while the grader call is in flight. Before: the cancellation was
        // caught as a failure, MarkFailed ran with the SAME cancelled token and threw, the row stayed
        // `processing`, and Hangfire recorded the job as Succeeded — so nothing ever graded it again.
        var ids = await SeedResumableAsync();
        var events = new RecordingGradingEvents();
        using var shutdown = new CancellationTokenSource();

        // The answer sat in the queue for 30 minutes before a worker claimed it.
        await using (var ctx = CreateContext())
            await ctx.Submissions.Where(s => s.Id == ids.SubmissionId)
                .ExecuteUpdateAsync(set => set.SetProperty(s => s.UpdatedAt, DateTime.UtcNow.AddMinutes(-30)));

        try
        {
            await using (var ctx = CreateContext())
            {
                var service = Service(ctx, new FakeSttProvider(), new CancellingGrader(shutdown), events);
                await Assert.ThrowsAnyAsync<OperationCanceledException>(() => service.RunAsync(ids.SubmissionId, shutdown.Token));
            }

            await using (var ctx = CreateContext())
            {
                var sub = await ctx.Submissions.SingleAsync(s => s.Id == ids.SubmissionId);
                Assert.Equal(SubmissionStatus.Processing, sub.Status);   // not failed: nothing was wrong
                Assert.Null(sub.ErrorMessage);
                // The claim restamped updated_at, so the stuck-submission sweeper counts its
                // 15 minutes from the claim — not from the upload, which would fail it at once.
                Assert.True(sub.UpdatedAt > DateTime.UtcNow.AddMinutes(-1));
            }
            Assert.DoesNotContain(events.Events, e => e.State == GradingState.Failed);

            // What Hangfire does on the next worker start: run the job again. It resumes and finishes.
            await using (var ctx = CreateContext())
                Assert.Equal(AssessmentOutcome.Done,
                    await Service(ctx, new FakeSttProvider(), new FakeGraderProvider(), events).RunAsync(ids.SubmissionId));

            await using (var ctx = CreateContext())
            {
                var sub = await ctx.Submissions.SingleAsync(s => s.Id == ids.SubmissionId);
                Assert.Equal(SubmissionStatus.Done, sub.Status);
                Assert.Null(sub.ErrorMessage);
            }
        }
        finally
        {
            await CleanupSeedAsync(ids);
        }
    }

    [Fact]
    public async Task A_failure_after_the_token_was_cancelled_is_still_written_as_failed()
    {
        // The terminal write uses CancellationToken.None: a non-cancellation failure that happens while
        // the job's token is already cancelled must still land, or the row is stranded in `processing`.
        var ids = await SeedResumableAsync();
        using var cancelled = new CancellationTokenSource();

        try
        {
            await using (var ctx = CreateContext())
            {
                var grader = new ThrowingGrader(new InvalidOperationException("vendor exploded"), cancelBefore: cancelled);
                var outcome = await Service(ctx, new FakeSttProvider(), grader, new RecordingGradingEvents())
                    .RunAsync(ids.SubmissionId, cancelled.Token);
                Assert.Equal(AssessmentOutcome.Failed, outcome);
            }

            await using (var ctx = CreateContext())
            {
                var sub = await ctx.Submissions.SingleAsync(s => s.Id == ids.SubmissionId);
                Assert.Equal(SubmissionStatus.Failed, sub.Status);
                Assert.Equal(SubmissionErrorCodes.GraderFailed, sub.ErrorMessage);
            }
        }
        finally
        {
            await CleanupSeedAsync(ids);
        }
    }

    [Fact]
    public async Task The_stuck_submission_sweeper_stores_the_timeout_code()
    {
        var ids = await SeedResumableAsync(withTranscript: false);
        await using (var ctx = CreateContext())
        {
            // Stuck in `processing` for half an hour: past the 15-minute window.
            await ctx.Submissions.Where(s => s.Id == ids.SubmissionId).ExecuteUpdateAsync(set => set
                .SetProperty(s => s.Status, SubmissionStatus.Processing)
                .SetProperty(s => s.UpdatedAt, DateTime.UtcNow.AddMinutes(-30)));
        }

        try
        {
            // A scope factory over THIS class's data source — no extra host is built for it.
            var services = new ServiceCollection();
            services.AddDbContext<GovoriDbContext>(o => o.UseGovori(_dataSource));
            await using var provider = services.BuildServiceProvider();
            var jobs = new MaintenanceJobs(
                provider.GetRequiredService<IServiceScopeFactory>(),
                new MaintenanceOptions { Enabled = true },
                NullLogger<MaintenanceJobs>.Instance);

            Assert.True(await jobs.FailStuckSubmissionsAsync() >= 1);

            await using var ctx = CreateContext();
            var sub = await ctx.Submissions.SingleAsync(s => s.Id == ids.SubmissionId);
            Assert.Equal(SubmissionStatus.Failed, sub.Status);
            Assert.Equal(SubmissionErrorCodes.GradingTimeout, sub.ErrorMessage);
        }
        finally
        {
            await CleanupSeedAsync(ids);
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

    private sealed record SeedIds(Guid Teacher, Guid Student, Guid Block, Guid QuestionId, Guid SubmissionId);

    // A pending submission ready to grade. With a transcript the pipeline takes the RESUME path and
    // never reads audio; without one, the audio read hits BytesOnlyStorage and STT is reached.
    private async Task<SeedIds> SeedResumableAsync(bool withTranscript = true)
    {
        var ids = new SeedIds(Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid());
        await SeedAsync(ids.Teacher, ids.Student, ids.Block, ids.QuestionId, ids.SubmissionId,
            $"answers/{Guid.NewGuid():N}.webm", referenceText: null);
        if (withTranscript)
            await SeedTranscriptAsync(ids.SubmissionId, "я живу в Ташкенте");
        return ids;
    }

    private async Task CleanupSeedAsync(SeedIds ids)
    {
        using var storage = new MinioObjectStorage(BuildStorageOptions());   // no keys to delete
        await CleanupAsync([], storage, ids.Teacher, ids.Student, ids.Block, ids.QuestionId, ids.SubmissionId);
    }

    private async Task SeedTranscriptAsync(Guid submissionId, string text)
    {
        await using var ctx = CreateContext();
        var now = DateTime.UtcNow;
        ctx.Transcripts.Add(new Transcript
        {
            Id = Guid.NewGuid(), SubmissionId = submissionId, Text = text, Language = "ru-RU",
            Pronunciation = "{\"pronunciation\": 80.0}", SttModel = "persisted-stt", CreatedAt = now, UpdatedAt = now,
        });
        await ctx.SaveChangesAsync();
    }

    // AssessmentService built directly — the pipeline alone, without GradingJob or a host — so a test
    // can hand RunAsync its own cancellation token, which is what a Hangfire shutdown does.
    private static AssessmentService Service(
        GovoriDbContext ctx, ISttProvider stt, IGraderProvider grader, IGradingEvents events,
        AiBudgetBlock budget = AiBudgetBlock.None)
        => new(ctx, new BytesOnlyStorage(), stt, grader, new FixedBudget(budget), events,
               NullLogger<AssessmentService>.Instance);

    /// <summary>The global AI budget pinned to one answer, for the pipeline-alone tests.</summary>
    private sealed class FixedBudget(AiBudgetBlock block) : IAiBudget
    {
        public Task<AiBudgetCheck> CheckAsync(CancellationToken ct = default) => Task.FromResult(new AiBudgetCheck(block));
        public Task RecordAsync(AiUsage usage, CancellationToken ct = default) => Task.CompletedTask;
    }

    /// <summary>Returns a few bytes for any audio read, so an STT fake is actually reached.</summary>
    private sealed class BytesOnlyStorage : IObjectStorage
    {
        public Task<byte[]> GetBytesAsync(string key, CancellationToken ct = default) => Task.FromResult(new byte[] { 1, 2, 3 });
        public string NewKey(string prefix, string ext) => throw new NotSupportedException();
        public Task<string> PutAsync(string key, Stream content, string contentType, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<string> GetUploadUrlAsync(string key, string contentType, TimeSpan? expiry = null, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<string> GetPresignedUrlAsync(string key, TimeSpan? expiry = null, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<bool> ExistsAsync(string key, CancellationToken ct = default) => throw new NotSupportedException();
        public Task DeleteAsync(string key, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<IReadOnlyList<StorageObject>> ListObjectsAsync(string prefix, CancellationToken ct = default) => throw new NotSupportedException();
    }

    private sealed class RecordingGradingEvents : IGradingEvents
    {
        private readonly List<GradingProgressEvent> _events = new();
        public IReadOnlyList<GradingProgressEvent> Events { get { lock (_events) return _events.ToList(); } }

        public Task PublishAsync(GradingProgressEvent evt, CancellationToken ct = default)
        {
            lock (_events) _events.Add(evt);
            return Task.CompletedTask;
        }
    }

    /// <summary>Every STT backend failed — the chain's AggregateException, vendor text and all.</summary>
    private sealed class ThrowingStt : ISttProvider
    {
        public ValueTask<bool> IsConfiguredAsync(CancellationToken ct = default) => ValueTask.FromResult(true);

        public Task<SttResult> TranscribeAsync(byte[] audio, string filename, string? referenceText,
            CancellationToken ct = default, SttRecognitionMode mode = SttRecognitionMode.Unscripted)
            => throw new AggregateException("All 1 configured STT backend(s) failed.",
                new HttpRequestException("Azure Speech returned 401: invalid subscription key"));
    }

    /// <summary>Throws <paramref name="failure"/>; optionally cancels a token first, to put the
    /// failure inside an already-cancelled job.</summary>
    private sealed class ThrowingGrader(Exception failure, CancellationTokenSource? cancelBefore = null) : IGraderProvider
    {
        public ValueTask<bool> IsConfiguredAsync(CancellationToken ct = default) => ValueTask.FromResult(true);

        public Task<GraderResult> AnalyzeAsync(GraderRequest request, CancellationToken ct = default)
        {
            cancelBefore?.Cancel();
            throw failure;
        }
    }

    /// <summary>The worker shuts down while the grader call is in flight: the job's token fires and
    /// the call ends in the cancellation it causes.</summary>
    private sealed class CancellingGrader(CancellationTokenSource shutdown) : IGraderProvider
    {
        public ValueTask<bool> IsConfiguredAsync(CancellationToken ct = default) => ValueTask.FromResult(true);

        public Task<GraderResult> AnalyzeAsync(GraderRequest request, CancellationToken ct = default)
        {
            shutdown.Cancel();
            ct.ThrowIfCancellationRequested();
            throw new InvalidOperationException("the job's token was expected to be the shutdown token");
        }
    }

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
