using Govori.Api.Startup;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;

namespace Govori.IntegrationTests;

/// <summary>
/// The boot-time refusal to run production on development secrets
/// (<see cref="ProductionSecrets"/>).
///
/// <para>These drive the RULES directly rather than booting a host, because the thing under test is
/// a host that does NOT come up — asserting on that through <c>WebApplicationFactory</c> would mean
/// catching a startup exception out of a background host and would tell us far less about WHICH rule
/// fired. The rules are pure, so each one gets a case.</para>
///
/// <para>They live in this assembly rather than Govori.UnitTests only because
/// <c>Govori.Api</c> is referenced here already; nothing about them needs a database, and they carry
/// no collection fixture so they never touch one.</para>
/// </summary>
public sealed class ProductionSecretsTests
{
    /// <summary>A configuration with every rule satisfied, which individual tests then break in one
    /// place each. Keeping the healthy baseline in one method is what makes a failing test name the
    /// single thing that is wrong.</summary>
    private static Dictionary<string, string?> HealthyProduction() => new()
    {
        ["SECRET_KEY"] = "Jm4kQe1sVbN7pXtZ2cRw9yUiOaSdFgHjKlPmQwErTyUi",   // 44 chars, no placeholder marker
        ["TELEGRAM_BOT_TOKEN"] = "1234567890:AAH-real-looking-bot-token",
        ["TELEGRAM_BOT_USERNAME"] = "govori_bot",
        ["S3_ACCESS_KEY"] = "AKIA-REAL-LOOKING-ACCESS-KEY",
        ["S3_SECRET_KEY"] = "a-real-looking-object-storage-secret",
        ["GOVORI_DB"] = "Host=db;Port=5432;Database=russpeak;Username=russpeak;Password=notdefault",
    };

    private static IConfiguration Config(Action<Dictionary<string, string?>>? mutate = null)
    {
        var values = HealthyProduction();
        mutate?.Invoke(values);
        return new ConfigurationBuilder().AddInMemoryCollection(values).Build();
    }

    private static IReadOnlyList<string> ProblemsFor(Action<Dictionary<string, string?>>? mutate = null)
        => ProductionSecrets.Problems(Config(mutate));

    // ── the healthy baseline ─────────────────────────────────────────────────

    [Fact]
    public void A_fully_configured_production_host_has_no_problems()
    {
        Assert.Empty(ProblemsFor());
    }

    // ── SECRET_KEY: JWT forgery ──────────────────────────────────────────────

    [Fact]
    public void Missing_secret_key_is_a_problem()
    {
        var problems = ProblemsFor(v => v["SECRET_KEY"] = null);
        Assert.Contains(problems, p => p.Contains("SECRET_KEY is not set", StringComparison.Ordinal));
    }

    [Fact]
    public void Short_secret_key_is_a_problem()
    {
        var problems = ProblemsFor(v => v["SECRET_KEY"] = "abcdefghijklmnop");   // 16 chars
        Assert.Contains(problems, p => p.Contains("at least 32", StringComparison.Ordinal));
    }

    /// <summary>The exact value shipped in <c>.env.example</c>. If this ever stops being caught, the
    /// most likely way a production host gets a forgeable signing key is open again.</summary>
    [Fact]
    public void The_env_example_placeholder_secret_key_is_a_problem()
    {
        var problems = ProblemsFor(v => v["SECRET_KEY"] = "change-me-in-production-use-a-long-random-string");
        Assert.Contains(problems, p => p.Contains("placeholder", StringComparison.Ordinal));
    }

    /// <summary>The integration suite's own secret is long enough to pass the length rule, so only
    /// the placeholder-marker rule catches it. That is exactly the case worth pinning: a test secret
    /// copied into a deploy is a realistic accident.</summary>
    [Fact]
    public void A_test_suite_secret_key_is_a_problem_despite_being_long_enough()
    {
        var testSecret = "identity-domain-integration-test-secret-key-do-not-use-in-prod";
        Assert.True(testSecret.Length >= ProductionSecrets.MinSecretKeyLength);

        var problems = ProblemsFor(v => v["SECRET_KEY"] = testSecret);
        Assert.Contains(problems, p => p.Contains("placeholder", StringComparison.Ordinal));
    }

    // ── OTP delivery: the 000000 authentication bypass ────────────────────────

    [Theory]
    [InlineData("TELEGRAM_BOT_TOKEN")]
    [InlineData("TELEGRAM_BOT_USERNAME")]
    public void Missing_either_telegram_setting_is_a_problem(string key)
    {
        // Program.cs requires BOTH to register the real sender; with either absent it falls back to
        // DevOtpDeliverySender, whose fixed code 000000 is accepted for every phone number.
        var problems = ProblemsFor(v => v[key] = null);
        Assert.Contains(problems, p => p.Contains("000000", StringComparison.Ordinal));
    }

    // ── Object storage ───────────────────────────────────────────────────────

    [Theory]
    [InlineData("S3_ACCESS_KEY")]
    [InlineData("S3_SECRET_KEY")]
    public void Stock_minio_object_storage_credentials_are_a_problem(string key)
    {
        var problems = ProblemsFor(v => v[key] = "minioadmin");
        Assert.Contains(problems, p => p.Contains(key, StringComparison.Ordinal)
                                       && p.Contains("stock credential", StringComparison.Ordinal));
    }

    [Fact]
    public void Unset_object_storage_credentials_are_a_problem_because_the_default_is_minioadmin()
    {
        var problems = ProblemsFor(v =>
        {
            v["S3_ACCESS_KEY"] = null;
            v["S3_SECRET_KEY"] = null;
        });
        Assert.Contains(problems, p => p.Contains("S3_ACCESS_KEY", StringComparison.Ordinal));
        Assert.Contains(problems, p => p.Contains("S3_SECRET_KEY", StringComparison.Ordinal));
    }

