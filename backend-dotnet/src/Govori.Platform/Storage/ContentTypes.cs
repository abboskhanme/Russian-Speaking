namespace Govori.Platform.Storage;

/// <summary>
/// Reduces a client-supplied Content-Type to its bare media type — <c>type/subtype</c>, lower-case,
/// no parameters (the WHATWG spec calls this the MIME type's "essence").
///
/// <para><b>Why the storage layer cares.</b> Chrome and Android record with MediaRecorder, whose
/// type is <c>audio/webm;codecs=opus</c>, and the browser sends that verbatim. Passed through to
/// <c>PutObject</c> as-is, the signature AWSSDK.S3 computes over that header is not the one MinIO
/// computes, and MinIO answers "The request signature we calculated does not match" — so EVERY answer from
/// those browsers failed at <c>POST /api/submissions</c> with a 500 (verified in isolation:
/// <c>audio/webm;codecs=opus</c> fails, while <c>audio/webm</c> and even
/// <c>audio/webm; codecs=opus</c> succeed). Nothing downstream needs the parameters: the audio is
/// decoded by sniffing its header, never by trusting this string. So <see cref="MinioObjectStorage"/>
/// stores the essence for every caller, and the modules that derive a file extension or check an
/// allow-list compare the essence too, so both spellings are accepted everywhere.</para>
/// </summary>
public static class ContentTypes
{
    /// <summary>What an absent or unusable Content-Type is stored as — S3's own neutral default.</summary>
    public const string Fallback = "application/octet-stream";

    /// <summary>
    /// <c>"Audio/WebM;codecs=opus"</c> → <c>"audio/webm"</c>. Everything from the first <c>;</c> is
    /// dropped, the rest trimmed and lower-cased; null, blank or parameters-only input becomes
    /// <see cref="Fallback"/>.
    /// </summary>
    public static string Essence(string? contentType)
    {
        if (string.IsNullOrWhiteSpace(contentType))
            return Fallback;

        var semicolon = contentType.IndexOf(';');
        var bare = (semicolon >= 0 ? contentType[..semicolon] : contentType).Trim().ToLowerInvariant();
        return bare.Length == 0 ? Fallback : bare;
    }
}
