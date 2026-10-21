using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Govori.Billing;
using Govori.Identity.Security;
using Govori.Infrastructure;
using Govori.Infrastructure.Entities;
using Govori.Platform.Storage;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Npgsql;

namespace Govori.IntegrationTests;

/// <summary>
/// Faza 6.6 billing, end to end against the prod-shaped Postgres. Four questions, and every one of
/// them is about money or access rather than about plumbing:
///
/// <list type="number">
///   <item><b>Premium has two sources and the 402 gate reads both.</b> The teacher grant the product
///   runs on today keeps working, an active subscription now also lifts the paywall, and a student
///   with neither meets exactly the 402 they met before. The lapsed and unpaid cases are asserted
///   too — a pending or expired subscription must grant nothing.</item>
///   <item><b>The flow stops honestly with no provider.</b> Flag off → <c>payments_disabled</c>;
///   flag on but no adapter → <c>provider_not_configured</c>. Neither writes a row, and neither can
///   be mistaken for a payment.</item>
///   <item><b>An unverified webhook grants nothing.</b> Anyone can POST to that route; the only
///   thing between it and free premium is the signature check.</item>
///   <item><b>One idempotency key is one payment</b>, and only a VERIFIED callback grants a
///   subscription — driven against a test adapter that IS configured, because the guard lives on a
///   code path the shipped stub refuses before reaching. Shipping an unexercised double-charge guard
///   is how you find out it never worked, from a customer.</item>
/// </list>
///
/// <para><b>One HTTP host, deliberately.</b> The payments flag is toggled through the
/// <c>app_settings</c> row it really lives in rather than through a second host's configuration, and
/// the configured-provider cases construct <see cref="BillingService"/> directly (the shape
/// <c>CatalogAccessSqlParityTests</c> already uses). EF Core throws once a process has built twenty
/// internal service providers, and every extra <see cref="WebApplicationFactory{T}"/> in this
/// assembly spends one of those from a budget shared with every other test class.</para>
/// </summary>
[Collection(PerRunDatabaseFixture.CollectionName)]
public sealed class BillingEndpointsTests : IClassFixture<BillingEndpointsTests.BillingApiFactory>, IDisposable
{
    private readonly BillingApiFactory _factory;
    private readonly NpgsqlDataSource _dataSource;

    public BillingEndpointsTests(BillingApiFactory factory)
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