    /// <summary>The compose stack sets the GOVORI_S3_* spelling; Program.cs accepts either, so the
    /// rule has to as well or it would demand a variable the running stack does not use.</summary>
    [Fact]
    public void The_govori_s3_spelling_satisfies_the_object_storage_rule()
    {
        var problems = ProblemsFor(v =>
        {
            v["S3_ACCESS_KEY"] = null;
            v["S3_SECRET_KEY"] = null;
            v["GOVORI_S3_ACCESS_KEY"] = "AKIA-REAL-LOOKING-ACCESS-KEY";
            v["GOVORI_S3_SECRET_KEY"] = "a-real-looking-object-storage-secret";
        });
        Assert.DoesNotContain(problems, p => p.Contains("S3_", StringComparison.Ordinal));
    }

    // ── Database ─────────────────────────────────────────────────────────────

    [Fact]
    public void No_connection_string_at_all_is_a_problem()
    {
        var problems = ProblemsFor(v => v["GOVORI_DB"] = null);
        Assert.Contains(problems, p => p.Contains("database connection string", StringComparison.Ordinal));
    }

    [Fact]
    public void The_connection_strings_section_satisfies_the_database_rule()
    {
        var problems = ProblemsFor(v =>
        {
            v["GOVORI_DB"] = null;
            v["ConnectionStrings:Govori"] = "Host=db;Port=5432;Database=russpeak;Username=u;Password=p";
        });
        Assert.DoesNotContain(problems, p => p.Contains("database connection string", StringComparison.Ordinal));
    }

    // ── CORS ─────────────────────────────────────────────────────────────────

    [Fact]
    public void A_wildcard_cors_origin_is_a_problem()
    {
        var problems = ProblemsFor(v => v["BACKEND_CORS_ORIGINS"] = "*");
        Assert.Contains(problems, p => p.Contains("wildcard", StringComparison.Ordinal));
    }

    [Fact]
    public void The_real_production_origins_are_not_a_problem()
    {
        var problems = ProblemsFor(v => v["BACKEND_CORS_ORIGINS"] = "https://govorim.uz,https://www.govorim.uz");
        Assert.Empty(problems);
    }

    // ── environment gating + escape hatch ────────────────────────────────────

    /// <summary>Development and the test host run on dev delivery, minioadmin and a throwaway
    /// secret ON PURPOSE — that is what makes the stack runnable with no external accounts. The gate
    /// must not fire there, or every developer's first `docker compose up` fails.</summary>
    [Fact]
    public void Development_is_never_gated_however_insecure()
    {
        var insecure = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["SECRET_KEY"] = "x" })
            .Build();

        ProductionSecrets.ThrowIfInsecure(insecure, new StubEnvironment(Environments.Development));
    }

    [Fact]
    public void Production_with_insecure_settings_refuses_to_start()
    {
        var insecure = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["SECRET_KEY"] = "change-me-in-production-use-a-long-random-string",
            })
            .Build();

        var ex = Assert.Throws<InvalidOperationException>(
            () => ProductionSecrets.ThrowIfInsecure(insecure, new StubEnvironment(Environments.Production)));

        // The message has to name every problem at once: fixing them one 40-second container restart
        // at a time is how a deploy window gets spent.
        Assert.Contains("SECRET_KEY", ex.Message, StringComparison.Ordinal);
        Assert.Contains("000000", ex.Message, StringComparison.Ordinal);
        Assert.Contains(ProductionSecrets.OverrideKey, ex.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Production_with_a_healthy_configuration_starts()
    {
        ProductionSecrets.ThrowIfInsecure(Config(), new StubEnvironment(Environments.Production));
    }

    [Theory]
    [InlineData("true")]
    [InlineData("1")]
    [InlineData("yes")]
    public void The_explicit_override_lets_a_production_host_boot_insecurely(string truthy)
    {
        var insecure = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["SECRET_KEY"] = "change-me-in-production-use-a-long-random-string",
                [ProductionSecrets.OverrideKey] = truthy,
            })
            .Build();

        ProductionSecrets.ThrowIfInsecure(insecure, new StubEnvironment(Environments.Production));
    }

    /// <summary>An override that is not an affirmative word must NOT disable the gate — otherwise
    /// `GOVORI_ALLOW_INSECURE_PRODUCTION=false` would read as "allow", which is the opposite of what
    /// an operator typing it means.</summary>
    [Fact]
    public void A_falsey_override_does_not_disable_the_gate()
    {
        var insecure = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["SECRET_KEY"] = "change-me-in-production-use-a-long-random-string",
                [ProductionSecrets.OverrideKey] = "false",
            })
            .Build();

        Assert.Throws<InvalidOperationException>(
            () => ProductionSecrets.ThrowIfInsecure(insecure, new StubEnvironment(Environments.Production)));
    }

    /// <summary>Minimal <see cref="IHostEnvironment"/>: the gate reads only EnvironmentName (through
    /// IsProduction/IsDevelopment), so nothing else needs to be real.</summary>
    private sealed class StubEnvironment : IHostEnvironment
    {
        public StubEnvironment(string environmentName) => EnvironmentName = environmentName;

        public string EnvironmentName { get; set; }
        public string ApplicationName { get; set; } = "Govori.Api";
        public string ContentRootPath { get; set; } = AppContext.BaseDirectory;
        public Microsoft.Extensions.FileProviders.IFileProvider ContentRootFileProvider { get; set; } =
            new Microsoft.Extensions.FileProviders.NullFileProvider();
    }
}
