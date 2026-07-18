namespace Govori.Platform.Grader;

/// <summary>
/// TODO(Faza 3.4 — real Google Gemini grader): faithful port of <c>llm.analyze</c> (llm.py:341-428)
/// on the Gemini path. Must send <c>RUBRIC_SYSTEM</c> as the system instruction, request the
/// <c>EvaluationResult</c> schema (structured JSON), and apply <c>_drop_cosmetic_corrections</c>
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
            "Gemini grader is not wired yet (Faza 3.4). Port llm.analyze: RUBRIC_SYSTEM instruction, " +
            "EvaluationResult schema, _drop_cosmetic_corrections (C6). Needs GEMINI_API_KEY (REST).");
}

/// <summary>
/// TODO(Faza 3.4 — real OpenAI / Azure OpenAI grader): faithful port of the OpenAI/Azure structured
/// path in <c>llm.analyze</c> (llm.py:85-171, 394-428) used as the grader BACKUP when Gemini fails.
/// Same <c>EvaluationResult</c> schema + <c>_drop_cosmetic_corrections</c>. Runs on
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
