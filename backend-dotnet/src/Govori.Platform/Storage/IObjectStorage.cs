namespace Govori.Platform.Storage;

/// <summary>
/// S3-compatible object storage abstraction the domains depend on. Stores every student
/// audio recording (Practice, Assessment) plus media/avatars.
///
/// PURE INFRASTRUCTURE — it holds no business rules: callers choose key prefixes,
/// expiries, and content types.
/// </summary>
public interface IObjectStorage
{
    /// <summary>
    /// Generate a fresh, collision-free object key <c>{prefix}/{uuid-hex}.{ext}</c>.
    /// The prefix (e.g. "answers", "shadow") is the caller's choice — this method only
    /// supplies the random mechanism.
    /// </summary>
    string NewKey(string prefix, string ext);

    /// <summary>
    /// Server-side upload of a stream under <paramref name="key"/>. Returns the key.
    /// Used by seeding/admin tasks, NOT the normal browser flow — that uploads directly
    /// via <see cref="GetUploadUrlAsync"/> so audio never transits the API.
    /// </summary>
    Task<string> PutAsync(string key, Stream content, string contentType, CancellationToken ct = default);

    /// <summary>
    /// Read an object's bytes server-side (from inside the Docker network) — used by the
    /// grading worker to fetch the audio for STT.
    /// </summary>
    Task<byte[]> GetBytesAsync(string key, CancellationToken ct = default);

    /// <summary>
    /// Presigned PUT URL for a direct browser upload. MUST be signed for the PUBLIC host,
    /// not the internal one, or SigV4 verification fails in the browser.
    /// Default expiry 30 minutes (1800 s).
    /// </summary>
    Task<string> GetUploadUrlAsync(string key, string contentType, TimeSpan? expiry = null, CancellationToken ct = default);

    /// <summary>
    /// Presigned GET URL for direct browser download/playback. MUST be signed for the PUBLIC
    /// host, not the internal one, or SigV4 verification fails in the browser.
    /// Default expiry 1 hour (3600 s).
    /// </summary>
    Task<string> GetPresignedUrlAsync(string key, TimeSpan? expiry = null, CancellationToken ct = default);

    /// <summary>True if an object exists under <paramref name="key"/> (HEAD request).</summary>
    Task<bool> ExistsAsync(string key, CancellationToken ct = default);

    /// <summary>
    /// Delete a single object (idempotent — deleting a missing key succeeds).
    /// </summary>
    Task DeleteAsync(string key, CancellationToken ct = default);

    /// <summary>
    /// List every object under <paramref name="prefix"/> with its last-modified time (paginated
    /// under the hood) — used by the orphan-upload cleanup job to find audio that never became
    /// a submission.
    /// </summary>
    Task<IReadOnlyList<StorageObject>> ListObjectsAsync(string prefix, CancellationToken ct = default);
}

/// <summary>One stored object as returned by <see cref="IObjectStorage.ListObjectsAsync"/>.</summary>
public sealed record StorageObject(string Key, DateTimeOffset LastModified);
