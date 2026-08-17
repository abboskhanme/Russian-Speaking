using Govori.Platform.Ai.Backends;
using Govori.Platform.Grader;
using Govori.Platform.Stt;
using Microsoft.Extensions.DependencyInjection;

namespace Govori.Platform.Ai;

/// <summary>
/// Registers the AI provider chain — the vendor backends plus the two chain providers the
/// Assessment pipeline consumes (docs/08 Faza 3.4).
///
/// <para><b>Why this is one extension and not two copies of the same block.</b> The API and the
/// Worker both grade. If their registrations are hand-maintained in two files, they will drift —
/// and the way that drift presents is the worst possible one: a submission graded by the API and
/// the same submission graded by the Worker take different providers, produce different scores, and
/// nothing in either process looks wrong. One method, called twice, makes the two hosts identical
/// by construction.</para>
///
/// <para><b>What this deliberately does NOT register:</b> <see cref="IAiConfigSource"/>. Its
/// implementation reads <c>app_settings</c> and therefore lives in <c>Govori.Administration</c>;
/// Platform must not depend on a domain module (ArchTests rule 1). Each composition root supplies
/// it. Resolving a chain provider without one is a startup failure, which is the correct outcome —
/// a silent fallback to environment-only configuration would mean the admin panel edits nothing.</para>
/// </summary>
public static class AiRegistration
{
    /// <summary>Wire the grader + STT chains and every vendor backend behind them.</summary>
    public static IServiceCollection AddGovoriAi(this IServiceCollection services)
    {
        // One named HttpClient per vendor. Named rather than shared because the handlers have
        // genuinely different characteristics — an audio upload is not a chat completion — and
        // because a pooled client per vendor is what keeps a busy worker from exhausting sockets.
        // The backends set their own timeouts on the resolved client.
        services.AddHttpClient(AnthropicGraderBackend.HttpClientName);
        services.AddHttpClient(GeminiGraderBackend.HttpClientName);
        services.AddHttpClient(OpenAiGraderBackend.HttpClientName);
        services.AddHttpClient(AzureSpeechSttBackend.HttpClientName);
        services.AddHttpClient(WhisperSttBackend.HttpClientName);

        // Backends are stateless — configuration arrives per call as an AiRuntimeConfig snapshot —
        // so a singleton each is correct and avoids rebuilding the object graph per submission.
        //
        // REGISTRATION ORDER IS NOT THE CHAIN ORDER. The chain reads its order from app_settings at
        // request time; these are just the implementations it may choose from. Adding one here does
        // not put it in the chain, and that separation is the point: a backend can ship before
        // anyone decides to route traffic to it.
        services.AddSingleton<IGraderBackend, AnthropicGraderBackend>();
        services.AddSingleton<IGraderBackend, GeminiGraderBackend>();
        services.AddSingleton<IGraderBackend, OpenAiGraderBackend>();
        services.AddSingleton<ISttBackend, AzureSpeechSttBackend>();
        services.AddSingleton<ISttBackend, WhisperSttBackend>();

        // The chain providers are SCOPED, not singletons: they resolve IAiConfigSource, which reads
        // through the scoped DbContext. A singleton here would capture the first request's
        // DbContext and use it for the lifetime of the process — the classic captive-dependency
        // bug, and one that only shows up under concurrency.
        services.AddScoped<IGraderProvider, ChainGraderProvider>();
        services.AddScoped<ISttProvider, ChainSttProvider>();

        return services;
    }
}
