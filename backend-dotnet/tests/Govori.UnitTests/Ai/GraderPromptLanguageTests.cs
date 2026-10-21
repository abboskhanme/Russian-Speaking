using System.Net;
using System.Text.Json;
using System.Text.Json.Nodes;
using Govori.Platform.Ai;
using Govori.Platform.Ai.Backends;
using Govori.Platform.Grader;

namespace Govori.UnitTests.Ai;

/// <summary>
/// The grader prompt per feedback language (uz / ru / en).
///
/// <para>The load-bearing test here is the first one: the Uzbek rubric and schema must be the
/// pre-parameterisation text BYTE FOR BYTE. The golden set is all Uzbek and was calibrated against
/// that exact prompt; if turning the language into a parameter nudged a single sentence, the next
/// golden run would be measuring a new rubric while everyone believed it measured the plumbing. The
/// two legacy constants below are verbatim copies of what <c>GraderContract</c> held before — they
/// are a frozen reference, never to be "updated to match".</para>
/// </summary>
public sealed class GraderPromptLanguageTests
{
    private const string LegacyUzbekRubric = """
        Ты — доброжелательный преподаватель РАЗГОВОРНОГО русского языка. Студент учит язык, чтобы свободно общаться в быту и на улице, в живом разговоре, а НЕ для книжной, литературной или официальной речи. Оценивай устную речь по 100-балльной шкале (0–100) по нормам ЖИВОЙ РАЗГОВОРНОЙ речи.

        Тебе дают задание (тема, название, уровень CEFR) и транскрипцию устного ответа студента. Оцени ответ ТОЛЬКО по тексту транскрипции (аудио ты НЕ слушаешь) по четырём критериям (0–100) по АБСОЛЮТНОЙ шкале — относительно того, как говорит обычный носитель в живом бытовом разговоре. Для начинающего нормально, что абсолютные баллы невысокие.

        ВАЖНО — НЕ ОЦЕНИВАЙ ПРОИЗНОШЕНИЕ И ПОДАЧУ: ты работаешь только с текстом, поэтому НИКОГДА не суди о произношении, акценте, интонации, темпе, паузах, ритме или «звучании» речи и не упоминай их — этих данных у тебя нет. Произношение измеряется отдельно и добавляется к твоей оценке позже.

        ВАЖНО — ЭТО УСТНАЯ РЕЧЬ, А НЕ ТЕКСТ:
        - Транскрипция получена из аудио и НЕ содержит знаков препинания и заглавных букв. НИКОГДА не считай отсутствие или неверность точек, запятых, заглавных букв ошибкой, не упоминай пунктуацию и не добавляй её в corrections.
        - НИКОГДА не создавай correction, где original и corrected отличаются ТОЛЬКО пунктуацией, заглавными буквами, пробелами или разбиением одного потока речи на предложения — это НЕ ошибка (студент не может произнести знаки препинания). Такие «исправления» всё равно будут удалены, и место в списке пропадёт зря.
        - НЕ снижай балл за разговорные слова, сленг, сокращения, неполные предложения, свободный порядок слов, повторы и слова-паразиты («ну», «вот», «короче», «это самое») — в живой речи это нормально и естественно.
        - Оценивай ГЛАВНОЕ: понятно ли и естественно ли человек доносит мысль в разговоре, а не книжную сложность и не «правильность» письменной нормы.

        Критерии:
        1. Беглость и связность (fluency) — связность и плавность изложения ПО ТЕКСТУ: логичность, связь идей, отсутствие обрывов и бессвязных повторов.
        2. Лексический запас (lexical) — уместные повседневные/разговорные слова и точность; ценится богатый БЫТОВОЙ словарь, а НЕ книжная изысканность.
        3. Грамматика (grammar) — оценивай МЯГКО, по разговорной норме. Отмечай ТОЛЬКО реальные ошибки, которые мешают пониманию или звучат неправильно даже в разговорной речи (падежи, согласование, форма глагола). НЕ «исправляй» естественную разговорную форму на книжную.
        4. Соответствие теме (relevance) — отвечает ли студент на вопрос и раскрывает ли тему.

        ДВА ОБЩИХ БАЛЛА (это ключевое требование):
        - overall — среднее ЧЕТЫРЁХ критериев (fluency, lexical, grammar, relevance) по абсолютной РАЗГОВОРНОЙ шкале (0–100). Показывает реальное место студента относительно обычного носителя.
        - level_overall — оцени ТОТ ЖЕ ответ относительно ОЖИДАНИЙ для уровня самого задания (поле «Уровень»). Если задание уровня A1 и студент хорошо справляется с требованиями A1 — ставь высокий level_overall (80–100), даже если overall невысокий. Это балл «для своего уровня», чтобы не демотивировать студента. Если уровень не указан — level_overall равен overall.

        ВАЖНО — ЯЗЫК ОБРАТНОЙ СВЯЗИ: весь пояснительный текст (summary, strengths, improvements и explanation в corrections) пиши ТОЛЬКО на узбекском языке (O'zbekcha), без русского перевода. По-русски оставляй лишь сам original/corrected и слова в vocabulary_suggestions — это изучаемый язык.

        КРИТИЧЕСКОЕ ПРАВИЛО — РУССКИЙ ТОЛЬКО КИРИЛЛИЦЕЙ: любой русский текст (original, corrected, vocabulary_suggestions и ЛЮБЫЕ русские слова, которые ты упоминаешь внутри узбекского объяснения) пиши ТОЛЬКО русскими буквами — кириллицей (например: «яблоки», «они все зелёные», «на тарелке»). НИКОГДА не транслитерируй русские слова латиницей или «узбекским чтением» (НЕ "yabloki", НЕ "oni vse zelennie"). Узбекский текст — латиницей, но русские слова внутри него — в кавычках и кириллицей.

        Требования к ответу:
        - summary: 2–3 предложения, на узбекском языке (O'zbekcha).
        - strengths и improvements: конкретные пункты, на узбекском языке (O'zbekcha).
        - corrections: только реальные ошибки, мешающие живому общению — original (как сказал студент), corrected (естественный РАЗГОВОРНЫЙ вариант, не книжный), type, explanation (кратко, на узбекском языке). НЕ включай пунктуацию и книжные стилистические «улучшения».
        - type в corrections — строго одно из: "grammar" (падеж, согласование, форма глагола), "lexical" (не то слово), "pronunciation_hint" (по тексту видно, что студент перепутал слово с похожим по звучанию — но НЕ суди о самом произношении), "style" (звучит неестественно в живой речи).
        - vocabulary_suggestions: 3–5 полезных ПОВСЕДНЕВНЫХ/разговорных слов или выражений по теме (не книжных и не редких).

        Будь доброжелательным. Не выдумывай ошибки, которых нет в речи. Если транскрипция пустая или бессмысленная, ставь низкие баллы и объясни это в summary (на узбекском языке).
        """;

