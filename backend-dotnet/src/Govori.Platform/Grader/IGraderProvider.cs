namespace Govori.Platform.Grader;

/// <summary>
/// LLM grader abstraction (docs/07 §7.7, Faza 3.4). Given the task + a transcript of the spoken
/// answer, returns structured 0–100 band scores (absolute + level-relative), feedback in the
/// student's language (<see cref="GraderRequest.FeedbackLanguage"/>, Uzbek by default) and
/// targeted corrections. TEXT-ONLY — delivery (pronunciation/intonation) is NOT judged here; the
/// Azure PronScore is folded into the final band later by the C5 blend.
///
/// <para>PURE INFRASTRUCTURE — no domain types. Real backends (Gemini, then OpenAI/Azure OpenAI
/// fallback) live behind this seam; <c>Govori.Assessment</c> depends only on the interface, and
/// integration tests swap in <see cref="FakeGraderProvider"/>. <see cref="IsConfiguredAsync"/> is
/// the deferral guard, exactly as on <c>Govori.Platform.Stt.ISttProvider</c>.</para>
/// </summary>
public interface IGraderProvider
{
    /// <summary>True when a grader key/endpoint is wired. Asynchronous because the answer comes from
    /// <c>app_settings</c> (DB override → env default), so a key pasted into the admin panel takes
    /// effect on the next submission without a restart.</summary>
    ValueTask<bool> IsConfiguredAsync(CancellationToken ct = default);

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

    /// <summary>
    /// Language of the explanatory feedback — <c>uz</c>, <c>ru</c> or <c>en</c> (see
    /// <see cref="global::Govori.Platform.Grader.FeedbackLanguage"/>). Defaults to Uzbek so a caller
    /// that does not know the student (placement, the admin probe) keeps the behaviour every stored
    /// evaluation was made with. The prompt builders run it through
    /// <c>FeedbackLanguage.Normalize</c>, so a stray value degrades to Uzbek rather than to a prompt
    /// with no language instruction at all.
    /// </summary>
    public string FeedbackLanguage { get; init; } = global::Govori.Platform.Grader.FeedbackLanguage.Uzbek;
}

/// <summary>
/// Structured grader output. Scores are 0–100;
/// <c>Summary</c>/<c>Strengths</c>/<c>Improvements</c>/correction explanations are in the requested
/// <see cref="GraderRequest.FeedbackLanguage"/> — asked for in the prompt, not enforced: a model can
/// still stray, which is what the golden set's language check watches for.
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
