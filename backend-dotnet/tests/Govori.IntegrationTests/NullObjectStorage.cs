using Govori.Platform.Storage;

namespace Govori.IntegrationTests;

/// <summary>
/// An <see cref="IObjectStorage"/> that touches nothing. For tests that construct a service
/// directly to exercise a pure QUERY path — <c>CatalogService.TaskIndexAsync</c> and
/// <c>NeedsPremiumAsync</c>, whose behaviour is frozen by the C9/C4 fixtures — where storage is a
/// constructor dependency the code under test never reaches.
///
/// <para>Every method throws rather than returning a plausible-looking default. A test that starts
/// touching storage should FAIL loudly here, not silently pass against a fake that quietly returned
/// an empty string — the whole point of these parity tests is that they compare real SQL against a
/// frozen expectation, and a silent stub would let an unnoticed dependency creep in.</para>
///
/// <para>Tests that genuinely exercise upload/download go through the real API host and the MinIO
/// container, not this.</para>
/// </summary>
internal sealed class NullObjectStorage : IObjectStorage
{
    private static InvalidOperationException Unexpected([System.Runtime.CompilerServices.CallerMemberName] string member = "")
        => new($"{member} was called on NullObjectStorage — this test's code path is not supposed to touch object storage.");

    public string NewKey(string prefix, string ext) => throw Unexpected();

    public Task<string> PutAsync(string key, Stream content, string contentType, CancellationToken ct = default)
        => throw Unexpected();

    public Task<byte[]> GetBytesAsync(string key, CancellationToken ct = default) => throw Unexpected();

    public Task<string> GetUploadUrlAsync(string key, string contentType, TimeSpan? expiry = null, CancellationToken ct = default)
        => throw Unexpected();

    public Task<string> GetPresignedUrlAsync(string key, TimeSpan? expiry = null, CancellationToken ct = default)
        => throw Unexpected();

    public Task<bool> ExistsAsync(string key, CancellationToken ct = default) => throw Unexpected();

    public Task DeleteAsync(string key, CancellationToken ct = default) => throw Unexpected();

    public Task<IReadOnlyList<StorageObject>> ListObjectsAsync(string prefix, CancellationToken ct = default)
        => throw Unexpected();
}
