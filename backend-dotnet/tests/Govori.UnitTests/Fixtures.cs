using System.Text.Json;

namespace Govori.UnitTests;

/// <summary>
/// Loads the frozen golden characterization fixtures
/// (tests/characterization/fixtures/*.json). These files are the specification:
/// the production code must agree with them, never the other way around. They are
/// read-only here — this project may not edit them, and nothing regenerates them.
///
/// Walk-up logic mirrors Govori.Characterization/Fixtures.cs so the tests run
/// from any working directory (including the Docker mount where the fixtures live
/// at /work/tests/characterization/fixtures).
/// </summary>
internal static class Fixtures
{
    private static readonly JsonSerializerOptions Options = new()
    {
        // Fixtures use snake_case keys (password_utf8_bytes, test_secret, ...).
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        PropertyNameCaseInsensitive = true,
    };

    private static readonly Lazy<string> Root = new(() =>
    {
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
// Fixture shapes. Mirror tests/characterization/fixtures/*.json.
// ---------------------------------------------------------------------------

// Public because xUnit [MemberData] feeds these as parameters to public test
// methods; a public method may not take a less-accessible parameter type.
public sealed record BcryptFixture(string Algorithm, string Prefix, int Cost, int TruncateBytes, BcryptCase[] Cases);
public sealed record BcryptCase(string Password, int PasswordUtf8Bytes, string Hash, bool Verifies, bool WrongPasswordVerifies);

public sealed record JwtFixture(string Algorithm, string TestSecret, string[] Claims, string[] AbsentClaims, JwtCase[] Cases);
public sealed record JwtCase(string Subject, string Type, string Token, string[] DecodedClaims, string Sub);
