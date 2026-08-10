using Govori.Catalog;
using Govori.Infrastructure;
using Govori.Infrastructure.Entities;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Govori.IntegrationTests;

/// <summary>
/// C9 (task_index) + C4 (needs_premium) SQL PARITY — closes task #10's known gap.
///
/// The Govori.Characterization suite freezes the ORDERING PREDICATE and the freemium gate as a
/// pure C# transcription checked against JSON fixtures — but it CANNOT prove that the EF Core
/// LINQ actually emits the same Postgres <c>ORDER BY</c>/<c>COUNT(*)</c> (a fixture has no DB).
/// This test drives the frozen scenarios (transcribed from
/// tests/characterization/fixtures/task_index_cases.json and needs_premium_cases.json — the
/// values are the contract) through the REAL <see cref="CatalogService.TaskIndexAsync"/> /
/// <see cref="CatalogService.NeedsPremiumAsync"/> against the govori-net schema Postgres, so the
/// SQL's same-block filter, published/non-deleted filter, and strict (sort_order, created_at)
/// tie-breaking are proven end-to-end.
///
/// Rows are transcribed inline (not read from the fixture file) so the test is self-contained in
/// the SDK container, which mounts only backend-dotnet. Every seeded row is deleted in a finally.
/// </summary>
public sealed class CatalogAccessSqlParityTests : IDisposable
{
    // Fixed UTC epoch; fixture "created_at" integer ticks map to milliseconds off this instant.
    // Milliseconds are well within timestamptz precision and preserve both ordering and ties.
    private static readonly DateTime Base = new(2024, 1, 1, 0, 0, 0, DateTimeKind.Utc);

    private readonly NpgsqlDataSource _dataSource;

    public CatalogAccessSqlParityTests()
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

    // A block-scoped question row present in the DB. "A"/"B" pick which seeded block it lives in.
    private sealed record Row(int SortOrder, int CreatedAt, string Block = "A", bool Published = true, bool Deleted = false);

    // One task_index_cases.json case: the full set of rows in the block(s) + the target key.
    private sealed record TaskIndexScenario(string Name, int TargetSortOrder, int TargetCreatedAt, bool TargetHasBlock, Row[] Rows, int Expected);

    // Transcribed verbatim from task_index_cases.json (the frozen C9 contract).
    private static readonly TaskIndexScenario[] TaskIndexScenarios =
    [
        new("empty_block", 0, 100, true, [new Row(0, 100)], 0),
        new("target_first", 0, 100, true, [new Row(0, 100), new Row(1, 50), new Row(2, 50)], 0),
        new("target_last", 3, 100, true, [new Row(0, 10), new Row(1, 20), new Row(2, 30), new Row(3, 100)], 3),
        new("sort_order_tie_broken_by_created_at", 1, 100, true,
            [new Row(1, 50), new Row(1, 150), new Row(0, 999), new Row(1, 100)], 2),
        new("exact_tie_not_counted", 1, 100, true, [new Row(1, 99), new Row(1, 100), new Row(1, 100)], 1),
        new("excludes_deleted", 2, 100, true,
            [new Row(0, 10), new Row(1, 20, Deleted: true), new Row(2, 100)], 1),
        new("excludes_unpublished", 2, 100, true,
            [new Row(0, 10), new Row(1, 20, Published: false), new Row(2, 100)], 1),
        new("excludes_other_block", 2, 100, true,
            [new Row(0, 10), new Row(1, 20, Block: "B"), new Row(2, 100)], 1),
        new("no_block_returns_zero", 2, 100, false, [new Row(0, 10), new Row(1, 20)], 0),
        new("mixed_realistic", 5, 500, true,
            [
                new Row(1, 10), new Row(3, 999), new Row(2, 20, Deleted: true),
                new Row(4, 30, Published: false), new Row(6, 5), new Row(5, 500),
            ], 2),
    ];