    /// <summary>
    /// THE regression test for this whole phase: adding a subscription layer must not cost the
    /// teacher-grant path anything, and must not open the paywall for anyone who has not paid.
    ///
    /// <para>Five students against the SAME paywalled task (index 3, past the free preview of 3):
    /// granted → through; actively subscribed → through; nothing → 402; subscription that has
    /// lapsed → 402; subscription created but never paid → 402. The last two are the ones a
    /// premature "any row means premium" implementation gets wrong.</para>
    /// </summary>
    [Fact]
    public async Task Premium_has_two_sources_and_the_402_gate_reads_both()
    {
        var teacherId = Guid.NewGuid();
        var blockId = Guid.NewGuid();
        var planId = Guid.NewGuid();
        var free = Guid.NewGuid();
        var granted = Guid.NewGuid();
        var subscribed = Guid.NewGuid();
        var lapsed = Guid.NewGuid();
        var unpaid = Guid.NewGuid();
        var q = Enumerable.Range(0, 4).Select(_ => Guid.NewGuid()).ToArray();

        using var storage = new MinioObjectStorage(BuildStorageOptions());
        var uploadedKeys = new List<string>();
        var now = DateTime.UtcNow;

        await using (var ctx = CreateContext())
        {
            ctx.Users.Add(NewUser(teacherId, UserRole.Teacher, premium: false));
            ctx.Users.Add(NewUser(free, UserRole.Student, premium: false));
            ctx.Users.Add(NewUser(granted, UserRole.Student, premium: true));      // the teacher grant
            ctx.Users.Add(NewUser(subscribed, UserRole.Student, premium: false));  // pays for it
            ctx.Users.Add(NewUser(lapsed, UserRole.Student, premium: false));
            ctx.Users.Add(NewUser(unpaid, UserRole.Student, premium: false));
            ctx.QuestionBlocks.Add(NewBlock(blockId, teacherId));
            for (var i = 0; i < q.Length; i++)
                ctx.Questions.Add(NewQuestion(q[i], teacherId, blockId, i));
            ctx.Plans.Add(NewPlan(planId));
            ctx.Subscriptions.Add(NewSubscription(subscribed, planId, SubscriptionStatuses.Active,
                now.AddDays(-1), now.AddDays(29)));
            // Marked active, but its window closed yesterday. Nothing flips a row to "expired" at
            // the instant it expires, so the dates have to be the authority.
            ctx.Subscriptions.Add(NewSubscription(lapsed, planId, SubscriptionStatuses.Active,
                now.AddDays(-31), now.AddDays(-1)));
            // Inside a generous window, never paid for.
            ctx.Subscriptions.Add(NewSubscription(unpaid, planId, SubscriptionStatuses.Pending,
                now.AddDays(-1), now.AddDays(29)));
            await ctx.SaveChangesAsync();

            // Every student has already answered q[2], so q[3] is next in the module's order and the
            // only gate left in front of it is the one under test — premium.
            foreach (var student in new[] { free, granted, subscribed, lapsed, unpaid })
                ctx.Submissions.Add(new Submission
                {
                    Id = Guid.NewGuid(), StudentId = student, QuestionId = q[2],
                    AudioKey = $"answers/seed-{Guid.NewGuid():N}.webm", Status = SubmissionStatus.Done,
                    CreatedAt = now, UpdatedAt = now,
                });
            await ctx.SaveChangesAsync();
        }

        try
        {
            var client = _factory.CreateClient();

            // ── The teacher grant still works, exactly as before ──
            var grantedResp = await Send(client, HttpMethod.Post, "/api/submissions", TokenFor(granted), AudioFor(q[3]));
            Assert.Equal(HttpStatusCode.Created, grantedResp.StatusCode);
            uploadedKeys.Add(await AudioKeyOf(grantedResp));

            // ── An active subscription now grants the same access ──
            var subResp = await Send(client, HttpMethod.Post, "/api/submissions", TokenFor(subscribed), AudioFor(q[3]));
            Assert.Equal(HttpStatusCode.Created, subResp.StatusCode);
            uploadedKeys.Add(await AudioKeyOf(subResp));

            // ── Neither → the SAME 402 as before, with the same body shape the client parses ──
            var freeResp = await Send(client, HttpMethod.Post, "/api/submissions", TokenFor(free), AudioFor(q[3]));
            Assert.Equal(HttpStatusCode.PaymentRequired, freeResp.StatusCode);
            using (var doc = JsonDocument.Parse(await freeResp.Content.ReadAsStringAsync()))
            {
                // The frontend branches on { "detail": … }; a 402 that changed shape would be a
                // silent break of the paywall message.
                Assert.True(doc.RootElement.TryGetProperty("detail", out var detail));
                Assert.False(string.IsNullOrWhiteSpace(detail.GetString()));
            }

            // ── A lapsed subscription grants nothing ──
            Assert.Equal(HttpStatusCode.PaymentRequired,
                (await Send(client, HttpMethod.Post, "/api/submissions", TokenFor(lapsed), AudioFor(q[3]))).StatusCode);

            // ── A subscription that was never paid for grants nothing ──
            Assert.Equal(HttpStatusCode.PaymentRequired,
                (await Send(client, HttpMethod.Post, "/api/submissions", TokenFor(unpaid), AudioFor(q[3]))).StatusCode);

            // ── The status endpoint agrees with the gate, and names the SOURCE ──
            using (var doc = await GetJson(client, "/api/billing/subscription", TokenFor(granted)))
            {
                Assert.True(doc.RootElement.GetProperty("is_premium").GetBoolean());
                Assert.Equal("teacher", doc.RootElement.GetProperty("source").GetString());
            }
            using (var doc = await GetJson(client, "/api/billing/subscription", TokenFor(subscribed)))
            {
                Assert.True(doc.RootElement.GetProperty("is_premium").GetBoolean());
                Assert.Equal("subscription", doc.RootElement.GetProperty("source").GetString());
                Assert.Equal(SubscriptionStatuses.Active, doc.RootElement.GetProperty("status").GetString());
            }
            using (var doc = await GetJson(client, "/api/billing/subscription", TokenFor(free)))
            {
                Assert.False(doc.RootElement.GetProperty("is_premium").GetBoolean());
                Assert.Equal("none", doc.RootElement.GetProperty("source").GetString());
                // Both gates report shut, which is what the screen renders instead of a buy button.
                Assert.False(doc.RootElement.GetProperty("payments_enabled").GetBoolean());
                Assert.False(doc.RootElement.GetProperty("provider_configured").GetBoolean());
            }

            // ── The free preview is untouched: the first task is still free ──
            var firstResp = await Send(client, HttpMethod.Post, "/api/submissions", TokenFor(free), AudioFor(q[0]));
            Assert.Equal(HttpStatusCode.Created, firstResp.StatusCode);
            uploadedKeys.Add(await AudioKeyOf(firstResp));
        }
        finally
        {
            foreach (var key in uploadedKeys)
                await storage.DeleteAsync(key);
            await Cleanup(teacherId, blockId, planId, [free, granted, subscribed, lapsed, unpaid]);
        }
    }

