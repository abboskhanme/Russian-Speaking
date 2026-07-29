namespace Govori.Platform.Stt;

/// <summary>
/// STT output for one recording. Field names carry through to the <c>transcripts</c> JSONB
/// columns (<c>word_timestamps</c>, <c>pronunciation</c>), so renaming a member changes stored
/// data — migrate rather than rename.
/// </summary>
public sealed record SttResult
{
    /// <summary>The faithful, verbatim transcript — Azure <c>Lexical</c>, NEVER <c>Display</c>:
    /// Display silently normalises the text and would erase the learner's actual mistakes.
    /// Whisper text on the fallback.</summary>
    public required string Text { get; init; }

    /// <summary>BCP-47 language tag (e.g. <c>ru-RU</c>).</summary>
    public string? Language { get; init; }

    /// <summary>Per-word timings + accuracy/phonemes → serialized to <c>word_timestamps</c> JSONB.</summary>
    public IReadOnlyList<SttWord>? Words { get; init; }

    /// <summary>Recording length in seconds (max word end offset), when the backend reports it.</summary>
    public double? DurationSec { get; init; }

    /// <summary>Pronunciation assessment → serialized to <c>pronunciation</c> JSONB. <c>null</c> on the
    /// Whisper fallback (it cannot assess pronunciation) — the scoring blend degrades to text-only.</summary>
    public SttPronunciation? Pronunciation { get; init; }

    /// <summary>STT model/engine label persisted to <c>transcripts.stt_model</c>.</summary>
    public string? Model { get; init; }
}

/// <summary>One recognized word with timing + per-phoneme accuracy (Azure Phoneme granularity).</summary>
public sealed record SttWord
{
    public string? Word { get; init; }
    public double? Start { get; init; }
    public double? End { get; init; }
    public double? Accuracy { get; init; }
    public string? ErrorType { get; init; }
    public IReadOnlyList<SttPhoneme>? Phonemes { get; init; }
}

/// <summary>Per-phoneme (letter-sound) accuracy inside a word.</summary>
public sealed record SttPhoneme(string? Phoneme, double? Accuracy);

/// <summary>
/// Pronunciation assessment aggregate (Azure PronunciationAssessment). <see cref="Pronunciation"/>
/// is the overall <c>PronScore</c> — the ONLY field the frozen C5 scoring blend reads.
/// </summary>
public sealed record SttPronunciation
{
    public double? Accuracy { get; init; }
    public double? Fluency { get; init; }
    public double? Completeness { get; init; }
    public double? Prosody { get; init; }

    /// <summary>Overall Azure <c>PronScore</c> (0–100) — the 5th, equally-weighted criterion the
    /// C5 blend folds in as <c>(text*4 + pron)/5</c>.</summary>
    public double? Pronunciation { get; init; }

    /// <summary>Shadowing content check — computed in our own code, not by the STT backend.</summary>
    public SttReferenceMatch? ReferenceMatch { get; init; }
}

/// <summary>How much of the shadowing target the learner actually spoke.</summary>
public sealed record SttReferenceMatch(
    double Completeness, double Similarity, int MatchedWords,
    int ReferenceWords, int SpokenWords, bool OnTopic);
