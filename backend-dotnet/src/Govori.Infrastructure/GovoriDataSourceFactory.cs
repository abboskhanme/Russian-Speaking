using Govori.Infrastructure.Entities;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Govori.Infrastructure;

/// <summary>
/// Single place where Govori's Npgsql <see cref="NpgsqlDataSource"/> and DbContext options
/// are built (docs/07 §7.4). The native PG enums require registration in THREE places, all
/// wired up here + in the DbContext — miss any one and the enum silently maps to int:
///   1. ADO wire layer — <c>NpgsqlDataSourceBuilder.MapEnum&lt;T&gt;("pg_name")</c> in <see cref="Build"/>.
///   2. EF type-mapping source — <c>o.MapEnum&lt;T&gt;("pg_name")</c> inside <c>UseNpgsql</c> in <see cref="UseGovori"/>.
///   3. EF model / migrations — <c>HasPostgresEnum&lt;T&gt;("public","pg_name")</c> in <see cref="GovoriDbContext.OnModelCreating"/>.
///
/// The runtime host (Govori.Api / Govori.Worker) MUST build its data source through
/// <see cref="Build"/> and register the context through <see cref="UseGovori"/> so the
/// enum mapping and snake_case naming convention are applied consistently everywhere
/// (the API, the worker, the design-time factory and the integration tests all funnel
/// through these two methods — one configuration, no drift).
/// </summary>
public static class GovoriDataSourceFactory
{
    /// <summary>The govori-net schema DB connection string used as the default when no env var is set.</summary>
    public const string DefaultConnectionString =
        "Host=govori-scaffold-db;Port=5432;Database=russpeak;Username=russpeak;Password=govori";

    /// <summary>
    /// Builds a data source with the three native PG enums mapped at the ADO layer.
    /// Enum labels come from the <c>[PgName]</c> attributes on each enum member, so the
    /// C# member order is irrelevant to correctness — the label text is what matches the DB.
    /// </summary>
    public static NpgsqlDataSource Build(string connectionString)
    {
        var builder = new NpgsqlDataSourceBuilder(connectionString);
        builder.MapEnum<UserRole>("user_role");
        builder.MapEnum<QuestionType>("question_type");
        builder.MapEnum<SubmissionStatus>("submission_status");
        return builder.Build();
    }

    /// <summary>
    /// Configures a <see cref="DbContextOptionsBuilder"/> for Govori: Npgsql over the given
    /// enum-aware data source plus <c>UseSnakeCaseNamingConvention()</c> (docs/07 §7.4 trap #2).
    /// snake_case is the single naming mechanism; the scaffold's explicit
    /// <c>HasColumnName</c>/<c>ToTable</c> calls were audited to agree with it exactly.
    /// </summary>
    public static DbContextOptionsBuilder UseGovori(this DbContextOptionsBuilder options, NpgsqlDataSource dataSource)
    {
        options.UseNpgsql(dataSource, o =>
        {
            o.MapEnum<UserRole>("user_role");
            o.MapEnum<QuestionType>("question_type");
            o.MapEnum<SubmissionStatus>("submission_status");
        });
        options.UseSnakeCaseNamingConvention();
        return options;
    }
}