    [Fact]
    public async Task TaskIndex_matches_the_frozen_C9_predicate_through_real_SQL()
    {
        var teacherId = Guid.NewGuid();
        var blockIds = new List<Guid>();
        var mismatches = new List<string>();

        try
        {
            await SeedTeacher(teacherId);

            foreach (var s in TaskIndexScenarios)
            {
                var blockA = Guid.NewGuid();
                var blockB = Guid.NewGuid();
                blockIds.Add(blockA);
                blockIds.Add(blockB);

                await using (var ctx = CreateContext())
                {
                    ctx.QuestionBlocks.Add(NewBlock(blockA, teacherId, "public"));
                    ctx.QuestionBlocks.Add(NewBlock(blockB, teacherId, "public"));
                    foreach (var r in s.Rows)
                    {
                        var block = r.Block == "B" ? blockB : blockA;
                        ctx.Questions.Add(NewQuestion(teacherId, block, r.SortOrder, r.CreatedAt, r.Published, r.Deleted));
                    }
                    await ctx.SaveChangesAsync();
                }

                var target = new Question
                {
                    BlockId = s.TargetHasBlock ? blockA : null,
                    SortOrder = s.TargetSortOrder,
                    CreatedAt = Base.AddMilliseconds(s.TargetCreatedAt),
                };

                await using (var ctx = CreateContext())
                {
                    var svc = new CatalogService(ctx, new CatalogOptions(), new NullObjectStorage());
                    var actual = await svc.TaskIndexAsync(target);
                    if (actual != s.Expected)
                        mismatches.Add($"'{s.Name}': EF/SQL={actual} vs frozen={s.Expected}");
                }
            }

            Assert.True(mismatches.Count == 0, "task_index SQL parity failed: " + string.Join("; ", mismatches));
        }
        finally
        {
            await Cleanup(teacherId, blockIds);
        }
    }

    // A needs_premium scenario driven through real SQL: seed `EarlierSiblings` published-live rows
    // before a target at sort_order == EarlierSiblings so the REAL task_index equals that count.
    private sealed record PremiumScenario(
        string Name, UserRole Role, bool IsPremium, string? Visibility, int FreeTasks,
        int EarlierSiblings, bool TargetHasBlock, bool Expected);

    // Transcribed from needs_premium_cases.json (the frozen C4 gate matrix). Cases whose DB reads
    // matter — the module-visibility lookup + the positional COUNT — are driven through real SQL.
    // (block_id_present=true & block_exists=false is not reproducible under the block_id FK, so it
    // is covered by the pure C# FreemiumCharacterizationTests instead; here we cover block absent.)
    private static readonly PremiumScenario[] PremiumScenarios =
    [
        // public module, non-premium student: below vs at the free threshold (the paywall edge).
        new("public_below_threshold", UserRole.Student, false, "public", 3, EarlierSiblings: 2, TargetHasBlock: true, Expected: false),
        new("public_at_threshold",    UserRole.Student, false, "public", 3, EarlierSiblings: 3, TargetHasBlock: true, Expected: true),
        // teacher-governed (group) content is never self-serve paywalled, even far past the edge.
        new("group_never_gated",      UserRole.Student, false, "group",  3, EarlierSiblings: 5, TargetHasBlock: true, Expected: false),
        // premium student bypasses the gate entirely.
        new("premium_bypass",         UserRole.Student, true,  "public", 3, EarlierSiblings: 5, TargetHasBlock: true, Expected: false),
        // only students are ever gated.
        new("teacher_never_gated",    UserRole.Teacher, false, "public", 3, EarlierSiblings: 5, TargetHasBlock: true, Expected: false),
        // n <= 0 → the whole module is free.
        new("whole_module_free",      UserRole.Student, false, "public", 0, EarlierSiblings: 5, TargetHasBlock: true, Expected: false),
        // no module → not gated.
        new("no_module",              UserRole.Student, false, "public", 3, EarlierSiblings: 0, TargetHasBlock: false, Expected: false),
    ];

