namespace Govori.Platform.Grader;

/// <summary>
/// LLM grader abstraction (docs/07 §7.7, Faza 3.4). Given the task + a transcript of the spoken
/// answer, returns structured 0–100 band scores (absolute + level-relative), Uzbek feedback and
/// targeted corrections. TEXT-ONLY — delivery (pronunciation/intonation) is NOT judged here; the
/// Azure PronScore is folded into the final band later by the C5 blend.
///
/// <para>PURE INFRASTRUCTURE — no domain types. Real backends (Gemini, then OpenAI/Azure OpenAI
/// fallback) live behind this seam; <c>Govori.Assessment</c> depends only on the interface, and
/// integration tests swap in <see cref="FakeGraderProvider"/>. <see cref="IsConfigured"/> is the
/// deferral guard, exactly as on <c>Govori.Platform.Stt.ISttProvider</c>.</para>
/// </summary>
public interface IGraderProvider
{
    /// <summary>True when a real grader key/endpoint is wired. Real TODO-stub reports <c>false</c>.</summary>
    bool IsConfigured { get; }

    /// <summary>Grade one transcript → <see cref="GraderResult"/>.</summary>
    Task<GraderResult> AnalyzeAsync(GraderRequest request, CancellationToken ct = default);
}

/// <summary>Everything the grader needs about one attempt.</summary>
public sealed record GraderRequest
{
    public required string QuestionPrompt { get; init; }
    public required string TranscriptText { get; init; }
    public string? Instruction { get; init; }
    public string? QuestionTitle { get; init; }
    public string? Level { get; init; }
    public string? Topic { get; init; }

    /// <summary>Picture-description tasks: the image bytes, so the grader can judge the description.</summary>
    public byte[]? ImageBytes { get; init; }
    public string? ImageMime { get; init; }
}

/// <summary>
/// Structured grader output. Scores are 0–100;
/// <c>Summary</c>/<c>Strengths</c>/<c>Improvements</c>/correction explanations are Uzbek.
/// </summary>
public sealed record GraderResult
{
    public required GraderScores Scores { get; init; }
    public string Summary { get; init; } = "";
    public IReadOnlyList<string> Strengths { get; init; } = Array.Empty<string>();
    public IReadOnlyList<string> Improvements { get; init; } = Array.Empty<string>();
    public IReadOnlyList<GraderCorrection> Corrections { get; init; } = Array.Empty<GraderCorrection>();
    public IReadOnlyList<string> VocabularySuggestions { get; init; } = Array.Empty<string>();

    /// <summary>The model that actually graded (e.g. <c>gemini-2.x</c>). Persisted to
    /// <c>evaluations.llm_model</c>. This MUST be what the provider really used — never the
    /// configured <c>GEMINI_MODEL</c> setting, which lies whenever the fallback provider ran
    /// (docs/07 §7.9).</summary>
    public string? Model { get; init; }
}

/// <summary>The four TEXT criteria + two aggregates.</summary>
public sealed record GraderScores(
    double Fluency, double Lexical, double Grammar, double Relevance,
    double Overall, double LevelOverall);

/// <summary>One targeted correction.</summary>
public sealed record GraderCorrection(string Original, string Corrected, string Type, string Explanation);
