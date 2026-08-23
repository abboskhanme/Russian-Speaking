using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using Govori.Drills;
using Govori.Identity.Security;
using Govori.Infrastructure;
using Govori.Infrastructure.Entities;
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
/// End-to-end coverage for F2 · the phoneme drill (docs/01) — HTTP → <see cref="DrillService"/> →
/// EF Core (prod-shaped Postgres) and back, with the STT seam faked so the two recognition passes
/// can be observed.
///
/// <para>The facts these hold down are the ones the feature can silently lose:</para>
/// <list type="bullet">
///   <item><b>The scripted pass's text never becomes the transcript.</b> Measured against the live
///     vendor, scripted <c>Lexical</c> echoes the REFERENCE — so if the wrong pass were ever read,
///     the drill would tell a learner who said <c>мишка</c> that they said <c>мышка</c>. The fake
///     returns deliberately different text per mode so that swap cannot pass unnoticed.</item>
///   <item><b>The second pass runs only on a miss.</b> It is the cost decision: the drill's bill
///     falls as the student improves instead of scaling with practice.</item>
///   <item><b>Per-sound detail is never load-bearing.</b> No phonemes, a count that disagrees with
///     our content, an outright vendor failure — all three still return a complete verdict.</item>
/// </list>
///
/// <para>Every seeded row — including the global <c>app_settings</c> flag and the seeded pairs — is
/// removed in a finally so the run is idempotent.</para>
/// </summary>
[Collection(PerRunDatabaseFixture.CollectionName)]
public sealed class DrillEndpointsTests : IClassFixture<DrillEndpointsTests.DrillApiFactory>, IDisposable
{
    private readonly DrillApiFactory _factory;
    private readonly NpgsqlDataSource _dataSource;

    public DrillEndpointsTests(DrillApiFactory factory)
    {
        _factory = factory;
        _dataSource = GovoriDataSourceFactory.Build(factory.ConnectionString);
    }

    // ─────────────────────────── the flag ───────────────────────────

    [Fact]
    public async Task Both_routes_require_authentication()
    {
        var client = _factory.CreateClient();

        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/drills/pairs")).StatusCode);
        Assert.Equal(
            HttpStatusCode.Unauthorized,
            (await client.PostAsync("/api/drills/attempts", Multipart("my-mi", "мышка"))).StatusCode);
    }

    /// <summary>Flag off: the hub says so on a normal body (the screen has to explain itself), and
    /// an attempt spends NOTHING — no vendor call, no row.</summary>
    [Fact]
    public async Task Flag_off_disables_the_feature_without_spending_anything()
    {
        var studentId = Guid.NewGuid();
        await SeedStudentAsync(studentId);
        var stt = _factory.Stt;
        stt.Reset();

        try
        {
            var client = _factory.CreateClient();
            var token = TokenFor(studentId);

            var catalog = await GetJsonAsync(client, "/api/drills/pairs", token);
            Assert.Equal("Disabled", catalog.GetProperty("state").GetString());
            Assert.Empty(catalog.GetProperty("pairs").EnumerateArray());

            var attempt = await PostAttemptAsync(client, token, "y-i-myshka", "мышка");
            Assert.Equal("Disabled", attempt.GetProperty("state").GetString());

            Assert.Equal(0, stt.Calls);
            await using var ctx = CreateContext();
            Assert.False(await ctx.Drills.AnyAsync(d => d.StudentId == studentId));
        }
        finally
        {
            await CleanupAsync(studentId);
        }
    }

    /// <summary>Flag on: the curated content is planted on first use and the hub is ready.</summary>
    [Fact]
    public async Task Flag_on_seeds_the_curated_pairs()
    {
        var studentId = Guid.NewGuid();
        await SeedStudentAsync(studentId);
        await SetFlagAsync(DrillService.EnabledKey, "true");

        try
        {
            var catalog = await GetJsonAsync(
                _factory.CreateClient(), "/api/drills/pairs", TokenFor(studentId));

            Assert.Equal("Ready", catalog.GetProperty("state").GetString());
            var pairs = catalog.GetProperty("pairs").EnumerateArray().ToList();
            Assert.Equal(MinimalPairSeed.All.Count, pairs.Count);

            // The gloss is what makes a miss feel like a consequence rather than a lost point, so
            // it has to reach the client.
            var first = pairs[0];
            Assert.False(string.IsNullOrWhiteSpace(first.GetProperty("gloss_a_uz").GetString()));
            Assert.False(string.IsNullOrWhiteSpace(first.GetProperty("why_uz").GetString()));
            Assert.NotEmpty(first.GetProperty("ipa_a").EnumerateArray());
        }
        finally
        {
            await CleanupAsync(studentId);
        }
    }

