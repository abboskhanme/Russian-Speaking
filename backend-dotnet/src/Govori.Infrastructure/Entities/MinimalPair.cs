using System;
using Microsoft.EntityFrameworkCore;

namespace Govori.Infrastructure.Entities;

/// <summary>
/// One authored minimal pair — two Russian words that differ in exactly one sound (docs/01 F2, the
/// <c>minimal_pairs</c> table).
///
/// <para><b>The pair IS the test.</b> Azure ships no phoneme inventory for <c>ru-RU</c> (measured
/// 2026-08-23: every <c>Phoneme</c> name comes back empty, in scripted mode too, where the identical
/// request against <c>en-US</c> returns full IPA), so "your ы scored 62" is not a sentence this
/// product can truthfully say. What it CAN say is which of two words the recogniser heard — and for
/// a minimal pair that is the same information, in the form a learner can actually act on: not a
/// number, but a consequence. Say <c>мышка</c> badly and you have said <c>мишка</c>; you asked for a
/// mouse and got a bear.</para>
///
/// <para>Content, not code — same reasoning as <see cref="Scenario"/>. A pair whose Uzbek gloss is
/// wrong, or whose contrast turns out to be unteachable, must be fixable without a release.</para>
/// </summary>
[EntityTypeConfiguration(typeof(MinimalPairConfiguration))]
public class MinimalPair
{
    public Guid Id { get; set; }

    /// <summary>Stable public id used in URLs and in the submit request. Wire value: add, never
    /// rename.</summary>
    public string Slug { get; set; } = null!;

    /// <summary>The contrast as a learner sees it on the card — «ы / и», «ш / щ». Written in
    /// Russian letters rather than IPA because the learner is being taught to read Russian, and IPA
    /// is a second notation to learn before the first one has landed.</summary>
    public string ContrastRu { get; set; } = null!;

    /// <summary>Why THIS pair is hard for an Uzbek speaker, in Uzbek. This is the teaching, and it
    /// is the reason the pair earned a slot: a pair whose difficulty cannot be explained in one
    /// sentence is a pair the student will not know what to do about.</summary>
    public string WhyUz { get; set; } = null!;

    /// <summary>CEFR band the pair is pitched at.</summary>
    public string Level { get; set; } = null!;

    /// <summary>The first twin, exactly as it is written (e.g. «мышка»).</summary>
    public string WordA { get; set; } = null!;

    /// <summary>The second twin (e.g. «мишка»).</summary>
    public string WordB { get; set; } = null!;

    /// <summary>What twin A means, in Uzbek. Load-bearing rather than decorative: the meaning IS the
    /// feedback — "you said bear, you meant mouse" is what makes a pronunciation error feel like a
    /// consequence instead of a deducted point.</summary>
    public string GlossAUz { get; set; } = null!;

    /// <summary>What twin B means, in Uzbek.</summary>
    public string GlossBUz { get; set; } = null!;

    /// <summary>
    /// Our OWN phoneme spelling of twin A, as a JSON array of IPA symbols
    /// (<c>["m","ɨ","ʂ","k","ə"]</c>).
    ///
    /// <para>These names are content because Azure will not supply them for Russian. They are
    /// aligned to Azure's per-position scores BY INDEX, which is sound only because scripted
    /// assessment emits one entry per REFERENCE phoneme — verified by holding one recording constant
    /// and varying the reference (5 symbols → 5 entries, 3 → 3). The alignment is nevertheless
    /// re-checked at runtime before any name is shown; see <c>DrillService</c>. A label attached to
    /// the wrong sound is worse than no label.</para>
    /// </summary>
    public string IpaA { get; set; } = null!;

    /// <summary>Our own phoneme spelling of twin B. Same contract as <see cref="IpaA"/>.</summary>
    public string IpaB { get; set; } = null!;

    /// <summary>Index into <see cref="IpaA"/> of the sound the pair is actually about — the position
    /// the UI highlights. Stored rather than derived: the twins can differ at more than one position
    /// (<c>быть</c>/<c>бить</c> differ in both the consonant's softness and the vowel), and which one
    /// is TAUGHT is an editorial decision, not a diff.</summary>
    public int FocusIndexA { get; set; }

    /// <summary>Index into <see cref="IpaB"/> of the contrasting sound.</summary>
    public int FocusIndexB { get; set; }

    /// <summary>Listing order.</summary>
    public int SortOrder { get; set; }

    /// <summary>Retired pairs stay so the <c>drills</c> rows referencing them still resolve; only
    /// the listing filters on this.</summary>
    public bool IsActive { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }
}
