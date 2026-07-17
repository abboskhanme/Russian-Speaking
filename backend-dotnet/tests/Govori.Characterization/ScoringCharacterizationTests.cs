using Xunit;

namespace Govori.Characterization;

/// <summary>
/// The number every student sees. Ported from the inline arithmetic in
/// workers/tasks.py:241-247 and services/gamification.py:22-29.
///
/// These are deliberately reimplemented in C# here and checked against the
/// Python-generated fixtures — the port's real scoring code (Phase 3.4) will
/// then be checked against the same fixtures.
/// </summary>
public class ScoringCharacterizationTests
{
    // ---- C5: pronunciation blend + orthoepy penalty ----

    private static double WithPron(double x, double? pron)
        => pron is null ? x : (x * 4 + pron.Value) / 5;

    private static double LevelScore(double text, double? pron, int nErrors, double perError, double cap)
    {
        var penalty = Math.Min(nErrors * perError, cap);
        return Math.Max(0.0, WithPron(text, pron) - penalty);
    }

    [Fact]
    public void Pron_blend_and_orthoepy_penalty_match_Python()
    {
        var fx = Fixtures.Load<PronMathFixture>("pron_math_cases.json");
        Assert.NotEmpty(fx.Cases);

        foreach (var c in fx.Cases)
        {
            var actual = LevelScore(c.TextScore, c.PronScore, c.OrthoepyErrors, fx.PenaltyPerError, fx.PenaltyCap);
            Assert.True(Math.Abs(actual - c.Expected) < 1e-9,
                $"score mismatch: text={c.TextScore} pron={c.PronScore?.ToString() ?? "null"} " +
                $"errs={c.OrthoepyErrors} → C#={actual} vs Python={c.Expected}");
        }
    }

    [Fact]
    public void Whisper_path_is_text_only()
    {
        // pron == null means the Whisper fallback ran (it cannot assess
        // pronunciation). Score must equal the text score minus penalty, never
        // blended with a phantom pronunciation number.
        var fx = Fixtures.Load<PronMathFixture>("pron_math_cases.json");
        foreach (var c in fx.Cases.Where(x => x.PronScore is null))
        {
            var penalty = Math.Min(c.OrthoepyErrors * fx.PenaltyPerError, fx.PenaltyCap);
            Assert.Equal(Math.Max(0.0, c.TextScore - penalty), c.Expected, 9);
        }
    }

    // ---- C8: XP curve ----

    private static int XpForBand(double? band)
    {
        var pct = band ?? 0;
        return pct < 27 ? 0 : (int)Math.Round(pct / 4, MidpointRounding.ToEven);
    }

    [Fact]
    public void Xp_curve_matches_Python()
    {
        var fx = Fixtures.Load<XpFixture>("xp_cases.json");
        Assert.NotEmpty(fx.Cases);

        foreach (var c in fx.Cases)
            Assert.Equal(c.Xp, XpForBand(c.Band));
    }

    [Fact]
    public void Xp_is_zero_below_the_floor()
    {
        // A band under 27 earns nothing — the anti-farming floor. Round-tripped
        // via the fixture so a Python change to the threshold surfaces here.
        var fx = Fixtures.Load<XpFixture>("xp_cases.json");
        foreach (var c in fx.Cases.Where(x => (x.Band ?? 0) < 27))
            Assert.Equal(0, c.Xp);
    }
}
