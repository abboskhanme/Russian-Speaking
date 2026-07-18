using Govori.Assessment;
using Xunit;

namespace Govori.Characterization;

/// <summary>
/// C5 — the REAL scoring port. Unlike <see cref="ScoringCharacterizationTests"/> (which
/// reimplements the arithmetic inline), this drives the ACTUAL production function
/// <see cref="Govori.Assessment.Scoring"/> used by the grading pipeline against the frozen
/// Python-generated fixture <c>pron_math_cases.json</c>. Every case must match — this is the proof
/// that the C# grading pipeline scores identically to <c>workers/tasks.py:239-247</c>.
/// </summary>
public class AssessmentScoringPortTests
{
    [Fact]
    public void Real_scoring_function_matches_pron_math_fixture()
    {
        var fx = Fixtures.Load<PronMathFixture>("pron_math_cases.json");
        Assert.NotEmpty(fx.Cases);

        // The frozen penalty constants must equal the production ones (a Python change surfaces here).
        Assert.Equal(Scoring.OrthoepyPenaltyPerError, fx.PenaltyPerError);
        Assert.Equal(Scoring.OrthoepyPenaltyCap, fx.PenaltyCap);

        foreach (var c in fx.Cases)
        {
            var actual = Scoring.Level(c.TextScore, c.PronScore, c.OrthoepyErrors);
            Assert.True(
                Math.Abs(actual - c.Expected) < 1e-9,
                $"C5 port mismatch: text={c.TextScore} pron={c.PronScore?.ToString() ?? "null"} " +
                $"errs={c.OrthoepyErrors} → C#={actual} vs Python={c.Expected}");
        }
    }

    [Fact]
    public void Whisper_path_is_text_only_in_the_real_function()
    {
        // pron == null ⇒ the Whisper fallback ran (no pronunciation). The real WithPron must return
        // the text score unblended, never fold in a phantom pronunciation number.
        var fx = Fixtures.Load<PronMathFixture>("pron_math_cases.json");
        foreach (var c in fx.Cases.Where(x => x.PronScore is null))
            Assert.Equal(c.TextScore, Scoring.WithPron(c.TextScore, c.PronScore), 9);
    }
}
