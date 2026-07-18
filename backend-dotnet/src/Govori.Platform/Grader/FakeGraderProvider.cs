namespace Govori.Platform.Grader;

/// <summary>
/// Deterministic <see cref="IGraderProvider"/> for tests — no Gemini/OpenAI, no network. Returns
/// fixed band scores so the C5 blend produces a known, asserted number. NEVER registered in prod DI
/// — tests inject it via <c>ConfigureTestServices</c>.
/// </summary>
public sealed class FakeGraderProvider : IGraderProvider
{
    private int _calls;

    private readonly GraderScores _scores;
    private readonly string _model;

    public FakeGraderProvider(GraderScores? scores = null, string model = "fake-grader")
    {
        // Overall (78 after blend with pron 70) ≠ LevelOverall (86 after blend) so a test can prove
        // BOTH aggregates are computed independently, not copied.
        _scores = scores ?? new GraderScores(
            Fluency: 75, Lexical: 80, Grammar: 82, Relevance: 83, Overall: 80, LevelOverall: 90);
        _model = model;
    }

    /// <summary>How many times the grader ran (0 ⇒ grading was skipped — e.g. shadowing).</summary>
    public int AnalyzeCalls => Volatile.Read(ref _calls);

    public bool IsConfigured => true;

    public Task<GraderResult> AnalyzeAsync(GraderRequest request, CancellationToken ct = default)
    {
        Interlocked.Increment(ref _calls);
        var result = new GraderResult
        {
            Scores = _scores,
            Summary = "Yaxshi javob.",
            Strengths = new[] { "Ravon gapirdi" },
            Improvements = new[] { "Ba'zi kelishik xatolari" },
            Corrections = new[]
            {
                new GraderCorrection("я идёт", "я иду", "grammar", "Fe'l shakli."),
            },
            VocabularySuggestions = new[] { "например", "кстати" },
            Model = _model,
        };
        return Task.FromResult(result);
    }
}
