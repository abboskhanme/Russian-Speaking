using Govori.Contracts;
using Govori.Infrastructure;
using Govori.Infrastructure.Entities;
using Govori.Platform.Ai;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;

namespace Govori.Administration;

/// <summary>
/// Runtime-editable app settings, backed by the DB with env-var fallback (docs/07 §3.7).
/// Resolution order for every key:
/// <code>DB override (app_settings) → env default (IConfiguration) → caller default</code>
///
/// <para><b>THE TRI-STATE (the subtle part).</b> A write distinguishes three states of the incoming
/// value, NOT two:</para>
/// <list type="bullet">
///   <item><c>null</c> → leave the key <b>unchanged</b> (used to keep an existing secret when the
///   admin didn't retype it);</item>
///   <item><c>""</c> → <b>clear</b> the override (delete the row) so the key reverts to its env
///   default;</item>
///   <item>any other string → <b>store</b> it (upsert the row).</item>
/// </list>
/// A naïve two-state implementation would merge <c>null</c> and <c>""</c> (both "no value") and
/// silently wipe a secret the admin meant to keep — that is the bug this design avoids. See
/// <see cref="SetManyAsync"/>.
///
/// <para><b>THE ~30s CACHE.</b> Reads go through <see cref="IAppSettingsCache"/> — the whole
/// override map is loaded once and reused for ~30s because the grader resolves config on every
/// submission. The cache is process-local, so every write MUST
/// <see cref="IAppSettingsCache.Invalidate">invalidate</see> it or the next read serves the
/// pre-write values for the rest of the TTL.</para>
///
/// <para>Reads reload with <c>AsNoTracking</c>: they must observe committed DB state, never a stale
/// instance held by the change tracker from earlier in the same request.</para>
/// </summary>
public sealed class AppSettingsService
{
    private readonly GovoriDbContext _db;
    private readonly IAppSettingsCache _cache;
    private readonly IConfiguration _config;

    public AppSettingsService(GovoriDbContext db, IAppSettingsCache cache, IConfiguration config)
    {
        _db = db;
        _cache = cache;
        _config = config;
    }

    // key → (env-var name used as the default, is_secret). The env-var names are the uppercase
    // form of the setting key and are read straight from IConfiguration. A key absent from this
    // map is unknown: it has no env default and SetManyAsync silently ignores writes to it.
    private static readonly IReadOnlyDictionary<string, (string EnvVar, bool Secret)> Spec =
        new Dictionary<string, (string, bool)>
        {
            ["llm_provider"] = ("LLM_PROVIDER", false),
            ["gemini_api_key"] = ("GEMINI_API_KEY", true),
            ["gemini_model"] = ("GEMINI_MODEL", false),
            ["orthoepy_enabled"] = ("ORTHOEPY_ENABLED", false),
            ["azure_openai_endpoint"] = ("AZURE_OPENAI_ENDPOINT", false),
            ["azure_openai_api_key"] = ("AZURE_OPENAI_API_KEY", true),
            ["azure_openai_deployment"] = ("AZURE_OPENAI_DEPLOYMENT", false),
            ["azure_openai_api_version"] = ("AZURE_OPENAI_API_VERSION", false),
            ["stt_provider"] = ("STT_PROVIDER", false),
            ["azure_speech_key"] = ("AZURE_SPEECH_KEY", true),
            ["azure_speech_region"] = ("AZURE_SPEECH_REGION", false),
            ["openai_api_key"] = ("OPENAI_API_KEY", true),
            ["whisper_model"] = ("WHISPER_MODEL", false),
            ["openai_grader_model"] = ("OPENAI_GRADER_MODEL", false),
            // Faza 6 feature switches. They are read at runtime by the modules that own them
            // (Engagement, Practice) straight off app_settings — but a key absent from Spec is
            // silently DROPPED on write, so without these four rows the admin panel could display
            // a toggle that saves nothing.
            ["review_drill_enabled"] = ("REVIEW_DRILL_ENABLED", false),
            ["roleplay_enabled"] = ("ROLEPLAY_ENABLED", false),
            ["roleplay_max_turns"] = ("ROLEPLAY_MAX_TURNS", false),
            ["roleplay_daily_turns"] = ("ROLEPLAY_DAILY_TURNS", false),
            ["tg_support_url"] = ("TG_SUPPORT_URL", false),
            ["tg_channel_url"] = ("TG_CHANNEL_URL", false),
            // Ordered-chain routing + the Anthropic backend. These four MUST be listed here
            // before anything can write them: SetManyAsync silently skips keys it does not
            // find in this map, so a chain the admin edits would appear to save and then
            // vanish on the next read.
            ["grader_chain"] = ("GRADER_CHAIN", false),
            ["stt_chain"] = ("STT_CHAIN", false),
            ["anthropic_api_key"] = ("ANTHROPIC_API_KEY", true),
            ["anthropic_model"] = ("ANTHROPIC_MODEL", false),
        };

