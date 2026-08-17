using System.Globalization;
using Govori.Infrastructure;
using Govori.Infrastructure.Entities;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Govori.IntegrationTests;

/// <summary>
/// Per-run throwaway database (docs/08 Faza 2.5 — "test isolation").
///
/// <para>Every integration test in this assembly talks to a database created fresh at the start of
/// the run — <c>govori_it_&lt;timestamp&gt;_&lt;short-guid&gt;</c> — and dropped at the end of it. The shared
/// dev database (<c>russpeak</c>) is never written to, so: two runs cannot corrupt each other, a
/// failed run cannot leave the dev database dirty, and the suite can be run while the app is in use.</para>
///
/// <para><b>Why this and not Testcontainers.</b> The plan named Testcontainers, and on a normal
/// machine that would be the answer. It cannot work <i>here</i>, and the reason is structural rather
/// than a matter of taste. The host SDK is 8.0 while every project targets net9.0, so the only way to
/// build or test this solution is inside the <c>mcr.microsoft.com/dotnet/sdk:9.0</c> container.
/// Testcontainers from inside that container would need the Docker socket mounted, and would then
/// start its Postgres with a published port on the <i>host</i> — a port that <c>localhost</c> inside
/// the test container does not resolve to. The container it starts would also be a sibling, not a
/// child, so its lifetime is no longer tied to the test process either. That is a dead end, not a
/// preference: the fix would be a Docker-socket mount plus network gymnastics, for a property we can
/// get outright by asking the Postgres we are already connected to for a second database.</para>
///
/// <para>What the plan actually wants is <b>per-run isolation</b>, and a uniquely-named database on
/// the existing server delivers exactly that, with the schema built by the project's own EF Core
/// migrations (never <c>EnsureCreated</c>, never a hand-written DDL snapshot) so a divergence between
/// the test schema and the migrations still fails the suite — which is half of why the suite exists.
/// If you are here to "fix" this back to Testcontainers, first check whether the build still has to
/// happen inside the SDK container. Until that changes, this is the working shape.</para>
/// </summary>
public static class TestDatabase
{
    /// <summary>Prefix that marks a database as this suite's disposable scratch space. Anything
    /// matching it is fair game for the stale sweep below.</summary>
    private const string NamePrefix = "govori_it_";

    private const string TimestampFormat = "yyyyMMddHHmmss";

    /// <summary>A leftover scratch database older than this was orphaned by a killed test host
    /// (SIGKILL runs no shutdown code at all). Younger ones may belong to a run happening right
    /// now, so they are left alone.</summary>
    private static readonly TimeSpan StaleAfter = TimeSpan.FromHours(3);

    /// <summary>
    /// Documented dev defaults, used when neither <c>GOVORI_TEST_DB</c> nor a readable repo
    /// <c>.env</c> supplies them: the compose Postgres reached as <c>db</c> over <c>govori-net</c>.
    /// Only the SERVER coordinates here are ever used — the database name is always replaced by the
    /// per-run one, which is what keeps <c>russpeak</c> untouched.
    /// </summary>
    private const string DevDefaultConnectionString =
        "Host=db;Port=5432;Database=russpeak;Username=russpeak;Password=russpeak";

    private static readonly object Gate = new();

    private static string? _connectionString;
    private static string? _maintenanceConnectionString;
    private static string? _databaseName;
    private static bool _dropped;

    /// <summary>Connection string for the per-run database. Creating it (and migrating it) happens
    /// on first access, so a test class can read this straight from a field initializer.</summary>
    public static string ConnectionString
    {
        get
        {
            EnsureCreated();
            return _connectionString!;
        }
    }

    /// <summary>Name of the per-run database — handy in failure messages.</summary>
    public static string DatabaseName
    {
        get
        {
            EnsureCreated();
            return _databaseName!;
        }
    }

    /// <summary>
    /// Creates the per-run database, brings its schema up with the EF Core migrations and seeds the
    /// baseline rows. Idempotent and thread-safe; the first caller pays for it.
    /// </summary>
    public static void EnsureCreated()
    {
        lock (Gate)
        {
            if (_connectionString is not null)
                return;
            if (_dropped)
                throw new InvalidOperationException(
                    "The per-run test database was already dropped; a test tried to use it after teardown.");

            var server = new NpgsqlConnectionStringBuilder(ResolveServerConnectionString());

            // `postgres` is the maintenance database: CREATE/DROP DATABASE cannot run from inside the
            // database being created or dropped. Pooling off so this connection never lingers and
            // becomes the very backend that blocks our own DROP.
            var maintenance = new NpgsqlConnectionStringBuilder(server.ConnectionString)
            {
                Database = "postgres",
                Pooling = false,
            }.ConnectionString;

            SweepStaleDatabases(maintenance);

            var name = NamePrefix
                       + DateTime.UtcNow.ToString(TimestampFormat, CultureInfo.InvariantCulture)
                       + "_"
                       + Guid.NewGuid().ToString("N")[..8];

            Execute(maintenance, $"CREATE DATABASE \"{name}\";");

            var connectionString = new NpgsqlConnectionStringBuilder(server.ConnectionString)
            {
                Database = name,
            }.ConnectionString;

            try
            {
                MigrateSchema(connectionString);
                SeedBaseline(connectionString);
            }
            catch
            {
                // A half-built database is still a database: drop it rather than leak it, then let
                // the original failure surface.
                TryDrop(maintenance, name);
                throw;
            }

            _maintenanceConnectionString = maintenance;
            _databaseName = name;
            _connectionString = connectionString;

            // Backstop only. The primary teardown is PerRunDatabaseFixture.Dispose (a real xUnit
            // collection fixture, which runs after the last test in the run whether it passed or
            // failed). ProcessExit covers the paths xUnit never reaches — a crash in the runner, a
            // test host torn down mid-collection — and is harmless when the fixture already ran.
            AppDomain.CurrentDomain.ProcessExit += (_, _) => Drop();
        }
    }

