using Govori.Identity;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;

namespace Govori.Api.Startup;

/// <summary>
/// The boot-time refusal to run production on development secrets.
///
/// <para><b>Why a hard failure and not a warning.</b> Every problem this class detects is silent at
/// runtime and total in effect. A stack that boots without <c>TELEGRAM_BOT_TOKEN</c> registers
/// <c>DevOtpDeliverySender</c>, whose fixed code <c>000000</c> then logs ANYONE in as ANY phone
/// number — the app looks completely healthy while having no authentication at all. A stack that
/// boots on the <c>.env.example</c> <c>SECRET_KEY</c> lets anyone who has read the repository mint an
/// access token for any user id, admins included. Neither shows up in a log line anyone reads, and
/// neither can be noticed from the outside until it is exploited. A process that refuses to start is
/// loud, immediate, and fixable in one deploy; a process that starts wrong is a breach.</para>
///
/// <para><b>Only in Production.</b> Development and the integration-test host deliberately run on
/// dev delivery, <c>minioadmin</c> and a short throwaway secret — that is what makes them runnable
/// with no external accounts. The gate keys off <see cref="IHostEnvironment.IsProduction"/>, so
/// nothing here changes how the stack behaves anywhere except the one environment where it matters.</para>
///
/// <para><b>One of the checks is deliberately dead code.</b> The dev-login tripwire in
/// <see cref="ThrowIfInsecure"/> asks <c>DevLoginEndpoints.IsEnabled</c> — the very predicate that
/// decides whether that bypass is mapped — whether it would fire on a host being booted as
/// Production. It cannot today, and it is there for the day the predicate is loosened by someone who
/// did not read why it was written that way. A guard that can only fire after a mistake is the only
/// kind worth having for a mistake this quiet.</para>
///
/// <para><b>The escape hatch is deliberate and deliberately awkward.</b>
/// <see cref="OverrideKey"/>=true starts a Production-configured host with insecure values, for the
/// one legitimate case: running the production image locally to reproduce something. It has to be
/// set explicitly, it is named after what it does, and it is documented in <c>.env.example</c> as
/// never belonging on a public host.</para>
/// </summary>
public static class ProductionSecrets
{
    /// <summary>Set to a truthy value to boot Production anyway. Local reproduction only.</summary>
    public const string OverrideKey = "GOVORI_ALLOW_INSECURE_PRODUCTION";

    /// <summary>
    /// Minimum <c>SECRET_KEY</c> length. HS256 signs over the RAW UTF-8 bytes of the secret (see
    /// <c>TokenService</c>), so 32 characters is the point at which the key is at least as wide as
    /// the SHA-256 output it feeds — below that the secret, not the algorithm, is the weak part.
    /// </summary>
    public const int MinSecretKeyLength = 32;

    /// <summary>
    /// Substrings that mark a secret as a placeholder somebody forgot to replace. Matched
    /// case-insensitively anywhere in the value, because the ways a placeholder survives to
    /// production are all variations on "the example file was copied and the line was skipped".
    /// </summary>
    private static readonly string[] PlaceholderMarkers =
    {
        "change-me", "changeme", "change_me", "changethis", "replace-me", "replaceme",
        "your-secret", "your_secret", "yoursecret", "supersecret", "secret-key", "secretkey",
        "do-not-use-in-prod", "donotuse", "not-for-prod", "insecure", "placeholder",
        "example", "sample", "dummy", "test-secret", "testsecret", "dev-secret", "devsecret",
    };

    /// <summary>Stock credentials shipped by MinIO and by every copy-pasted compose file.</summary>
    private static readonly HashSet<string> StockObjectStorageCredentials =
        new(StringComparer.OrdinalIgnoreCase)
        {
            "minioadmin", "minio", "admin", "password", "changeme", "root", "access-key", "secret-key",
        };

    /// <summary>
    /// Throw a single aggregated <see cref="InvalidOperationException"/> when a Production host is
    /// configured insecurely. All problems are reported at once on purpose: fixing them one restart
    /// at a time, each 40 s of container start-up apart, is how a deploy window gets spent.
    /// </summary>
    public static void ThrowIfInsecure(IConfiguration config, IHostEnvironment environment)
    {
        if (!environment.IsProduction())
            return;
        if (IsTruthy(config[OverrideKey]))
            return;

        var problems = Problems(config).Concat(HostProblems(environment)).ToList();
        if (problems.Count == 0)
            return;

        throw new InvalidOperationException(
            "Refusing to start: this host is configured for Production but is using development or "
            + "default secrets. Fix these, or set " + OverrideKey + "=true if this is a local "
            + "reproduction run and never a public host."
            + Environment.NewLine
            + string.Join(Environment.NewLine, problems.Select(p => "  • " + p)));
    }

