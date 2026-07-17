using System.Text.RegularExpressions;
using Xunit;

namespace Govori.Characterization;

/// <summary>
/// C7 — the shadowing reference match (services/stt.py:_reference_match).
///
/// This is the single hardest fixture to port faithfully: it is built on
/// Python's <c>difflib.SequenceMatcher</c> (Ratcliff–Obershelp), which .NET has
/// no equivalent for. The gate it feeds — <c>on_topic = completeness >= 50</c> —
/// decides whether a shadowing attempt earns XP, so a silent drift here quietly
/// changes every student's reward. The C# below is a line-for-line port of the
/// CPython algorithm with <c>isjunk=None, autojunk=False</c> (exactly how the
/// production code constructs it), checked against the Python-generated fixture.
///
/// Python (stt.py:202-217):
///     ref    = _normalize_words(reference_text)
///     spoken = _normalize_words(spoken_text)
///     matcher = difflib.SequenceMatcher(None, ref, spoken, autojunk=False)
///     matched = sum(block.size for block in matcher.get_matching_blocks())
///     completeness = round(matched / len(ref) * 100, 1)
///     similarity   = round(matcher.ratio(), 3)
///     on_topic     = completeness >= 50.0
/// </summary>
public class ReferenceMatchCharacterizationTests
{
    private static readonly ReferenceMatchFixture Fx =
        Fixtures.Load<ReferenceMatchFixture>("reference_match_cases.json");

    [Fact]
    public void Fixture_pins_the_on_topic_gate()
    {
        Assert.Equal(50.0, Fx.OnTopicThreshold);
        Assert.NotEmpty(Fx.Cases);
    }

    [Fact]
    public void Reference_match_matches_Python_on_every_case()
    {
        foreach (var c in Fx.Cases)
        {
            var actual = ReferenceMatch(c.Spoken, c.Reference);
            Assert.NotNull(actual);
            var r = actual!;

            Assert.Equal(c.Result.MatchedWords, r.MatchedWords);
            Assert.Equal(c.Result.ReferenceWords, r.ReferenceWords);
            Assert.Equal(c.Result.SpokenWords, r.SpokenWords);
            Assert.Equal(c.Result.Completeness, r.Completeness, 1);
            Assert.Equal(c.Result.Similarity, r.Similarity, 3);
            Assert.Equal(c.Result.OnTopic, r.OnTopic);
        }
    }

    [Fact]
    public void The_on_topic_gate_is_purely_a_function_of_completeness()
    {
        // Guards against a port that wires on_topic to `similarity` (a different
        // number) instead of `completeness`. The fixture proves they diverge:
        // "я иду в магазин" vs "я иду в магазин сегодня" has completeness 100 but
        // similarity 0.889.
        foreach (var c in Fx.Cases)
            Assert.Equal(c.Result.Completeness >= Fx.OnTopicThreshold, c.Result.OnTopic);
    }

    // ------------------------------------------------------------------
    // Faithful port of the production function.
    // ------------------------------------------------------------------

    private static ReferenceMatchResult? ReferenceMatch(string? spokenText, string? referenceText)
    {
        var reference = NormalizeWords(referenceText);
        if (reference.Count == 0)
            return null;                       // Python: `if not ref: return None`
        var spoken = NormalizeWords(spokenText);

        var matched = TotalMatchedSize(reference, spoken);
        var completeness = Math.Round(matched / (double)reference.Count * 100, 1, MidpointRounding.ToEven);
        var total = reference.Count + spoken.Count;
        var ratio = total == 0 ? 1.0 : 2.0 * matched / total;   // difflib.ratio()
        var similarity = Math.Round(ratio, 3, MidpointRounding.ToEven);

        return new ReferenceMatchResult(
            Completeness: completeness,
            Similarity: similarity,
            MatchedWords: matched,
            ReferenceWords: reference.Count,
            SpokenWords: spoken.Count,
            OnTopic: completeness >= 50.0);
    }

    // _normalize_words: lower → non-word/space → space → split on whitespace.
    // Python's re.UNICODE \w and .NET's default \w both match Unicode letters
    // (incl. Cyrillic), digits, and underscore — identical for our inputs.
    private static List<string> NormalizeWords(string? text)
    {
        var cleaned = Regex.Replace((text ?? "").ToLowerInvariant(), @"[^\w\s]", " ");
        return cleaned.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries).ToList();
    }

    // sum(block.size for block in SequenceMatcher(None, a, b, autojunk=False).get_matching_blocks())
    // Order of recursion does not affect the sum, so we skip the sort/merge/sentinel.
    private static int TotalMatchedSize(IReadOnlyList<string> a, IReadOnlyList<string> b)
    {
        // b2j: element → ascending indices in b (no junk, autojunk disabled → all kept).
        var b2j = new Dictionary<string, List<int>>();
        for (var j = 0; j < b.Count; j++)
        {
            if (!b2j.TryGetValue(b[j], out var list))
                b2j[b[j]] = list = new List<int>();
            list.Add(j);
        }

        var matched = 0;
        var stack = new Stack<(int alo, int ahi, int blo, int bhi)>();
        stack.Push((0, a.Count, 0, b.Count));
        while (stack.Count > 0)
        {
            var (alo, ahi, blo, bhi) = stack.Pop();
            var (i, j, k) = FindLongestMatch(a, b, b2j, alo, ahi, blo, bhi);
            if (k <= 0) continue;
            matched += k;
            if (alo < i && blo < j) stack.Push((alo, i, blo, j));
            if (i + k < ahi && j + k < bhi) stack.Push((i + k, ahi, j + k, bhi));
        }
        return matched;
    }

    // CPython SequenceMatcher.find_longest_match with no junk. Tie-break: the
    // block with the smallest i, then the smallest j, wins — preserved by the
    // strict `k > bestsize` comparison and the ascending b2j iteration.
    private static (int besti, int bestj, int bestsize) FindLongestMatch(
        IReadOnlyList<string> a, IReadOnlyList<string> b,
        Dictionary<string, List<int>> b2j,
        int alo, int ahi, int blo, int bhi)
    {
        int besti = alo, bestj = blo, bestsize = 0;
        var j2len = new Dictionary<int, int>();
        for (var i = alo; i < ahi; i++)
        {
            var newj2len = new Dictionary<int, int>();
            if (b2j.TryGetValue(a[i], out var js))
            {
                foreach (var j in js)          // ascending
                {
                    if (j < blo) continue;
                    if (j >= bhi) break;
                    var k = (j2len.TryGetValue(j - 1, out var prev) ? prev : 0) + 1;
                    newj2len[j] = k;
                    if (k > bestsize)
                        (besti, bestj, bestsize) = (i - k + 1, j - k + 1, k);
                }
            }
            j2len = newj2len;
        }
        // No junk: extend the match over equal adjacent elements on both sides.
        while (besti > alo && bestj > blo && a[besti - 1] == b[bestj - 1])
            (besti, bestj, bestsize) = (besti - 1, bestj - 1, bestsize + 1);
        while (besti + bestsize < ahi && bestj + bestsize < bhi
               && a[besti + bestsize] == b[bestj + bestsize])
            bestsize++;
        return (besti, bestj, bestsize);
    }
}
