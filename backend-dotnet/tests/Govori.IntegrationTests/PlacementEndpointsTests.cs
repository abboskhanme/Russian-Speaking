using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Govori.Identity.Security;
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
/// The placement test slice (owner mockup "dastlabki sinov") over the real Govori.Api host: an authed
/// student reads the 3 fixed Russian questions, submits an answer to each, and completes → a CEFR
/// level. Placement reads NO DB and stores nothing, so the test needs only a minted access token (no
/// seeding). The STT + grader providers are swapped for the deterministic fakes so the "configured"
/// grading path runs with known numbers: FakeStt PronScore 70 + FakeGrader Overall 80 →
/// C5 blend (80*4 + 70)/5 = 78 per answer → averaged 78 → B2.
/// </summary>
[Collection(PerRunDatabaseFixture.CollectionName)]
public sealed class PlacementEndpointsTests : IClassFixture<PlacementEndpointsTests.PlacementApiFactory>
{
    private readonly PlacementApiFactory _factory;

    public PlacementEndpointsTests(PlacementApiFactory factory) => _factory = factory;

    [Fact]
    public async Task Authed_student_gets_questions_submits_three_and_completes_to_a_level()
    {
        var client = _factory.CreateClientWithFakes();
        var token = TokenFor(Guid.NewGuid());

        // ── Anonymous → 401 (all placement routes RequireAuthorization) ──
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/placement/questions")).StatusCode);

        // ── GET /api/placement/questions → exactly 3 { index, prompt_ru } ──
        var qResp = await Send(client, HttpMethod.Get, "/api/placement/questions", token);
        Assert.Equal(HttpStatusCode.OK, qResp.StatusCode);
        using var qDoc = JsonDocument.Parse(await qResp.Content.ReadAsStringAsync());
        var questions = qDoc.RootElement.EnumerateArray().ToList();
        Assert.Equal(3, questions.Count);
        for (var i = 0; i < questions.Count; i++)
        {
            Assert.Equal(i, questions[i].GetProperty("index").GetInt32());
            Assert.False(string.IsNullOrWhiteSpace(questions[i].GetProperty("prompt_ru").GetString()));
        }

        // ── POST /api/placement/submit × 3 → { index, band } with the blended fake band (78) ──
        var bands = new List<double>();
        for (var i = 0; i < 3; i++)
        {
            var sResp = await Send(client, HttpMethod.Post, "/api/placement/submit", token, BuildAudioForm(i));
            Assert.Equal(HttpStatusCode.OK, sResp.StatusCode);
            using var sDoc = JsonDocument.Parse(await sResp.Content.ReadAsStringAsync());
            Assert.Equal(i, sDoc.RootElement.GetProperty("index").GetInt32());
            var band = sDoc.RootElement.GetProperty("band").GetDouble();
            Assert.Equal(78.0, band, precision: 3); // (Overall 80 × 4 + Pron 70) / 5
            bands.Add(band);
        }

        // ── Out-of-range index → 400 ──
        var badResp = await Send(client, HttpMethod.Post, "/api/placement/submit", token, BuildAudioForm(9));
        Assert.Equal(HttpStatusCode.BadRequest, badResp.StatusCode);

        // ── POST /api/placement/complete → { level, label_uz, band } ──
        var cReq = new HttpRequestMessage(HttpMethod.Post, "/api/placement/complete")
        {
            Content = JsonContent.Create(new { bands }),
        };
        cReq.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var cResp = await client.SendAsync(cReq);
        Assert.Equal(HttpStatusCode.OK, cResp.StatusCode);
        using var cDoc = JsonDocument.Parse(await cResp.Content.ReadAsStringAsync());
        var level = cDoc.RootElement.GetProperty("level").GetString();
        Assert.Contains(level, new[] { "A1", "A2", "B1", "B2", "C1" });
        Assert.Equal("B2", level);                                       // avg 78 → B2 bucket
        Assert.False(string.IsNullOrWhiteSpace(cDoc.RootElement.GetProperty("label_uz").GetString()));
        Assert.Equal(78.0, cDoc.RootElement.GetProperty("band").GetDouble(), precision: 3);
    }

    // ── helpers ──

    private static string TokenFor(Guid userId) =>
        new TokenService(new IdentityAuthOptions { SecretKey = PlacementApiFactory.TestSecretKey })
            .CreateAccessToken(userId.ToString());

    private static Task<HttpResponseMessage> Send(
        HttpClient client, HttpMethod method, string url, string token, HttpContent? content = null)
    {
        var req = new HttpRequestMessage(method, url) { Content = content };
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client.SendAsync(req);
    }

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

    /// <summary>Boots Govori.Api with a fixed test SECRET_KEY and swaps in the deterministic STT +
    /// grader fakes so the placement grading path runs with known numbers (no Azure/Gemini). Placement
    /// touches no DB, but GOVORI_DB is set for parity with the other host-booting fixtures.</summary>
    public sealed class PlacementApiFactory : WebApplicationFactory<Program>
    {
        // The per-run throwaway database (see TestDatabase) — never the shared dev one.
        public string ConnectionString { get; } = TestDatabase.ConnectionString;

        internal const string TestSecretKey =
            "placement-domain-integration-test-secret-key-do-not-use-in-prod";

        public PlacementApiFactory()
        {
            Environment.SetEnvironmentVariable("SECRET_KEY", TestSecretKey);
            Environment.SetEnvironmentVariable("GOVORI_DB", ConnectionString);
        }

        // Hangfire off so no Postgres job storage is required just to boot this hermetic slice.
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
