namespace Govori.IntegrationTests;

/// <summary>
/// Owns the lifetime of the per-run database (see <see cref="TestDatabase"/>): created before the
/// first test that needs it, dropped after the last one.
///
/// <para>It is a COLLECTION fixture, and every DB-touching test class carries
/// <c>[Collection(PerRunDatabaseFixture.CollectionName)]</c>, because that is the only xUnit v2
/// lifetime that spans the whole run and still disposes deterministically — a class fixture would
/// drop the database between test classes, and a static-only holder would never drop it at all.
/// xUnit disposes collection fixtures whether the tests passed or failed, which is the point:
/// a failed run must not leave a database behind.</para>
///
/// <para>Class fixtures (the <c>WebApplicationFactory</c> subclasses) are constructed after this one
/// and read <see cref="TestDatabase.ConnectionString"/>, so the host they boot points at the per-run
/// database too — via the same <c>GOVORI_DB</c> env var it always used.</para>
/// </summary>
public sealed class PerRunDatabaseFixture : IDisposable
{
    public const string CollectionName = "govori-per-run-database";

    public PerRunDatabaseFixture() => TestDatabase.EnsureCreated();

    public void Dispose() => TestDatabase.Drop();
}

/// <summary>Binds <see cref="PerRunDatabaseFixture"/> to the collection name. Carries no code — the
/// attribute plus the interface is the whole registration.</summary>
[CollectionDefinition(PerRunDatabaseFixture.CollectionName)]
public sealed class PerRunDatabaseCollection : ICollectionFixture<PerRunDatabaseFixture>;
