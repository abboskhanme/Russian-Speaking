using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using Govori.Identity.Security;
using Govori.Infrastructure;
using Govori.Infrastructure.Entities;
using Govori.Practice;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Govori.IntegrationTests;

/// <summary>
/// End-to-end coverage for F3 · «Kunlik 5 daqiqa» (docs/08 Faza 6.3) — HTTP → <see cref="DailyService"/>
/// → EF Core (prod-shaped Postgres) and back.
///
/// The three facts these tests exist to hold down are the three the feature can silently lose:
/// <list type="bullet">
///   <item><b>the flag really is a flag</b> — with <c>daily_five_enabled</c> off the route does not
///     exist (404), which is what lets the client hide the entry point rather than render a dead
///     card in every deployment that has not switched F3 on;</item>
///   <item><b>the day's session is stable</b> — asking twice returns the same exercises, and it
///     stays the same task after the student answers it. A session that reshuffles on refresh turns
///     the one screen built to remove choice back into a chooser;</item>
///   <item><b>an empty SRS queue removes the step</b> — the drill is ABSENT, not a step reporting
///     "0 ta element", and the same holds when the drill feature itself is off (a step pointing at a
///     404 is worse than no step).</item>
/// </list>
///
/// Every seeded row — including the <c>app_settings</c> flag rows, which are global — is removed in
/// a finally so the run is idempotent and the next class sees the defaults.
/// </summary>
[Collection(PerRunDatabaseFixture.CollectionName)]
public sealed class DailyEndpointsTests : IClassFixture<DailyEndpointsTests.DailyApiFactory>, IDisposable
{
    private readonly DailyApiFactory _factory;
    private readonly NpgsqlDataSource _dataSource;

    public DailyEndpointsTests(DailyApiFactory factory)
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
    public async Task Flag_off_hides_the_route_entirely()
    {
        var studentId = Guid.NewGuid();
        await using (var ctx = CreateContext())
        {
            ctx.Users.Add(NewUser(studentId, UserRole.Student));
            await ctx.SaveChangesAsync();
        }

        try
        {
            var client = _factory.CreateClient();

            // Anonymous is 401 whatever the flag says — the route is authenticated first.
            Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/daily")).StatusCode);

            // Authenticated, flag off ⇒ 404. Not an empty 200: "not shipped here" and "nothing to do
            // today" are different answers and the client acts on them differently.
            var resp = await Get(client, "/api/daily", TokenFor(studentId));
            Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
        }
        finally
        {
            await CleanupAsync(studentId);
        }
    }

