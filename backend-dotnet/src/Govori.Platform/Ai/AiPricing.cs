namespace Govori.Platform.Ai;

/// <summary>
/// Unit prices, in US dollars, used to ESTIMATE what one vendor call cost. Every field is
/// configurable (env var → <c>app_settings</c> override, see <c>AppSettingsService</c>); the
/// defaults are list prices for the default model of each backend as of 2026-10 and must be
/// checked against the real invoices — the ledger is only as honest as these numbers.
///
/// <para><b>Per provider, not per model.</b> An admin can pin a different model without a deploy,
/// and a price table keyed by model id would silently price an unknown model at zero. One price per
/// backend means a model change is a price the operator must update — written down in
/// docs/ASSUMPTIONS.md — rather than a hole in the ceiling.</para>
/// </summary>
public sealed record AiPriceTable
{
    /// <summary>Azure AI Speech, real-time STT (with pronunciation assessment), per audio hour.</summary>
    public decimal AzureSttPerHour { get; init; } = 1.00m;

    /// <summary>OpenAI Whisper transcription, per audio minute.</summary>
    public decimal WhisperPerMinute { get; init; } = 0.006m;

    /// <summary>Anthropic (default model claude-opus-5): input / output, per million tokens.</summary>
    public decimal AnthropicInputPerMTok { get; init; } = 5m;
    public decimal AnthropicOutputPerMTok { get; init; } = 25m;

    /// <summary>Google Gemini (default model gemini-3.1-flash-lite), per million tokens. Set
    /// deliberately above the 2.5 Flash-Lite list price ($0.10/$0.40) because the 3.1 price was not
    /// verified — over-estimating closes the cap early, under-estimating overspends.</summary>
    public decimal GeminiInputPerMTok { get; init; } = 0.25m;
    public decimal GeminiOutputPerMTok { get; init; } = 1.50m;

    /// <summary>OpenAI / Azure OpenAI grader (default model gpt-4o-mini), per million tokens.</summary>
    public decimal OpenAiInputPerMTok { get; init; } = 0.15m;
    public decimal OpenAiOutputPerMTok { get; init; } = 0.60m;
}

/// <summary>
/// Turns one vendor call into an estimated dollar cost. Pure and static so the arithmetic is
/// unit-tested without a vendor, a database or a clock.
///
/// <para><b>STT</b> is priced per audio second (Azure bills per second, Whisper per second rounded
/// up to the minute's fraction). The seconds are, in order of preference: the exact length of a
/// PCM WAV upload; the duration the vendor reported; a byte-length estimate that assumes a LOW
/// bitrate (32 kbit/s, i.e. it over-counts compressed browser audio rather than under-counting it).
/// Rounded up to whole seconds, minimum one.</para>
///
/// <para><b>Grader</b> calls are priced per token when the vendor reported usage (all three do on a
/// successful call; thinking/reasoning tokens are counted as output, as they are billed). When it did
/// not — the call failed, timed out or was refused — the call is charged a FLAT assumed size
/// (<see cref="AssumedInputTokens"/> in / <see cref="AssumedOutputTokens"/> out): a failed call is
/// usually still billed for its input, and charging nothing would let a retry storm against a
/// failing vendor spend money the ledger never sees.</para>
/// </summary>
public static class AiCostEstimator
{
    /// <summary>Rubric + prompt + transcript of a typical grading request.</summary>
    public const long AssumedInputTokens = 3_000;

    /// <summary>The JSON verdict plus some reasoning. Deliberately generous.</summary>
    public const long AssumedOutputTokens = 1_500;

    /// <summary>Compressed-audio bitrate assumed when nothing better is known: 32 kbit/s.</summary>
    public const int AssumedBytesPerSecond = 4_000;

    /// <summary>Upper bound on a single estimated recording (10 min) so one corrupt upload cannot
    /// close the daily cap on its own.</summary>
    public const double MaxEstimatedSeconds = 600;

    /// <summary>Cost of one transcription of <paramref name="seconds"/> of audio.</summary>
    public static decimal Stt(string provider, double seconds, AiPriceTable prices)
    {
        var billed = (decimal)Math.Max(1, Math.Ceiling(seconds));
        var perSecond = provider switch
        {
            AiProviders.AzureSpeech => prices.AzureSttPerHour / 3600m,
            AiProviders.Whisper => prices.WhisperPerMinute / 60m,
            // A backend this table does not know is charged the dearest known rate, never zero.
            _ => Math.Max(prices.AzureSttPerHour / 3600m, prices.WhisperPerMinute / 60m),
        };
        return billed * perSecond;
    }

    /// <summary>Cost of one grader call. <paramref name="inputTokens"/>/<paramref name="outputTokens"/>
    /// null ⇒ the vendor reported no usage ⇒ the flat assumed size is charged.</summary>
    public static (decimal Cost, long Input, long Output) Grader(
        string provider, long? inputTokens, long? outputTokens, AiPriceTable prices)
    {
        var input = inputTokens ?? AssumedInputTokens;
        var output = outputTokens ?? AssumedOutputTokens;
        var (inPrice, outPrice) = provider switch
        {
            AiProviders.Anthropic => (prices.AnthropicInputPerMTok, prices.AnthropicOutputPerMTok),
            AiProviders.Gemini => (prices.GeminiInputPerMTok, prices.GeminiOutputPerMTok),
            AiProviders.OpenAi => (prices.OpenAiInputPerMTok, prices.OpenAiOutputPerMTok),
            _ => (Math.Max(prices.AnthropicInputPerMTok, Math.Max(prices.GeminiInputPerMTok, prices.OpenAiInputPerMTok)),
                  Math.Max(prices.AnthropicOutputPerMTok, Math.Max(prices.GeminiOutputPerMTok, prices.OpenAiOutputPerMTok))),
        };
        var cost = (input * inPrice + output * outPrice) / 1_000_000m;
        return (cost, input, output);
    }

    /// <summary>
    /// How many seconds of audio a transcription is billed for. A PCM WAV is measured exactly from
    /// its header; otherwise the vendor-reported duration wins; otherwise the bytes are converted at
    /// <see cref="AssumedBytesPerSecond"/>. Never below one second, never above
    /// <see cref="MaxEstimatedSeconds"/> for an estimate.
    /// </summary>
    public static double AudioSeconds(byte[] audio, double? reported)
    {
        if (WavSeconds(audio) is { } exact)
            return Math.Max(1, exact);
        if (reported is > 0)
            return reported.Value;
        return Math.Clamp((double)audio.Length / AssumedBytesPerSecond, 1, MaxEstimatedSeconds);
    }

    // RIFF/WAVE with a fmt chunk: seconds = data bytes / byte rate. Anything else → null.
    private static double? WavSeconds(byte[] audio)
    {
        if (audio.Length < 44
            || audio[0] != 'R' || audio[1] != 'I' || audio[2] != 'F' || audio[3] != 'F'
            || audio[8] != 'W' || audio[9] != 'A' || audio[10] != 'V' || audio[11] != 'E')
            return null;

        var byteRate = System.Buffers.Binary.BinaryPrimitives.ReadInt32LittleEndian(audio.AsSpan(28, 4));
        if (byteRate <= 0)
            return null;
        return Math.Min((double)(audio.Length - 44) / byteRate, MaxEstimatedSeconds);
    }
}
