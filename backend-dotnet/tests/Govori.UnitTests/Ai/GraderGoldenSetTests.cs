using System.Text.Json;
using System.Text.Json.Serialization;
using Govori.Platform.Ai;
using Govori.Platform.Ai.Backends;
using Govori.Platform.Grader;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;

namespace Govori.UnitTests.Ai;

/// <summary>
/// Runs the frozen grader golden set against the REAL provider chain (docs/08 Faza 1.4–1.6).
///
/// <para>This is the instrument that makes "the new grader is as good as the old one" a
/// measurement instead of a claim. The rubric was ported verbatim from the pre-rewrite Python
/// grader specifically so this set measures the new plumbing rather than a new rubric.</para>
///
/// <para><b>Skipped unless <c>GOVORI_GOLDEN=1</c>.</b> It costs real vendor calls and takes tens of
/// seconds, so it is opt-in — but it reports itself SKIPPED rather than passing, because a run that
/// did nothing must never be readable as evidence that the grader is fine.</para>
///
/// <para><b>Threshold: 90%</b> of assertions. Not 100%: an LLM grader is stochastic, and a gate
/// demanding perfection is a gate somebody disables in week one. Not lower: at 80% the grader could
/// be wrong about one case in five and still ship. See <c>tests/golden/grader/README.md</c> for
/// what the set covers — and, as plainly, what it does not.</para>
/// </summary>
public sealed class GraderGoldenSetTests
{
    private sealed class GoldenFactAttribute : FactAttribute
    {
        public GoldenFactAttribute()
        {
            if (Environment.GetEnvironmentVariable("GOVORI_GOLDEN") != "1")
                Skip = "grader golden set — set GOVORI_GOLDEN=1 with vendor keys to run (see tests/golden/grader/README.md)";
        }
    }

    private const double PassThreshold = 0.90;

    // ── The corpus, as it sits on disk ──────────────────────────────────────

    private sealed record GoldenFile(
        [property: JsonPropertyName("cases")] List<GoldenCase> Cases,
        [property: JsonPropertyName("ordering")] List<OrderingRule> Ordering);

    private sealed record GoldenCase(
        [property: JsonPropertyName("id")] string Id,
        [property: JsonPropertyName("level")] string Level,
        [property: JsonPropertyName("topic")] string Topic,
        [property: JsonPropertyName("prompt")] string Prompt,
        [property: JsonPropertyName("transcript")] string Transcript,
        [property: JsonPropertyName("expect")] Expectation Expect);

    private sealed record Expectation(
        [property: JsonPropertyName("overall_min")] double? OverallMin,
        [property: JsonPropertyName("overall_max")] double? OverallMax,
        [property: JsonPropertyName("relevance_max")] double? RelevanceMax,
        [property: JsonPropertyName("grammar_min")] double? GrammarMin,
        [property: JsonPropertyName("min_corrections")] int? MinCorrections,
        [property: JsonPropertyName("max_corrections")] int? MaxCorrections,
        [property: JsonPropertyName("must_find_correction_types")] List<string>? MustFindCorrectionTypes,
        [property: JsonPropertyName("feedback_language")] string? FeedbackLanguage);

    private sealed record OrderingRule(
        [property: JsonPropertyName("better")] string Better,
        [property: JsonPropertyName("worse")] string Worse,
        [property: JsonPropertyName("field")] string Field,
        [property: JsonPropertyName("margin")] double Margin,
        [property: JsonPropertyName("why")] string Why);

