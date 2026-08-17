using System.Text.Json;
using System.Text.Json.Serialization;

namespace Govori.Practice;

/// <summary>
/// One beat of a scenario: a single thing the partner has to get out of the student before the
/// conversation can move on.
///
/// <para>A beat is not a line of a script — it is a GOAL plus the two things the partner can say
/// about it. <see cref="LineRu"/> is what she says once the student has delivered;
/// <see cref="NudgeRu"/> is what she says when they have not. That pair is the whole difference
/// between a conversation and a recording: a scripted partner answers "сколько раз в день?" with
/// the next line whether or not the question was ever asked, and the student learns that nothing
/// they say matters.</para>
/// </summary>
/// <param name="GoalRu">What the partner is trying to establish, in Russian. Sent to the grader as
/// the task condition, so relevance is judged against THIS turn rather than against the topic.</param>
/// <param name="ExpectRu">A model answer, used only to make the goal concrete for the grader. Never
/// shown to the student mid-conversation — it would turn speaking practice into reading aloud.</param>
/// <param name="LineRu">The partner's reply when the beat is satisfied.</param>
/// <param name="NudgeRu">The partner's reply when it is not — a re-ask, in character.</param>
public sealed record ScenarioBeat(
    [property: JsonPropertyName("goal_ru")] string GoalRu,
    [property: JsonPropertyName("expect_ru")] string ExpectRu,
    [property: JsonPropertyName("line_ru")] string LineRu,
    [property: JsonPropertyName("nudge_ru")] string NudgeRu);

/// <summary>
/// The authored roleplay catalogue, and the code that puts it in the database the first time the
/// feature is asked for anything.
///
/// <para><b>Why the seed is here and not in the migration.</b> The migration for this feature
/// contains only <c>CREATE TABLE</c>/<c>CREATE INDEX</c> — that rule exists because prod is live
/// with real users and a migration is the one thing that runs unattended against their data.
/// Content is not schema. It is planted by <c>RoleplayService</c> on first use, and only into an
/// EMPTY table, so an operator who edits or retires a scenario keeps their edit: the seed is a
/// starting point, not a reset that reasserts itself on every restart.</para>
///
/// <para>The Russian is ported verbatim from the frontend's <c>scenarios.ts</c>, which is what the
/// screen has been playing. Keeping the wording identical means this slice can be judged on the
/// plumbing it changes rather than on new content nobody has reviewed — the same reason the grader
/// rubric was ported unchanged in Faza 3.4.</para>
/// </summary>
public static class RoleplayScenarioSeed
{
    /// <summary>The slug the "Erkin mavzu" card opens. Its beats are open questions rather than a
    /// task list, so the partner keeps the exchange going wherever the student takes it.</summary>
    public const string FreeSlug = "free";

