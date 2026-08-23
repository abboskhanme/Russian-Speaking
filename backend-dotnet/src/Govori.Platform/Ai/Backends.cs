using Govori.Platform.Grader;
using Govori.Platform.Stt;

namespace Govori.Platform.Ai;

/// <summary>
/// One concrete grader vendor (Claude, Gemini, OpenAI). Distinct from <see cref="IGraderProvider"/>,
/// which is what the Assessment pipeline consumes: the pipeline sees ONE grader, and the chain
/// decides which backend actually answers.
///
/// <para>Backends are stateless and take the configuration as an argument rather than capturing it,
/// so a key pasted into the admin panel takes effect on the next submission — no restart, and no
/// per-request object graph to rebuild.</para>
/// </summary>
public interface IGraderBackend
{
    /// <summary>Wire name, matching an <see cref="AiProviders"/> constant.</summary>
    string Name { get; }

    /// <summary>Whether this backend has what it needs to run. Checked before every attempt, because
    /// a backend that cannot run must be SKIPPED silently rather than counted as a failure — an
    /// unconfigured Claude sitting first in the chain should cost nothing.</summary>
    bool IsConfigured(AiRuntimeConfig config);

    /// <summary>Grade one transcript. Throws on failure; the chain catches and moves on.</summary>
    Task<GraderResult> AnalyzeAsync(GraderRequest request, AiRuntimeConfig config, CancellationToken ct);
}

/// <summary>One concrete STT vendor (Azure AI Speech, OpenAI Whisper). Mirrors
/// <see cref="IGraderBackend"/> exactly; see it for the design notes.</summary>
public interface ISttBackend
{
    string Name { get; }

    bool IsConfigured(AiRuntimeConfig config);

    /// <summary><paramref name="mode"/> is LAST and defaults to
    /// <see cref="SttRecognitionMode.Unscripted"/> so that a call site which says nothing about it
    /// gets the faithful behaviour — see the enum for why this is deliberately not derived from
    /// <paramref name="referenceText"/>.</summary>
    Task<SttResult> TranscribeAsync(
        byte[] audio, string filename, string? referenceText, AiRuntimeConfig config, CancellationToken ct,
        SttRecognitionMode mode = SttRecognitionMode.Unscripted);
}
