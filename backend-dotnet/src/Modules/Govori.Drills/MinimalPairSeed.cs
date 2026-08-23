using System.Text.Json;

namespace Govori.Drills;

/// <summary>One authored pair, before it becomes a row.</summary>
/// <param name="Slug">Stable public id.</param>
/// <param name="ContrastRu">The contrast as the card shows it — «ы / и».</param>
/// <param name="WhyUz">Why an Uzbek speaker gets this wrong. The teaching.</param>
/// <param name="WordA">First twin.</param>
/// <param name="WordB">Second twin.</param>
/// <param name="GlossAUz">What twin A means, in Uzbek.</param>
/// <param name="GlossBUz">What twin B means, in Uzbek.</param>
/// <param name="IpaA">Our phoneme spelling of A, one symbol per Azure position.</param>
/// <param name="IpaB">Our phoneme spelling of B.</param>
/// <param name="FocusIndexA">Where the contrast sits in A.</param>
/// <param name="FocusIndexB">Where the contrast sits in B.</param>
/// <param name="SortOrder">Listing order.</param>
public sealed record MinimalPairSeedItem(
    string Slug,
    string ContrastRu,
    string WhyUz,
    string WordA,
    string WordB,
    string GlossAUz,
    string GlossBUz,
    IReadOnlyList<string> IpaA,
    IReadOnlyList<string> IpaB,
    int FocusIndexA,
    int FocusIndexB,
    int SortOrder,
    string Level = "A1");