    /// <summary>
    /// Drops the per-run database. Called from the collection fixture's Dispose, so it runs on a
    /// failing run exactly as it does on a passing one — a leaked database per failed run is how this
    /// fix would quietly turn into a disk leak.
    /// </summary>
    public static void Drop()
    {
        lock (Gate)
        {
            if (_connectionString is null || _databaseName is null || _maintenanceConnectionString is null)
                return;

            var maintenance = _maintenanceConnectionString;
            var name = _databaseName;

            _connectionString = null;
            _databaseName = null;
            _maintenanceConnectionString = null;
            _dropped = true;

            TryDrop(maintenance, name);
        }
    }

    // ── creation steps ───────────────────────────────────────────────────────────

    /// <summary>
    /// Builds the schema from the project's EF Core migrations — the same migrations the API and the
    /// deploy scripts run. Nothing is hand-written and nothing is copied from a snapshot, so a model
    /// change that was never turned into a migration fails the suite here instead of in production.
    /// </summary>
    private static void MigrateSchema(string connectionString)
    {
        // A dedicated data source, disposed straight after: it connects to the database BEFORE the
        // native enum types exist, so its type catalogue is stale by the time the migration finishes.
        // Test-owned data sources are built fresh afterwards and see the real thing.
        using var dataSource = GovoriDataSourceFactory.Build(connectionString);
        var options = new DbContextOptionsBuilder<GovoriDbContext>();
        options.UseGovori(dataSource);
        using var ctx = new GovoriDbContext(options.Options);
        ctx.Database.Migrate();
    }

    /// <summary>
    /// Rows that used to come for free from the shared dev database and that a test reads without
    /// having written. Today that is exactly one thing: the user population
    /// <see cref="SchemaRoundTripTests"/> asserts a floor on (>= 34 users; >= 2 admin, >= 26 student,
    /// >= 6 teacher — the demo dump's baseline). Seeding it here is what lets that assertion keep
    /// meaning something on an empty database.
    ///
    /// <para>Deliberately minimal: everything else in this suite seeds what it reads and deletes it
    /// again, and should keep doing so. Do not grow this into a shared world that tests silently
    /// start depending on.</para>
    /// </summary>
    private static void SeedBaseline(string connectionString)
    {
        using var dataSource = GovoriDataSourceFactory.Build(connectionString);
        var options = new DbContextOptionsBuilder<GovoriDbContext>();
        options.UseGovori(dataSource);
        using var ctx = new GovoriDbContext(options.Options);

        var now = DateTime.UtcNow;
        var seeded = new List<User>();

        void Add(UserRole role, int count)
        {
            for (var i = 0; i < count; i++)
            {
                var id = Guid.NewGuid();
                seeded.Add(new User
                {
                    Id = id,
                    Email = $"baseline-{role.ToString().ToLowerInvariant()}-{i:D2}-{id:N}@example.test",
                    FullName = $"Baseline {role} {i:D2}",
                    Role = role,
                    IsActive = true,
                    IsPremium = false,
                    PreferredLanguage = "uz",
                    CreatedAt = now,
                    UpdatedAt = now,
                });
            }
        }

        Add(UserRole.Admin, 2);
        Add(UserRole.Student, 26);
        Add(UserRole.Teacher, 6);

        ctx.Users.AddRange(seeded);
        ctx.SaveChanges();
    }

    // ── server resolution ────────────────────────────────────────────────────────

    /// <summary>
    /// Where the Postgres SERVER is. <c>GOVORI_TEST_DB</c> wins if it is set (its database name is
    /// discarded — only host/port/credentials are used); otherwise the repo's <c>.env</c> is read, so
    /// a machine whose password is not the compose default still works without a code change; failing
    /// that, the documented dev defaults.
    /// </summary>
    private static string ResolveServerConnectionString()
    {
        var fromEnv = Environment.GetEnvironmentVariable("GOVORI_TEST_DB");
        if (!string.IsNullOrWhiteSpace(fromEnv))
            return fromEnv;

        return FromDotEnv() ?? DevDefaultConnectionString;
    }