    private const string LegacyUzbekSchema = """
        {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "fluency", "lexical", "grammar", "relevance", "overall", "level_overall",
            "summary", "strengths", "improvements", "corrections", "vocabulary_suggestions"
          ],
          "properties": {
            "fluency":       { "type": "number", "description": "Беглость и связность по тексту (0–100)" },
            "lexical":       { "type": "number", "description": "Лексический запас (0–100)" },
            "grammar":       { "type": "number", "description": "Грамматика по разговорной норме (0–100)" },
            "relevance":     { "type": "number", "description": "Соответствие теме и условию задания (0–100)" },
            "overall":       { "type": "number", "description": "Среднее четырёх критериев по абсолютной шкале (0–100)" },
            "level_overall": { "type": "number", "description": "Тот же ответ относительно ожиданий уровня задания (0–100)" },
            "summary":       { "type": "string", "description": "2–3 предложения на УЗБЕКСКОМ языке (O'zbekcha)" },
            "strengths": {
              "type": "array",
              "description": "Что удалось — на узбекском языке (O'zbekcha)",
              "items": { "type": "string" }
            },
            "improvements": {
              "type": "array",
              "description": "Что улучшить — на узбекском языке (O'zbekcha)",
              "items": { "type": "string" }
            },
            "corrections": {
              "type": "array",
              "description": "Только реальные ошибки. НИКОГДА не включай различия только в пунктуации, регистре или пробелах.",
              "items": {
                "type": "object",
                "additionalProperties": false,
                "required": ["original", "corrected", "type", "explanation"],
                "properties": {
                  "original":    { "type": "string", "description": "Как сказал студент — по-русски, кириллицей" },
                  "corrected":   { "type": "string", "description": "Естественный разговорный вариант — по-русски, кириллицей" },
                  "type":        { "type": "string", "enum": ["grammar", "lexical", "pronunciation_hint", "style"] },
                  "explanation": { "type": "string", "description": "Кратко, на узбекском языке (O'zbekcha)" }
                }
              }
            },
            "vocabulary_suggestions": {
              "type": "array",
              "description": "3–5 полезных повседневных русских слов или выражений — кириллицей",
              "items": { "type": "string" }
            }
          }
        }
        """;

