using System.Text.Json.Nodes;
using Govori.Infrastructure;
using Govori.Infrastructure.Entities;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Govori.IntegrationTests;

/// <summary>
/// Proves the database-first EF Core mapping (docs/07 §7.4) round-trips against the
/// real prod-shaped schema DB: native PG enums, TIMESTAMPTZ (Kind=Utc), client-generated
/// UUID v4 PKs, and JSONB — all without the schema changing.
///
/// Runs against the per-run throwaway database built by <see cref="TestDatabase"/> from the EF Core
/// migrations — which is what makes the mapping assertions below mean something: the schema they
/// round-trip against is the schema the migrations produce, not whatever the dev database has
/// drifted into. The baseline user population the first test asserts a floor on is seeded there.
/// </summary>
[Collection(PerRunDatabaseFixture.CollectionName)]
public sealed class SchemaRoundTripTests : IDisposable
{
    private readonly NpgsqlDataSource _dataSource;

    public SchemaRoundTripTests()
    {
        // The per-run throwaway database (see TestDatabase) — never the shared dev one.
        var connectionString = TestDatabase.ConnectionString;

        _dataSource = GovoriDataSourceFactory.Build(connectionString);
    }

    private GovoriDbContext CreateContext()
    {
        var builder = new DbContextOptionsBuilder<GovoriDbContext>();
        builder.UseGovori(_dataSource);
        return new GovoriDbContext(builder.Options);
    }

    [Fact]
    public async Task Mapping_round_trips_enums_timestamptz_uuid_and_jsonb()
    {
        // ---- 1. Read existing seed data: role deserializes to the PG enum ----
        await using (var ctx = CreateContext())
        {
            var userCount = await ctx.Users.CountAsync();
            // Floor, not an exact count: the demo dump's baseline (34 users) is seeded into the
            // per-run database by TestDatabase.SeedBaseline, and other tests in the run only ADD
            // users. Assert the baseline is present.
            Assert.True(userCount >= 34, $"expected >= 34 seeded users, got {userCount}");

            // The enum read path against real prod-shaped rows must not throw and must
            // materialize the native user_role enum — every role present at >= its baseline.
            var byRole = await ctx.Users
                .GroupBy(u => u.Role)
                .Select(g => new { Role = g.Key, Count = g.Count() })
                .ToDictionaryAsync(x => x.Role, x => x.Count);

            Assert.True(byRole.GetValueOrDefault(UserRole.Admin) >= 2);
            Assert.True(byRole.GetValueOrDefault(UserRole.Student) >= 26);
            Assert.True(byRole.GetValueOrDefault(UserRole.Teacher) >= 6);
        }

        // ---- 2. Insert a NEW user + submission + transcript (exercises every trap) ----
        var userId = Guid.NewGuid();            // client-generated UUID v4 (NOT NewGuid v7 / DB default)
        var submissionId = Guid.NewGuid();
        var transcriptId = Guid.NewGuid();
        Assert.Equal(4, userId.Version);        // confirm it really is a v4 GUID

        var createdAt = DateTime.UtcNow;
        Assert.Equal(DateTimeKind.Utc, createdAt.Kind);

        const string wordTimestampsJson =
            """[{"word":"привет","start":0.0,"end":0.5},{"word":"мир","start":0.5,"end":1.0}]""";

        try
        {
            await using (var ctx = CreateContext())
            {
                ctx.Users.Add(new User
                {
                    Id = userId,
                    Email = $"efcore-roundtrip-{userId:N}@example.test",
                    FullName = "EF Core Round-Trip",
                    Role = UserRole.Teacher,          // native enum write
                    IsActive = true,                  // bool
                    IsPremium = false,                // bool
                    PreferredLanguage = "uz",
                    CreatedAt = createdAt,            // timestamptz, Kind=Utc
                    UpdatedAt = createdAt,
                });

                ctx.Submissions.Add(new Submission
                {
                    Id = submissionId,
                    StudentId = userId,
                    AudioKey = "roundtrip/test-audio.webm",
                    Status = SubmissionStatus.Processing,   // native enum write
                    CreatedAt = createdAt,
                    UpdatedAt = createdAt,
                });

                ctx.Transcripts.Add(new Transcript
                {
                    Id = transcriptId,
                    SubmissionId = submissionId,
                    Text = "привет мир",
                    Language = "ru",
                    WordTimestamps = wordTimestampsJson,    // JSONB write (Cyrillic + numbers)
                    CreatedAt = createdAt,
                    UpdatedAt = createdAt,
                });

                var written = await ctx.SaveChangesAsync();
                Assert.Equal(3, written);
            }

            // ---- 3. Read it back in a FRESH context (no identity-map caching) ----
            await using (var ctx = CreateContext())
            {
                var user = await ctx.Users.SingleAsync(u => u.Id == userId);
                Assert.Equal(UserRole.Teacher, user.Role);          // enum round-trip
                Assert.True(user.IsActive);
                Assert.False(user.IsPremium);
                Assert.Equal(DateTimeKind.Utc, user.CreatedAt.Kind); // timestamptz stays UTC
                Assert.Equal(createdAt, user.CreatedAt, TimeSpan.FromSeconds(1));

                var submission = await ctx.Submissions.SingleAsync(s => s.Id == submissionId);
                Assert.Equal(SubmissionStatus.Processing, submission.Status); // enum round-trip

                var transcript = await ctx.Transcripts.SingleAsync(t => t.Id == transcriptId);
                Assert.NotNull(transcript.WordTimestamps);

                // JSONB semantic round-trip: PG jsonb normalizes text, so compare parsed
                // values (System.Text.Json), not raw strings.
                var roundTripped = JsonNode.Parse(transcript.WordTimestamps!)!.AsArray();
                Assert.Equal("привет", (string?)roundTripped[0]!["word"]);   // Cyrillic survives
                Assert.Equal(0.0, (double?)roundTripped[0]!["start"]);
                Assert.Equal("мир", (string?)roundTripped[1]!["word"]);
                Assert.Equal(1.0, (double?)roundTripped[1]!["end"]);
            }
        }
        finally
        {
            // ---- 4. Clean up so the test is idempotent (FK-safe order) ----
            await using var ctx = CreateContext();
            await ctx.Transcripts.Where(t => t.Id == transcriptId).ExecuteDeleteAsync();
            await ctx.Submissions.Where(s => s.Id == submissionId).ExecuteDeleteAsync();
            await ctx.Users.Where(u => u.Id == userId).ExecuteDeleteAsync();
        }
    }

