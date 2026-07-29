namespace Govori.Guest.Tts;

/// <summary>
/// Text-to-speech provider abstraction: turn a short Russian phrase into MP3 bytes for the "hear
/// the correct pronunciation" button on the public guest demo.
///
/// <para>PURE INFRASTRUCTURE — no domain types. Only the Guest module consumes it today, since the
/// sole TTS surface is the auth-less demo. A real Azure backend lives behind this seam; integration
/// tests never need it (the TTS route is guarded by the demo-word allow-list before ever calling a
/// provider).</para>
///
/// <para><see cref="IsConfigured"/> follows the same guard as STT: with no Azure key a real provider
/// reports <c>false</c> and <see cref="SynthesizeAsync"/> throws, so the endpoint answers 503 rather
/// than failing opaquely. An unconfigured deployment therefore degrades to "no audio", never to a
/// 500.</para>
/// </summary>
public interface ITtsProvider
{
    /// <summary>True when this provider can actually synthesize (a key/region is wired).</summary>
    bool IsConfigured { get; }

    /// <summary>Synthesize <paramref name="text"/> to MP3 bytes (16 kHz mono, ru-RU voice). Throws
    /// on failure or misconfiguration — the caller maps that to 503.</summary>
    Task<byte[]> SynthesizeAsync(string text, CancellationToken ct = default);
}