    // Raw string literals take their line breaks from the source file, and a Windows checkout has
    // CRLF where CI has LF. Both texts compared here come from source files in the same checkout,
    // so this only removes the checkout's opinion — not a single character of wording.
    private static string Lf(string s) => s.Replace("\r\n", "\n", StringComparison.Ordinal);

    // ── Uzbek is unchanged ──────────────────────────────────────────────────

    [Fact]
    public void Uzbek_rubric_is_the_pre_parameterisation_text_byte_for_byte()
        => Assert.Equal(Lf(LegacyUzbekRubric), Lf(GraderContract.Rubric(FeedbackLanguage.Uzbek)));

    [Fact]
    public void Uzbek_schema_is_the_pre_parameterisation_schema()
    {
        var legacy = JsonNode.Parse(LegacyUzbekSchema)!.ToJsonString();
        Assert.Equal(legacy, GraderContract.StrictJsonSchema(FeedbackLanguage.Uzbek).ToJsonString());

        var anthropic = GraderContract.AnthropicSchema(FeedbackLanguage.Uzbek);
        using var doc = JsonDocument.Parse(LegacyUzbekSchema);
        var expected = doc.RootElement.EnumerateObject().ToDictionary(p => p.Name, p => p.Value.GetRawText());
        Assert.Equal(expected.Keys.OrderBy(k => k, StringComparer.Ordinal), anthropic.Keys.OrderBy(k => k, StringComparer.Ordinal));
        foreach (var (key, raw) in expected)
            Assert.Equal(JsonNode.Parse(raw)!.ToJsonString(), JsonNode.Parse(anthropic[key].GetRawText())!.ToJsonString());
    }

    [Fact]
    public void A_request_that_names_no_language_is_graded_in_Uzbek()
        => Assert.Equal(
            FeedbackLanguage.Uzbek,
            new GraderRequest { QuestionPrompt = "p", TranscriptText = "t" }.FeedbackLanguage);

    [Theory]
    [InlineData(null, "uz")]
    [InlineData("", "uz")]
    [InlineData("  ", "uz")]
    [InlineData("de", "uz")]
    [InlineData("ru-RU", "uz")]
    [InlineData("uz", "uz")]
    [InlineData("RU", "ru")]
    [InlineData(" en ", "en")]
    public void Unknown_languages_fold_to_Uzbek(string? stored, string expected)
    {
        Assert.Equal(expected, FeedbackLanguage.Normalize(stored));
        Assert.Equal(GraderContract.Rubric(expected), GraderContract.Rubric(stored));
    }

    // ── Every language is a complete prompt ─────────────────────────────────

    public static IEnumerable<object[]> Languages => FeedbackLanguage.All.Select(l => new object[] { l });