    [Fact]
    public async Task Session_is_stable_for_the_day_and_pins_the_task_once_it_is_answered()
    {
        var teacherId = Guid.NewGuid();
        var studentId = Guid.NewGuid();
        var blockId = Guid.NewGuid();
        var q = new[] { Guid.NewGuid(), Guid.NewGuid() };

        await using (var ctx = CreateContext())
        {
            ctx.Users.Add(NewUser(teacherId, UserRole.Teacher));
            ctx.Users.Add(NewUser(studentId, UserRole.Student));
            ctx.QuestionBlocks.Add(NewBlock(blockId, teacherId));
            for (var i = 0; i < q.Length; i++) ctx.Questions.Add(NewQuestion(q[i], teacherId, blockId, i));
            // Eight phrases, so "the same three came back" cannot be an accident of there being three.
            for (var i = 0; i < 8; i++) ctx.ShadowingPhrases.Add(NewPhrase($"Фраза {i}"));
            await ctx.SaveChangesAsync();
        }

        try
        {
            await SetFlagAsync(DailyService.EnabledKey, "true");
            var client = _factory.CreateClient();
            var token = TokenFor(studentId);

            using var first = await SessionAsync(client, token, tzOffset: 300);
            using var second = await SessionAsync(client, token, tzOffset: 300);

            // ── Stability: identical bodies, not merely equivalent ones ──
            Assert.Equal(first.RootElement.ToString(), second.RootElement.ToString());

            var steps = Steps(first);
            Assert.Equal(new[] { "warmup", "task" }, steps.Select(Kind).ToArray());

            var warmup = steps[0];
            Assert.Equal(DailyService.WarmupPhraseCount, warmup.GetProperty("phrases").GetArrayLength());
            Assert.False(warmup.GetProperty("done").GetBoolean());

            var task = steps[1];
            Assert.Equal(q[0], task.GetProperty("task_id").GetGuid());   // the module's next_task_id
            Assert.False(task.GetProperty("done").GetBoolean());
            Assert.False(first.RootElement.GetProperty("completed").GetBoolean());

            // ── The student answers it. next_task_id now points at q[1] — but today's session must
            //    still be about q[0], now done. Otherwise finishing the task would swap the card for
            //    a different exercise, which is the reshuffle this feature is defined against. ──
            await using (var ctx = CreateContext())
            {
                ctx.Submissions.Add(NewSubmission(studentId, q[0]));
                await ctx.SaveChangesAsync();
            }

            using var after = await SessionAsync(client, token, tzOffset: 300);
            var afterTask = Steps(after).Single(s => Kind(s) == "task");
            Assert.Equal(q[0], afterTask.GetProperty("task_id").GetGuid());
            Assert.True(afterTask.GetProperty("done").GetBoolean());
            // Every observable step is done ⇒ today's five minutes are finished. The warm-up leaves
            // no trace and deliberately does not get a vote (it would pin the session open forever).
            Assert.True(after.RootElement.GetProperty("completed").GetBoolean());

            // ── The warm-up is still the same three phrases after all that ──
            Assert.Equal(PhraseIds(Steps(first)[0]), PhraseIds(Steps(after)[0]));
        }
        finally
        {
            await ClearFlagsAsync();
            await CleanupAsync(studentId, teacherId, blockId, q);
        }
    }

    [Fact]
    public async Task Day_follows_the_student_not_the_server()
    {
        var studentId = Guid.NewGuid();
        await using (var ctx = CreateContext())
        {
            ctx.Users.Add(NewUser(studentId, UserRole.Student));
            ctx.ShadowingPhrases.Add(NewPhrase("Привет"));
            await ctx.SaveChangesAsync();
        }

        try
        {
            await SetFlagAsync(DailyService.EnabledKey, "true");
            var client = _factory.CreateClient();
            var token = TokenFor(studentId);

            // ±14 h apart is always a different calendar date somewhere in the pair, whatever the
            // hour the suite happens to run at — which is the point: the day is the STUDENT's.
            using var east = await SessionAsync(client, token, tzOffset: 14 * 60);
            using var west = await SessionAsync(client, token, tzOffset: -14 * 60);

            Assert.NotEqual(
                east.RootElement.GetProperty("day").GetString(),
                west.RootElement.GetProperty("day").GetString());

            // A nonsense offset is clamped, never refused: it only decides whose day this is, and an
            // error screen is a heavy price for a bad number the student never typed.
            using var absurd = await SessionAsync(client, token, tzOffset: 999_999);
            Assert.Equal(
                east.RootElement.GetProperty("day").GetString(),
                absurd.RootElement.GetProperty("day").GetString());
        }
        finally
        {
            await ClearFlagsAsync();
            await CleanupAsync(studentId);
        }
    }