    /// <summary>Locates <c>tests/golden/grader/cases.json</c> by walking up from the test binaries.
    /// The same walk the Characterization suite uses — the corpus lives at the REPO ROOT, not
    /// beside the assembly, so mounting only <c>backend-dotnet/</c> is what makes it disappear.</summary>
    private static GoldenFile LoadCorpus()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            var candidate = Path.Combine(dir.FullName, "tests", "golden", "grader", "cases.json");
            if (File.Exists(candidate))
                return JsonSerializer.Deserialize<GoldenFile>(File.ReadAllText(candidate))!;
            dir = dir.Parent;
        }

        throw new FileNotFoundException(
            "tests/golden/grader/cases.json not found walking up from " + AppContext.BaseDirectory +
            " — mount the REPO ROOT, not backend-dotnet/.");
    }

    // ── The chain, built from the environment ───────────────────────────────

    private static (IGraderProvider Chain, AiRuntimeConfig Config) BuildChain()
    {
        var config = new AiRuntimeConfig
        {
            GraderChain = AiProviders.ParseChain(
                Environment.GetEnvironmentVariable("GRADER_CHAIN"), AiProviders.DefaultGraderChain),
            AnthropicApiKey = Environment.GetEnvironmentVariable("ANTHROPIC_API_KEY"),
            AnthropicModel = Environment.GetEnvironmentVariable("ANTHROPIC_MODEL") ?? AiProviders.DefaultAnthropicModel,
            GeminiApiKey = Environment.GetEnvironmentVariable("GEMINI_API_KEY"),
            GeminiModel = Environment.GetEnvironmentVariable("GEMINI_MODEL") ?? "gemini-3.1-flash-lite",
            OpenAiApiKey = Environment.GetEnvironmentVariable("OPENAI_API_KEY"),
            OpenAiGraderModel = Environment.GetEnvironmentVariable("OPENAI_GRADER_MODEL") ?? "gpt-4o-mini",
        };

        var http = new ServiceCollection().AddHttpClient().BuildServiceProvider()
            .GetRequiredService<IHttpClientFactory>();

        IGraderBackend[] backends =
        [
            new AnthropicGraderBackend(http),
            new GeminiGraderBackend(http),
            new OpenAiGraderBackend(http),
        ];

        return (new ChainGraderProvider(backends, new Static(config), NullLogger<ChainGraderProvider>.Instance), config);
    }

    private sealed class Static : IAiConfigSource
    {
        private readonly AiRuntimeConfig _c;
        public Static(AiRuntimeConfig c) => _c = c;
        public Task<AiRuntimeConfig> GetAsync(CancellationToken ct = default) => Task.FromResult(_c);
    }

    // ── Assertion helpers ───────────────────────────────────────────────────

    private sealed class Tally
    {
        private readonly List<string> _failures = new();
        public int Total { get; private set; }
        public IReadOnlyList<string> Failures => _failures;

        public void Check(bool ok, string description)
        {
            Total++;
            if (!ok) _failures.Add(description);
        }

        public double Rate => Total == 0 ? 0 : (Total - _failures.Count) / (double)Total;
    }

    /// <summary>Uzbek here is written in Latin script; Russian feedback would be Cyrillic. Counting
    /// scripts is crude but it is the check that actually catches the regression that matters — a
    /// grader quietly answering in Russian to an Uzbek-speaking learner.</summary>
    private static bool LooksUzbek(string? text)
    {
        if (string.IsNullOrWhiteSpace(text)) return false;
        var latin = text.Count(c => c is >= 'a' and <= 'z' or >= 'A' and <= 'Z');
        var cyrillic = text.Count(c => c is >= 'Ѐ' and <= 'ӿ');
        return latin > 10 && latin > cyrillic;
    }

    /// <summary>C6: a "correction" whose only difference is punctuation, casing or whitespace is not
    /// a correction. Checked on every case rather than per case, because it is a property of the
    /// grader — showing a student a fix for a mistake they could not have made out loud is the way
    /// to teach them that correct Russian is wrong.</summary>
    private static bool IsCosmetic(GraderCorrection c)
    {
        static string Strip(string s) => new(s
            .ToLowerInvariant()
            .Replace('ё', 'е')
            .Where(ch => char.IsLetterOrDigit(ch))
            .ToArray());

        return Strip(c.Original) == Strip(c.Corrected);
    }

    private static double Field(GraderScores s, string field) => field switch
    {
        "overall" => s.Overall,
        "relevance" => s.Relevance,
        "grammar" => s.Grammar,
        "lexical" => s.Lexical,
        "fluency" => s.Fluency,
        "level_overall" => s.LevelOverall,
        _ => throw new ArgumentException($"unknown ordering field '{field}'"),
    };

    // ── The run ─────────────────────────────────────────────────────────────

    [GoldenFact]
    public async Task GraderMeetsTheGoldenSet()
    {
        var corpus = LoadCorpus();
        var (chain, config) = BuildChain();

        Assert.True(await chain.IsConfiguredAsync(CancellationToken.None),
            "no grader backend is configured — the golden set cannot measure anything. " +
            $"Chain: [{string.Join(", ", config.GraderChain)}]");

        var tally = new Tally();
        var results = new Dictionary<string, GraderResult>();

        // Sequential on purpose. Firing 18 requests at once is the fastest way to be rate-limited
        // by the vendor, and a 429 would read as a grader regression rather than as impatience.
        foreach (var c in corpus.Cases)
        {
            GraderResult r;
            try
            {
                r = await chain.AnalyzeAsync(new GraderRequest
                {
                    QuestionPrompt = c.Prompt,
                    TranscriptText = c.Transcript,
                    Level = c.Level,
                    Topic = c.Topic,
                }, CancellationToken.None);
            }
            catch (Exception ex)
            {
                // A hard failure costs every assertion that case carried — it is not a free skip.
                tally.Check(false, $"{c.Id}: the chain threw — {ex.GetType().Name}: {ex.Message}");
                continue;
            }

            results[c.Id] = r;
            var s = r.Scores;
            Console.WriteLine(
                $"  {c.Id,-24} overall={s.Overall,3:0} gram={s.Grammar,3:0} rel={s.Relevance,3:0} " +
                $"lex={s.Lexical,3:0} flu={s.Fluency,3:0} corr={r.Corrections.Count} [{r.Model}]");

            var e = c.Expect;
            if (e.OverallMin is { } omin)
                tally.Check(s.Overall >= omin, $"{c.Id}: overall {s.Overall:0} < required min {omin}");
            if (e.OverallMax is { } omax)
                tally.Check(s.Overall <= omax, $"{c.Id}: overall {s.Overall:0} > allowed max {omax}");
            if (e.RelevanceMax is { } rmax)
                tally.Check(s.Relevance <= rmax, $"{c.Id}: relevance {s.Relevance:0} > allowed max {rmax}");
            if (e.GrammarMin is { } gmin)
                tally.Check(s.Grammar >= gmin, $"{c.Id}: grammar {s.Grammar:0} < required min {gmin}");
            if (e.MinCorrections is { } cmin)
                tally.Check(r.Corrections.Count >= cmin,
                    $"{c.Id}: {r.Corrections.Count} correction(s), expected at least {cmin} — the error was missed");
            if (e.MaxCorrections is { } cmax)
                tally.Check(r.Corrections.Count <= cmax,
                    $"{c.Id}: {r.Corrections.Count} correction(s), expected at most {cmax} — corrections invented");
            if (e.MustFindCorrectionTypes is { Count: > 0 } types)
                foreach (var t in types)
                    tally.Check(
                        r.Corrections.Any(x => string.Equals(x.Type, t, StringComparison.OrdinalIgnoreCase)),
                        $"{c.Id}: no correction of type '{t}'");
            if (e.FeedbackLanguage == "uz")
                tally.Check(LooksUzbek(r.Summary),
                    $"{c.Id}: feedback does not read as Uzbek — \"{Trim(r.Summary)}\"");

            // C6, on every case.
            var cosmetic = r.Corrections.Where(IsCosmetic).ToList();
            tally.Check(cosmetic.Count == 0,
                $"{c.Id}: {cosmetic.Count} cosmetic correction(s) survived C6, e.g. " +
                $"\"{cosmetic.FirstOrDefault()?.Original}\" → \"{cosmetic.FirstOrDefault()?.Corrected}\"");

            // Aggregates must be independent numbers, not one copied into the other.
            tally.Check(s.LevelOverall is >= 0 and <= 100, $"{c.Id}: level_overall {s.LevelOverall:0} out of range");
        }

        // Ordering: the checks that survive model drift. Whatever the absolute numbers do, a better
        // answer must outrank a worse one.
        Console.WriteLine();
        foreach (var o in corpus.Ordering)
        {
            if (!results.TryGetValue(o.Better, out var b) || !results.TryGetValue(o.Worse, out var w))
            {
                tally.Check(false, $"ordering {o.Better} > {o.Worse}: a case did not produce a result");
                continue;
            }

            var gap = Field(b.Scores, o.Field) - Field(w.Scores, o.Field);
            var ok = gap >= o.Margin;
            Console.WriteLine(
                $"  {(ok ? "ok  " : "FAIL")} {o.Better} > {o.Worse} on {o.Field}: gap {gap:0} (need {o.Margin:0})");
            tally.Check(ok,
                $"ordering {o.Better} > {o.Worse} on {o.Field}: gap {gap:0} < margin {o.Margin:0} — {o.Why}");
        }

        Console.WriteLine();
        Console.WriteLine($"  golden set: {tally.Total - tally.Failures.Count}/{tally.Total} " +
                          $"({tally.Rate:P1}), threshold {PassThreshold:P0}");
        foreach (var f in tally.Failures) Console.WriteLine($"    ✗ {f}");

        Assert.True(tally.Rate >= PassThreshold,
            $"grader golden set at {tally.Rate:P1}, below the {PassThreshold:P0} gate:\n" +
            string.Join("\n", tally.Failures.Select(f => "  - " + f)));
    }

    private static string Trim(string? s)
        => s is null ? "" : s.Length <= 60 ? s : s[..60] + "…";
}
