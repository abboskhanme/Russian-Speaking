using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Govori.Infrastructure;

/// <summary>
/// Design-time factory so <c>dotnet ef migrations add / dbcontext scaffold</c> work
/// WITHOUT a running application host (docs/07 §7.4 — migrations are the only sanctioned
/// way the schema ever changes; <c>EnsureCreated()</c> is forbidden per rule 4).
///
/// Reads the connection string from the <c>GOVORI_DB</c> environment variable, falling
/// back to the govori-net schema DB (<see cref="GovoriDataSourceFactory.DefaultConnectionString"/>).
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