    [Fact]
    public async Task Drill_step_is_absent_when_nothing_is_due_and_when_the_drill_is_off()
    {
        var teacherId = Guid.NewGuid();
        var studentId = Guid.NewGuid();
        var blockId = Guid.NewGuid();
        var q = new[] { Guid.NewGuid(), Guid.NewGuid() };
        var reviewId = Guid.NewGuid();

        await using (var ctx = CreateContext())
        {
            ctx.Users.Add(NewUser(teacherId, UserRole.Teacher));
            ctx.Users.Add(NewUser(studentId, UserRole.Student));
            ctx.QuestionBlocks.Add(NewBlock(blockId, teacherId));
            for (var i = 0; i < q.Length; i++) ctx.Questions.Add(NewQuestion(q[i], teacherId, blockId, i));
            ctx.ShadowingPhrases.Add(NewPhrase("Привет"));
            await ctx.SaveChangesAsync();
        }

        try
        {
            await SetFlagAsync(DailyService.EnabledKey, "true");
            await SetFlagAsync(DailyService.DrillFlagKey, "true");
            var client = _factory.CreateClient();
            var token = TokenFor(studentId);

            // ── Nothing due: the step does not exist. Not a step saying "0" — a student with no
            //    mistakes worth replaying gets a two-step session, not a screen congratulating itself.
            using (var empty = await SessionAsync(client, token, tzOffset: 0))
                Assert.DoesNotContain(Steps(empty), s => Kind(s) == "drill");

            // ── One card due ⇒ the step appears, carrying the backlog size ──
            await using (var ctx = CreateContext())
            {
                ctx.ReviewItems.Add(NewReview(reviewId, studentId, q[1]));
                await ctx.SaveChangesAsync();
            }

            using (var withDrill = await SessionAsync(client, token, tzOffset: 0))
            {
                var drill = Steps(withDrill).Single(s => Kind(s) == "drill");
                Assert.Equal(1, drill.GetProperty("due_count").GetInt32());
                Assert.False(drill.GetProperty("done").GetBoolean());
            }

            // ── The drill feature itself is off ⇒ the step disappears again, even though a card is
            //    due. The step's destination would answer 404, and a dead end built on purpose is
            //    worse than an absent step.
            await SetFlagAsync(DailyService.DrillFlagKey, "false");
            using (var noDrill = await SessionAsync(client, token, tzOffset: 0))
                Assert.DoesNotContain(Steps(noDrill), s => Kind(s) == "drill");
        }
        finally
        {
            await ClearFlagsAsync();
            await using var ctx = CreateContext();
            await ctx.ReviewItems.Where(r => r.Id == reviewId).ExecuteDeleteAsync();
            await CleanupAsync(studentId, teacherId, blockId, q);
        }
    }

    /* ── helpers ─────────────────────────────────────────────────────────── */

    private static IReadOnlyList<JsonElement> Steps(JsonDocument doc)
        => doc.RootElement.GetProperty("steps").EnumerateArray().ToList();

    private static string Kind(JsonElement step) => step.GetProperty("kind").GetString()!;

    private static IReadOnlyList<Guid> PhraseIds(JsonElement warmup)
        => warmup.GetProperty("phrases").EnumerateArray().Select(p => p.GetProperty("id").GetGuid()).ToList();

    private static async Task<JsonDocument> SessionAsync(HttpClient client, string token, int tzOffset)
    {
        var resp = await Get(client, $"/api/daily?tz_offset={tzOffset}", token);
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        return JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
    }

    private static Task<HttpResponseMessage> Get(HttpClient client, string url, string token)
    {
        var req = new HttpRequestMessage(HttpMethod.Get, url);
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client.SendAsync(req);
    }

    private static string TokenFor(Guid userId) =>
        new TokenService(new IdentityAuthOptions { SecretKey = DailyApiFactory.TestSecretKey })
            .CreateAccessToken(userId.ToString());

    // app_settings rows are GLOBAL, so every test that sets one clears it again — otherwise the next
    // class in the run inherits a feature it never asked for.
    private async Task SetFlagAsync(string key, string value)
    {
        await using var ctx = CreateContext();
        var row = await ctx.AppSettings.FirstOrDefaultAsync(s => s.Key == key);
        if (row is null)
            ctx.AppSettings.Add(new AppSetting
            {
                Key = key,
                Value = value,
                IsSecret = false,
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow,
            });
        else
            row.Value = value;
        await ctx.SaveChangesAsync();
    }

    private async Task ClearFlagsAsync()
    {
        await using var ctx = CreateContext();
        await ctx.AppSettings
            .Where(s => s.Key == DailyService.EnabledKey || s.Key == DailyService.DrillFlagKey)
            .ExecuteDeleteAsync();
    }