    /// <summary>The secret keys. The reveal endpoint accepts ONLY these, so a non-secret setting
    /// can never be dumped through it.</summary>
    public static readonly IReadOnlySet<string> SecretKeys =
        Spec.Where(kv => kv.Value.Secret).Select(kv => kv.Key).ToHashSet();

    // Curated Gemini models for the admin dropdown. Ordered best-first.
    private static readonly IReadOnlyList<KnownModel> KnownModels = new List<KnownModel>
    {
        new("gemini-3.1-flash-lite", "Gemini 3.1 Flash Lite (recommended)",
            "Fast and cheap; ~500 requests/day on the free tier."),
        new("gemini-2.5-flash-lite", "Gemini 2.5 Flash Lite",
            "Light and quick; generous free-tier limits."),
        new("gemini-2.5-flash", "Gemini 2.5 Flash (avoid on free tier)",
            "Higher quality but only ~20 requests/day free — exhausts quickly."),
        new("gemini-2.0-flash", "Gemini 2.0 Flash",
            "Previous-gen flash; solid free-tier limits."),
        new("gemini-1.5-flash", "Gemini 1.5 Flash",
            "Legacy fallback; widely available."),
    };

    // Curated Anthropic (Claude) models for the admin dropdown. Ordered best-first, same as the
    // Gemini list. These ids are complete as written — Anthropic model ids carry no date suffix,
    // and appending one produces a 404 at request time rather than a validation error here.
    private static readonly IReadOnlyList<KnownModel> KnownAnthropicModels = new List<KnownModel>
    {
        new("claude-opus-5", "Claude Opus 5 (tavsiya etiladi)",
            "Eng kuchli baholash sifati; 1M token uchun $5/$25."),
        new("claude-sonnet-5", "Claude Sonnet 5",
            "Opusga yaqin sifat, arzonroq; $3/$15."),
        new("claude-haiku-4-5", "Claude Haiku 4.5",
            "Eng tez va arzon; $1/$5."),
    };

    // Accepted truthy spellings for boolean-ish settings; anything else counts as false.
    private static readonly HashSet<string> TrueWords = new(StringComparer.Ordinal) { "true", "1", "yes", "on" };

    // ─── Read primitives ────────────────────────────────────────────────────

    // The env default for a key — "" when the key is unmapped or the variable is unset.
    private string EnvDefault(string key)
        => Spec.TryGetValue(key, out var s) && !string.IsNullOrEmpty(s.EnvVar)
            ? _config[s.EnvVar] ?? string.Empty
            : string.Empty;

    // All DB overrides, cached for the TTL. On a miss, load the whole table fresh (AsNoTracking)
    // and cache it — one query serves every key the caller will resolve.
    private async Task<IReadOnlyDictionary<string, string?>> OverridesAsync(CancellationToken ct)
    {
        if (_cache.TryGet(out var cached))
            return cached;

        var map = await _db.AppSettings
            .AsNoTracking()
            .ToDictionaryAsync(r => r.Key, r => r.Value, ct);
        _cache.Set(map);
        return map;
    }

    /// <summary>Resolved value for <paramref name="key"/>: DB override → env default →
    /// <paramref name="def"/>. An override wins only when it is non-empty, so a stored NULL or ""
    /// falls through to the env default rather than blanking the setting.</summary>
    public async Task<string> GetAsync(string key, string def = "", CancellationToken ct = default)
    {
        var overrides = await OverridesAsync(ct);
        overrides.TryGetValue(key, out var ov);
        if (!string.IsNullOrEmpty(ov))       // null and "" both fall through to the env default
            return ov!;
        var env = EnvDefault(key);
        return !string.IsNullOrEmpty(env) ? env : def;
    }

    // ─── Write — THE TRI-STATE ──────────────────────────────────────────────

