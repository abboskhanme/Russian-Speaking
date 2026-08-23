namespace Govori.Platform.Stt;

/// <summary>
/// Deterministic <see cref="ISttProvider"/> for tests — no Azure/Whisper, no ffmpeg, no network.
/// Returns a fixed faithful transcript + a fixed pronunciation <c>PronScore</c> so the C5 scoring
/// math is exercised end-to-end with known numbers. NEVER registered in prod DI — tests inject it
/// via <c>ConfigureTestServices</c>.
///
/// <para><see cref="TranscribeCalls"/> lets a resume-from-transcript test prove STT was SKIPPED
/// (call count stays 0) when a <c>Transcript</c> already exists.</para>
/// </summary>
public sealed class FakeSttProvider : ISttProvider
{
    private int _calls;

    private readonly string _text;
    private readonly double? _pronScore;
    private readonly string _language;
    private readonly string _model;

    public FakeSttProvider(
        string text = "привет как дела",
        double? pronScore = 70.0,
        string language = "ru-RU",
        string model = "fake-stt")
    {
        _text = text;
        _pronScore = pronScore;
        _language = language;
        _model = model;
    }

    /// <summary>How many times <see cref="TranscribeAsync"/> ran (0 ⇒ STT was skipped/resumed).</summary>
    public int TranscribeCalls => Volatile.Read(ref _calls);

    public ValueTask<bool> IsConfiguredAsync(CancellationToken ct = default) => ValueTask.FromResult(true);

    public Task<SttResult> TranscribeAsync(
        byte[] audio, string filename, string? referenceText, CancellationToken ct = default,
        SttRecognitionMode mode = SttRecognitionMode.Unscripted)
    {
        Interlocked.Increment(ref _calls);

        SttReferenceMatch? match = null;
        if (!string.IsNullOrWhiteSpace(referenceText))
            match = new SttReferenceMatch(
                Completeness: 100.0, Similarity: 1.0, MatchedWords: 3,
                ReferenceWords: 3, SpokenWords: 3, OnTopic: true);

        var result = new SttResult
        {
            Text = _text,
            Language = _language,
            DurationSec = 3.5,
            Model = _model,
            Words = new[]
            {
                new SttWord { Word = "привет", Start = 0.0, End = 0.6, Accuracy = 95 },
                new SttWord { Word = "как", Start = 0.6, End = 0.9, Accuracy = 92 },
                new SttWord { Word = "дела", Start = 0.9, End = 1.4, Accuracy = 90 },
            },
            Pronunciation = _pronScore is null
                ? null
                : new SttPronunciation
                {
                    Accuracy = 90,
                    Fluency = 88,
                    Completeness = 100,
                    Prosody = 85,
                    Pronunciation = _pronScore,
                    ReferenceMatch = match,
                },
        };
        return Task.FromResult(result);
    }
}
