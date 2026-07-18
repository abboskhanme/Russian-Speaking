namespace Govori.Platform.Stt;

/// <summary>
/// STT output, a structural port of the <c>stt_result</c> dict returned by
/// <c>stt.transcribe</c> (stt.py:318-325 / 369-376). Field names carry through to the
/// <c>transcripts</c> JSONB columns (<c>word_timestamps</c>, <c>pronunciation</c>).
/// </summary>
public sealed record SttResult
{
    /// <summary>The faithful, verbatim transcript — Azure <c>Lexical</c> (NOT <c>Display</c>), so
    /// the learner's actual words/mistakes survive (stt.py:145). Whisper text on the fallback.</summary>
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
/// is the overall <c>PronScore</c> — the ONLY field the frozen C5 scoring blend reads
/// (<c>pron_score = pronunciation["pronunciation"]</c>, tasks.py:239).
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

    /// <summary>Shadowing content check (our own <c>_reference_match</c>, stt.py:188-218).</summary>
    public SttReferenceMatch? ReferenceMatch { get; init; }
}

/// <summary>How much of the shadowing target the learner actually spoke (stt.py:210-218).</summary>
public sealed record SttReferenceMatch(
    double Completeness, double Similarity, int MatchedWords,
    int ReferenceWords, int SpokenWords, bool OnTopic);
