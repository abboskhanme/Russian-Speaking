namespace Govori.Guest.Tts;

/// <summary>
/// TODO(Faza 3.4 — real Azure AI Speech TTS): faithful port of <c>tts.synthesize</c>
/// (backend/app/services/tts.py). Must synthesize with the <c>ru-RU-SvetlanaNeural</c> voice at
/// 16 kHz mono MP3 and cap input at <see cref="Govori.Guest.GuestPhrases.MaxTtsChars"/>. Not wired
/// here: there is no <c>AZURE_SPEECH_KEY</c> in this environment (same key/region as STT).
///
/// <para>Until a key is provisioned this reports <see cref="IsConfigured"/> = <c>false</c> and
/// <see cref="SynthesizeAsync"/> throws — the guest TTS endpoint catches that and returns 503,
/// mirroring Python where <c>tts.synthesize</c> raises <c>RuntimeError</c> with no key (tts.py:20)
/// and the route answers 503 "TTS unavailable" (guest.py:140-141).</para>
/// </summary>
public sealed class AzureTtsProvider : ITtsProvider
{
    public bool IsConfigured => false;

    public Task<byte[]> SynthesizeAsync(string text, CancellationToken ct = default)
        => throw new NotImplementedException(
            "Azure TTS is not wired yet (Faza 3.4). Port tts.synthesize: ru-RU-SvetlanaNeural, " +
            "16 kHz mono MP3, MAX_TTS_CHARS cap. Needs AZURE_SPEECH_KEY.");
}