    // ─────────────────────── the verdict, and the two passes ───────────────────────

    /// <summary>Said correctly: one pass, and no scripted call at all — there is nothing to
    /// diagnose, and the second vendor call would buy the learner nothing.</summary>
    [Fact]
    public async Task A_correct_answer_costs_exactly_one_recognition_pass()
    {
        var studentId = Guid.NewGuid();
        await SeedStudentAsync(studentId);
        await SetFlagAsync(DrillService.EnabledKey, "true");
        var stt = _factory.Stt;
        stt.Reset();
        stt.UnscriptedText = "мышка";

        try
        {
            var client = _factory.CreateClient();
            await GetJsonAsync(client, "/api/drills/pairs", TokenFor(studentId));   // seed

            var result = await PostAttemptAsync(client, TokenFor(studentId), "y-i-myshka", "мышка");

            Assert.Equal("Correct", result.GetProperty("outcome").GetString());
            Assert.Equal("мышка", result.GetProperty("heard_text").GetString());
            Assert.Equal(1, stt.Calls);
            Assert.DoesNotContain(SttRecognitionMode.Scripted, stt.Modes);

            await using var ctx = CreateContext();
            var row = await ctx.Drills.SingleAsync(d => d.StudentId == studentId);
            Assert.Equal("correct", row.Outcome);
            Assert.Equal("мышка", row.HeardText);
        }
        finally
        {
            await CleanupAsync(studentId);
        }
    }

    /// <summary>
    /// Said as the other twin: the teachable failure. Two passes, the verdict names the word they
    /// actually produced — and, critically, the stored transcript is the UNSCRIPTED one.
    ///
    /// <para>The fake returns "мышка" for the scripted pass, exactly as the real vendor does when
    /// handed that reference. If anything ever reads the scripted text, this test reports the
    /// learner as having said the target they in fact missed, and fails.</para>
    /// </summary>
    [Fact]
    public async Task Saying_the_twin_is_diagnosed_and_the_scripted_text_is_never_stored()
    {
        var studentId = Guid.NewGuid();
        await SeedStudentAsync(studentId);
        await SetFlagAsync(DrillService.EnabledKey, "true");
        var stt = _factory.Stt;
        stt.Reset();
        stt.UnscriptedText = "мишка";        // what they really said
        stt.ScriptedText = "мышка";          // what Azure echoes back — a trap on purpose
        stt.ScriptedPhonemes = new double?[] { 0, 0, 0, 100, 100 };

        try
        {
            var client = _factory.CreateClient();
            await GetJsonAsync(client, "/api/drills/pairs", TokenFor(studentId));

            var result = await PostAttemptAsync(client, TokenFor(studentId), "y-i-myshka", "мышка");

            Assert.Equal("Twin", result.GetProperty("outcome").GetString());
            Assert.Equal("мишка", result.GetProperty("heard_text").GetString());
            Assert.Equal("мишка", result.GetProperty("heard_word").GetString());
            Assert.Equal("мышка", result.GetProperty("target_word").GetString());

            Assert.Equal(2, stt.Calls);
            Assert.Contains(SttRecognitionMode.Scripted, stt.Modes);

            // Our names, Azure's scores, and the focus flag on the one sound the pair is about.
            var phonemes = result.GetProperty("phonemes").EnumerateArray().ToList();
            Assert.Equal(5, phonemes.Count);
            Assert.Equal("ɨ", phonemes[1].GetProperty("ipa").GetString());
            Assert.True(phonemes[1].GetProperty("focus").GetBoolean());
            Assert.Equal(0, phonemes[1].GetProperty("score").GetDouble());

            await using var ctx = CreateContext();
            var row = await ctx.Drills.SingleAsync(d => d.StudentId == studentId);
            Assert.Equal("twin", row.Outcome);
            Assert.Equal("мишка", row.HeardText);      // NOT the scripted echo
            Assert.Equal(0, row.FocusScore);
            Assert.NotNull(row.Phonemes);
        }
        finally
        {
            await CleanupAsync(studentId);
        }
    }

