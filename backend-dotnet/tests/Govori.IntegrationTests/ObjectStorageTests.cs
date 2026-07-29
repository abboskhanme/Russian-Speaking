using System.Net;
using System.Text;
using Govori.Platform.Storage;

namespace Govori.IntegrationTests;

/// <summary>
/// Exercises <see cref="MinioObjectStorage"/> (Govori.Platform.Storage) against the real
/// govori-net MinIO container.
///
/// Round-trip: Put bytes under a unique key → Exists true → presigned GET (HTTP 200 + bytes
/// match) → Delete → Exists false. Idempotent: the key is unique per run (Guid, not Random)
/// and cleaned up in a finally block.
///
/// Connects via GOVORI_S3_ENDPOINT (default http://govori-minio:9000), creds minioadmin,
/// bucket govori-audio. PublicUrl is set to the same internal endpoint so the presigned URL
/// is reachable from inside the Docker network (in prod the two hosts differ — a presigned URL must
/// be signed for the host the CONSUMER reaches; see StorageOptions).
/// </summary>
public sealed class ObjectStorageTests
{
    private static StorageOptions BuildOptions()
    {
        var endpoint =
            Environment.GetEnvironmentVariable("GOVORI_S3_ENDPOINT") ?? "http://govori-minio:9000";
        return new StorageOptions
        {
            Endpoint = endpoint,
            PublicUrl = endpoint, // in-network test: browser-facing host == internal host
            AccessKey = Environment.GetEnvironmentVariable("GOVORI_S3_ACCESS_KEY") ?? "minioadmin",
            SecretKey = Environment.GetEnvironmentVariable("GOVORI_S3_SECRET_KEY") ?? "minioadmin",
            Bucket = Environment.GetEnvironmentVariable("GOVORI_S3_BUCKET") ?? "govori-audio",
            Region = "us-east-1",
        };
    }

    [Fact]
    public async Task Put_exists_presign_download_delete_round_trips()
    {
        var ct = CancellationToken.None;
        using var storage = new MinioObjectStorage(BuildOptions());

        // Unique key per run (GUID via NewKey), so concurrent/re-runs never collide.
        var key = storage.NewKey("integration-test", "bin");
        var payload = Encoding.UTF8.GetBytes($"govori-audio-roundtrip-{Guid.NewGuid():N}");
        const string contentType = "audio/webm";

        try
        {
            // ---- Put ----
            using (var body = new MemoryStream(payload))
            {
                var returnedKey = await storage.PutAsync(key, body, contentType, ct);
                Assert.Equal(key, returnedKey);
            }

            // ---- Exists → true ----
            Assert.True(await storage.ExistsAsync(key, ct));

            // ---- Server-side read back (download_bytes port) ----
            var fetched = await storage.GetBytesAsync(key, ct);
            Assert.Equal(payload, fetched);

            // ---- Presigned GET → HTTP 200 + identical bytes ----
            var url = await storage.GetPresignedUrlAsync(key, TimeSpan.FromMinutes(5), ct);
            Assert.Contains(key, url);
            Assert.StartsWith("http://", url); // scheme honours the (http) endpoint, like boto3

            using var http = new HttpClient();
            using var response = await http.GetAsync(url, ct);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            var downloaded = await response.Content.ReadAsByteArrayAsync(ct);
            Assert.Equal(payload, downloaded);
        }
        finally
        {
            // ---- Delete (idempotent) ----
            await storage.DeleteAsync(key, ct);
        }

        // ---- Exists → false ----
        Assert.False(await storage.ExistsAsync(key, ct));
    }
}