    /// <summary>
    /// Upsert overrides from an admin edit. Per key: <c>null</c> → leave unchanged; <c>""</c> →
    /// delete the row (revert to the env default); any other string → upsert. Unknown keys are
    /// ignored. MUST invalidate the cache afterwards, or the edit stays invisible for the TTL.
    /// </summary>
    public async Task SetManyAsync(IReadOnlyDictionary<string, string?> values, CancellationToken ct = default)
    {
        var now = DateTime.UtcNow;
        foreach (var (key, val) in values)
        {
            if (val is null || !Spec.TryGetValue(key, out var spec))
                continue;                                    // null → unchanged; unknown → skip

            var row = await _db.AppSettings.FindAsync(new object?[] { key }, ct);
            if (val.Length == 0)                             // "" → clear the override
            {
                if (row is not null)
                    _db.AppSettings.Remove(row);
            }
            else if (row is null)
            {
                _db.AppSettings.Add(new AppSetting
                {
                    Key = key,
                    Value = val,
                    IsSecret = spec.Secret,
                    CreatedAt = now,
                    UpdatedAt = now,
                });
            }
            else
            {
                row.Value = val;
                row.UpdatedAt = now;
            }
        }
        await _db.SaveChangesAsync(ct);
        _cache.Invalidate();                                 // required: the cache is process-local
    }

    // ─── Derived read models ────────────────────────────────────────────────

    /// <summary>Whether the best-effort orthoepy audio pass runs. Defaults to ON — it is disabled
    /// only when an admin has explicitly stored a falsey value.</summary>
    public async Task<bool> OrthoepyEnabledAsync(CancellationToken ct = default)
        => TrueWords.Contains((await GetAsync("orthoepy_enabled", "true", ct)).Trim().ToLowerInvariant());

    /// <summary>Resolved outbound links shown in the sidebar contact menu.</summary>
    public async Task<LinksResponse> ResolveLinksAsync(CancellationToken ct = default)
        => new(await GetAsync("tg_support_url", ct: ct), await GetAsync("tg_channel_url", ct: ct));

    // A secret is NEVER returned in full here: only "is it set" plus its last 4 characters, enough
    // for an admin to recognise which key is configured without exposing it.
    private static SecretState Secret(string val)
        => new(!string.IsNullOrEmpty(val),
               string.IsNullOrEmpty(val) ? string.Empty : (val.Length <= 4 ? val : val[^4..]));

    // Which backends could serve a request RIGHT NOW, in the default chain order. One helper, so
    // the "openai counts when either the public key or all three Azure fields are set" rule is
    // written once instead of being re-derived at each of the three call sites that need it.
    //
    // This is the DISPLAY of a fact the runtime owns: AiConfigSource plus each backend's own
    // IsConfigured decide what actually runs. Nothing routes on the lists below — they exist so the
    // panel can tell an admin that a backend they selected will be skipped every time.
    private static (IReadOnlyList<string> Grader, IReadOnlyList<string> Stt) ReadyBackends(
        bool anthropicKey, bool geminiKey, bool openAiKey, bool azureOpenAiReady, bool azureSpeechReady)
    {
        var grader = new List<string>(3);
        if (anthropicKey) grader.Add(AiProviders.Anthropic);
        if (geminiKey) grader.Add(AiProviders.Gemini);
        if (openAiKey || azureOpenAiReady) grader.Add(AiProviders.OpenAi);

        var stt = new List<string>(2);
        if (azureSpeechReady) stt.Add(AiProviders.AzureSpeech);
        if (openAiKey) stt.Add(AiProviders.Whisper);   // Whisper is an OpenAI endpoint: same key

        return (grader, stt);
    }

