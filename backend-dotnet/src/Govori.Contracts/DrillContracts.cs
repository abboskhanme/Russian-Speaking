using System.Text.Json.Serialization;

namespace Govori.Contracts;

/// <summary>
/// Why a drill cannot run right now — carried as a value on a 200 body, never as a status code, the
/// same convention <c>RoleplayState</c> follows. The flag being off is not an error; it is an
/// answer, and the screen needs to say something true about it.
/// </summary>
[JsonConverter(typeof(JsonStringEnumConverter))]
public enum DrillState
{
    /// <summary>Everything is wired; the learner may speak.</summary>
    Ready,

    /// <summary>The <c>phoneme_drill_enabled</c> flag is off.</summary>
    Disabled,

    /// <summary>No STT backend has a key, so nothing can be assessed. An operator's problem — it
    /// must not cost the learner an attempt.</summary>
    Unconfigured,

    /// <summary>This student has spent their attempts for the day.</summary>
    BudgetSpent,
}

/// <summary>What the learner did on one attempt. The verdict IS the feature.</summary>
[JsonConverter(typeof(JsonStringEnumConverter))]
public enum DrillOutcome
{
    /// <summary>The recogniser heard the word that was asked for.</summary>
    Correct,

    /// <summary>It heard the OTHER half of the pair — the teachable failure, and the only outcome
    /// that can say precisely which sound went wrong.</summary>
    Twin,

    /// <summary>It heard some other word. Usually a slip or a noisy room, not a phoneme error.</summary>
    Other,

    /// <summary>It heard nothing at all.</summary>
    Silent,
}

/// <summary>One minimal pair as the screen shows it.</summary>
public sealed record DrillPairResponse(
    string Slug,
    [property: JsonPropertyName("contrast_ru")] string ContrastRu,
    [property: JsonPropertyName("why_uz")] string WhyUz,
    string Level,
    [property: JsonPropertyName("word_a")] string WordA,
    [property: JsonPropertyName("word_b")] string WordB,
    [property: JsonPropertyName("gloss_a_uz")] string GlossAUz,
    [property: JsonPropertyName("gloss_b_uz")] string GlossBUz,
    [property: JsonPropertyName("ipa_a")] IReadOnlyList<string> IpaA,
    [property: JsonPropertyName("ipa_b")] IReadOnlyList<string> IpaB,
    [property: JsonPropertyName("focus_index_a")] int FocusIndexA,
    [property: JsonPropertyName("focus_index_b")] int FocusIndexB,
    /// <summary>How many times this student has got this pair right, and out of how many — the
    /// progress the hub tile shows.</summary>
    [property: JsonPropertyName("attempts")] int Attempts,
    [property: JsonPropertyName("correct")] int Correct);

/// <summary>The drill hub: every active pair, plus whether speaking is possible at all.</summary>
public sealed record DrillCatalogResponse(
    DrillState State,
    IReadOnlyList<DrillPairResponse> Pairs,
    [property: JsonPropertyName("daily_left")] int DailyLeft);

/// <summary>One sound of the target word, with the score Azure gave that position.</summary>
/// <param name="Ipa">Our name for the sound — Azure supplies none for Russian.</param>
/// <param name="Score">0–100, or null when Azure returned no detail for this position.</param>
/// <param name="Focus">True for the one sound this pair is about.</param>
public sealed record DrillPhonemeResponse(
    string Ipa,
    double? Score,
    bool Focus);

/// <summary>The result of one attempt — what was asked, what was heard, and what that means.</summary>
public sealed record DrillResultResponse(
    DrillState State,
    DrillOutcome Outcome,
    [property: JsonPropertyName("target_word")] string TargetWord,
    /// <summary>The word the learner actually produced, as the UNSCRIPTED recogniser heard it.
    /// Verbatim — this is the evidence behind the verdict.</summary>
    [property: JsonPropertyName("heard_text")] string? HeardText,
    /// <summary>Set when <see cref="Outcome"/> is <see cref="DrillOutcome.Twin"/>: the word they
    /// said instead. This is what turns a score into a consequence.</summary>
    [property: JsonPropertyName("heard_word")] string? HeardWord,
    /// <summary>Azure's 0–100 for the target word. Decoration — null is normal.</summary>
    double? Accuracy,
    /// <summary>Per-sound detail, or EMPTY when Azure returned none or the alignment could not be
    /// trusted. The screen must render a complete result without it.</summary>
    IReadOnlyList<DrillPhonemeResponse> Phonemes,
    [property: JsonPropertyName("daily_left")] int DailyLeft);

/// <summary>Body of <c>POST /api/drills/attempts</c> — multipart, so this documents the fields
/// rather than binding them.</summary>
public sealed record DrillAttemptRequest(
    [property: JsonPropertyName("pair_slug")] string? PairSlug,
    [property: JsonPropertyName("target_word")] string? TargetWord);
