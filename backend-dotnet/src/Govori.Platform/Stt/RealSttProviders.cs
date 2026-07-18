namespace Govori.Platform.Stt;

/// <summary>
/// TODO(Faza 3.4 — real Azure AI Speech): faithful port of <c>stt._transcribe_azure</c>
/// (stt.py:221-328). Must recognise UNSCRIPTED (empty <c>reference_text</c>, miscue OFF — even for
/// shadowing), read <c>Lexical</c> not <c>Display</c>, run at Phoneme granularity + prosody, and
/// return the pronunciation aggregate + per-word timings. Not wired here: there is no
/// <c>AZURE_SPEECH_KEY</c> in this environment, and transcoding needs ffmpeg. Circuit breaker
/// (<c>azure_speech_breaker</c>) is one of the 5 deferred breakers.
///
/// <para>Until a key is provisioned this reports <see cref="IsConfigured"/> = <c>false</c>, so the
/// Assessment pipeline defers the attempt (leaves it pending) rather than failing it.</para>
/// </summary>
public sealed class AzureSttProvider : ISttProvider
{
    public bool IsConfigured => false;

    public Task<SttResult> TranscribeAsync(
        byte[] audio, string filename, string? referenceText, CancellationToken ct = default)
        => throw new NotImplementedException(
            "Azure STT is not wired yet (Faza 3.4). Port stt._transcribe_azure: UNSCRIPTED " +
            "recognition, Lexical transcript, Phoneme+prosody pronunciation. Needs AZURE_SPEECH_KEY.");
}

/// <summary>
/// TODO(Faza 3.4 — real OpenAI Whisper fallback): faithful port of <c>stt._transcribe_whisper</c>
/// (stt.py:335-376). Transcribes only — NO pronunciation assessment (<c>Pronunciation</c> stays
/// <c>null</c>, so the C5 blend degrades to text-only) — and ignores the reference text (no scripted
/// mode). Used when no Azure key is set. Not wired: no <c>OPENAI_API_KEY</c> here.
/// </summary>
public sealed class WhisperSttProvider : ISttProvider
{
    public bool IsConfigured => false;

    public Task<SttResult> TranscribeAsync(
        byte[] audio, string filename, string? referenceText, CancellationToken ct = default)
        => throw new NotImplementedException(
            "Whisper STT is not wired yet (Faza 3.4). Port stt._transcribe_whisper: transcribe-only, " +
            "pronunciation=null. Needs OPENAI_API_KEY.");
}
