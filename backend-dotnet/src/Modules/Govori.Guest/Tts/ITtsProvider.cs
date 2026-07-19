namespace Govori.Guest.Tts;

/// <summary>
/// Text-to-speech provider abstraction — a faithful port of <c>backend/app/services/tts.py</c>
/// (<c>synthesize()</c>): turn a short Russian phrase into MP3 bytes for the "hear the correct
/// pronunciation" button on the public guest demo.
///
/// <para>PURE INFRASTRUCTURE — no domain types. Only the Guest module consumes it today (the sole
/// TTS surface is the auth-less demo, guest.py:131). A real Azure backend lives behind this seam;
/// integration tests never need it (the TTS route is guarded by the demo-word allow-list before
/// ever calling a provider).</para>
///
/// <para><see cref="IsConfigured"/> mirrors STT's guard: a real provider with no Azure key reports
/// <c>false</c> and <see cref="SynthesizeAsync"/> throws, so the endpoint returns 503 — exactly as
/// Python raises <c>RuntimeError</c> when no key/region is set (tts.py:20).</para>
/// </summary>
public interface ITtsProvider
{
    /// <summary>True when this provider can actually synthesize (a key/region is wired).</summary>
    bool IsConfigured { get; }

    /// <summary>Synthesize <paramref name="text"/> to MP3 bytes (16 kHz mono, ru-RU voice). Throws
    /// on failure/misconfiguration — the caller maps that to 503. Mirrors <c>tts.synthesize</c>.</summary>
    Task<byte[]> SynthesizeAsync(string text, CancellationToken ct = default);
}