    /// <summary>A silent recording is an answer, recorded as one, and costs no second pass.</summary>
    [Fact]
    public async Task Silence_is_recorded_as_an_answer()
    {
        var studentId = Guid.NewGuid();
        await SeedStudentAsync(studentId);
        await SetFlagAsync(DrillService.EnabledKey, "true");
        var stt = _factory.Stt;
        stt.Reset();
        stt.UnscriptedText = "";

        try
        {
            var client = _factory.CreateClient();
            await GetJsonAsync(client, "/api/drills/pairs", TokenFor(studentId));

            var result = await PostAttemptAsync(client, TokenFor(studentId), "y-i-myshka", "мышка");

            Assert.Equal("Silent", result.GetProperty("outcome").GetString());
            Assert.Equal(1, stt.Calls);
        }
        finally
        {
            await CleanupAsync(studentId);
        }
    }

    // ─────────────────── per-sound detail is never load-bearing ───────────────────

    /// <summary>
    /// Azure returns NO phoneme entries whenever the recording does not resemble the reference —
    /// measured, not hypothetical. The attempt must still produce a complete verdict.
    /// </summary>
    [Fact]
    public async Task A_missing_phoneme_array_still_returns_a_complete_verdict()
    {
        var studentId = Guid.NewGuid();
        await SeedStudentAsync(studentId);
        await SetFlagAsync(DrillService.EnabledKey, "true");
        var stt = _factory.Stt;
        stt.Reset();
        stt.UnscriptedText = "мишка";
        stt.ScriptedPhonemes = Array.Empty<double?>();      // Azure aligned nothing

        try
        {
            var client = _factory.CreateClient();
            await GetJsonAsync(client, "/api/drills/pairs", TokenFor(studentId));

            var result = await PostAttemptAsync(client, TokenFor(studentId), "y-i-myshka", "мышка");

            Assert.Equal("Twin", result.GetProperty("outcome").GetString());
            Assert.Equal("мишка", result.GetProperty("heard_word").GetString());
            Assert.Empty(result.GetProperty("phonemes").EnumerateArray());

            await using var ctx = CreateContext();
            var row = await ctx.Drills.SingleAsync(d => d.StudentId == studentId);
            Assert.Null(row.Phonemes);
            Assert.Null(row.FocusScore);
        }
        finally
        {
            await CleanupAsync(studentId);
        }
    }

    /// <summary>
    /// THE alignment guard. Azure returning a different number of positions than our content spells
    /// must drop the whole array — labelling position 2's score with position 1's name would be a
    /// confident lie, and confidently wrong is worse than absent.
    /// </summary>
    [Fact]
    public async Task A_phoneme_count_that_disagrees_with_our_content_is_refused_wholesale()
    {
        var studentId = Guid.NewGuid();
        await SeedStudentAsync(studentId);
        await SetFlagAsync(DrillService.EnabledKey, "true");
        var stt = _factory.Stt;
        stt.Reset();
        stt.UnscriptedText = "мишка";
        stt.ScriptedPhonemes = new double?[] { 10, 20, 30 };   // мышка is spelled with FIVE

        try
        {
            var client = _factory.CreateClient();
            await GetJsonAsync(client, "/api/drills/pairs", TokenFor(studentId));

            var result = await PostAttemptAsync(client, TokenFor(studentId), "y-i-myshka", "мышка");

            Assert.Equal("Twin", result.GetProperty("outcome").GetString());
            Assert.Empty(result.GetProperty("phonemes").EnumerateArray());
        }
        finally
        {
            await CleanupAsync(studentId);
        }
    }

    /// <summary>A vendor failure on the SECOND pass costs the decoration, never the verdict — the
    /// learner already spoke and we already know what they said.</summary>
    [Fact]
    public async Task A_failed_scripted_pass_still_returns_the_verdict()
    {
        var studentId = Guid.NewGuid();
        await SeedStudentAsync(studentId);
        await SetFlagAsync(DrillService.EnabledKey, "true");
        var stt = _factory.Stt;
        stt.Reset();
        stt.UnscriptedText = "мишка";
        stt.ThrowOnScripted = true;

        try
        {
            var client = _factory.CreateClient();
            await GetJsonAsync(client, "/api/drills/pairs", TokenFor(studentId));

            var result = await PostAttemptAsync(client, TokenFor(studentId), "y-i-myshka", "мышка");

            Assert.Equal("Twin", result.GetProperty("outcome").GetString());
            Assert.Equal("мишка", result.GetProperty("heard_word").GetString());
            Assert.Empty(result.GetProperty("phonemes").EnumerateArray());

            await using var ctx = CreateContext();
            Assert.True(await ctx.Drills.AnyAsync(d => d.StudentId == studentId));
        }
        finally
        {
            await CleanupAsync(studentId);
        }
    }