    /// <summary>
    /// With no merchant account the purchase flow must STOP, visibly, and write nothing. Two
    /// distinct refusals because they have two distinct fixes — switch the flag on, or wire an
    /// adapter — and an operator must be able to tell which one they are looking at.
    ///
    /// <para>The flag is flipped through the <c>app_settings</c> row it really lives in, so this
    /// also proves the admin panel's switch reaches this module.</para>
    /// </summary>
    [Fact]
    public async Task Checkout_stops_honestly_and_writes_nothing_when_payments_cannot_happen()
    {
        var studentId = Guid.NewGuid();
        var planId = Guid.NewGuid();

        await using (var ctx = CreateContext())
        {
            ctx.Users.Add(NewUser(studentId, UserRole.Student, premium: false));
            ctx.Plans.Add(NewPlan(planId));
            await ctx.SaveChangesAsync();
        }

        try
        {
            var client = _factory.CreateClient();
            var token = TokenFor(studentId);
            var body = () => JsonContent.Create(new { plan_id = planId, idempotency_key = "buy-once" });

            // ── Flag OFF (the default — no row, no env var) → payments_disabled ──
            var off = await Send(client, HttpMethod.Post, "/api/billing/checkout", token, body());
            Assert.Equal(HttpStatusCode.ServiceUnavailable, off.StatusCode);
            Assert.Equal(BillingService.PaymentsDisabledReason, await DetailOf(off));

            // ── Flag ON, still no adapter → provider_not_configured. Turning the switch on must NOT
            //    open a flow that cannot complete. ──
            await SetPaymentsFlag("true");
            var on = await Send(client, HttpMethod.Post, "/api/billing/checkout", token, body());
            Assert.Equal(HttpStatusCode.ServiceUnavailable, on.StatusCode);
            Assert.Equal(UnconfiguredPaymentProvider.NotConfiguredReason, await DetailOf(on));

            // ── Nothing was written on either path: no intent, and above all no subscription ──
            await using (var ctx = CreateContext())
            {
                Assert.Equal(0, await ctx.PaymentIntents.CountAsync(i => i.UserId == studentId));
                Assert.Equal(0, await ctx.Subscriptions.CountAsync(s => s.UserId == studentId));
            }

            // ── The plans list still works — a student may see the price of something they cannot
            //    yet buy; they must simply not be told they bought it. ──
            using var doc = await GetJson(client, "/api/billing/plans", token);
            Assert.Contains(doc.RootElement.EnumerateArray(), p => p.GetProperty("id").GetGuid() == planId);
        }
        finally
        {
            await SetPaymentsFlag(null);
            await Cleanup(null, null, planId, [studentId]);
        }
    }