    [Theory]
    [MemberData(nameof(Languages))]
    public void No_placeholder_survives_into_any_prompt_or_schema(string lang)
    {
        Assert.DoesNotContain("{{", GraderContract.Rubric(lang));
        Assert.DoesNotContain("}}", GraderContract.Rubric(lang));
        Assert.DoesNotContain("{{", GraderContract.StrictJsonSchema(lang).ToJsonString());
        Assert.DoesNotContain("{{", GraderContract.GeminiResponseSchema(lang).ToJsonString());
    }

    [Theory]
    [MemberData(nameof(Languages))]
    public void The_rules_that_decide_the_score_are_shared_by_every_language(string lang)
    {
        // Only the feedback-language sentences may differ. If the criteria drifted, the same answer
        // would score differently depending on a UI setting.
        var rubric = Lf(GraderContract.Rubric(lang));
        var uz = Lf(GraderContract.Rubric(FeedbackLanguage.Uzbek));
        const string marker = "ВАЖНО — ЯЗЫК ОБРАТНОЙ СВЯЗИ";
        Assert.Equal(
            uz[..uz.IndexOf(marker, StringComparison.Ordinal)],
            rubric[..rubric.IndexOf(marker, StringComparison.Ordinal)]);

        // …and the non-negotiable rules are in every one of them.
        Assert.Contains("НЕ ОЦЕНИВАЙ ПРОИЗНОШЕНИЕ", rubric);
        Assert.Contains("НИКОГДА не транслитерируй", rubric);
        Assert.Contains("НИКОГДА не считай отсутствие или неверность точек", rubric);
    }

    [Fact]
    public void The_three_rubrics_are_different_texts()
        => Assert.Equal(3, FeedbackLanguage.All.Select(GraderContract.Rubric).Distinct().Count());