    // ─────────────────────────── request validation ───────────────────────────

    [Fact]
    public async Task An_unknown_pair_is_a_404()
    {
        var studentId = Guid.NewGuid();
        await SeedStudentAsync(studentId);
        await SetFlagAsync(DrillService.EnabledKey, "true");

        try
        {
            var client = _factory.CreateClient();
            await GetJsonAsync(client, "/api/drills/pairs", TokenFor(studentId));

            var resp = await PostAsync(client, TokenFor(studentId), Multipart("no-such-pair", "мышка"));
            Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
        }
        finally
        {
            await CleanupAsync(studentId);
        }
    }

    /// <summary>The target must be one of that pair's own twins. Otherwise the caller would be
    /// choosing the reference text sent to the vendor, and the drill would score against a word it
    /// has no IPA for.</summary>
    [Fact]
    public async Task A_target_word_outside_the_pair_is_a_400()
    {
        var studentId = Guid.NewGuid();
        await SeedStudentAsync(studentId);
        await SetFlagAsync(DrillService.EnabledKey, "true");

        try
        {
            var client = _factory.CreateClient();
            await GetJsonAsync(client, "/api/drills/pairs", TokenFor(studentId));

            var resp = await PostAsync(
                client, TokenFor(studentId), Multipart("y-i-myshka", "здравствуйте"));
            Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
        }
        finally
        {
            await CleanupAsync(studentId);
        }
    }

    /// <summary>The daily budget is counted from the rows, so it survives a restart and cannot be
    /// reset by reloading the screen.</summary>
    [Fact]
    public async Task The_daily_budget_closes_the_feature_for_the_day()
    {
        var studentId = Guid.NewGuid();
        await SeedStudentAsync(studentId);
        await SetFlagAsync(DrillService.EnabledKey, "true");
        await SetFlagAsync(DrillService.DailyAttemptsKey, "1");
        var stt = _factory.Stt;
        stt.Reset();
        stt.UnscriptedText = "мышка";

        try
        {
            var client = _factory.CreateClient();
            var token = TokenFor(studentId);
            await GetJsonAsync(client, "/api/drills/pairs", token);

            var first = await PostAttemptAsync(client, token, "y-i-myshka", "мышка");
            Assert.Equal("Ready", first.GetProperty("state").GetString());
            Assert.Equal(0, first.GetProperty("daily_left").GetInt32());

            var second = await PostAttemptAsync(client, token, "y-i-myshka", "мышка");
            Assert.Equal("BudgetSpent", second.GetProperty("state").GetString());

            await using var ctx = CreateContext();
            Assert.Equal(1, await ctx.Drills.CountAsync(d => d.StudentId == studentId));
        }
        finally
        {
            await CleanupAsync(studentId);
        }
    }

    // ─────────────────────────── helpers ───────────────────────────

    private GovoriDbContext CreateContext()
    {
        var builder = new DbContextOptionsBuilder<GovoriDbContext>();
        builder.UseGovori(_dataSource);
        return new GovoriDbContext(builder.Options);
    }

    private static MultipartFormDataContent Multipart(string pairSlug, string targetWord)
    {
        var form = new MultipartFormDataContent
        {
            { new StringContent(pairSlug), "pair_slug" },
            { new StringContent(targetWord), "target_word" },
            { new StringContent("1.2"), "audio_duration_sec" },
        };
        var audio = new ByteArrayContent(new byte[] { 1, 2, 3, 4 });
        audio.Headers.ContentType = new MediaTypeHeaderValue("audio/webm");
        form.Add(audio, "audio", "drill.webm");
        return form;
    }

    private static Task<HttpResponseMessage> PostAsync(
        HttpClient client, string token, MultipartFormDataContent form)
    {
        var req = new HttpRequestMessage(HttpMethod.Post, "/api/drills/attempts") { Content = form };
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client.SendAsync(req);
    }

    private static async Task<JsonElement> PostAttemptAsync(
        HttpClient client, string token, string pairSlug, string targetWord)
    {
        var resp = await PostAsync(client, token, Multipart(pairSlug, targetWord));
        resp.EnsureSuccessStatusCode();
        return JsonDocument.Parse(await resp.Content.ReadAsStringAsync()).RootElement.Clone();
    }

