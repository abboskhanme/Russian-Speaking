using System.Net;
using Amazon.Runtime;
using Amazon.S3;
using Amazon.S3.Model;

namespace Govori.Platform.Storage;

/// <summary>
/// <see cref="IObjectStorage"/> backed by <c>AWSSDK.S3</c> against an S3-compatible store
/// (MinIO in dev). Path-style addressing, SigV4.
///
/// TWO CLIENTS EXIST ON PURPOSE — do not collapse them into one:
///   * <see cref="_internal"/> — signed for the internal Docker host (<c>S3_ENDPOINT_URL</c>);
///     used for server-side put/get/head/delete.
///   * <see cref="_public"/> — signed for the public host (<c>S3_PUBLIC_URL</c>); used ONLY
///     to mint presigned URLs so the SigV4 signature is valid for the host the browser hits.
/// This is not a URL string-rewrite — the SDK signs each URL for its own client's ServiceURL.
/// </summary>
public sealed class MinioObjectStorage : IObjectStorage, IDisposable
{
    // Presign expiries clients rely on: uploads 1800 s (30 min), downloads 3600 s (1 h).
    private static readonly TimeSpan DefaultUploadExpiry = TimeSpan.FromSeconds(1800);
    private static readonly TimeSpan DefaultDownloadExpiry = TimeSpan.FromSeconds(3600);

    private readonly IAmazonS3 _internal;
    private readonly IAmazonS3 _public;
    private readonly string _bucket;
    private readonly bool _publicUsesHttp;

    public MinioObjectStorage(StorageOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);
        _bucket = options.Bucket;

        var credentials = new BasicAWSCredentials(options.AccessKey, options.SecretKey);
        _internal = new AmazonS3Client(credentials, MakeConfig(options.Endpoint, options.Region));
        // Presigned URLs must be signed for the PUBLIC host the browser reaches.
        var publicHost = string.IsNullOrWhiteSpace(options.PublicUrl) ? options.Endpoint : options.PublicUrl;
        _publicUsesHttp = publicHost.StartsWith("http://", StringComparison.OrdinalIgnoreCase);
        _public = new AmazonS3Client(credentials, MakeConfig(publicHost, options.Region));
    }

    // Test/DI seam: inject pre-built clients (e.g. a fake) without touching real MinIO.
    internal MinioObjectStorage(IAmazonS3 internalClient, IAmazonS3 publicClient, string bucket, bool publicUsesHttp = true)
    {
        _internal = internalClient;
        _public = publicClient;
        _bucket = bucket;
        _publicUsesHttp = publicUsesHttp;
    }

    private static AmazonS3Config MakeConfig(string serviceUrl, string region) => new()
    {
        ServiceURL = serviceUrl,
        ForcePathStyle = true,          // REQUIRED for MinIO: path-style addressing, not virtual-hosted buckets
        AuthenticationRegion = region,  // SigV4 region placeholder — MinIO ignores it but signing needs a value
    };

    // AWSSDK always mints presigned URLs as https:// regardless of the ServiceURL scheme, so a
    // plain-http endpoint (MinIO in dev) would hand the browser an unreachable URL. Safe to fix
    // up: SigV4 does not sign the URI scheme, so rewriting https→http keeps the signature valid.
    private string NormalizeScheme(string url) =>
        _publicUsesHttp && url.StartsWith("https://", StringComparison.OrdinalIgnoreCase)
            ? string.Concat("http://", url.AsSpan("https://".Length))
            : url;

    /// <summary>Builds a fresh key of the form <c>{prefix}/{uuid-hex}.{ext}</c>.</summary>
    public string NewKey(string prefix, string ext)
    {
        var cleanExt = ext.TrimStart('.');
        return $"{prefix}/{Guid.NewGuid():N}.{cleanExt}";
    }

    public async Task<string> PutAsync(string key, Stream content, string contentType, CancellationToken ct = default)
    {
        var request = new PutObjectRequest
        {
            BucketName = _bucket,
            Key = key,
            InputStream = content,
            ContentType = contentType,
            AutoCloseStream = false,
        };
        await _internal.PutObjectAsync(request, ct).ConfigureAwait(false);
        return key;
    }

    public async Task<byte[]> GetBytesAsync(string key, CancellationToken ct = default)
    {
        using var response = await _internal
            .GetObjectAsync(new GetObjectRequest { BucketName = _bucket, Key = key }, ct)
            .ConfigureAwait(false);
        using var buffer = new MemoryStream();
        await response.ResponseStream.CopyToAsync(buffer, ct).ConfigureAwait(false);
        return buffer.ToArray();
    }

    public Task<string> GetUploadUrlAsync(string key, string contentType, TimeSpan? expiry = null, CancellationToken ct = default)
    {
        var request = new GetPreSignedUrlRequest
        {
            BucketName = _bucket,
            Key = key,
            Verb = HttpVerb.PUT,
            ContentType = contentType,
            Expires = DateTime.UtcNow.Add(expiry ?? DefaultUploadExpiry),
        };
        return PresignAsync(request);
    }

    public Task<string> GetPresignedUrlAsync(string key, TimeSpan? expiry = null, CancellationToken ct = default)
    {
        var request = new GetPreSignedUrlRequest
        {
            BucketName = _bucket,
            Key = key,
            Verb = HttpVerb.GET,
            Expires = DateTime.UtcNow.Add(expiry ?? DefaultDownloadExpiry),
        };
        return PresignAsync(request);
    }

    private async Task<string> PresignAsync(GetPreSignedUrlRequest request) =>
        NormalizeScheme(await _public.GetPreSignedURLAsync(request).ConfigureAwait(false));

    public async Task<bool> ExistsAsync(string key, CancellationToken ct = default)
    {
        try
        {
            await _internal
                .GetObjectMetadataAsync(new GetObjectMetadataRequest { BucketName = _bucket, Key = key }, ct)
                .ConfigureAwait(false);
            return true;
        }
        catch (AmazonS3Exception ex) when (ex.StatusCode == HttpStatusCode.NotFound)
        {
            return false;
        }
    }

    public Task DeleteAsync(string key, CancellationToken ct = default) =>
        _internal.DeleteObjectAsync(new DeleteObjectRequest { BucketName = _bucket, Key = key }, ct);

    public async Task<IReadOnlyList<StorageObject>> ListObjectsAsync(string prefix, CancellationToken ct = default)
    {
        var results = new List<StorageObject>();
        string? continuationToken = null;
        do
        {
            var response = await _internal.ListObjectsV2Async(new ListObjectsV2Request
            {
                BucketName = _bucket,
                Prefix = prefix,
                ContinuationToken = continuationToken,
            }, ct).ConfigureAwait(false);

            foreach (var obj in response.S3Objects)
            {
                // S3/MinIO report LastModified in UTC; the container runs UTC. Pin the Kind so the
                // "older than 24h" cutoff compares apples to apples with DateTime.UtcNow.
                var lastModifiedUtc = DateTime.SpecifyKind(obj.LastModified, DateTimeKind.Utc);
                results.Add(new StorageObject(obj.Key, new DateTimeOffset(lastModifiedUtc)));
            }

            continuationToken = response.IsTruncated ? response.NextContinuationToken : null;
        }
        while (continuationToken is not null);

        return results;
    }

    public void Dispose()
    {
        _internal.Dispose();
        _public.Dispose();
    }
}
