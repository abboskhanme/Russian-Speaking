using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Govori.Infrastructure;

/// <summary>
/// Design-time factory so <c>dotnet ef migrations add</c> and <c>dotnet ef database update</c>
/// work WITHOUT a running application host. Migrations are the only sanctioned way the
/// schema ever changes; <c>EnsureCreated()</c> is forbidden because it builds the schema
/// behind EF's back and leaves the migrations history empty.
///
/// Reads the connection string from the <c>GOVORI_DB</c> environment variable, falling
/// back to <see cref="GovoriDataSourceFactory.DefaultConnectionString"/>. Point
/// <c>GOVORI_DB</c> at a scratch database to verify a migration before it touches
/// anything real.
/// Uses the shared <see cref="GovoriDataSourceFactory"/> so the enum mapping + snake_case
/// convention are identical to runtime.
/// </summary>
public sealed class GovoriDbContextFactory : IDesignTimeDbContextFactory<GovoriDbContext>
{
    public GovoriDbContext CreateDbContext(string[] args)
    {
        var connectionString =
            Environment.GetEnvironmentVariable("GOVORI_DB")
            ?? GovoriDataSourceFactory.DefaultConnectionString;

        var dataSource = GovoriDataSourceFactory.Build(connectionString);

        // UseGovori mutates this same builder instance (it returns the non-generic
        // base type), so read the strongly-typed Options off the builder afterwards.
        var builder = new DbContextOptionsBuilder<GovoriDbContext>();
        builder.UseGovori(dataSource);

        return new GovoriDbContext(builder.Options);
    }
}
