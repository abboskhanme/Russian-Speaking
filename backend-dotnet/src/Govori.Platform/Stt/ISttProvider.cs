namespace Govori.Platform.Stt;

/// <summary>
/// Speech-to-text provider abstraction (docs/07 §7.7, Faza 3.4). Turns audio bytes into an
/// acoustically FAITHFUL Russian transcript (never auto-corrected — the transcript must record
/// what the student actually said) plus, when the backend can, a pronunciation assessment and
/// per-word timings.
///
/// <para>PURE INFRASTRUCTURE — no domain types. Real backends (Azure AI Speech, OpenAI Whisper)
/// live behind this seam; the grading pipeline (<c>Govori.Assessment</c>) depends only on the
/// interface, and integration tests swap in <see cref="FakeSttProvider"/>.</para>
///
/// <para><see cref="IsConfiguredAsync"/> is the guard: a provider with no key reports
/// <c>false</c>, so the pipeline can DEFER (leave the attempt pending for a durable worker) instead
/// of failing it. Never transcribe on an unconfigured provider — a missing key must not burn the
/// student's attempt.</para>
/// </summary>
public interface ISttProvider
{
    /// <summary>True when this provider can actually transcribe (a key/endpoint is wired).
    ///
    /// <para>Asynchronous because configuration lives in <c>app_settings</c>, not only in the
    /// environment: an admin pastes a key and the very next submission must see it. A synchronous
    /// property could only ever report what was true at start-up.</para></summary>
    ValueTask<bool> IsConfiguredAsync(CancellationToken ct = default);

    /// <summary>
    /// Transcribe Russian audio → <see cref="SttResult"/> (text, language, word timings, optional
    /// pronunciation, model, duration). <paramref name="referenceText"/> is the shadowing target,
    /// honoured by Azure (still recognised UNSCRIPTED — compared in our own code) and ignored by
    /// Whisper.
    /// </summary>
    Task<SttResult> TranscribeAsync(
        byte[] audio, string filename, string? referenceText, CancellationToken ct = default);
}