    /// <summary>
    /// Findings that come from the HOST rather than from its configuration — things that are unsafe
    /// because of what the process will REGISTER, not because of a value somebody typed.
    ///
    /// <para>Today there is exactly one: the development-only one-tap login
    /// (<c>GET/POST /api/auth/dev/*</c>), which mints a token pair for a seeded demo account with no
    /// credential of any kind. This asks <c>DevLoginEndpoints.IsEnabled</c> — the SAME predicate that
    /// decides whether those routes get mapped, not a second opinion about it.</para>
    ///
    /// <para><b>It cannot fire today, and that is the point.</b> <c>IsDevelopment()</c> and
    /// <c>IsProduction()</c> are mutually exclusive, so on the one environment <see cref="ThrowIfInsecure"/>
    /// gates this is dead code. It is a tripwire, and a tripwire is only ever crossed by a mistake:
    /// the day that predicate is widened — to <c>!IsProduction()</c>, to a config flag, to "just for
    /// staging" — Production refuses to boot instead of quietly serving a login bypass that no log
    /// line would mention. Changing the predicate's signature also breaks this call site, which puts
    /// whoever is widening it in front of this comment.</para>
    ///
    /// <para>Separate from <see cref="Problems(IConfiguration)"/> so the configuration rules stay
    /// pure, and so this one can be driven from a test with a host environment the real runtime can
    /// never produce.</para>
    /// </summary>
    public static IReadOnlyList<string> HostProblems(IHostEnvironment environment)
    {
        if (!DevLoginEndpoints.IsEnabled(environment))
            return Array.Empty<string>();

        return new[]
        {
            "The development-only one-tap login (GET/POST /api/auth/dev/*) would be REGISTERED on this "
            + "host. It issues a full session for a seeded account with no credential of any kind, and "
            + "must not EXIST outside Development — see DevLoginEndpoints.",
        };
    }

    /// <summary>
    /// Every insecure-configuration finding, as human-readable sentences. Pure and free of the host,
    /// so the rules can be driven directly from a test instead of by booting a process and reading
    /// its exit code. Host-shaped findings live in <see cref="HostProblems"/>.
    /// </summary>
    public static IReadOnlyList<string> Problems(IConfiguration config)
    {
        var problems = new List<string>();

        // ── 1. JWT signing key ────────────────────────────────────────────────
        var secretKey = config["SECRET_KEY"];
        if (string.IsNullOrWhiteSpace(secretKey))
        {
            problems.Add("SECRET_KEY is not set. Every session token is signed with it.");
        }
        else
        {
            if (secretKey.Length < MinSecretKeyLength)
                problems.Add(
                    $"SECRET_KEY is only {secretKey.Length} characters; at least {MinSecretKeyLength} are "
                    + "required. Generate one with `openssl rand -base64 48`.");
            if (LooksLikePlaceholder(secretKey))
                problems.Add(
                    "SECRET_KEY still looks like the .env.example placeholder. Anyone who can read the "
                    + "repository could mint an admin token. Generate one with `openssl rand -base64 48`.");
        }

        // ── 2. OTP delivery — the dev channel is an authentication bypass ─────
        // Program.cs picks DevOtpDeliverySender whenever EITHER Telegram value is missing, and that
        // sender accepts the fixed code 000000 for every phone number in existence.
        var botToken = config["TELEGRAM_BOT_TOKEN"];
        var botUsername = config["TELEGRAM_BOT_USERNAME"];
        if (string.IsNullOrWhiteSpace(botToken) || string.IsNullOrWhiteSpace(botUsername))
            problems.Add(
                "TELEGRAM_BOT_TOKEN and TELEGRAM_BOT_USERNAME must BOTH be set. Without them the API "
                + "falls back to dev OTP delivery, whose fixed code 000000 logs anyone in as any phone "
                + "number.");

        // ── 3. Object storage credentials ─────────────────────────────────────
        // An unset key is as bad as a stock one: Program.cs defaults both to "minioadmin".
        foreach (var (name, value) in new[]
                 {
                     ("S3_ACCESS_KEY", config["S3_ACCESS_KEY"] ?? config["GOVORI_S3_ACCESS_KEY"]),
                     ("S3_SECRET_KEY", config["S3_SECRET_KEY"] ?? config["GOVORI_S3_SECRET_KEY"]),
                 })
        {
            if (string.IsNullOrWhiteSpace(value))
                problems.Add($"{name} is not set; the host would fall back to the stock `minioadmin` credentials.");
            else if (StockObjectStorageCredentials.Contains(value.Trim()))
                problems.Add($"{name} is a stock credential (`{value.Trim()}`). Every recorded answer is behind it.");
        }

        // ── 4. Database ───────────────────────────────────────────────────────
        // The scaffold fallback names a host that does not exist, so this is a crash rather than a
        // wrong-database write — but it is a crash 40 s into a deploy instead of at boot.
        if (string.IsNullOrWhiteSpace(config.GetConnectionString("Govori"))
            && string.IsNullOrWhiteSpace(config["GOVORI_DB"]))
        {
            problems.Add("No database connection string: set ConnectionStrings__Govori or GOVORI_DB.");
        }

        // ── 5. CORS ───────────────────────────────────────────────────────────
        // A wildcard origin is refused outright rather than downgraded: this API is called with a
        // bearer token, so "any site may read the response" is the whole of the damage.
        problems.AddRange(CorsOrigins.Problems(config["BACKEND_CORS_ORIGINS"]));

        return problems;
    }

    private static bool LooksLikePlaceholder(string value)
    {
        var lowered = value.ToLowerInvariant();
        return PlaceholderMarkers.Any(marker => lowered.Contains(marker, StringComparison.Ordinal));
    }

    /// <summary>The spellings of "yes" an operator might reasonably type into an env file.</summary>
    private static bool IsTruthy(string? value)
        => value is not null
           && (value.Trim().ToLowerInvariant() is "true" or "1" or "yes" or "on");
}