    /// <summary>
    /// The webhook is anonymous and reachable by anyone. Every callback it cannot VERIFY is
    /// rejected, and the rejection is identical whatever was wrong — a wrong provider name, a forged
    /// signature and an unknown intent are indistinguishable from outside, so the route cannot be
    /// used to probe what exists. Nothing is written, and the poster gains no access.
    /// </summary>
    [Fact]
    public async Task An_unverified_webhook_grants_nothing_and_says_nothing()
    {
        var studentId = Guid.NewGuid();
        var planId = Guid.NewGuid();

        await using (var ctx = CreateContext())
        {
            ctx.Users.Add(NewUser(studentId, UserRole.Student, premium: false));
            ctx.Plans.Add(NewPlan(planId));
            await ctx.SaveChangesAsync();
        }

        try
        {
            await SetPaymentsFlag("true");        // even fully switched on, the callback is refused
            var client = _factory.CreateClient();

            // The shapes a forger would actually try: a Payme Merchant API call, a Click callback,
            // and a naive "just tell them it is paid" body naming the victim.
            string[] bodies =
            [
                "{}",
                $"{{\"user_id\":\"{studentId}\",\"plan_id\":\"{planId}\",\"paid\":true}}",
                "{\"method\":\"PerformTransaction\",\"params\":{\"id\":\"5f2\",\"time\":1}}",
                $"click_trans_id=1&merchant_trans_id={studentId}&amount=49900&sign_string=whatever",
            ];

            foreach (var provider in new[] { "none", "payme", "click" })
            {
                foreach (var body in bodies)
                {
                    var req = new HttpRequestMessage(HttpMethod.Post, $"/api/billing/webhook/{provider}")
                    {
                        Content = new StringContent(body, Encoding.UTF8, "application/json"),
                    };
                    req.Headers.TryAddWithoutValidation("X-Signature", "sha256=deadbeef");
                    req.Headers.TryAddWithoutValidation("Authorization", "Basic UGF5Y29tOnNlY3JldA==");

                    var resp = await client.SendAsync(req);
                    Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
                    // One answer for every rejection — nothing leaks about which providers are wired
                    // up or which intents exist.
                    Assert.Equal("webhook_rejected", await DetailOf(resp));
                }
            }

            await using var ctx = CreateContext();
            Assert.Equal(0, await ctx.Subscriptions.CountAsync(s => s.UserId == studentId));
            Assert.Equal(0, await ctx.PaymentIntents.CountAsync(i => i.UserId == studentId));
        }
        finally
        {
            await SetPaymentsFlag(null);
            await Cleanup(null, null, planId, [studentId]);
        }
    }