    private async Task CleanupAsync(
        Guid studentId, Guid? teacherId = null, Guid? blockId = null, Guid[]? questionIds = null)
    {
        await using var ctx = CreateContext();
        await ctx.ShadowingPhrases.Where(p => p.Text.StartsWith("Фраза") || p.Text == "Привет").ExecuteDeleteAsync();
        await ctx.Submissions.Where(s => s.StudentId == studentId).ExecuteDeleteAsync();
        await ctx.ReviewItems.Where(r => r.StudentId == studentId).ExecuteDeleteAsync();
        if (questionIds is not null)
            await ctx.Questions.Where(q => questionIds.Contains(q.Id)).ExecuteDeleteAsync();
        if (blockId is not null)
            await ctx.QuestionBlocks.Where(b => b.Id == blockId.Value).ExecuteDeleteAsync();
        await ctx.Users.Where(u => u.Id == studentId || (teacherId != null && u.Id == teacherId.Value))
            .ExecuteDeleteAsync();
    }

    private static User NewUser(Guid id, UserRole role) => new()
    {
        Id = id,
        Email = $"daily-{id:N}@example.test",
        FullName = "Daily Seed",
        Role = role,
        IsActive = true,
        IsPremium = false,
        PreferredLanguage = "uz",
        CurrentStreak = 3,
        CreatedAt = DateTime.UtcNow,
        UpdatedAt = DateTime.UtcNow,
    };

    private static QuestionBlock NewBlock(Guid id, Guid teacherId) => new()
    {
        Id = id,
        TeacherId = teacherId,
        Name = "Daily Module",
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
        Title = $"Daily task {sortOrder}",
        PromptText = "p",
        Level = "A2",
        IsPublished = true,
        IsDeleted = false,
        IsPublic = false,
        PrepTimeSec = 0,
        AnswerTimeLimitSec = 0,
        SortOrder = sortOrder,
        CreatedAt = new DateTime(2024, 1, 1, 0, 0, 0, DateTimeKind.Utc).AddSeconds(sortOrder),
        UpdatedAt = DateTime.UtcNow,
    };

    private static ShadowingPhrase NewPhrase(string text) => new()
    {
        Id = Guid.NewGuid(),
        Text = text,
        Level = "A1–A2",
        IsActive = true,
        CreatedAt = DateTime.UtcNow,
        UpdatedAt = DateTime.UtcNow,
    };

    private static Submission NewSubmission(Guid studentId, Guid questionId) => new()
    {
        Id = Guid.NewGuid(),
        StudentId = studentId,
        QuestionId = questionId,
        AudioKey = $"answers/{Guid.NewGuid():N}.webm",
        Status = SubmissionStatus.Done,
        CreatedAt = DateTime.UtcNow,
        UpdatedAt = DateTime.UtcNow,
    };

    private static ReviewItem NewReview(Guid id, Guid studentId, Guid questionId) => new()
    {
        Id = id,
        StudentId = studentId,
        QuestionId = questionId,
        WeaknessDim = "grammar",
        IntervalIndex = 0,
        DueAt = DateTime.UtcNow.AddMinutes(-5),      // due now
        Completed = false,
        CreatedAt = DateTime.UtcNow.AddDays(-1),
        UpdatedAt = DateTime.UtcNow.AddDays(-1),     // == CreatedAt ⇒ never answered
    };

    public void Dispose() => _dataSource.Dispose();

    /// <summary>Boots Govori.Api against the per-run schema DB with a fixed test SECRET_KEY — the
    /// same pattern as PracticeEndpointsTests. F3 is read-only and touches neither storage nor the
    /// grading queue, so no further host wiring is needed.</summary>
    public sealed class DailyApiFactory : WebApplicationFactory<Program>
    {
        public string ConnectionString { get; } = TestDatabase.ConnectionString;

        internal const string TestSecretKey =
            "daily-five-integration-test-secret-key-do-not-use-in-prod";

        public DailyApiFactory()
        {
            Environment.SetEnvironmentVariable("SECRET_KEY", TestSecretKey);
            Environment.SetEnvironmentVariable("GOVORI_DB", ConnectionString);
        }

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseSetting("GOVORI_HANGFIRE", "false");
            builder.UseSetting("GOVORI_SIGNALR_BACKPLANE", "false");
        }
    }
}
