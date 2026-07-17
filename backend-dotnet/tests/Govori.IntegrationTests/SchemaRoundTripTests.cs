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
/// Connects to the already-running govori-net schema DB via the GOVORI_TEST_DB env var
/// (default = the govori-net connection string).
///
/// TODO(§7.3): migrate to Testcontainers.PostgreSql once docker-in-docker is available in
/// CI so the test spins up its own throwaway Postgres instead of the shared schema DB.
/// </summary>
public sealed class SchemaRoundTripTests : IDisposable
{
    private readonly NpgsqlDataSource _dataSource;

    public SchemaRoundTripTests()
    {
        var connectionString =
            Environment.GetEnvironmentVariable("GOVORI_TEST_DB")
            ?? GovoriDataSourceFactory.DefaultConnectionString;

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
        // ---- 1. Read existing sample data: 34 users, role deserializes to the PG enum ----
        await using (var ctx = CreateContext())
        {
            var userCount = await ctx.Users.CountAsync();
            Assert.Equal(34, userCount);

            // The enum read path against real prod-shaped rows must not throw and must
            // materialize the native user_role enum. The seeded distribution is fixed.
            var byRole = await ctx.Users
                .GroupBy(u => u.Role)
                .Select(g => new { Role = g.Key, Count = g.Count() })
                .ToDictionaryAsync(x => x.Role, x => x.Count);

            Assert.Equal(2, byRole[UserRole.Admin]);
            Assert.Equal(26, byRole[UserRole.Student]);
            Assert.Equal(6, byRole[UserRole.Teacher]);
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

    public void Dispose() => _dataSource.Dispose();
}