    /// <summary>
    /// The partial unique index on <c>users.phone</c> (<c>ix_users_phone</c>) does the two things it
    /// exists to do: a second row on the same number is REFUSED, and the many accounts that have no
    /// number at all (Google sign-ins, legacy email rows) are untouched by it — the index is filtered
    /// <c>WHERE phone IS NOT NULL</c>, so a plain unique constraint's NULL semantics are not what is
    /// being relied on here.
    ///
    /// <para>It also pins the name: <see cref="DbErrors.IsUniqueViolation"/> matches on the exact
    /// constraint Postgres reports, and the auth paths turn ONLY that one back into a normal answer.
    /// If a rename ever silently changed it, this assertion fails here rather than the auth code
    /// quietly starting to 500 on a race it used to absorb.</para>
    /// </summary>
    [Fact]
    public async Task Phone_unique_index_refuses_a_duplicate_and_ignores_nulls()
    {
        var phone = "+99893" + Random.Shared.Next(0, 10_000_000).ToString("D7");
        var firstId = Guid.NewGuid();
        var secondId = Guid.NewGuid();
        var nullPhoneIds = new[] { Guid.NewGuid(), Guid.NewGuid() };

        try
        {
            await using (var ctx = CreateContext())
            {
                ctx.Users.Add(NewUser(firstId, phone));
                Assert.Equal(1, await ctx.SaveChangesAsync());
            }

            // Same number, different account → refused by the database, not by application code.
            await using (var ctx = CreateContext())
            {
                ctx.Users.Add(NewUser(secondId, phone));
                var ex = await Assert.ThrowsAsync<DbUpdateException>(() => ctx.SaveChangesAsync());

                Assert.True(DbErrors.IsUniqueViolation(ex, "ix_users_phone"),
                    $"expected a unique violation on ix_users_phone, got: {ex.InnerException?.Message}");
                // A collision on some OTHER index must not be mistaken for this one.
                Assert.False(DbErrors.IsUniqueViolation(ex, "ix_users_email"));
            }

            // Two accounts with NO number are both fine — the filter excludes them from the index.
            await using (var ctx = CreateContext())
            {
                ctx.Users.Add(NewUser(nullPhoneIds[0], phone: null));
                ctx.Users.Add(NewUser(nullPhoneIds[1], phone: null));
                Assert.Equal(2, await ctx.SaveChangesAsync());
            }
        }
        finally
        {
            await using var ctx = CreateContext();
            await ctx.Users
                .Where(u => u.Id == firstId || u.Id == secondId || nullPhoneIds.Contains(u.Id))
                .ExecuteDeleteAsync();
        }
    }

    /// <summary>A minimal valid <c>users</c> row: everything NOT NULL set, and a per-id placeholder
    /// email so the <c>email</c> unique index can never be the thing that fails a phone test.</summary>
    private static User NewUser(Guid id, string? phone) => new()
    {
        Id = id,
        Email = $"phone-index-{id:N}@example.test",
        FullName = "Phone Index Probe",
        Role = UserRole.Student,
        IsActive = true,
        IsPremium = false,
        PreferredLanguage = "uz",
        Phone = phone,
        CreatedAt = DateTime.UtcNow,
        UpdatedAt = DateTime.UtcNow,
    };

    public void Dispose() => _dataSource.Dispose();
}