    /// <summary>The admin AI/STT read model: resolved provider settings plus the derived
    /// "ready"/"active provider" flags. Every secret is masked to its last 4 characters.</summary>
    public async Task<AiSettingsResponse> GetAiSettingsAsync(CancellationToken ct = default)
    {
        var llmProvider = await GetAsync("llm_provider", ct: ct);
        var provider = string.IsNullOrEmpty(llmProvider) ? "auto" : llmProvider;

        var geminiKey = Secret(await GetAsync("gemini_api_key", ct: ct));
        var azureKey = Secret(await GetAsync("azure_openai_api_key", ct: ct));
        var azureEndpoint = await GetAsync("azure_openai_endpoint", ct: ct);
        var azureDeployment = await GetAsync("azure_openai_deployment", ct: ct);
        var azureReady = !string.IsNullOrEmpty(azureEndpoint) && azureKey.Set && !string.IsNullOrEmpty(azureDeployment);
        var active = azureReady && (provider is "azure" or "auto") ? "azure" : "gemini";

        var sttRaw = await GetAsync("stt_provider", ct: ct);
        var sttProvider = string.IsNullOrEmpty(sttRaw) ? "auto" : sttRaw;
        var speechKey = Secret(await GetAsync("azure_speech_key", ct: ct));
        var openaiKey = Secret(await GetAsync("openai_api_key", ct: ct));
        var azureSpeechRegion = await GetAsync("azure_speech_region", ct: ct);
        var azureSpeechReady = speechKey.Set && !string.IsNullOrEmpty(azureSpeechRegion);
        var sttActive = sttProvider is "azure" or "whisper"
            ? sttProvider
            : speechKey.Set ? "azure"
            : openaiKey.Set ? "whisper"
            : "none";

        var anthropicKey = Secret(await GetAsync("anthropic_api_key", ct: ct));
        var (readyGrader, readyStt) =
            ReadyBackends(anthropicKey.Set, geminiKey.Set, openaiKey.Set, azureReady, azureSpeechReady);

        // The chains are reported RESOLVED, not raw: an unset key means "the default order", and the
        // panel must show the order that will actually run rather than an empty field.
        var graderChain = AiProviders.ParseChain(
            await GetAsync("grader_chain", ct: ct), AiProviders.DefaultGraderChain);
        var sttChain = AiProviders.ParseChain(
            await GetAsync("stt_chain", ct: ct), AiProviders.DefaultSttChain);

        return new AiSettingsResponse(
            LlmProvider: provider,
            GeminiModel: await GetAsync("gemini_model", ct: ct),
            OrthoepyEnabled: await OrthoepyEnabledAsync(ct),
            KnownGeminiModels: KnownModels,
            AzureOpenaiEndpoint: azureEndpoint,
            AzureOpenaiDeployment: azureDeployment,
            AzureOpenaiApiVersion: await GetAsync("azure_openai_api_version", ct: ct),
            GeminiApiKey: geminiKey,
            AzureOpenaiApiKey: azureKey,
            AzureReady: azureReady,
            ActiveProvider: active,
            SttProvider: sttProvider,
            AzureSpeechRegion: azureSpeechRegion,
            WhisperModel: await GetAsync("whisper_model", ct: ct),
            AzureSpeechKey: speechKey,
            OpenaiApiKey: openaiKey,
            AzureSpeechReady: azureSpeechReady,
            SttActiveProvider: sttActive,
            GraderChain: string.Join(',', graderChain),
            SttChain: string.Join(',', sttChain),
            GraderBackends: AiProviders.DefaultGraderChain,
            SttBackends: AiProviders.DefaultSttChain,
            ReadyGraderBackends: readyGrader,
            ReadySttBackends: readyStt,
            AnthropicApiKey: anthropicKey,
            AnthropicModel: await GetAsync("anthropic_model", AiProviders.DefaultAnthropicModel, ct),
            KnownAnthropicModels: KnownAnthropicModels);
    }

    /// <summary>
    /// The Faza 6 feature switches as the admin panel should see them.
    ///
    /// <para>Defaults mirror the owning modules exactly — <b>both features OFF</b>, turn ceiling 8,
    /// daily budget 24. They are repeated here rather than imported because Administration must not
    /// reference Engagement or Practice (ArchTests rule 4); the cost of that boundary is this
    /// duplication, and the mitigation is that a drift shows up as a wrong number on screen rather
    /// than as wrong behaviour — the modules never read these values back.</para>
    /// </summary>
    public async Task<FeatureFlagsResponse> GetFeatureFlagsAsync(CancellationToken ct = default)
        => new(
            ReviewDrillEnabled: TrueWords.Contains((await GetAsync("review_drill_enabled", "false", ct)).Trim().ToLowerInvariant()),
            RoleplayEnabled: TrueWords.Contains((await GetAsync("roleplay_enabled", "false", ct)).Trim().ToLowerInvariant()),
            RoleplayMaxTurns: Clamp(await GetAsync("roleplay_max_turns", "", ct), 8, 1, 20),
            RoleplayDailyTurns: Clamp(await GetAsync("roleplay_daily_turns", "", ct), 24, 1, 500));

    // A malformed or out-of-range stored value falls back to the default rather than throwing: the
    // settings row is admin-editable text, and one bad character must not take the panel down.
    private static int Clamp(string raw, int fallback, int min, int max)
        => int.TryParse(raw, out var n) ? Math.Clamp(n, min, max) : fallback;
}
