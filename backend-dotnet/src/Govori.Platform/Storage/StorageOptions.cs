namespace Govori.Platform.Storage;

/// <summary>
/// Configuration for the S3-compatible object store (MinIO in dev, R2/S3 in prod).
/// Pure config carrier — no behaviour, no secrets baked in.
///
/// The production environment keys mirror the Python backend 1:1
/// (<c>backend/app/core/config.py</c> lines 38-43) so the same <c>.env</c> works:
///   <list type="bullet">
///     <item><c>S3_ENDPOINT_URL</c> → <see cref="Endpoint"/></item>
///     <item><c>S3_PUBLIC_URL</c>   → <see cref="PublicUrl"/></item>
///     <item><c>S3_ACCESS_KEY</c>   → <see cref="AccessKey"/></item>
///     <item><c>S3_SECRET_KEY</c>   → <see cref="SecretKey"/></item>
///     <item><c>S3_BUCKET</c>       → <see cref="Bucket"/></item>
///     <item><c>S3_REGION</c>       → <see cref="Region"/></item>
///   </list>
///
/// Two hosts exist on purpose (see <see cref="MinioObjectStorage"/> and the Python
/// module docstring): the BACKEND reaches MinIO over the internal Docker host
/// (<see cref="Endpoint"/>), while presigned URLs handed to the BROWSER must be signed
/// for the PUBLIC host (<see cref="PublicUrl"/>) or SigV4 fails.
///
/// DI wiring (binding + <c>IOptions&lt;StorageOptions&gt;</c>) is deferred to the domain
/// that first consumes it (Practice) per the task scope; Platform stays infrastructure-only.
/// </summary>
public sealed class StorageOptions
{
    /// <summary>Config section name for <c>IConfiguration.GetSection(...).Bind(...)</c>.</summary>
    public const string SectionName = "Storage";

    /// <summary>Internal S3 endpoint the backend connects to (e.g. <c>http://govori-minio:9000</c>). Env: <c>S3_ENDPOINT_URL</c>.</summary>
    public string Endpoint { get; set; } = string.Empty;

    /// <summary>Public S3 endpoint presigned URLs are signed for (e.g. <c>http://localhost:9000</c>). Env: <c>S3_PUBLIC_URL</c>.</summary>
    public string PublicUrl { get; set; } = string.Empty;

    /// <summary>Access key. Env: <c>S3_ACCESS_KEY</c>. Never defaulted — must be supplied.</summary>
    public string AccessKey { get; set; } = string.Empty;

    /// <summary>Secret key. Env: <c>S3_SECRET_KEY</c>. Never defaulted — must be supplied.</summary>
    public string SecretKey { get; set; } = string.Empty;

    /// <summary>Bucket name. Env: <c>S3_BUCKET</c>. Python default: <c>russpeak-media</c>.</summary>
    public string Bucket { get; set; } = "russpeak-media";

    /// <summary>SigV4 region placeholder for MinIO. Env: <c>S3_REGION</c>. Python default: <c>us-east-1</c>.</summary>
    public string Region { get; set; } = "us-east-1";
}
