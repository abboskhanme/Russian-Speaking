using System;
using Microsoft.EntityFrameworkCore;

namespace Govori.Infrastructure.Entities;

/// <summary>
/// One drill attempt: the learner was shown a word, said it, and this is what came back
/// (docs/01 F2, the <c>drills</c> table).
///
/// <para><b><see cref="HeardText"/> comes from the UNSCRIPTED pass and nothing else.</b> The drill
/// makes two different requests of Azure and they are not interchangeable — measured 2026-08-23:
/// with a reference text supplied, <c>Lexical</c> echoes the REFERENCE in 6 of 6 trials. A learner
/// who said <c>мишка</c> while the drill was scoring against <c>мышка</c> gets back the transcript
/// "мышка". That is precisely the bias <c>transcript-must-stay-faithful</c> exists to forbid, and it
/// is why the scripted response's text is read for nothing and stored nowhere.</para>
/// </summary>
[EntityTypeConfiguration(typeof(DrillConfiguration))]
public class Drill
{
    public Guid Id { get; set; }

    public Guid StudentId { get; set; }

    public Guid PairId { get; set; }

    /// <summary>Which twin the learner was asked for, written out rather than stored as an A/B flag.
    /// An edited pair must not silently rewrite the history of what someone practised.</summary>
    public string TargetWord { get; set; } = null!;

    /// <summary>What the recogniser ACTUALLY heard, verbatim, from the unscripted pass. Empty when
    /// the recording carried no speech — recorded as the empty answer it was. This is the evidence
    /// behind <see cref="Outcome"/>, so a verdict a student disputes can always be traced.</summary>
    public string? HeardText { get; set; }

    /// <summary>The verdict: <c>correct</c>, <c>twin</c> (they said the other half of the pair — the
    /// teachable failure), <c>other</c> (a different word entirely), or <c>silent</c>. A short
    /// string rather than an enum column: adding a fifth outcome must not need a migration, and
    /// nothing in the database branches on it.</summary>
    public string Outcome { get; set; } = null!;

    /// <summary>Azure's word accuracy for the target, 0–100, from the SCRIPTED pass. Null whenever
    /// that pass was not made or returned nothing — the drill is fully usable without it.</summary>
    public double? Accuracy { get; set; }

    /// <summary>
    /// Per-position detail as a JSON array of <c>{ ipa, score }</c> — our names, Azure's scores,
    /// joined by index. NULL is a normal, expected outcome, not a failure: Azure returns no phoneme
    /// entries at all when the recording does not resemble the reference (measured), and the runtime
    /// alignment check drops the whole array rather than risk labelling a score with the wrong sound.
    /// </summary>
    public string? Phonemes { get; set; }

    /// <summary>The score at the pair's focus position — the one sound the drill is about — lifted
    /// out of <see cref="Phonemes"/> so progress over a contrast can be queried without opening
    /// JSON. Null under exactly the same conditions.</summary>
    public double? FocusScore { get; set; }

    /// <summary>Which STT engine really served this attempt (docs/07 §7.9). Recorded per attempt
    /// because the chain can fall through to Whisper, which assesses nothing — and "why did this one
    /// have no phoneme detail" is the first question asked of a drill that looks broken.</summary>
    public string? SttModel { get; set; }

    public double? AudioDurationSec { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }

    public virtual MinimalPair Pair { get; set; } = null!;

    public virtual User Student { get; set; } = null!;
}