    /// <summary>Walks up from the test binaries looking for the repo-root <c>.env</c> and turns its
    /// POSTGRES_* entries into a connection string. Returns null if there is no usable file.</summary>
    private static string? FromDotEnv()
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
        {
            var candidate = Path.Combine(dir.FullName, ".env");
            if (!File.Exists(candidate))
                continue;

            Dictionary<string, string> values;
            try
            {
                values = ParseDotEnv(candidate);
            }
            catch (IOException)
            {
                return null;
            }

            if (!values.TryGetValue("POSTGRES_USER", out var user) ||
                !values.TryGetValue("POSTGRES_PASSWORD", out var password))
                return null;

            var host = values.GetValueOrDefault("POSTGRES_HOST", "db");
            var port = values.GetValueOrDefault("POSTGRES_PORT", "5432");
            var database = values.GetValueOrDefault("POSTGRES_DB", "russpeak");

            return $"Host={host};Port={port};Database={database};Username={user};Password={password}";
        }

        return null;
    }

    private static Dictionary<string, string> ParseDotEnv(string path)
    {
        var values = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var raw in File.ReadAllLines(path))
        {
            var line = raw.Trim();
            if (line.Length == 0 || line[0] == '#')
                continue;

            var separator = line.IndexOf('=');
            if (separator <= 0)
                continue;

            var key = line[..separator].Trim();
            var value = line[(separator + 1)..].Trim().Trim('"', '\'');
            if (key.Length != 0)
                values[key] = value;
        }
        return values;
    }

    // ── teardown helpers ─────────────────────────────────────────────────────────

    /// <summary>
    /// Drops <paramref name="name"/>, terminating every other backend on it first. Without the
    /// terminate, one lingering pooled connection (a WebApplicationFactory host that outlived its
    /// class fixture, say) makes DROP DATABASE block or fail — and the database survives the run.
    /// </summary>
    private static void TryDrop(string maintenanceConnectionString, string name)
    {
        // Our own idle pooled connections count as backends on that database too.
        NpgsqlConnection.ClearAllPools();

        try
        {
            using var conn = new NpgsqlConnection(maintenanceConnectionString);
            conn.Open();

            using (var terminate = new NpgsqlCommand(
                       "SELECT pg_terminate_backend(pid) FROM pg_stat_activity " +
                       "WHERE datname = @db AND pid <> pg_backend_pid();", conn))
            {
                terminate.Parameters.AddWithValue("db", name);
                terminate.ExecuteNonQuery();
            }

            using var drop = new NpgsqlCommand($"DROP DATABASE IF EXISTS \"{name}\" WITH (FORCE);", conn);
            drop.ExecuteNonQuery();
        }
        catch (Exception ex)
        {
            // Never fail a run over teardown — but say so loudly, because a surviving
            // govori_it_* database is a leak the next run's sweep has to clean up.
            Console.Error.WriteLine($"[TestDatabase] failed to drop '{name}': {ex.Message}");
        }
    }

    /// <summary>
    /// Drops scratch databases left behind by runs that never got to shut down. The name carries the
    /// creation timestamp precisely so this can tell "orphaned hours ago" from "a run in progress
    /// right now" without a catalogue read that needs superuser.
    /// </summary>
    private static void SweepStaleDatabases(string maintenanceConnectionString)
    {
        List<string> stale = [];
        try
        {
            using var conn = new NpgsqlConnection(maintenanceConnectionString);
            conn.Open();

            // starts_with, not LIKE: '_' is a single-character wildcard in a LIKE pattern, so
            // 'govori_it_%' would also match names this suite never created.
            using (var query = new NpgsqlCommand(
                       "SELECT datname FROM pg_database WHERE starts_with(datname, @prefix);", conn))
            {
                query.Parameters.AddWithValue("prefix", NamePrefix);
                using var reader = query.ExecuteReader();
                while (reader.Read())
                {
                    var name = reader.GetString(0);
                    if (IsStale(name))
                        stale.Add(name);
                }
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[TestDatabase] stale sweep skipped: {ex.Message}");
            return;
        }

        foreach (var name in stale)
            TryDrop(maintenanceConnectionString, name);
    }

    private static bool IsStale(string databaseName)
    {
        var rest = databaseName[NamePrefix.Length..];
        var underscore = rest.IndexOf('_');
        if (underscore < 0)
            return false;

        return DateTime.TryParseExact(
                   rest[..underscore], TimestampFormat, CultureInfo.InvariantCulture,
                   DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var createdAt)
               && DateTime.UtcNow - createdAt > StaleAfter;
    }

    private static void Execute(string connectionString, string sql)
    {
        using var conn = new NpgsqlConnection(connectionString);
        conn.Open();
        using var cmd = new NpgsqlCommand(sql, conn);
        cmd.ExecuteNonQuery();
    }
}