    /// <summary>
    /// The double-charge guard and the grant path, driven through a CONFIGURED adapter.
    ///
    /// <para>It has to be tested this way: with the stub in place a checkout never reaches the
    /// insert, so the guard would ship never having run once. A retry carrying the same key returns
    /// the SAME intent and leaves exactly one row; a different key is a genuinely new attempt.
    /// Then the other direction — premium arrives ONLY through a callback the adapter verified, and
    /// a redelivery of that callback does not sell a second month.</para>
    ///
    /// <para>Driven at the SERVICE level rather than over HTTP: swapping the provider would need a
    /// second test host, and this assembly is already close to EF Core's twenty-service-provider
    /// ceiling. The service is where every one of these rules lives.</para>
    /// </summary>
    [Fact]
    public async Task One_idempotency_key_is_one_payment_and_only_a_verified_callback_grants_premium()
    {
        var studentId = Guid.NewGuid();
        var planId = Guid.NewGuid();

        await using (var seed = CreateContext())
        {
            seed.Users.Add(NewUser(studentId, UserRole.Student, premium: false));
            seed.Plans.Add(NewPlan(planId));
            await seed.SaveChangesAsync();
        }

        try
        {
            var provider = new FakeConfiguredPaymentProvider();
            var config = new ConfigurationBuilder()
                .AddInMemoryCollection(new Dictionary<string, string?> { ["PAYMENTS_ENABLED"] = "true" })
                .Build();

            // A fresh service (and DbContext) per call, exactly as a request-scoped one would be.
            BillingService Service(GovoriDbContext ctx) => new(ctx, provider, config);

            Guid firstIntentId;
            await using (var ctx = CreateContext())
            {
                var svc = Service(ctx);
                var first = await svc.CheckoutAsync(studentId, new(planId, "one-purchase"));
                Assert.Equal(BillingOutcome.Ok, first.Outcome);
                firstIntentId = first.Value!.IntentId;
                // Starting a checkout is not a payment: the intent is pending, not succeeded.
                Assert.Equal(PaymentIntentStatuses.Pending, first.Value.Status);
            }

            // ── Same key again → the SAME intent, not a second one ──
            await using (var ctx = CreateContext())
            {
                var repeat = await Service(ctx).CheckoutAsync(studentId, new(planId, "one-purchase"));
                Assert.Equal(BillingOutcome.Ok, repeat.Outcome);
                Assert.Equal(firstIntentId, repeat.Value!.IntentId);
            }
            await using (var ctx = CreateContext())
                Assert.Equal(1, await ctx.PaymentIntents.CountAsync(i => i.UserId == studentId));

            // ── A different key is a different attempt: the guard de-duplicates RETRIES, it does
            //    not stop someone deliberately buying twice ──
            await using (var ctx = CreateContext())
            {
                var other = await Service(ctx).CheckoutAsync(studentId, new(planId, "another-purchase"));
                Assert.NotEqual(firstIntentId, other.Value!.IntentId);
            }
            await using (var ctx = CreateContext())
            {
                Assert.Equal(2, await ctx.PaymentIntents.CountAsync(i => i.UserId == studentId));
                // …and starting checkouts has granted NOTHING. No money has moved.
                Assert.Equal(0, await ctx.Subscriptions.CountAsync(s => s.UserId == studentId));
            }

            // ── A callback the adapter refuses to verify changes nothing ──
            await using (var ctx = CreateContext())
            {
                var rejected = await Service(ctx).HandleWebhookAsync(
                    provider.Name,
                    $"{{\"intent_id\":\"{firstIntentId}\",\"paid\":true}}",
                    Headers("wrong-signature"));
                Assert.Equal(BillingOutcome.Forbidden, rejected.Outcome);
            }
            await using (var ctx = CreateContext())
                Assert.Equal(0, await ctx.Subscriptions.CountAsync(s => s.UserId == studentId));

            // ── A VERIFIED callback is the only thing that grants a subscription ──
            await using (var ctx = CreateContext())
            {
                var accepted = await Service(ctx).HandleWebhookAsync(
                    provider.Name,
                    $"{{\"intent_id\":\"{firstIntentId}\",\"paid\":true}}",
                    Headers(FakeConfiguredPaymentProvider.Signature));
                Assert.Equal(BillingOutcome.Ok, accepted.Outcome);
                Assert.True(accepted.Value);
            }
            await using (var ctx = CreateContext())
            {
                var sub = Assert.Single(await ctx.Subscriptions.Where(s => s.UserId == studentId).ToListAsync());
                Assert.Equal(SubscriptionStatuses.Active, sub.Status);
                Assert.NotNull(sub.EndsAt);
                Assert.Equal(PaymentIntentStatuses.Succeeded,
                    (await ctx.PaymentIntents.FirstAsync(i => i.Id == firstIntentId)).Status);
            }

            // ── Redelivery of the same callback does not sell a second month ──
            await using (var ctx = CreateContext())
            {
                var replay = await Service(ctx).HandleWebhookAsync(
                    provider.Name,
                    $"{{\"intent_id\":\"{firstIntentId}\",\"paid\":true}}",
                    Headers(FakeConfiguredPaymentProvider.Signature));
                Assert.Equal(BillingOutcome.Ok, replay.Outcome);
            }
            await using (var ctx = CreateContext())
                Assert.Equal(1, await ctx.Subscriptions.CountAsync(s => s.UserId == studentId));

            // ── And that subscription is the SAME premium the 402 gate reads ──
            await using (var ctx = CreateContext())
            {
                Assert.True(await PremiumAccess.HasPremiumAsync(
                    ctx, await ctx.Users.FirstAsync(u => u.Id == studentId), DateTime.UtcNow));
            }
        }
        finally
        {
            await Cleanup(null, null, planId, [studentId]);
        }
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private static Dictionary<string, string> Headers(string signature) =>
        new(StringComparer.OrdinalIgnoreCase) { [FakeConfiguredPaymentProvider.SignatureHeader] = signature };

    /// <summary>Writes (or clears) the <c>payments_enabled</c> override — the same row the admin
    /// panel's switch writes, which is why the flag is toggled here rather than in configuration.</summary>
    private async Task SetPaymentsFlag(string? value)
    {
        await using var ctx = CreateContext();
        await ctx.AppSettings.Where(s => s.Key == BillingService.EnabledKey).ExecuteDeleteAsync();
        if (value is null)
            return;
        ctx.AppSettings.Add(new AppSetting
        {
            Key = BillingService.EnabledKey,
            Value = value,
            IsSecret = false,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
        });
        await ctx.SaveChangesAsync();
    }

    private static string TokenFor(Guid userId) =>
        new TokenService(new IdentityAuthOptions { SecretKey = BillingApiFactory.TestSecretKey })
            .CreateAccessToken(userId.ToString());

    private static Task<HttpResponseMessage> Send(
        HttpClient client, HttpMethod method, string url, string token, HttpContent? content = null)
    {
        var req = new HttpRequestMessage(method, url) { Content = content };
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client.SendAsync(req);
    }

    private static async Task<JsonDocument> GetJson(HttpClient client, string url, string token)
    {
        var resp = await Send(client, HttpMethod.Get, url, token);
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        return JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
    }

    private static async Task<string?> DetailOf(HttpResponseMessage resp)
    {
        using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
        return doc.RootElement.GetProperty("detail").GetString();
    }

    private static async Task<string> AudioKeyOf(HttpResponseMessage resp)
    {
        using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
        return doc.RootElement.GetProperty("audio_key").GetString()!;
    }

    private static MultipartFormDataContent AudioFor(Guid questionId)
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

    private static User NewUser(Guid id, UserRole role, bool premium) => new()
    {
        Id = id,
        Email = $"billing-{id:N}@example.test",
        FullName = "Billing Seed",
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
        Name = "Billing Module",
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
        Title = $"task {sortOrder}",
        PromptText = "Расскажите о себе.",
        IsPublished = true,
        IsDeleted = false,
        IsPublic = false,
        PrepTimeSec = 0,
        AnswerTimeLimitSec = 60,
        SortOrder = sortOrder,
        CreatedAt = DateTime.UtcNow.AddMinutes(sortOrder),
        UpdatedAt = DateTime.UtcNow,
    };

    private static Plan NewPlan(Guid id) => new()
    {
        Id = id,
        Code = $"t{id:N}"[..20],
        Name = "1 oylik Premium",
        PriceMinor = 4_990_000,          // 49 900 so'm, in tiyin
        Currency = "UZS",
        DurationDays = 30,
        IsActive = true,
        SortOrder = 0,
        CreatedAt = DateTime.UtcNow,
        UpdatedAt = DateTime.UtcNow,
    };

    private static Subscription NewSubscription(
        Guid userId, Guid planId, string status, DateTime startsAt, DateTime? endsAt) => new()
    {
        Id = Guid.NewGuid(),
        UserId = userId,
        PlanId = planId,
        Status = status,
        StartsAt = startsAt,
        EndsAt = endsAt,
        Provider = "manual",
        CreatedAt = DateTime.UtcNow,
        UpdatedAt = DateTime.UtcNow,
    };

    // Children before parents: intents and subscriptions reference the plan under RESTRICT, so the
    // plan cannot go first.
    private async Task Cleanup(Guid? teacherId, Guid? blockId, Guid planId, Guid[] studentIds)
    {
        await using var ctx = CreateContext();
        await ctx.Submissions.Where(s => studentIds.Contains(s.StudentId)).ExecuteDeleteAsync();
        await ctx.PaymentIntents.Where(i => studentIds.Contains(i.UserId)).ExecuteDeleteAsync();
        await ctx.Subscriptions.Where(s => studentIds.Contains(s.UserId)).ExecuteDeleteAsync();
        await ctx.Plans.Where(p => p.Id == planId).ExecuteDeleteAsync();
        if (blockId is not null)
        {
            await ctx.Questions.Where(q => q.BlockId == blockId).ExecuteDeleteAsync();
            await ctx.QuestionBlocks.Where(b => b.Id == blockId).ExecuteDeleteAsync();
        }
        var users = teacherId is null ? studentIds : studentIds.Append(teacherId.Value).ToArray();
        await ctx.Users.Where(u => users.Contains(u.Id)).ExecuteDeleteAsync();
    }

    public void Dispose() => _dataSource.Dispose();

    /// <summary>The default deployment: payments flag OFF, stub adapter. What production is today.</summary>
    public sealed class BillingApiFactory : WebApplicationFactory<Program>
    {
        public string ConnectionString { get; } = TestDatabase.ConnectionString;

        internal const string TestSecretKey =
            "billing-domain-integration-test-secret-key-do-not-use-in-prod";

        public BillingApiFactory()
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

/// <summary>
/// A stand-in for a real Payme/Click adapter, used by one test.
///
/// <para>It exists so the double-charge guard and the "only a verified callback grants premium" rule
/// are actually executed, which the shipped stub can never do — it refuses before reaching them. Its
/// "signature check" is a fixed header value: crude, and exactly the right shape, because what the
/// test needs to prove is that a callback which FAILS verification changes nothing, not that HMAC
/// works.</para>
///
/// <para>It lives in the test assembly and is never registered in any composition root, so no
/// deployment can reach it.</para>
/// </summary>
internal sealed class FakeConfiguredPaymentProvider : IPaymentProvider
{
    internal const string SignatureHeader = "X-Fake-Signature";
    internal const string Signature = "valid-signature";

    public string Name => "fake";

    public Task<bool> IsConfiguredAsync(CancellationToken ct = default) => Task.FromResult(true);

    public Task<PaymentStartResult> CreatePaymentAsync(PaymentIntent intent, CancellationToken ct = default)
        => Task.FromResult(new PaymentStartResult(
            Ok: true,
            Status: PaymentIntentStatuses.Pending,
            RedirectUrl: $"https://payments.example.test/pay/{intent.Id}",
            ExternalId: $"ext-{intent.Id:N}",
            RawPayload: "{\"ok\":true}"));

    public Task<PaymentCallback?> VerifyWebhookAsync(
        string rawBody, IReadOnlyDictionary<string, string> headers, CancellationToken ct = default)
    {
        if (!headers.TryGetValue(SignatureHeader, out var sig) || sig != Signature)
            return Task.FromResult<PaymentCallback?>(null);   // the whole point of the seam

        using var doc = JsonDocument.Parse(rawBody);
        var intentId = doc.RootElement.GetProperty("intent_id").GetGuid();
        var paid = doc.RootElement.GetProperty("paid").GetBoolean();
        return Task.FromResult<PaymentCallback?>(
            new PaymentCallback($"ext-{intentId:N}", intentId, paid, rawBody));
    }
}
