namespace Govori.Platform.Grader;

/// <summary>
/// TODO(Faza 3.4 — real Google Gemini grader): the primary grader path. Must send
/// <c>RUBRIC_SYSTEM</c> as the system instruction, request the grader result schema (structured
/// JSON), and drop cosmetic corrections
/// (C6) so a punctuation/case-only "fix" is never shown. Gemini has no official .NET SDK — this
/// wraps the REST API (docs/07 §3, A4). Runs on the MAIN <c>gemini_breaker</c> (one of the 5
/// deferred breakers); OpenAI is the fallback (see <see cref="OpenAiGraderProvider"/>).
///
/// <para>No <c>GEMINI_API_KEY</c> is wired here, so <see cref="IsConfigured"/> = <c>false</c> and the
/// Assessment pipeline defers grading (attempt stays pending) instead of failing it.</para>
/// </summary>
public sealed class GeminiGraderProvider : IGraderProvider
{
    public bool IsConfigured => false;

    public Task<GraderResult> AnalyzeAsync(GraderRequest request, CancellationToken ct = default)
        => throw new NotImplementedException(
            "Gemini grader is not wired yet (Faza 3.4). Required behaviour: RUBRIC_SYSTEM instruction, " +
            "EvaluationResult schema, drop cosmetic corrections (C6). Needs GEMINI_API_KEY (REST).");
}

/// <summary>
/// TODO(Faza 3.4 — real OpenAI / Azure OpenAI grader): the structured-output BACKUP used when
/// Gemini fails. Same grader result schema + cosmetic-correction dropping. Runs on
/// <c>openai_llm_breaker</c> / <c>azure_llm_breaker</c>. Not wired: no key here.
/// </summary>
public sealed class OpenAiGraderProvider : IGraderProvider
{
    public bool IsConfigured => false;

    public Task<GraderResult> AnalyzeAsync(GraderRequest request, CancellationToken ct = default)
        => throw new NotImplementedException(
            "OpenAI grader is not wired yet (Faza 3.4). Port the OpenAI/Azure structured path in " +
            "llm.analyze. Needs OPENAI_API_KEY / AZURE_OPENAI_*.");
}
