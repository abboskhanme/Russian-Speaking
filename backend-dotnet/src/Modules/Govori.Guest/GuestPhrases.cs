using System.Text.RegularExpressions;

namespace Govori.Guest;

/// <summary>
/// The public demo's phrase pool + derived guards, a faithful port of the module-level constants in
/// <c>backend/app/api/v1/guest.py:19-36</c>. Short A1-level "repeat-after-me" phrases; one is picked
/// at random per visit so the guest check isn't the same sentence every time.
/// </summary>
public static class GuestPhrases
{
    /// <summary>The scripted demo phrases (guest.py:21-32). Order preserved — <c>Demo[0]</c> is the
    /// fallback reference when a caller submits a <c>phrase</c> we didn't hand out.</summary>
    public static readonly IReadOnlyList<string> Demo = new[]
    {
        "Привет! Меня зовут Антон. Я хочу учить русский язык.",
        "Здравствуйте! Сегодня очень хорошая погода.",
        "Меня зовут Мария, и я живу в Ташкенте.",
        "Я люблю пить чай по утрам с молоком.",
        "Извините, где находится ближайшая аптека?",
        "Я изучаю русский язык, потому что это интересно.",
        "На выходных я обычно гуляю в парке с друзьями.",
        "Мой любимый город — это Санкт-Петербург.",
        "Давай встретимся завтра в кафе после работы.",
        "Каждое утро я делаю зарядку и завтракаю.",
    };

    /// <summary>Guard against abuse / runaway cost on the public endpoints (guest.py:36).</summary>
    public const int MaxAudioBytes = 10 * 1024 * 1024;

    /// <summary>Max TTS characters — the public endpoint synthesizes only demo-phrase words
    /// (guest.py:132, tts.py MAX_TTS_CHARS).</summary>
    public const int MaxTtsChars = 300;

    // \w+ over the lower-cased phrases; .NET's \w is Unicode-aware (matches Cyrillic), matching
    // Python's re.findall(r"\w+", ..., re.UNICODE). guest.py:33-35.
    private static readonly Regex WordRegex = new(@"\w+", RegexOptions.Compiled | RegexOptions.CultureInvariant);

    /// <summary>Every word that appears in any demo phrase — the TTS allow-list so the public
    /// endpoint can't be used for arbitrary text-to-speech (guest.py:33-35, 136).</summary>
    public static readonly IReadOnlySet<string> AllowedWords = BuildAllowedWords();

    /// <summary>Tokenize text into lower-cased <c>\w+</c> words (shared by the TTS guard).</summary>
    public static IReadOnlyList<string> Words(string text) =>
        WordRegex.Matches(text.ToLowerInvariant()).Select(m => m.Value).ToList();

    private static HashSet<string> BuildAllowedWords()
    {
        var set = new HashSet<string>();
        foreach (var phrase in Demo)
            foreach (var word in Words(phrase))
                set.Add(word);
        return set;
    }
}