    private static async Task<JsonElement> GetJsonAsync(HttpClient client, string url, string token)
    {
        var req = new HttpRequestMessage(HttpMethod.Get, url);
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var resp = await client.SendAsync(req);
        resp.EnsureSuccessStatusCode();
        return JsonDocument.Parse(await resp.Content.ReadAsStringAsync()).RootElement.Clone();
    }

    private static string TokenFor(Guid userId) =>
        new TokenService(new IdentityAuthOptions { SecretKey = DrillApiFactory.TestSecretKey })
            .CreateAccessToken(userId.ToString());

    private async Task SeedStudentAsync(Guid studentId)
    {
        await using var ctx = CreateContext();
        ctx.Users.Add(new User
        {
            Id = studentId,
            Email = $"drill-{studentId:N}@example.test",
            FullName = "Drill Seed",
            Role = UserRole.Student,
            IsActive = true,
            IsPremium = false,
            PreferredLanguage = "uz",
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
        });
        await ctx.SaveChangesAsync();
    }

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

    private async Task CleanupAsync(Guid studentId)
    {
        await using var ctx = CreateContext();
        await ctx.Drills.Where(d => d.StudentId == studentId).ExecuteDeleteAsync();
        await ctx.MinimalPairs.ExecuteDeleteAsync();
        await ctx.AppSettings
            .Where(s => s.Key == DrillService.EnabledKey || s.Key == DrillService.DailyAttemptsKey)
            .ExecuteDeleteAsync();
        await ctx.Users.Where(u => u.Id == studentId).ExecuteDeleteAsync();
    }

    public void Dispose() => _dataSource.Dispose();

    /// <summary>
    /// A recording STT seam. It answers DIFFERENTLY per recognition mode on purpose: the real
    /// vendor's scripted pass echoes the reference back, and a drill that read the wrong pass would
    /// report the target as though the learner had said it.
    /// </summary>
    public sealed class RecordingStt : ISttProvider
    {
        private readonly List<SttRecognitionMode> _modes = new();

        public string UnscriptedText { get; set; } = "мышка";
        public string ScriptedText { get; set; } = "мышка";
        public double?[] ScriptedPhonemes { get; set; } = Array.Empty<double?>();
        public bool ThrowOnScripted { get; set; }

        public int Calls => _modes.Count;
        public IReadOnlyList<SttRecognitionMode> Modes
        {
            get { lock (_modes) return _modes.ToList(); }
        }

        public void Reset()
        {
            lock (_modes) _modes.Clear();
            UnscriptedText = "мышка";
            ScriptedText = "мышка";
            ScriptedPhonemes = Array.Empty<double?>();
            ThrowOnScripted = false;
        }

        public ValueTask<bool> IsConfiguredAsync(CancellationToken ct = default)
            => ValueTask.FromResult(true);

        public Task<SttResult> TranscribeAsync(
            byte[] audio, string filename, string? referenceText, CancellationToken ct = default,
            SttRecognitionMode mode = SttRecognitionMode.Unscripted)
        {
            lock (_modes) _modes.Add(mode);

            if (mode == SttRecognitionMode.Scripted)
            {
                if (ThrowOnScripted)
                    throw new InvalidOperationException("vendor had a bad minute");

                return Task.FromResult(new SttResult
                {
                    Text = ScriptedText,
                    Language = "ru-RU",
                    Model = "fake-stt:scripted",
                    Words = new[]
                    {
                        new SttWord
                        {
                            Word = referenceText,
                            Accuracy = 49,
                            // Nameless, exactly as ru-RU really answers — the names are ours.
                            Phonemes = ScriptedPhonemes.Length == 0
                                ? null
                                : ScriptedPhonemes.Select(s => new SttPhoneme("", s)).ToList(),
                        },
                    },
                });
            }

            return Task.FromResult(new SttResult
            {
                Text = UnscriptedText,
                Language = "ru-RU",
                Model = "fake-stt:unscripted",
                DurationSec = 1.2,
            });
        }
    }

    /// <summary>Boots Govori.Api against the per-run schema DB with a fixed test SECRET_KEY, with the
    /// STT seam replaced so both recognition passes can be observed.</summary>
    public sealed class DrillApiFactory : WebApplicationFactory<Program>
    {
        public string ConnectionString { get; } = TestDatabase.ConnectionString;

        public RecordingStt Stt { get; } = new();

        internal const string TestSecretKey =
            "phoneme-drill-integration-test-secret-key-do-not-use-in-prod";

        public DrillApiFactory()
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
            });
        }
    }
}
