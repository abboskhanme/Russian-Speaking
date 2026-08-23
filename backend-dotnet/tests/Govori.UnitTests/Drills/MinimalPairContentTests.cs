using Govori.Drills;

namespace Govori.UnitTests.Drills;

/// <summary>
/// The curated drill content has to hold together on its own before any vendor is involved
/// (docs/01 F2).
///
/// <para><b>Why content gets a test suite at all.</b> The IPA symbols in this seed are the only
/// names the learner will ever see for these sounds — Azure supplies none for Russian — and they are
/// joined to Azure's scores BY INDEX. An off-by-one in a hand-written array therefore prints one
/// sound's score under another sound's name, authoritatively, to someone who has no way to tell it
/// is wrong. There is a runtime guard against that (<c>DrillService.Align</c> refuses a mismatched
/// alignment outright), but the guard degrades the feature silently, so these assertions exist to
/// fail loudly at the point the mistake is made instead.</para>
/// </summary>
public class MinimalPairContentTests
{
    public static IEnumerable<object[]> Pairs() =>
        MinimalPairSeed.All.Select(p => new object[] { p.Slug });

    private static MinimalPairSeedItem Pair(string slug) =>
        MinimalPairSeed.All.Single(p => p.Slug == slug);

    /// <summary>Six was the deliberate number: each pair costs hand-verification against the live
    /// vendor, and badly curated pairs teach something false. This asserts the decision rather than
    /// the content, so growing the set is a conscious edit here.</summary>
    [Fact]
    public void The_seed_is_the_six_curated_pairs()
    {
        Assert.Equal(6, MinimalPairSeed.All.Count);
    }

    [Fact]
    public void Slugs_are_unique()
    {
        var slugs = MinimalPairSeed.All.Select(p => p.Slug).ToList();

        Assert.Equal(slugs.Count, slugs.Distinct().Count());
    }

    [Fact]
    public void Sort_orders_are_unique_so_the_grid_has_one_order()
    {
        var orders = MinimalPairSeed.All.Select(p => p.SortOrder).ToList();

        Assert.Equal(orders.Count, orders.Distinct().Count());
    }

    /// <summary>The twins must actually differ, or the drill is asking the learner to distinguish a
    /// word from itself and every attempt scores "correct".</summary>
    [Theory]
    [MemberData(nameof(Pairs))]
    public void The_two_twins_are_different_words(string slug)
    {
        var pair = Pair(slug);

        Assert.NotEqual(pair.WordA, pair.WordB);
    }

    /// <summary>
    /// The verdict folds <c>ё</c> onto <c>е</c> — Russian is written both ways and Azure picks one,
    /// the same fold the shadowing comparison makes. A pair whose whole contrast is <c>ё</c>/<c>е</c>
    /// would therefore be judged "correct" no matter what the learner said. None is in the seed;
    /// this makes sure none is added.
    /// </summary>
    [Theory]
    [MemberData(nameof(Pairs))]
    public void No_pair_relies_on_a_contrast_the_verdict_folds_away(string slug)
    {
        var pair = Pair(slug);

        Assert.NotEqual(
            pair.WordA.Replace('ё', 'е'),
            pair.WordB.Replace('ё', 'е'));
    }

    /// <summary>Every field the screen renders has to be there. A blank gloss is the one that hurts
    /// most: the meaning IS the feedback ("you said bear, you meant mouse"), so a pair without it
    /// degrades to the bare score this feature exists to avoid.</summary>
    [Theory]
    [MemberData(nameof(Pairs))]
    public void Every_pair_is_fully_authored(string slug)
    {
        var pair = Pair(slug);

        Assert.False(string.IsNullOrWhiteSpace(pair.ContrastRu));
        Assert.False(string.IsNullOrWhiteSpace(pair.WhyUz));
        Assert.False(string.IsNullOrWhiteSpace(pair.Level));
        Assert.False(string.IsNullOrWhiteSpace(pair.GlossAUz));
        Assert.False(string.IsNullOrWhiteSpace(pair.GlossBUz));
    }

    /// <summary>The IPA arrays are what the names are read from, so an empty one would leave the
    /// focus index pointing at nothing.</summary>
    [Theory]
    [MemberData(nameof(Pairs))]
    public void Both_twins_have_an_ipa_spelling(string slug)
    {
        var pair = Pair(slug);

        Assert.NotEmpty(pair.IpaA);
        Assert.NotEmpty(pair.IpaB);
        Assert.DoesNotContain(pair.IpaA, string.IsNullOrWhiteSpace);
        Assert.DoesNotContain(pair.IpaB, string.IsNullOrWhiteSpace);
    }

    /// <summary>THE content guard. The focus index is what the screen highlights; out of range it
    /// would either throw or, worse, quietly highlight nothing while the learner reads the result as
    /// "no particular sound was wrong".</summary>
    [Theory]
    [MemberData(nameof(Pairs))]
    public void The_focus_index_points_at_a_real_sound(string slug)
    {
        var pair = Pair(slug);

        Assert.InRange(pair.FocusIndexA, 0, pair.IpaA.Count - 1);
        Assert.InRange(pair.FocusIndexB, 0, pair.IpaB.Count - 1);
    }

    /// <summary>The focus is supposed to BE the contrast, so the two twins must differ at the
    /// position the drill points to. A pair focusing on a sound both twins share would highlight
    /// something the learner got right either way.</summary>
    [Theory]
    [MemberData(nameof(Pairs))]
    public void The_focus_position_is_where_the_twins_actually_differ(string slug)
    {
        var pair = Pair(slug);

        Assert.NotEqual(pair.IpaA[pair.FocusIndexA], pair.IpaB[pair.FocusIndexB]);
    }

    /// <summary>Round-trips through the jsonb column shape. Relaxed escaping is deliberate — the IPA
    /// stays readable in psql instead of becoming a wall of ʲ — and this proves the symbols
    /// survive it intact.</summary>
    [Theory]
    [MemberData(nameof(Pairs))]
    public void Ipa_survives_the_json_round_trip(string slug)
    {
        var pair = Pair(slug);

        Assert.Equal(pair.IpaA, MinimalPairSeed.ReadIpa(MinimalPairSeed.Serialize(pair.IpaA)));
        Assert.Equal(pair.IpaB, MinimalPairSeed.ReadIpa(MinimalPairSeed.Serialize(pair.IpaB)));
    }

    /// <summary>Hand-edited content must never be able to take the drill down. A malformed jsonb
    /// value costs the per-sound decoration and nothing else.</summary>
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("not json at all")]
    [InlineData("{\"not\":\"an array\"}")]
    public void Unreadable_ipa_degrades_to_empty_rather_than_throwing(string? json)
    {
        Assert.Empty(MinimalPairSeed.ReadIpa(json));
    }

    /// <summary>
    /// The PM's three required contrasts (ы/и, ш/щ, твёрдый/мягкий) are all present. Stated as a
    /// test because "we covered the hard ones" is exactly the kind of claim that quietly stops being
    /// true when someone retires a pair.
    /// </summary>
    [Theory]
    [InlineData("ы / и")]
    [InlineData("ш / щ")]
    [InlineData("б / бь")]
    [InlineData("л / ль")]
    [InlineData("ц / с")]
    public void The_required_contrasts_are_all_covered(string contrast)
    {
        Assert.Contains(MinimalPairSeed.All, p => p.ContrastRu == contrast);
    }
}
