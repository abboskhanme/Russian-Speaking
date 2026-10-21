namespace Govori.Platform.Ai;

/// <summary>
/// The AI configuration as it stands RIGHT NOW — one immutable snapshot, resolved per grading run
/// from <see cref="IAiConfigSource"/> (docs/07 §3.7: DB override → env default).
///
/// <para>It is a snapshot on purpose. An admin can change the provider order or paste a key while a
/// submission is mid-flight; taking one snapshot at the top of a run means every decision inside
/// that run — which backend is tried, which key it uses, which model name is recorded — comes from
/// a single consistent view, instead of a chain that starts on one provider and finishes on
/// another's key.</para>
///
/// <para>Every field is here rather than read ad hoc by each backend so that "what is the AI
/// configured to do" has exactly one answer, printable in one log line.</para>
/// </summary>
public sealed record AiRuntimeConfig
{
    /// <summary>Grader backends to try, in order. The first one that is configured AND succeeds
    /// serves the request; the rest are the fallback chain. An empty list disables grading.</summary>
    public IReadOnlyList<string> GraderChain { get; init; } = Array.Empty<string>();

    /// <summary>STT backends to try, in order. Same semantics as <see cref="GraderChain"/>.</summary>
    public IReadOnlyList<string> SttChain { get; init; } = Array.Empty<string>();

    // ─── Anthropic (Claude) ─────────────────────────────────────────────────
    public string? AnthropicApiKey { get; init; }
    public string AnthropicModel { get; init; } = AiProviders.DefaultAnthropicModel;

    // ─── Google Gemini ──────────────────────────────────────────────────────
    public string? GeminiApiKey { get; init; }
    public string GeminiModel { get; init; } = "gemini-3.1-flash-lite";

    // ─── OpenAI (and Azure OpenAI, which is the same wire format) ───────────
    public string? OpenAiApiKey { get; init; }
    public string OpenAiGraderModel { get; init; } = "gpt-4o-mini";

    /// <summary>Azure OpenAI is only "ready" with all three of endpoint + key + deployment; any one
    /// missing and the OpenAI backend uses the public api.openai.com route instead.</summary>
    public string? AzureOpenAiEndpoint { get; init; }
    public string? AzureOpenAiApiKey { get; init; }
    public string? AzureOpenAiDeployment { get; init; }
    public string AzureOpenAiApiVersion { get; init; } = "2024-10-21";

    // ─── Azure AI Speech (STT + pronunciation assessment) ───────────────────
    public string? AzureSpeechKey { get; init; }
    public string? AzureSpeechRegion { get; init; }

    // ─── OpenAI Whisper (STT fallback — transcribe only, no pronunciation) ──
    public string WhisperModel { get; init; } = "whisper-1";

    // ─── Cost estimation (the global AI budget, IAiBudget) ──────────────────
    /// <summary>Unit prices the chain uses to estimate each call's cost for the spend ledger. Part
    /// of the snapshot so a price change takes effect on the next run, like a key change does.</summary>
    public AiPriceTable Prices { get; init; } = new();

    /// <summary>True when Azure OpenAI can be addressed; see <see cref="AzureOpenAiEndpoint"/>.</summary>
    public bool AzureOpenAiReady =>
        !string.IsNullOrWhiteSpace(AzureOpenAiEndpoint)
        && !string.IsNullOrWhiteSpace(AzureOpenAiApiKey)
        && !string.IsNullOrWhiteSpace(AzureOpenAiDeployment);
}

/// <summary>
/// The backend names the chains are written in. They are wire values — they appear in
/// <c>app_settings</c> rows an admin has edited and in <c>evaluations.llm_model</c> history — so
/// renaming one silently changes what a stored configuration means. Add, don't rename.
/// </summary>
public static class AiProviders
{
    public const string Anthropic = "anthropic";
    public const string Gemini = "gemini";
    public const string OpenAi = "openai";
    public const string AzureSpeech = "azure";
    public const string Whisper = "whisper";

    /// <summary>Claude model used when no override is stored. Opus 5 is the current default for new
    /// work; the admin can pin a different one without a deploy.</summary>
    public const string DefaultAnthropicModel = "claude-opus-5";

    /// <summary>Order used when an admin has never set one. Claude first because it is the strongest
    /// at the judgement this app asks for; Gemini second because it is the cheapest that is good
    /// enough; OpenAI last as the one most likely to still answer when the other two are having a
    /// bad day. An unconfigured backend is skipped, so this default is safe with any subset of keys.</summary>
    public static readonly IReadOnlyList<string> DefaultGraderChain =
        new[] { Anthropic, Gemini, OpenAi };

    /// <summary>Azure first: it is the only STT backend that returns a pronunciation assessment, and
    /// pronunciation is a fifth of the score. Whisper transcribes but cannot assess, so falling back
    /// to it degrades the band to text-only rather than failing the attempt.</summary>
    public static readonly IReadOnlyList<string> DefaultSttChain =
        new[] { AzureSpeech, Whisper };

    /// <summary>Parses a stored chain ("anthropic,gemini") into names, dropping blanks and
    /// duplicates while KEEPING order. Returns <paramref name="fallback"/> for empty input, so a
    /// cleared setting means "the default", never "no providers at all".</summary>
    public static IReadOnlyList<string> ParseChain(string? stored, IReadOnlyList<string> fallback)
    {
        if (string.IsNullOrWhiteSpace(stored))
            return fallback;

        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var chain = stored
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(s => s.ToLowerInvariant())
            .Where(seen.Add)
            .ToArray();

        return chain.Length > 0 ? chain : fallback;
    }
}
