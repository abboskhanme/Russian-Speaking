using Govori.Platform.Ai.Backends;
using Govori.Platform.Grader;

namespace Govori.UnitTests.Ai;

/// <summary>
/// "Nothing here" placeholders a model writes into a feedback list ("None", "N/A", "-", "нет",
/// "yoʻq") are dropped — by the shared helper and by the vendor-response parser that every grader
/// backend goes through — so no screen shows a bullet reading "None" under "Strengths".
/// </summary>
public sealed class FeedbackTextTests
{
    [Theory]
    [InlineData("None")]
    [InlineData("none")]
    [InlineData(" None. ")]
    [InlineData("N/A")]
    [InlineData("-")]
    [InlineData("—")]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(null)]
    [InlineData("Нет")]
    [InlineData("yoʻq")]
    [InlineData("Yo'q.")]
    public void Placeholders_are_recognised(string? item) => Assert.True(FeedbackText.IsPlaceholder(item));

    [Theory]
    [InlineData("None of the verbs were wrong")]
    [InlineData("Ravon gapirdi")]
    [InlineData("Нет ошибок в падежах")]
    public void Real_items_are_kept(string item) => Assert.False(FeedbackText.IsPlaceholder(item));

    [Fact]
    public void Clean_keeps_order_and_trims()
        => Assert.Equal(new[] { "a", "b" }, FeedbackText.Clean(new[] { " a ", "None", "-", "b" }));

    [Fact]
    public void The_vendor_parser_drops_placeholder_items()
    {
        const string json = """
            {"fluency": 0, "lexical": 0, "grammar": 0, "relevance": 0, "overall": 0, "level_overall": 0,
             "summary": "Empty.", "strengths": ["None"], "improvements": ["N/A", "Speak more."],
             "corrections": [], "vocabulary_suggestions": ["-", "кстати"]}
            """;

        var result = GraderContract.Parse(json, "test-model");

        Assert.Empty(result.Strengths);
        Assert.Equal(new[] { "Speak more." }, result.Improvements);
        Assert.Equal(new[] { "кстати" }, result.VocabularySuggestions);
    }
}