    [Fact]
    public async Task NeedsPremium_matches_the_frozen_C4_gate_through_real_SQL()
    {
        var teacherId = Guid.NewGuid();
        var blockIds = new List<Guid>();
        var mismatches = new List<string>();

        try
        {
            await SeedTeacher(teacherId);

            foreach (var s in PremiumScenarios)
            {
                var blockId = Guid.NewGuid();
                blockIds.Add(blockId);

                await using (var ctx = CreateContext())
                {
                    ctx.QuestionBlocks.Add(NewBlock(blockId, teacherId, s.Visibility!));
                    // `EarlierSiblings` published, live tasks at sort_order 0..n-1 → real task_index == n.
                    for (var i = 0; i < s.EarlierSiblings; i++)
                        ctx.Questions.Add(NewQuestion(teacherId, blockId, sortOrder: i, createdAt: 10 * (i + 1)));
                    await ctx.SaveChangesAsync();
                }

                // Student + target are read-only inputs to NeedsPremium (role/premium off the User;
                // block_id/sort_order/created_at off the Question) — no need to persist them.
                var student = new User { Role = s.Role, IsPremium = s.IsPremium };
                var target = new Question
                {
                    BlockId = s.TargetHasBlock ? blockId : null,
                    SortOrder = s.EarlierSiblings,               // sits after every earlier sibling
                    CreatedAt = Base.AddMilliseconds(10_000),
                };

                await using (var ctx = CreateContext())
                {
                    var svc = new CatalogService(
                        ctx, new CatalogOptions { FreeTasksPerModule = s.FreeTasks }, new NullObjectStorage());
                    var actual = await svc.NeedsPremiumAsync(student, target);
                    if (actual != s.Expected)
                        mismatches.Add($"'{s.Name}': EF/SQL={actual} vs frozen={s.Expected}");
                }
            }

            Assert.True(mismatches.Count == 0, "needs_premium SQL parity failed: " + string.Join("; ", mismatches));
        }
        finally
        {
            await Cleanup(teacherId, blockIds);
        }
    }

    // ── seeding helpers ──
    private async Task SeedTeacher(Guid teacherId)
    {
        await using var ctx = CreateContext();
        ctx.Users.Add(new User
        {
            Id = teacherId,
            Email = $"catalog-parity-{teacherId:N}@example.test",
            FullName = "Catalog Parity Teacher",
            Role = UserRole.Teacher,
            IsActive = true,
            IsPremium = false,
            PreferredLanguage = "uz",
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
        });
        await ctx.SaveChangesAsync();
    }

    private static QuestionBlock NewBlock(Guid id, Guid teacherId, string visibility) => new()
    {
        Id = id,
        TeacherId = teacherId,
        Name = "Parity Module",
        Visibility = visibility,
        IsPublished = true,
        SortOrder = 0,
        CreatedAt = DateTime.UtcNow,
        UpdatedAt = DateTime.UtcNow,
    };

    private static Question NewQuestion(
        Guid teacherId, Guid blockId, int sortOrder, int createdAt, bool published = true, bool deleted = false) => new()
    {
        Id = Guid.NewGuid(),
        TeacherId = teacherId,
        BlockId = blockId,
        Type = QuestionType.Text,
        Title = "q",
        PromptText = "p",
        IsPublished = published,
        IsDeleted = deleted,
        IsPublic = false,
        PrepTimeSec = 0,
        AnswerTimeLimitSec = 0,
        SortOrder = sortOrder,
        CreatedAt = Base.AddMilliseconds(createdAt),
        UpdatedAt = Base,
    };

    private async Task Cleanup(Guid teacherId, List<Guid> blockIds)
    {
        await using var ctx = CreateContext();
        await ctx.Questions.Where(q => q.BlockId != null && blockIds.Contains(q.BlockId.Value)).ExecuteDeleteAsync();
        await ctx.QuestionBlocks.Where(b => blockIds.Contains(b.Id)).ExecuteDeleteAsync();
        await ctx.Users.Where(u => u.Id == teacherId).ExecuteDeleteAsync();
    }

    public void Dispose() => _dataSource.Dispose();
}
