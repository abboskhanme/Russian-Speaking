namespace Govori.Platform.Grader;

/// <summary>
/// Deterministic <see cref="IGraderProvider"/> for tests — no Gemini/OpenAI, no network. Returns
/// fixed band scores so the C5 blend produces a known, asserted number. NEVER registered in prod DI
/// — tests inject it via <c>ConfigureTestServices</c>.
///
/// <para>The feedback text follows <see cref="GraderRequest.FeedbackLanguage"/> the way a real
/// vendor is asked to, so an integration test can prove the student's language actually reached
/// the grader — a fake that always answered in Uzbek would pass whether or not it did.</para>
/// </summary>
public sealed class FakeGraderProvider : IGraderProvider
{
    private int _calls;
    private string? _lastLanguage;

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

    /// <summary>The feedback language of the most recent request, as sent (null before any call).</summary>
    public string? LastFeedbackLanguage => Volatile.Read(ref _lastLanguage);

    public ValueTask<bool> IsConfiguredAsync(CancellationToken ct = default) => ValueTask.FromResult(true);

    public Task<GraderResult> AnalyzeAsync(GraderRequest request, CancellationToken ct = default)
    {
        Interlocked.Increment(ref _calls);
        Volatile.Write(ref _lastLanguage, request.FeedbackLanguage);

        // Same normalisation the real prompt builder applies: an unknown value is Uzbek.
        var (summary, strength, improvement, explanation) = FeedbackLanguage.Normalize(request.FeedbackLanguage) switch
        {
            FeedbackLanguage.Russian => ("Хороший ответ.", "Говорит свободно", "Есть ошибки в падежах", "Форма глагола."),
            FeedbackLanguage.English => ("Good answer.", "Speaks fluently", "Some case-ending mistakes", "Verb form."),
            _ => ("Yaxshi javob.", "Ravon gapirdi", "Ba'zi kelishik xatolari", "Fe'l shakli."),
        };

        var result = new GraderResult
        {
            Scores = _scores,
            Summary = summary,
            Strengths = new[] { strength },
            Improvements = new[] { improvement },
            Corrections = new[]
            {
                // The Russian being corrected never changes with the feedback language.
                new GraderCorrection("я идёт", "я иду", "grammar", explanation),
            },
            VocabularySuggestions = new[] { "например", "кстати" },
            Model = _model,
        };
        return Task.FromResult(result);
    }
}
