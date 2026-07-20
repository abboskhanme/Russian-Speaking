using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Govori.Api.RateLimiting;
using Govori.Guest;
using Govori.Guest.Tts;
using Govori.Identity.Providers;
using Govori.Infrastructure;
using Govori.Platform.Stt;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Govori.IntegrationTests;

/// <summary>
/// Guest domain (Faza 3.8) + rate-limiter (docs/07 §7.3) coverage over the real Govori.Api host:
/// the auth-less demo works with NO bearer token, and the ASP.NET Core RateLimiter returns 429 only
/// AFTER the limit (never before) while preserving the CRITICAL fail-open rule — a store outage
/// ALLOWS requests instead of blocking them (the opposite of OTP's fail-closed).
///
/// External providers (STT/TTS, OTP store/sender, Google verifier, rate-limit store) are swapped for
/// fakes via ConfigureTestServices so tests never touch Azure/Redis/Google. Nothing is persisted by
/// the guest surface; the OTP-request burst creates no rows — runs are idempotent.
/// </summary>
public sealed class GuestEndpointsTests : IClassFixture<GuestEndpointsTests.GuestApiFactory>
{
    private readonly GuestApiFactory _factory;

    public GuestEndpointsTests(GuestApiFactory factory) => _factory = factory;

    // ── 1. GET /api/guest/demo works with NO auth and returns a known demo phrase ──
    [Fact]
    public async Task Guest_demo_returns_a_phrase_without_auth()
    {
        var client = _factory.CreateClientWith();

        var resp = await client.GetAsync("/api/guest/demo");

        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
        var phrase = doc.RootElement.GetProperty("phrase").GetString();
        Assert.False(string.IsNullOrWhiteSpace(phrase));
        Assert.Contains(phrase, GuestPhrases.Demo); // one of the scripted A1 phrases
    }

    // ── 2. POST /api/guest/assess works with NO auth and returns scored demo feedback ──
    [Fact]
    public async Task Guest_assess_scores_the_attempt_without_auth()
    {
        var reference = GuestPhrases.Demo[0];
        // Fake STT returns a fixed pronunciation aggregate (PronScore 70) + an on-topic match.
        var client = _factory.CreateClientWith(stt: new FakeSttProvider());

        var content = new ByteArrayContent(new byte[] { 1, 2, 3, 4 }); // raw audio body
        var resp = await client.PostAsync(
            $"/api/guest/assess?phrase={Uri.EscapeDataString(reference)}", content);

        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
        var root = doc.RootElement;
        Assert.Equal(reference, root.GetProperty("phrase").GetString());
        Assert.Equal("привет как дела", root.GetProperty("transcript").GetString());
        Assert.Equal(70, root.GetProperty("overall").GetInt32());       // rounded PronScore
        Assert.Equal("A1+", root.GetProperty("level").GetString());     // 60 ≤ 70 < 72
        Assert.True(root.GetProperty("on_topic").GetBoolean());
        Assert.True(root.GetProperty("scored").GetBoolean());
        Assert.Equal(90, root.GetProperty("criteria").GetProperty("pronunciation").GetInt32());
        Assert.Equal(0, root.GetProperty("errors").GetArrayLength());   // all fake words ≥ 80
    }