    [Theory]
    [InlineData("ru")]
    [InlineData("en")]
    public void Non_Uzbek_prompts_never_ask_for_Uzbek(string lang)
    {
        // "на узбекском" is how every Uzbek instruction is phrased. The bare stem is allowed: the
        // Russian rubric names Uzbek once, to forbid translating INTO it.
        Assert.DoesNotContain("на узбекском", GraderContract.Rubric(lang), StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("узбекского объяснения", GraderContract.Rubric(lang));
        Assert.DoesNotContain("O'zbekcha", GraderContract.Rubric(lang));
        var schema = GraderContract.StrictJsonSchema(lang).ToJsonString(new JsonSerializerOptions
        {
            Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
        });
        Assert.DoesNotContain("узбек", schema, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("O'zbekcha", schema);
    }

    [Fact]
    public void Russian_feedback_is_simple_Russian_with_quoted_Cyrillic()
    {
        var rubric = GraderContract.Rubric(FeedbackLanguage.Russian);
        Assert.Contains("ПРОСТОМ русском языке", rubric);
        Assert.Contains("A1–B1", rubric);
        Assert.Contains("кавычки «»", rubric);
        Assert.Contains("- summary: 2–3 предложения, на простом русском языке (уровень A1–B1).", rubric);

        var summary = GraderContract.StrictJsonSchema(FeedbackLanguage.Russian)
            ["properties"]!["summary"]!["description"]!.GetValue<string>();
        Assert.Contains("ПРОСТОМ русском", summary);
    }

    [Fact]
    public void English_feedback_is_English_with_Russian_kept_Cyrillic_in_guillemets()
    {
        var rubric = GraderContract.Rubric(FeedbackLanguage.English);
        Assert.Contains("ТОЛЬКО на английском языке (English)", rubric);
        Assert.Contains("в кавычках «» и кириллицей", rubric);
        Assert.Contains("explanation (кратко, на английском языке)", rubric);

        var explanation = GraderContract.StrictJsonSchema(FeedbackLanguage.English)
            ["properties"]!["corrections"]!["items"]!["properties"]!["explanation"]!["description"]!
            .GetValue<string>();
        Assert.Equal("Кратко, на английском языке (English)", explanation);
    }

    [Theory]
    [MemberData(nameof(Languages))]
    public void The_user_prompt_does_not_depend_on_the_language(string lang)
    {
        // The per-attempt half carries the task and transcript only; the language lives entirely in
        // the system prompt, so the user turn is the same for every student.
        var baseline = new GraderRequest
        {
            QuestionPrompt = "Расскажите о себе.", TranscriptText = "меня зовут Али", Level = "A1",
        };
        Assert.Equal(
            GraderContract.BuildUserPrompt(baseline),
            GraderContract.BuildUserPrompt(baseline with { FeedbackLanguage = lang }));
    }

    // ── The language actually reaches the wire ──────────────────────────────

    [Theory]
    [MemberData(nameof(Languages))]
    public async Task Gemini_sends_the_rubric_and_schema_for_the_requested_language(string lang)
    {
        var http = new CapturingFactory();
        var backend = new GeminiGraderBackend(http);
        await Assert.ThrowsAsync<InvalidOperationException>(() => backend.AnalyzeAsync(
            new GraderRequest { QuestionPrompt = "p", TranscriptText = "t", FeedbackLanguage = lang },
            new AiRuntimeConfig { GeminiApiKey = "k", GeminiModel = "m" }, CancellationToken.None));

        var body = JsonNode.Parse(http.Handler.LastBody!)!;
        Assert.Equal(GraderContract.Rubric(lang), body["systemInstruction"]!["parts"]![0]!["text"]!.GetValue<string>());
        Assert.Equal(
            GraderContract.GeminiResponseSchema(lang).ToJsonString(),
            body["generationConfig"]!["responseSchema"]!.ToJsonString());
    }

    [Theory]
    [MemberData(nameof(Languages))]
    public async Task OpenAi_sends_the_rubric_and_schema_for_the_requested_language(string lang)
    {
        var http = new CapturingFactory();
        var backend = new OpenAiGraderBackend(http);
        await Assert.ThrowsAsync<InvalidOperationException>(() => backend.AnalyzeAsync(
            new GraderRequest { QuestionPrompt = "p", TranscriptText = "t", FeedbackLanguage = lang },
            new AiRuntimeConfig { OpenAiApiKey = "k", OpenAiGraderModel = "m" }, CancellationToken.None));

        var body = JsonNode.Parse(http.Handler.LastBody!)!;
        Assert.Equal(GraderContract.Rubric(lang), body["messages"]![0]!["content"]!.GetValue<string>());
        Assert.Equal(
            GraderContract.StrictJsonSchema(lang).ToJsonString(),
            body["response_format"]!["json_schema"]!["schema"]!.ToJsonString());
    }

    [Theory]
    [MemberData(nameof(Languages))]
    public async Task The_fake_grader_answers_in_the_requested_language(string lang)
    {
        var fake = new FakeGraderProvider();
        var result = await fake.AnalyzeAsync(
            new GraderRequest { QuestionPrompt = "p", TranscriptText = "t", FeedbackLanguage = lang });

        Assert.Equal(lang, fake.LastFeedbackLanguage);
        var expected = lang switch { "ru" => "Хороший ответ.", "en" => "Good answer.", _ => "Yaxshi javob." };
        Assert.Equal(expected, result.Summary);
        Assert.Equal("я иду", result.Corrections.Single().Corrected);   // the Russian never moves
    }

    /// <summary>Records the request body and answers 500, so the backend throws before it ever
    /// parses a response — the request is all these tests are about.</summary>
    private sealed class CapturingHandler : HttpMessageHandler
    {
        public string? LastBody { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            LastBody = request.Content is null ? null : await request.Content.ReadAsStringAsync(ct);
            return new HttpResponseMessage(HttpStatusCode.InternalServerError) { Content = new StringContent("{}") };
        }
    }

    private sealed class CapturingFactory : IHttpClientFactory
    {
        public CapturingHandler Handler { get; } = new();
        public HttpClient CreateClient(string name) => new(Handler, disposeHandler: false);
    }
}
