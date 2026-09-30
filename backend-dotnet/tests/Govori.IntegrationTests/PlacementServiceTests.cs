using Govori.Assessment;
using Govori.Platform.Grader;
using Govori.Platform.Stt;

namespace Govori.IntegrationTests;

/// <summary>
/// The placement test never invents a level. It used to answer every unscorable recording — no
/// STT/grader key, or a vendor fault — with a "deterministic placeholder band" of 40–56 computed from
/// the recording's BYTE LENGTH, which the screen then showed a brand-new student as their measured
/// CEFR level. Now an unscorable answer is <c>null</c>, which both submit endpoints turn into 503
/// <c>placement_unavailable</c>.
///
/// <para>Service-level on purpose: no host is built here. Every extra WebApplicationFactory host
/// counts against EF Core's per-process service-provider budget, and the question under test is
/// only what this one method returns.</para>
/// </summary>
public sealed class PlacementServiceTests
{
    private static readonly byte[] Audio = new byte[4096];

    [Fact]
    public async Task A_configured_pipeline_returns_the_real_blended_band()
    {
        var svc = new PlacementService(new Stt(configured: true), new Grader(configured: true));
        // Same C5 blend as the app: (Overall 80 × 4 + Pron 70) / 5.
        Assert.Equal(78.0, (await svc.GradeAnswerAsync(0, Audio, default))!.Value, precision: 3);
    }

    [Theory]
    [InlineData(false, true)]
    [InlineData(true, false)]
    [InlineData(false, false)]
    public async Task No_configured_provider_means_no_band_rather_than_an_invented_one(bool stt, bool grader)
    {
        var svc = new PlacementService(new Stt(stt), new Grader(grader));
        Assert.Null(await svc.GradeAnswerAsync(1, Audio, default));
    }

    [Fact]
    public async Task A_vendor_failure_means_no_band_rather_than_an_invented_one()
    {
        var svc = new PlacementService(new Stt(configured: true), new Grader(configured: true, throws: true));
        Assert.Null(await svc.GradeAnswerAsync(2, Audio, default));
    }

    [Fact]
    public async Task A_cancelled_request_is_not_a_vendor_failure_and_propagates()
    {
        using var cts = new CancellationTokenSource();
        var svc = new PlacementService(new Stt(configured: true, cancel: cts), new Grader(configured: true));
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => svc.GradeAnswerAsync(0, Audio, cts.Token));
    }

    private sealed class Stt(bool configured, CancellationTokenSource? cancel = null) : ISttProvider
    {
        public ValueTask<bool> IsConfiguredAsync(CancellationToken ct = default) => ValueTask.FromResult(configured);

        public Task<SttResult> TranscribeAsync(byte[] audio, string filename, string? referenceText,
            CancellationToken ct = default, SttRecognitionMode mode = SttRecognitionMode.Unscripted)
        {
            if (cancel is not null)
            {
                cancel.Cancel();
                ct.ThrowIfCancellationRequested();
            }
            return Task.FromResult(new SttResult
            {
                Text = "меня зовут азиз",
                Pronunciation = new SttPronunciation { Pronunciation = 70 },
            });
        }
    }

    private sealed class Grader(bool configured, bool throws = false) : IGraderProvider
    {
        public ValueTask<bool> IsConfiguredAsync(CancellationToken ct = default) => ValueTask.FromResult(configured);

        public Task<GraderResult> AnalyzeAsync(GraderRequest request, CancellationToken ct = default) =>
            throws
                ? throw new HttpRequestException("vendor exploded")
                : Task.FromResult(new GraderResult { Scores = new GraderScores(80, 80, 80, 80, 80, 80) });
    }
}
