using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Govori.Infrastructure;
using Govori.Platform.Grader;
using Govori.Platform.Stt;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Govori.IntegrationTests;

/// <summary>
/// The AUTH-LESS "try the placement test" slice (product: try before register) over the real Govori.Api
/// host: a visitor with NO bearer token reads the 3 questions, submits an answer to each, and completes
/// → a CEFR level via <c>/api/guest/placement/*</c>. These endpoints are NOT <c>.RequireAuthorization()</c>,
/// delegate to the SAME PlacementService as the authed flow, and store nothing. The STT + grader providers
/// are the deterministic fakes so the band is the known C5 blend (Overall 80 × 4 + Pron 70) / 5 = 78 → B2.
/// The test also asserts the authed <c>/api/placement/questions</c> STILL requires a token (401 without one).
/// </summary>
[Collection(PerRunDatabaseFixture.CollectionName)]
public sealed class GuestPlacementEndpointsTests : IClassFixture<GuestPlacementEndpointsTests.GuestPlacementApiFactory>
{
    private readonly GuestPlacementApiFactory _factory;

    public GuestPlacementEndpointsTests(GuestPlacementApiFactory factory) => _factory = factory;

    [Fact]
    public async Task Guest_gets_questions_submits_three_and_completes_to_a_level_without_any_token()
    {
        var client = _factory.CreateClientWithFakes();

        // ── GET /api/guest/placement/questions → exactly 3 { index, prompt_ru }, NO auth header ──
        var qResp = await client.GetAsync("/api/guest/placement/questions");
        Assert.Equal(HttpStatusCode.OK, qResp.StatusCode);
        using var qDoc = JsonDocument.Parse(await qResp.Content.ReadAsStringAsync());
        var questions = qDoc.RootElement.EnumerateArray().ToList();
        Assert.Equal(3, questions.Count);
        for (var i = 0; i < questions.Count; i++)
        {
            Assert.Equal(i, questions[i].GetProperty("index").GetInt32());
            Assert.False(string.IsNullOrWhiteSpace(questions[i].GetProperty("prompt_ru").GetString()));
        }

        // ── POST /api/guest/placement/submit × 3 → { index, band } with the blended fake band (78) ──
        var bands = new List<double>();
        for (var i = 0; i < 3; i++)
        {
            var sResp = await client.PostAsync("/api/guest/placement/submit", BuildAudioForm(i));
            Assert.Equal(HttpStatusCode.OK, sResp.StatusCode);
            using var sDoc = JsonDocument.Parse(await sResp.Content.ReadAsStringAsync());
            Assert.Equal(i, sDoc.RootElement.GetProperty("index").GetInt32());
            var band = sDoc.RootElement.GetProperty("band").GetDouble();
            Assert.Equal(78.0, band, precision: 3); // (Overall 80 × 4 + Pron 70) / 5
            bands.Add(band);
        }

        // ── Out-of-range index → 400 (still no auth involved) ──
        var badResp = await client.PostAsync("/api/guest/placement/submit", BuildAudioForm(9));
        Assert.Equal(HttpStatusCode.BadRequest, badResp.StatusCode);

        // ── POST /api/guest/placement/complete → { level, label_uz, band } ──
        var cResp = await client.PostAsJsonAsync("/api/guest/placement/complete", new { bands });
        Assert.Equal(HttpStatusCode.OK, cResp.StatusCode);
        using var cDoc = JsonDocument.Parse(await cResp.Content.ReadAsStringAsync());
        Assert.Equal("B2", cDoc.RootElement.GetProperty("level").GetString());       // avg 78 → B2 bucket
        Assert.False(string.IsNullOrWhiteSpace(cDoc.RootElement.GetProperty("label_uz").GetString()));
        Assert.Equal(78.0, cDoc.RootElement.GetProperty("band").GetDouble(), precision: 3);
    }

    [Fact]
    public async Task Authed_placement_still_requires_a_token_while_the_guest_flow_is_open()
    {
        var client = _factory.CreateClientWithFakes();

        // The guest questions are open to everyone...
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/guest/placement/questions")).StatusCode);

        // ...but the ORIGINAL authed placement route is untouched: no token → 401.
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/placement/questions")).StatusCode);
    }

    // ── helpers ──

    private static MultipartFormDataContent BuildAudioForm(int questionIndex)
    {
        var form = new MultipartFormDataContent
        {
            { new StringContent(questionIndex.ToString()), "question_index" },
        };
        var audio = new ByteArrayContent(Encoding.UTF8.GetBytes($"fake-webm-audio-{Guid.NewGuid():N}"));
        audio.Headers.ContentType = new MediaTypeHeaderValue("audio/webm");
        form.Add(audio, "audio", "answer.webm");
        return form;
    }

    /// <summary>Boots Govori.Api and swaps in the deterministic STT + grader fakes so the guest
    /// placement grading path runs with known numbers (no Azure/Gemini). Placement touches no DB, but
    /// GOVORI_DB is set for parity with the other host-booting fixtures.</summary>
    public sealed class GuestPlacementApiFactory : WebApplicationFactory<Program>
    {
        // The per-run throwaway database (see TestDatabase) — never the shared dev one.
        public string ConnectionString { get; } = TestDatabase.ConnectionString;

        private const string TestSecretKey =
            "guest-placement-domain-integration-test-secret-key-do-not-use-in-prod";

        public GuestPlacementApiFactory()
        {
            Environment.SetEnvironmentVariable("SECRET_KEY", TestSecretKey);
            Environment.SetEnvironmentVariable("GOVORI_DB", ConnectionString);
        }

        // Hangfire/SignalR-backplane off so no Postgres job storage / Redis is required to boot.
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseSetting("GOVORI_HANGFIRE", "false");
            builder.UseSetting("GOVORI_SIGNALR_BACKPLANE", "false");
        }

        public HttpClient CreateClientWithFakes()
        {
            return WithWebHostBuilder(builder =>
                builder.ConfigureTestServices(services =>
                {
                    services.RemoveAll<ISttProvider>();
                    services.AddSingleton<ISttProvider>(new FakeSttProvider());
                    services.RemoveAll<IGraderProvider>();
                    services.AddSingleton<IGraderProvider>(new FakeGraderProvider());
                })).CreateClient();
        }
    }
}
