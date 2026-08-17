using Govori.Platform.Ai;

namespace Govori.Administration;

/// <summary>
/// The <see cref="IAiConfigSource"/> implementation: a thin adapter over
/// <see cref="AppSettingsService"/> that answers "what is the AI configured to do right now".
///
/// <para><b>Why an adapter rather than direct reads.</b> Every field below could be read from the
/// DB by whoever needs it, and that is exactly the failure this type prevents: the tri-state write
/// rules and the ~30s read cache would then exist in as many copies as there are readers, and the
/// first one to drift would serve a grading run from stale or half-cleared settings. Routing all
/// reads through <see cref="AppSettingsService"/> keeps both in one place. It also keeps the
/// dependency arrow pointing the right way — <c>Govori.Platform</c> declares the seam and never
/// learns that <c>app_settings</c>, the DbContext, or this module exist.</para>
///
/// <para><b>Register this as SCOPED, never as a singleton.</b> It reads a scoped DbContext through
/// <see cref="AppSettingsService"/>; captured in a singleton it would pin one request's context for
/// the process lifetime. The cheapness the seam promises comes from the shared ~30s cache, not from
/// a long-lived instance, so there is nothing to gain by widening the lifetime.</para>
/// </summary>
public sealed class AiConfigSource : IAiConfigSource
{
    private readonly AppSettingsService _settings;

    public AiConfigSource(AppSettingsService settings) => _settings = settings;

    /// <summary>Builds one <see cref="AiRuntimeConfig"/> snapshot from the current settings. Nothing
    /// is cached here beyond what <see cref="AppSettingsService"/> already caches — a second cache
    /// layer would only widen the window in which a pasted key is invisible.</summary>
    public async Task<AiRuntimeConfig> GetAsync(CancellationToken ct = default)
    {
        // Model defaults come from the record's own initialisers, so an unset or cleared key
        // resolves to the model Platform declares rather than to "". An empty model name would
        // reach the vendor SDK and fail the run with a 400 that reads like an outage.
        var d = new AiRuntimeConfig();

        return new AiRuntimeConfig
        {
            GraderChain = AiProviders.ParseChain(
                await _settings.GetAsync("grader_chain", ct: ct), AiProviders.DefaultGraderChain),
            SttChain = AiProviders.ParseChain(
                await _settings.GetAsync("stt_chain", ct: ct), AiProviders.DefaultSttChain),

            AnthropicApiKey = Blank(await _settings.GetAsync("anthropic_api_key", ct: ct)),
            AnthropicModel = await _settings.GetAsync(
                "anthropic_model", AiProviders.DefaultAnthropicModel, ct),

            GeminiApiKey = Blank(await _settings.GetAsync("gemini_api_key", ct: ct)),
            GeminiModel = await _settings.GetAsync("gemini_model", d.GeminiModel, ct),

            OpenAiApiKey = Blank(await _settings.GetAsync("openai_api_key", ct: ct)),
            OpenAiGraderModel = await _settings.GetAsync(
                "openai_grader_model", d.OpenAiGraderModel, ct),

            AzureOpenAiEndpoint = Blank(await _settings.GetAsync("azure_openai_endpoint", ct: ct)),
            AzureOpenAiApiKey = Blank(await _settings.GetAsync("azure_openai_api_key", ct: ct)),
            AzureOpenAiDeployment = Blank(await _settings.GetAsync("azure_openai_deployment", ct: ct)),
            AzureOpenAiApiVersion = await _settings.GetAsync(
                "azure_openai_api_version", d.AzureOpenAiApiVersion, ct),

            AzureSpeechKey = Blank(await _settings.GetAsync("azure_speech_key", ct: ct)),
            AzureSpeechRegion = Blank(await _settings.GetAsync("azure_speech_region", ct: ct)),

            WhisperModel = await _settings.GetAsync("whisper_model", d.WhisperModel, ct),
        };
    }

    // An unset setting resolves to ""; the credential fields are nullable so that "absent" and
    // "present but empty" cannot be told apart downstream — a backend asking IsNullOrWhiteSpace
    // would treat them alike anyway, and null says what is meant.
    private static string? Blank(string value) => string.IsNullOrWhiteSpace(value) ? null : value;
}
