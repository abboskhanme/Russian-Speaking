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
    /// <summary>
    /// How long one transcription gets before the chain calls it dead and moves on.
    ///
    /// <para><b>Where the number comes from.</b> A measured end-to-end grade — Azure STT plus a
    /// Gemini grade, on real submitted audio — takes about 16 seconds in total. 45 s is therefore
    /// several times the whole pipeline's normal duration for just this one leg: comfortably past
    /// "slow today", nowhere near "hung". The value it replaces was not a decision at all but
    /// <c>HttpClient</c>'s 100-second default, which on a stalled vendor is indistinguishable from
    /// forever — long enough to hold a grading worker through both STT backends for over three
    /// minutes on a single attempt.</para>
    ///
    /// <para>Shorter than the grader's budget on purpose: transcription is one request/response over
    /// a few hundred kilobytes of audio, while a grader is generating tokens and legitimately thinks
    /// for longer. Giving both the same number would mean one of them is always the wrong one.</para>
    ///
    /// <para><b>A timeout here MUST reach the chain as a failure, not a cancellation.</b>
    /// <c>HttpClient</c> signals it with <c>TaskCanceledException</c>, which derives from
    /// <c>OperationCanceledException</c> — the type the chain rethrows without falling back. The
    /// chain distinguishes them by the caller's token (<c>when (ct.IsCancellationRequested)</c>),
    /// which is false for a timeout, so the fallback runs. That distinction is pinned by
    /// <c>ProviderChainTests.VendorTimeout_FallsThroughToTheNextBackend_*</c>; without it, a slow
    /// vendor would silently abort the student's attempt instead of failing over.</para>
    /// </summary>
    public static readonly TimeSpan SttTimeout = TimeSpan.FromSeconds(45);

    /// <summary>Wire the grader + STT chains and every vendor backend behind them.</summary>
    public static IServiceCollection AddGovoriAi(this IServiceCollection services)
    {
        // One named HttpClient per vendor. Named rather than shared because the handlers have
        // genuinely different characteristics — an audio upload is not a chat completion — and
        // because a pooled client per vendor is what keeps a busy worker from exhausting sockets.
        //
        // THE TIMEOUT IS SET HERE, not in the backends. It used to be the backend's job, and the
        // three graders did it while the two STT backends did not — so every transcription ran on
        // HttpClient's 100-second default, and a stalled vendor held a grading worker for that long
        // per attempt, twice over when the chain fell through to the second backend. The failure is
        // invisible in code review precisely because it is an ABSENT line; moving the decision to the
        // single place every backend is registered means a new backend cannot forget it.
        foreach (var grader in new[]
                 {
                     AnthropicGraderBackend.HttpClientName,
                     GeminiGraderBackend.HttpClientName,
                     OpenAiGraderBackend.HttpClientName,
                 })
        {
            services.AddHttpClient(grader, client => client.Timeout = GraderContract.VendorTimeout);
        }

        foreach (var stt in new[]
                 {
                     AzureSpeechSttBackend.HttpClientName,
                     WhisperSttBackend.HttpClientName,
                 })
        {
            services.AddHttpClient(stt, client => client.Timeout = SttTimeout);
        }

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
