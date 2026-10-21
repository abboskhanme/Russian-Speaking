namespace Govori.Platform.Grader;

/// <summary>
/// Cleans the grader's list items (strengths, improvements, vocabulary) before they are stored.
///
/// <para>A model with nothing to say for a list does not always return an empty array: it writes a
/// placeholder — "None", "N/A", "-", "нет", "yoʻq". Stored as-is, that renders as a bullet reading
/// "None" under a "Strengths" heading (seen in the UI audit, on an empty-transcript answer). These
/// items carry no information in any language, so they are dropped and the list may end up empty,
/// which the screens already handle by hiding the section.</para>
/// </summary>
public static class FeedbackText
{
    // Compared after trimming whitespace and trailing dots, case-insensitively. Only whole-item
    // placeholders: a real sentence that merely contains "none" is kept.
    private static readonly HashSet<string> Placeholders = new(StringComparer.OrdinalIgnoreCase)
    {
        "none", "n/a", "na", "-", "--", "—", "–", "null", "nil", "nothing", "no", "empty",
        "нет", "ничего", "отсутствует", "отсутствуют",
        "yoʻq", "yo'q", "yo‘q", "yo`q", "yok", "hech narsa", "mavjud emas",
    };

    /// <summary>True when <paramref name="item"/> is blank or only a "nothing here" placeholder.</summary>
    public static bool IsPlaceholder(string? item)
    {
        if (string.IsNullOrWhiteSpace(item))
            return true;
        var core = item.Trim().TrimEnd('.', '!', ' ').Trim();
        return core.Length == 0 || Placeholders.Contains(core);
    }

    /// <summary>The trimmed, non-placeholder items of <paramref name="items"/>, in order.</summary>
    public static IReadOnlyList<string> Clean(IEnumerable<string?>? items)
        => items is null
            ? Array.Empty<string>()
            : items.Where(i => !IsPlaceholder(i)).Select(i => i!.Trim()).ToArray();
}
