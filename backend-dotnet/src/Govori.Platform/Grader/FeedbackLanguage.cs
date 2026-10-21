namespace Govori.Platform.Grader;

/// <summary>
/// The language the grader writes its EXPLANATORY text in (summary, strengths, improvements,
/// correction explanations). The Russian being judged — original/corrected, vocabulary — is never
/// translated; only the commentary around it follows the student.
///
/// <para>It follows <c>users.preferred_language</c> — the same switch that picks the UI locale — so
/// a student who reads the app in Russian or English stops receiving Uzbek feedback under Russian
/// or English headings. Uzbek stays the default because the product is built for Uzbek learners and
/// every existing evaluation was written in it.</para>
/// </summary>
public static class FeedbackLanguage
{
    public const string Uzbek = "uz";
    public const string Russian = "ru";
    public const string English = "en";

    /// <summary>The three languages the UI ships, in a stable order (tests iterate it).</summary>
    public static readonly IReadOnlyList<string> All = new[] { Uzbek, Russian, English };

    /// <summary>
    /// Folds whatever is stored on the user row into one of <see cref="All"/>. Anything unknown —
    /// null, blank, a locale the UI does not ship, a regional tag like "ru-RU" — becomes Uzbek
    /// rather than an error: grading must never fail over a profile preference, and Uzbek is the
    /// language every student of this product can read.
    /// </summary>
    public static string Normalize(string? language) => language?.Trim().ToLowerInvariant() switch
    {
        Russian => Russian,
        English => English,
        _ => Uzbek,
    };
}
