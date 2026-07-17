namespace Govori.Platform.Storage;

/// <summary>
/// S3-compatible object storage abstraction the domains depend on. Stores every student
/// audio recording (Practice, Assessment) plus media/avatars.
///
/// This is a faithful port of the Python storage service
/// (<c>backend/app/services/storage.py</c>). It is PURE INFRASTRUCTURE — it holds no
/// business rules: callers choose key prefixes, expiries, and content types.
/// </summary>
public interface IObjectStorage
{
    /// <summary>
    /// Generate a fresh, collision-free object key <c>{prefix}/{uuid-hex}.{ext}</c>.
    /// Mirrors Python <c>new_key</c> (storage.py:40-41). The prefix (e.g. "answers",
    /// "shadow") is the caller's choice — this method only supplies the random mechanism.
    /// </summary>
    string NewKey(string prefix, string ext);

    /// <summary>
    /// Server-side upload of a stream under <paramref name="key"/>. Returns the key.
    /// Mirrors Python <c>upload_bytes</c> (storage.py:65-69) — used by seeding/admin
    /// tasks, not the normal browser flow (that uses <see cref="GetUploadUrlAsync"/>).
    /// </summary>
    Task<string> PutAsync(string key, Stream content, string contentType, CancellationToken ct = default);

    /// <summary>
    /// Read an object's bytes server-side (from inside the Docker network).
    /// Mirrors Python <c>download_bytes</c> (storage.py:60-62) — used by the grading
    /// worker to fetch the audio for STT.
    /// </summary>
    Task<byte[]> GetBytesAsync(string key, CancellationToken ct = default);

    /// <summary>
    /// Presigned PUT URL for a direct browser upload, signed for the PUBLIC host.
    /// Mirrors Python <c>presigned_put</c> (storage.py:44-49). Default expiry 30 min
    /// (Python <c>expires=1800</c>).
    /// </summary>
    Task<string> GetUploadUrlAsync(string key, string contentType, TimeSpan? expiry = null, CancellationToken ct = default);

    /// <summary>
    /// Presigned GET URL for direct browser download/playback, signed for the PUBLIC host.
    /// Mirrors Python <c>presigned_get</c> (storage.py:52-57). Default expiry 1 h
    /// (Python <c>expires=3600</c>).
    /// </summary>
    Task<string> GetPresignedUrlAsync(string key, TimeSpan? expiry = null, CancellationToken ct = default);

    /// <summary>True if an object exists under <paramref name="key"/> (HEAD request).</summary>
    Task<bool> ExistsAsync(string key, CancellationToken ct = default);

    /// <summary>
    /// Delete a single object (idempotent — deleting a missing key succeeds).
    /// Single-key counterpart to Python's batch <c>delete_keys</c> (storage.py:80-84).
    /// </summary>
    Task DeleteAsync(string key, CancellationToken ct = default);
}