    private static readonly JsonSerializerOptions Json = new()
    {
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    /// <summary>One seeded scenario, in the shape the entity stores it.</summary>
    public sealed record Seed(
        string Slug, string TitleRu, string GoalUz, string Level, int Minutes, string Tone,
        string Icon, string PersonaRu, string OpeningRu,
        IReadOnlyList<ScenarioBeat> Beats, IReadOnlyList<string> Phrases, int SortOrder);

    /// <summary>Serializes beats/phrases for the jsonb columns. Cyrillic is written literally, not
    /// as <c>\uXXXX</c>, so the stored row is readable to whoever edits it next in psql.</summary>
    public static string Serialize<T>(T value) => JsonSerializer.Serialize(value, Json);

    /// <summary>Reads a beat list back out of the jsonb column. Returns an empty list rather than
    /// throwing on malformed content: a hand-edited scenario with a stray comma should close the
    /// conversation politely, not 500 a student mid-sentence.</summary>
    public static IReadOnlyList<ScenarioBeat> ReadBeats(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
            return Array.Empty<ScenarioBeat>();
        try
        {
            return JsonSerializer.Deserialize<List<ScenarioBeat>>(json, Json) ?? new List<ScenarioBeat>();
        }
        catch (JsonException)
        {
            return Array.Empty<ScenarioBeat>();
        }
    }

    /// <inheritdoc cref="ReadBeats"/>
    public static IReadOnlyList<string> ReadPhrases(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
            return Array.Empty<string>();
        try
        {
            return JsonSerializer.Deserialize<List<string>>(json, Json) ?? new List<string>();
        }
        catch (JsonException)
        {
            return Array.Empty<string>();
        }
    }

    /// <summary>
    /// The five scenarios the feature ships with — the four grid tiles in mockup order, then the
    /// free topic, which is deliberately last and is filtered out of the grid by its slug.
    /// </summary>
    public static readonly IReadOnlyList<Seed> All = new List<Seed>
    {
        new(
            Slug: "pharmacy",
            TitleRu: "В аптеке",
            GoalUz: "Dori dozasini bilib ol",
            Level: "A2",
            Minutes: 4,
            Tone: "peach",
            Icon: "💊",
            PersonaRu: "Ты — доброжелательный аптекарь в аптеке в Ташкенте. Клиент пришёл за лекарством.",
            OpeningRu: "Здравствуйте! Что вам подсказать?",
            Beats: new[]
            {
                new ScenarioBeat(
                    "Студент говорит, что его беспокоит, и просит лекарство.",
                    "Здравствуйте. У меня болит горло. Что можно взять?",
                    "Понятно. Возьмите вот эти таблетки для горла — они хорошо помогают.",
                    "Извините, я не расслышала. Что именно вас беспокоит?"),
                new ScenarioBeat(
                    "Студент спрашивает, как часто принимать лекарство.",
                    "Сколько раз в день их принимать?",
                    "Три раза в день, после еды. По одной таблетке.",
                    "Спросите меня, как их принимать — это важно."),
                new ScenarioBeat(
                    "Студент спрашивает, сколько дней продолжать лечение.",
                    "А сколько дней их пить?",
                    "Пять дней. Если не станет легче, обратитесь к врачу.",
                    "А как долго их пить, вы не спросили. Спросите, пожалуйста."),
                new ScenarioBeat(
                    "Студент спрашивает цену или как оплатить.",
                    "Спасибо. Сколько это стоит?",
                    "Сорок тысяч сумов. Оплатить можно на кассе. Выздоравливайте!",
                    "Что-нибудь ещё? Может быть, вас интересует цена?"),
            },
            Phrases: new[]
            {
                "Что можно взять от горла?",
                "Сколько раз в день принимать?",
                "Сколько это стоит?",
            },
            SortOrder: 1),

        new(
            Slug: "interview",
            TitleRu: "Собеседование",
            GoalUz: "O'zingni tanishtir",
            Level: "B1",
            Minutes: 5,
            Tone: "blue",
            Icon: "💼",
            PersonaRu: "Ты — HR-менеджер на собеседовании. Кандидат пришёл устраиваться на работу.",
            OpeningRu: "Добрый день! Расскажите немного о себе.",
            Beats: new[]
            {
                new ScenarioBeat(
                    "Кандидат называет имя, возраст и город.",
                    "Здравствуйте. Меня зовут Азиз, мне двадцать пять лет. Я живу в Ташкенте.",
                    "Очень приятно. А где вы работали раньше?",
                    "Простите, как вас зовут и откуда вы?"),
                new ScenarioBeat(
                    "Кандидат рассказывает о прошлом опыте работы.",
                    "Последние два года я работал менеджером в торговой компании.",
                    "Понятно. А почему вы хотите работать именно у нас?",
                    "Расскажите, пожалуйста, где вы работали и кем."),
                new ScenarioBeat(
                    "Кандидат объясняет, почему хочет эту работу.",
                    "Мне интересна ваша компания, и я хочу развиваться в этой сфере.",
                    "Хорошо. А какие у вас сильные стороны?",
                    "И всё-таки: почему вас заинтересовала наша компания?"),
                new ScenarioBeat(
                    "Кандидат называет свои сильные стороны.",
                    "Я ответственный, быстро учусь и легко работаю в команде.",
                    "Отлично. Спасибо, мы свяжемся с вами на этой неделе.",
                    "Назовите, пожалуйста, две-три ваши сильные стороны."),
            },
            Phrases: new[]
            {
                "Меня зовут … , мне … лет.",
                "Я работал менеджером два года.",
                "Я быстро учусь и работаю в команде.",
            },
            SortOrder: 2),

        new(
            Slug: "doctor",
            TitleRu: "У врача",
            GoalUz: "Shikoyatni tushuntir",
            Level: "A2",
            Minutes: 4,
            Tone: "green",
            Icon: "🩺",
            PersonaRu: "Ты — терапевт на приёме в поликлинике. К тебе пришёл пациент.",
            OpeningRu: "Здравствуйте! На что жалуетесь?",
            Beats: new[]
            {
                new ScenarioBeat(
                    "Пациент называет свои симптомы.",
                    "Здравствуйте, доктор. У меня болит голова и температура.",
                    "Понятно. А когда это началось?",
                    "Расскажите подробнее: что именно у вас болит?"),
                new ScenarioBeat(
                    "Пациент говорит, когда начались симптомы.",
                    "Два дня назад. Ещё у меня кашель.",
                    "Ясно. Горло болит? Давайте посмотрим.",
                    "А когда это началось — вчера, неделю назад?"),
                new ScenarioBeat(
                    "Пациент отвечает про горло.",
                    "Да, немного болит, когда я глотаю.",
                    "У вас простуда. Я выпишу вам лекарство.",
                    "Скажите, горло болит? Больно глотать?"),
                new ScenarioBeat(
                    "Пациент спрашивает, что ему делать дальше.",
                    "Спасибо. А что мне нужно делать?",
                    "Больше отдыхайте, пейте тёплую воду и принимайте лекарство. Выздоравливайте!",
                    "У вас есть вопросы? Спросите, что вам делать дома."),
            },
            Phrases: new[]
            {
                "У меня болит голова.",
                "Это началось два дня назад.",
                "Что мне нужно делать?",
            },
            SortOrder: 3),

        new(
            Slug: "taxi",
            TitleRu: "В такси",
            GoalUz: "Manzilni ayt",
            Level: "A1",
            Minutes: 3,
            Tone: "amber",
            Icon: "🚕",
            PersonaRu: "Ты — водитель такси в Ташкенте. Пассажир только что сел в машину.",
            OpeningRu: "Здравствуйте! Куда едем?",
            Beats: new[]
            {
                new ScenarioBeat(
                    "Пассажир называет улицу, куда ему нужно.",
                    "Здравствуйте. Мне нужно на улицу Навои.",
                    "Хорошо. А какой дом?",
                    "Простите, куда вам ехать? Скажите улицу."),
                new ScenarioBeat(
                    "Пассажир называет номер дома или ориентир.",
                    "Дом десять. Рядом с аптекой.",
                    "Понял. Поехали.",
                    "А номер дома какой?"),
                new ScenarioBeat(
                    "Пассажир спрашивает цену поездки.",
                    "Сколько будет стоить?",
                    "Двадцать тысяч сумов.",
                    "Может быть, вы хотите узнать цену? Спросите."),
                new ScenarioBeat(
                    "Пассажир просит остановиться.",
                    "Остановите здесь, пожалуйста.",
                    "Хорошо, приехали. Всего доброго!",
                    "Мы почти на месте. Скажите, где остановиться."),
            },
            Phrases: new[]
            {
                "Мне нужно на улицу Навои.",
                "Сколько будет стоить?",
                "Остановите здесь, пожалуйста.",
            },
            SortOrder: 4),

        new(
            Slug: FreeSlug,
            TitleRu: "Свободная тема",
            GoalUz: "Xohlagan mavzuda gaplash",
            Level: "A2",
            Minutes: 5,
            Tone: "peach",
            Icon: "💬",
            PersonaRu: "Ты — доброжелательный собеседник, который помогает практиковать разговорный русский.",
            OpeningRu: "Привет! О чём хочешь поговорить сегодня?",
            // The free topic has no task to satisfy, so every beat's goal is simply "the student
            // said something on topic". The nudges are open re-asks rather than corrections — the
            // point of this scenario is to keep a beginner talking, not to hold them to a script.
            Beats: new[]
            {
                new ScenarioBeat(
                    "Студент называет тему, о которой хочет поговорить.",
                    "Я хочу рассказать о своей работе.",
                    "Интересно! Расскажи об этом подробнее.",
                    "Я не совсем понял. О чём ты хочешь поговорить?"),
                new ScenarioBeat(
                    "Студент рассказывает подробности по своей теме.",
                    "Я работаю в магазине, у нас всегда много людей.",
                    "Понятно. А что тебе в этом нравится больше всего?",
                    "Расскажи чуть подробнее — я слушаю."),
                new ScenarioBeat(
                    "Студент говорит, что ему нравится или не нравится, и почему.",
                    "Мне нравится общаться с людьми, потому что это интересно.",
                    "Здорово. А как ты думаешь, что будет дальше?",
                    "А что тебе в этом нравится? Скажи почему."),
                new ScenarioBeat(
                    "Студент делится своим мнением или планом.",
                    "Я думаю, что скоро смогу говорить лучше.",
                    "Спасибо за разговор! У тебя хорошо получается говорить.",
                    "А как ты сам думаешь? Скажи своими словами."),
            },
            Phrases: new[]
            {
                "Я хочу рассказать о …",
                "Мне это нравится, потому что …",
                "Как ты думаешь?",
            },
            SortOrder: 5),
    };
}