    // ── 3. POST /api/guest/assess with an empty body → 400 (no external calls) ──
    [Fact]
    public async Task Guest_assess_rejects_empty_audio()
    {
        var client = _factory.CreateClientWith(stt: new FakeSttProvider());
        var resp = await client.PostAsync("/api/guest/assess", new ByteArrayContent(Array.Empty<byte>()));
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    // ── 4. GET /api/guest/tts refuses text outside the demo-phrase word set → 400 ──
    [Fact]
    public async Task Guest_tts_rejects_non_demo_words()
    {
        var client = _factory.CreateClientWith();
        var resp = await client.GetAsync("/api/guest/tts?text=hackerman");
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    // ── 5. Rate limiter: allows UNDER the limit, then returns 429 (email_code = 5/window) ──
    // Also proves the limiter is applied to the phone-OTP request endpoint (a task requirement).
    [Fact]
    public async Task Rate_limiter_allows_under_the_limit_then_returns_429()
    {
        // Fresh in-memory counter for this isolated host so the window starts at zero.
        var client = _factory.CreateClientWith(rateLimitStore: new InMemoryRateLimitStore());
        const string phone = "+998901112233";

        // The email_code policy allows 5 requests per window. First 5 must NOT be 429...
        for (var i = 1; i <= 5; i++)
        {
            var ok = await client.PostAsJsonAsync("/api/auth/otp/request", new { phone });
            Assert.NotEqual(HttpStatusCode.TooManyRequests, ok.StatusCode); // under the limit → allowed
        }

        // ...the 6th trips the limiter: 429 with FastAPI's { detail } body.
        var limited = await client.PostAsJsonAsync("/api/auth/otp/request", new { phone });
        Assert.Equal(HttpStatusCode.TooManyRequests, limited.StatusCode);
        using var doc = JsonDocument.Parse(await limited.Content.ReadAsStringAsync());
        Assert.Equal("Too many requests. Please try again later.",
            doc.RootElement.GetProperty("detail").GetString());
    }

    // ── 6. Rate limiter is FAIL-OPEN: a throwing store ALLOWS every request (never 429) ──
    [Fact]
    public async Task Rate_limiter_is_fail_open_when_the_store_errors()
    {
        var client = _factory.CreateClientWith(rateLimitStore: new ThrowingRateLimitStore());
        const string phone = "+998901112244";

        // Burst well past the email_code limit (5). Because the store throws, the limiter must ALLOW
        // every request — the opposite of OTP's fail-closed. None may be 429.
        for (var i = 0; i < 8; i++)
        {
            var resp = await client.PostAsJsonAsync("/api/auth/otp/request", new { phone });
            Assert.NotEqual(HttpStatusCode.TooManyRequests, resp.StatusCode);
        }
    }

    /// <summary><see cref="IRateLimitStore"/> that always throws — simulates a Redis outage so a
    /// test can prove the limiter is FAIL-OPEN (a store failure must ALLOW, never block).</summary>
    private sealed class ThrowingRateLimitStore : IRateLimitStore
    {
        public Task<long> HitAsync(string key, TimeSpan window, CancellationToken ct = default)
            => throw new InvalidOperationException("simulated rate-limit store outage");
    }

    /// <summary>
    /// Boots Govori.Api against the schema DB with a fixed test SECRET_KEY, then swaps the guest
    /// providers (STT/TTS), OTP fakes and the rate-limit store for fakes via ConfigureTestServices.
    /// Each call builds an isolated host via WithWebHostBuilder so tests don't share limiter state.
    /// </summary>
    public sealed class GuestApiFactory : WebApplicationFactory<Program>
    {
        public string ConnectionString { get; } =
            Environment.GetEnvironmentVariable("GOVORI_TEST_DB")
            ?? GovoriDataSourceFactory.DefaultConnectionString;

        // Same value the other host-booting fixtures use — SECRET_KEY is process-global and the
        // collections are serialized (TestParallelization.cs), so a shared value avoids races.
        private const string TestSecretKey =
            "identity-domain-integration-test-secret-key-do-not-use-in-prod";

        public GuestApiFactory()
        {
            Environment.SetEnvironmentVariable("SECRET_KEY", TestSecretKey);
            Environment.SetEnvironmentVariable("GOVORI_DB", ConnectionString);
        }

        public HttpClient CreateClientWith(
            ISttProvider? stt = null,
            ITtsProvider? tts = null,
            IRateLimitStore? rateLimitStore = null)
        {
            return WithWebHostBuilder(builder =>
                builder.ConfigureTestServices(services =>
                {
                    if (stt is not null)
                    {
                        services.RemoveAll<ISttProvider>();
                        services.AddSingleton(stt);
                    }
                    if (tts is not null)
                    {
                        services.RemoveAll<ITtsProvider>();
                        services.AddSingleton(tts);
                    }
                    if (rateLimitStore is not null)
                    {
                        services.RemoveAll<IRateLimitStore>();
                        services.AddSingleton(rateLimitStore);
                    }

                    // OTP fakes so /api/auth/otp/request (the rate-limit burst target) never hits
                    // Redis. The default dev delivery sender (no bot token in tests) just logs.
                    services.RemoveAll<IOtpStore>();
                    services.AddSingleton<IOtpStore>(new FakeOtpStore());
                    services.RemoveAll<IOtpDeliverySender>();
                    services.AddSingleton<IOtpDeliverySender>(new FakeOtpDeliverySender());
                })).CreateClient();
        }
    }
}
