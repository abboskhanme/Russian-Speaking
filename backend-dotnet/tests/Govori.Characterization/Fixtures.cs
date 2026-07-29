using System.Text.Json;

namespace Govori.Characterization;

/// <summary>
/// Loads the JSON golden fixtures in <c>tests/characterization/fixtures/</c>.
///
/// These files are FROZEN GOLDEN SNAPSHOTS owned by this test project — they are
/// the specification of the behavior, not a derived artifact, and nothing
/// regenerates them. They must never be edited to make a C# test pass: a
/// disagreement means the production code changed behavior, which is the bug the
/// test exists to catch.
/// </summary>
internal static class Fixtures
{
    private static readonly JsonSerializerOptions Options = new()
    {
        // The fixture files use snake_case keys (password_utf8_bytes,
        // penalty_per_error, ...). Map them to the PascalCase record properties.
        // Case-insensitive matching alone does NOT bridge snake_case →
        // PascalCase, so the naming policy is required.
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        PropertyNameCaseInsensitive = true,
    };

    private static readonly Lazy<string> Root = new(() =>
    {
        // Walk up from the test assembly to the repo root, then into the shared
        // fixture directory. Keeps the tests runnable from any working dir.
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !Directory.Exists(Path.Combine(dir.FullName, "tests", "characterization", "fixtures")))
            dir = dir.Parent;

        if (dir is null)
            throw new InvalidOperationException(
                "Could not locate tests/characterization/fixtures by walking up from " +
                AppContext.BaseDirectory + ". The golden fixtures live at the REPO ROOT, so the " +
                "tests must run with the repo root available (not just backend-dotnet/).");

        return Path.Combine(dir.FullName, "tests", "characterization", "fixtures");
    });

    public static T Load<T>(string fileName)
    {
        var path = Path.Combine(Root.Value, fileName);
        if (!File.Exists(path))
            throw new FileNotFoundException(
                $"Golden fixture missing: {path}. It is checked into the repo — restore it from git.", path);

        return JsonSerializer.Deserialize<T>(File.ReadAllText(path), Options)
               ?? throw new InvalidOperationException($"Fixture {fileName} deserialized to null.");
    }
}

// ---------------------------------------------------------------------------
// Fixture shapes — these records must match the on-disk golden JSON exactly.
// ---------------------------------------------------------------------------

internal sealed record BcryptFixture(string Algorithm, string Prefix, int Cost, int TruncateBytes, BcryptCase[] Cases);
internal sealed record BcryptCase(string Password, int PasswordUtf8Bytes, string Hash, bool Verifies, bool WrongPasswordVerifies);

internal sealed record JwtFixture(string Algorithm, string[] Claims, string[] AbsentClaims, JwtCase[] Cases);
internal sealed record JwtCase(string Subject, string Type, string Token, string[] DecodedClaims, string Sub);

internal sealed record XpFixture(XpCase[] Cases);
internal sealed record XpCase(double? Band, int Xp);

internal sealed record PronMathFixture(double PenaltyPerError, double PenaltyCap, PronMathCase[] Cases);
internal sealed record PronMathCase(double TextScore, double? PronScore, int OrthoepyErrors, double Expected);

internal sealed record CosmeticFixture(CosmeticCase[] Cases);
internal sealed record CosmeticCase(string Original, string Corrected, string NormOriginal, string NormCorrected, bool Keep);

internal sealed record PhoneFixture(PhoneCase[] Cases);
internal sealed record PhoneCase(string Input, string? Output, bool Raises);

internal sealed record ReferenceMatchFixture(double OnTopicThreshold, ReferenceMatchCase[] Cases);
internal sealed record ReferenceMatchCase(string Reference, string Spoken, ReferenceMatchResult Result);
internal sealed record ReferenceMatchResult(
    double Completeness, double Similarity, int MatchedWords, int ReferenceWords, int SpokenWords, bool OnTopic);

// C3 — progress scoring: effective_band / rolling_avg / best_band.
internal sealed record ScoringFixture(int RecentWindow, ScoringScenario[] Cases);
internal sealed record ScoringScenario(
    string Name, int Window, ScoringSubmission[] Submissions, double? RollingAvg, double? BestBand);
internal sealed record ScoringSubmission(
    long CreatedAt, double? TeacherBand, bool HasEvaluation, double? LevelScore, double? OverallBand, double? EffectiveBand);

// C4 — needs_premium: the freemium paywall decision.
internal sealed record NeedsPremiumFixture(int DefaultFreeTasksPerModule, NeedsPremiumCase[] Cases);
internal sealed record NeedsPremiumCase(
    string Role, bool IsPremium, bool BlockIdPresent, bool BlockExists,
    string? Visibility, int FreeTasksPerModule, int TaskIndex, bool Expected);

// C9 — task_index: the sibling-ordering predicate behind the positional gate.
internal sealed record TaskIndexFixture(TaskIndexCase[] Cases);
internal sealed record TaskIndexCase(
    string Name, string BlockId, TaskIndexTarget Target, TaskIndexRow[] Siblings, int ExpectedIndex);
internal sealed record TaskIndexTarget(int SortOrder, long CreatedAt, string? BlockId, bool BlockIdPresent);
internal sealed record TaskIndexRow(int SortOrder, long CreatedAt, string BlockId, bool IsPublished, bool IsDeleted);