/// <summary>
/// The curated drill content (docs/01 F2).
///
/// <para><b>Six pairs, not ten, and every one was measured against the live vendor before it earned
/// its slot.</b> Each pair costs hand-verification — the twins must both be real words a beginner
/// meets, the recogniser must actually hear each twin correctly when it is said correctly (or the
/// drill accuses a student who did nothing wrong), and our IPA spelling must match the number of
/// positions Azure returns. A badly curated pair does not merely add nothing; it teaches something
/// false.</para>
///
/// <para><b>What the measurement rejected.</b> <c>цех</c>/<c>чех</c> was dropped: Azure heard
/// flawless synthesized <c>цех</c> as <c>тех</c>, so the drill would have told a correct speaker
/// they were wrong. <c>царь</c>/<c>сарь</c> was dropped for losing the final soft sign in
/// recognition, and <c>час</c>/<c>цас</c> because the second twin is not a word. The replacement,
/// <c>цвет</c>/<c>свет</c>, is both more common and cleanly recognised.</para>
///
/// <para><b>Why these contrasts, for an Uzbek speaker specifically.</b> Uzbek has no <c>ы</c>, no
/// palatalisation contrast, no <c>щ</c> and no <c>ц</c>; it has <c>и</c>, plain consonants, <c>ш</c>
/// and <c>ч</c>/<c>с</c>. Every pair below is therefore a sound Uzbek simply does not carry, being
/// replaced by its nearest Uzbek neighbour — which is exactly the substitution that turns one
/// Russian word into a different one.</para>
/// </summary>
public static class MinimalPairSeed
{
    /// <summary>
    /// The pairs, with the vendor measurement that admitted each one recorded beside it. The
    /// numbers are Azure word-accuracy for the twin said correctly and scored against ITSELF, then
    /// against its twin — the gap is the contrast the drill can see.
    /// </summary>
    public static readonly IReadOnlyList<MinimalPairSeedItem> All = new[]
    {
        // Measured: мышка 100 vs 51 · мишка 100 vs 49. Both heard correctly. The canonical pair.
        new MinimalPairSeedItem(
            Slug: "y-i-myshka",
            ContrastRu: "ы / и",
            WhyUz: "O'zbek tilida «ы» tovushi umuman yo'q, shuning uchun uning o'rniga eng yaqin "
                 + "tanish tovush — «и» aytiladi. Til orqaga tortilib, lablar yoyilmaydi: «ы» "
                 + "«и» dan chuqurroq, tomoqqa yaqinroq chiqadi.",
            WordA: "мышка", WordB: "мишка",
            GlossAUz: "sichqoncha", GlossBUz: "ayiqcha",
            IpaA: new[] { "m", "ɨ", "ʂ", "k", "ə" },
            IpaB: new[] { "mʲ", "i", "ʂ", "k", "ə" },
            FocusIndexA: 1, FocusIndexB: 1,
            SortOrder: 1),

        // Measured: мыло 100 vs 44 · мило 100 vs 41. The SAME contrast in an open syllable — a
        // student who manages ы before ш often loses it before л, so this is a second exposure
        // rather than a duplicate.
        new MinimalPairSeedItem(
            Slug: "y-i-mylo",
            ContrastRu: "ы / и",
            WhyUz: "Xuddi shu «ы», lekin bu safar ochiq bo'g'inda. «мышка» da uddalagan bo'lsang "
                 + "ham, bu yerda «и» ga sirg'alib ketish oson — tovush cho'ziladi va farq "
                 + "yaqqolroq eshitiladi.",
            WordA: "мыло", WordB: "мило",
            GlossAUz: "sovun", GlossBUz: "yoqimli",
            IpaA: new[] { "m", "ɨ", "l", "ə" },
            IpaB: new[] { "mʲ", "i", "l", "ə" },
            FocusIndexA: 1, FocusIndexB: 1,
            SortOrder: 2),

        // Measured: быть 100 vs 0 · бить 100 vs 0. The sharpest contrast in the set — Azure scores
        // the wrong twin at literally zero, which makes it the best pair to meet first after ы/и.
        new MinimalPairSeedItem(
            Slug: "hard-soft-byt",
            ContrastRu: "б / бь",
            WhyUz: "Rus tilida undosh «qattiq» yoki «yumshoq» bo'ladi va bu ma'noni o'zgartiradi. "
                 + "O'zbek tilida bunday qarama-qarshilik yo'q, shuning uchun ikkalasi ham bir xil "
                 + "eshitiladi. «бить» da til tanglayga ko'tariladi, «быть» da esa yo'q.",
            WordA: "быть", WordB: "бить",
            GlossAUz: "bo'lmoq", GlossBUz: "urmoq",
            IpaA: new[] { "b", "ɨ", "tʲ" },
            IpaB: new[] { "bʲ", "i", "tʲ" },
            FocusIndexA: 1, FocusIndexB: 1,
            SortOrder: 3),

        // Measured: угол 100 vs 73 · уголь 98 vs 68. The narrowest gap kept, and kept deliberately:
        // word-final softness is the hardest case and the one that changes the most words.
        new MinimalPairSeedItem(
            Slug: "hard-soft-ugol",
            ContrastRu: "л / ль",
            WhyUz: "Yumshoqlik so'z oxirida ham ishlaydi va aynan shu joyda eng ko'p yo'qoladi. "
                 + "«уголь» dagi «ь» harfi o'qilmaydi, lekin oldingi «л» ni yumshatadi — tilning "
                 + "o'rta qismi tanglayga tegadi.",
            WordA: "угол", WordB: "уголь",
            GlossAUz: "burchak", GlossBUz: "ko'mir",
            IpaA: new[] { "u", "g", "ɐ", "l" },
            IpaB: new[] { "u", "g", "ɐ", "lʲ" },
            FocusIndexA: 3, FocusIndexB: 3,
            SortOrder: 4),

        // Measured: шит 100 vs 69 · щит 100 vs 57. Both heard correctly.
        new MinimalPairSeedItem(
            Slug: "sh-shch-shchit",
            ContrastRu: "ш / щ",
            WhyUz: "O'zbek tilida «ш» bor, «щ» yo'q — shuning uchun ikkalasi ham «ш» bo'lib "
                 + "chiqadi. «щ» yumshoqroq va cho'ziqroq: til tanglayga yaqinroq turadi va tovush "
                 + "uzunroq davom etadi.",
            WordA: "шит", WordB: "щит",
            GlossAUz: "tikilgan", GlossBUz: "qalqon",
            IpaA: new[] { "ʂ", "ɨ", "t" },
            IpaB: new[] { "ɕː", "i", "t" },
            FocusIndexA: 0, FocusIndexB: 0,
            SortOrder: 5),

        // Measured: цвет 100 vs 84 · свет 100 vs 78. The weakest gap of the six, which is why it
        // sits last — but both twins are everyday words and both are heard correctly, and ц is a
        // sound Uzbek does not have at all.
        new MinimalPairSeedItem(
            Slug: "ts-s-tsvet",
            ContrastRu: "ц / с",
            WhyUz: "«ц» — bu «т» va «с» ning qo'shilishi, bitta tovush sifatida aytiladi. O'zbek "
                 + "tilida u yo'q, shuning uchun ko'pincha oddiy «с» bo'lib qoladi. Boshida tilni "
                 + "tishga tegizib, keyin darhol qo'yib yuborish kerak.",
            WordA: "цвет", WordB: "свет",
            GlossAUz: "rang", GlossBUz: "yorug'lik",
            IpaA: new[] { "ts", "vʲ", "e", "t" },
            IpaB: new[] { "s", "vʲ", "e", "t" },
            FocusIndexA: 0, FocusIndexB: 0,
            SortOrder: 6),
    };

    private static readonly JsonSerializerOptions Options = new()
    {
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    /// <summary>Serializes an IPA list for the jsonb column. Relaxed escaping so the IPA symbols
    /// stay readable in <c>psql</c> rather than becoming a wall of <c>ʲ</c>.</summary>
    public static string Serialize(IReadOnlyList<string> symbols)
        => JsonSerializer.Serialize(symbols, Options);

    /// <summary>Reads an IPA column back. A malformed or absent value yields an EMPTY list, never an
    /// exception: the per-sound detail is decoration, and hand-edited content must not be able to
    /// take the whole drill down with it.</summary>
    public static IReadOnlyList<string> ReadIpa(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
            return Array.Empty<string>();

        try
        {
            return JsonSerializer.Deserialize<List<string>>(json, Options) ?? new List<string>();
        }
        catch (JsonException)
        {
            return Array.Empty<string>();
        }
    }
}
