namespace Govori.Platform.Stt;

/// <summary>
/// Speech-to-text provider abstraction (docs/07 §7.7, Faza 3.4). A faithful port of the
/// <c>transcribe()</c> contract in <c>backend/app/services/stt.py</c>: turn audio bytes into an
/// acoustically FAITHFUL Russian transcript (never auto-corrected — memory: "transcript must stay
/// faithful") plus, when the backend can, a pronunciation assessment and per-word timings.
///
/// <para>PURE INFRASTRUCTURE — no domain types. Real backends (Azure AI Speech, OpenAI Whisper)
/// live behind this seam; the grading pipeline (<c>Govori.Assessment</c>) depends only on the
/// interface, and integration tests swap in <see cref="FakeSttProvider"/>.</para>
///
/// <para><see cref="IsConfigured"/> is the guard: a real provider with no key reports
/// <c>false</c>, so the pipeline can DEFER (leave the attempt pending for a durable worker) instead
/// of failing it — mirroring today's Python, where <c>_provider()</c> raises when no key is set.</para>
/// </summary>
public interface ISttProvider
{
    /// <summary>True when this provider can actually transcribe (a key/endpoint is wired). A real
    /// TODO-stub provider reports <c>false</c> until keys land; the fake reports <c>true</c>.</summary>
    bool IsConfigured { get; }

    /// <summary>
    /// Transcribe Russian audio → <see cref="SttResult"/> (text, language, word timings, optional
    /// pronunciation, model, duration). <paramref name="referenceText"/> is the shadowing target,
    /// honoured by Azure (still recognised UNSCRIPTED — compared in our own code) and ignored by
    /// Whisper. Mirrors <c>stt.transcribe(audio, filename, reference_text)</c>.
    /// </summary>
    Task<SttResult> TranscribeAsync(
        byte[] audio, string filename, string? referenceText, CancellationToken ct = default);
}
