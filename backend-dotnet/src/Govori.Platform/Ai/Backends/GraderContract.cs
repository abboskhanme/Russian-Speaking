using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Govori.Platform.Grader;

namespace Govori.Platform.Ai.Backends;

/// <summary>
/// Everything the three grader vendors agree on: the rubric, the JSON schema, the user prompt and
/// the parser. The backends differ ONLY in transport — Claude through the official SDK, Gemini and
/// OpenAI over REST — and that difference stops at the edge of this file.
///
/// <para>It lives in one place because the vendors are interchangeable at runtime: the chain may
/// grade one submission with Claude and the next with Gemini after a fallback, and a student must
/// not be able to tell which. A rubric copied into three files drifts in three directions, and the
/// drift shows up as an unexplained score difference between two attempts at the same task.</para>
///
/// <para><b>Text only.</b> The rubric forbids the model from judging — or even mentioning —
/// pronunciation, accent, intonation, pace or rhythm. It never hears the audio; anything it said
/// about delivery would be invention. Delivery is scored by Azure's PronScore and folded in
/// afterwards by <c>Govori.Assessment.Scoring.Level</c> (the frozen C5 blend), so a model that
/// guessed at it would be double-counting a number it does not have.</para>
///
/// <para><b>No temperature is set on any vendor.</b> Claude Opus 5 reasons by default and the API
/// rejects an explicit temperature alongside thinking, so the only setting all three backends can
/// share is "whatever the vendor's default is". Consistency between them comes from the schema and
/// the rubric, not from a knob two of the three would have to be special-cased for.</para>
/// </summary>
public static partial class GraderContract
{
    /// <summary>
    /// The system instruction. Written in Russian because that is the language being judged and the
    /// one the model reasons about most precisely here; the FEEDBACK it produces is Uzbek, because
    /// the reader is an Uzbek-speaking learner. Ported verbatim from the pre-rewrite grader so the
    /// golden set measures the new plumbing, not a new rubric.
    ///
    /// <para>Three rules in here are not stylistic and must survive any edit: never judge delivery
    /// (we have no audio); never treat missing punctuation or capitals as an error (speech-to-text
    /// emits neither, so every transcript would "fail"); and never transliterate Russian into Latin
    /// letters (an Uzbek learner shown "yabloki" learns the wrong spelling).</para>
    /// </summary>
    public const string RubricSystem = """
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

    /// <summary>
    /// The wire shape, as JSON Schema. Field names are snake_case and the six scores are FLAT (not
    /// nested under a <c>scores</c> object) because that is what the three vendors' structured-output
    /// modes handle most reliably; <see cref="Parse"/> still accepts the nested form so a stored
    /// response from the pre-rewrite grader can be re-read.
    ///
    /// <para>There is deliberately no <c>minimum</c>/<c>maximum</c> on the scores even though they
    /// are 0–100: OpenAI's <c>strict</c> mode rejects numeric range keywords outright. The range is
    /// stated in the rubric and enforced by the clamp in <see cref="Parse"/>, which has to be there
    /// anyway — a schema cannot stop a model from returning 105.</para>
    ///
    /// <para><c>additionalProperties: false</c> plus a <c>required</c> list naming EVERY property is
    /// what OpenAI's strict mode demands; Claude accepts it and Gemini has it stripped back out by
    /// <see cref="GeminiResponseSchema"/>, which does not know the keyword.</para>
    /// </summary>
    private const string SchemaJson = """
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

    /// <summary>The schema name OpenAI requires alongside the schema body. Vendor-visible only.</summary>
    public const string SchemaName = "govori_grader_result";

    /// <summary>
    /// How long any one vendor gets before its backend gives up on it. Shared by all three so the
    /// chain's worst case is bounded and predictable rather than being whatever three different SDK
    /// defaults happen to add up to — the SDK defaults here run to minutes, long enough for one
    /// stalled vendor to hold a submission open past every retry the worker has.
    /// </summary>
    public static readonly TimeSpan VendorTimeout = TimeSpan.FromSeconds(60);

    /// <summary>
    /// The schema as Claude's SDK wants it — the root object flattened into a raw property bag for
    /// <c>OutputConfig.Format.Schema</c>. Built once and shared: <see cref="JsonElement"/> values
    /// cloned out of a parsed document are immutable, so there is nothing here for concurrent
    /// grading runs to corrupt.
    /// </summary>
    public static readonly IReadOnlyDictionary<string, JsonElement> AnthropicSchema = BuildAnthropicSchema();

    /// <summary>
    /// The schema as JSON Schema, for OpenAI's <c>json_schema</c> response format. Returns a FRESH
    /// tree on every call because <see cref="JsonNode"/> instances remember their parent — handing
    /// the same object to two concurrent requests would throw the moment the second tried to attach
    /// it to its own body.
    /// </summary>
    public static JsonObject StrictJsonSchema() => ParseSchema();

    /// <summary>
    /// The schema in the dialect Gemini's <c>responseSchema</c> accepts, which is an OpenAPI subset
    /// rather than JSON Schema: type names are the upper-case proto enum values, and
    /// <c>additionalProperties</c> is not a field it knows — sending it earns a 400 rather than
    /// being ignored. Fresh tree per call, for the reason given on <see cref="StrictJsonSchema"/>.
    /// </summary>
    public static JsonObject GeminiResponseSchema()
    {
        var schema = ParseSchema();
        ToGeminiDialect(schema);
        return schema;
    }

    /// <summary>
    /// Assembles the per-attempt half of the prompt: what the task was, what level it targets, and
    /// what the student actually said. The transcript is quoted so a one-word answer still reads as
    /// an answer rather than as a stray fragment of the instructions.
    /// </summary>
    public static string BuildUserPrompt(GraderRequest request)
    {
        var sb = new StringBuilder();

        if (!string.IsNullOrWhiteSpace(request.QuestionTitle))
            sb.Append("Название задания: ").AppendLine(request.QuestionTitle!.Trim());
        if (!string.IsNullOrWhiteSpace(request.Topic))
            sb.Append("Тема: ").AppendLine(request.Topic!.Trim());
        if (!string.IsNullOrWhiteSpace(request.Level))
            sb.Append("Уровень (CEFR): ").AppendLine(request.Level!.Trim());
        if (sb.Length > 0)
            sb.AppendLine();

        // Only claim a picture is attached when one is actually going on the wire. A backend that
        // dropped the image would otherwise leave the model hunting for a picture it cannot see and
        // inventing a relevance judgement about it.
        if (ResolveImageMime(request) is not null)
        {
            sb.AppendLine(
                "К заданию приложено изображение (см. картинку). Студент должен описать его. " +
                "При оценке relevance учитывай, насколько точно и полно ответ соответствует тому, " +
                "что действительно изображено на картинке.");
            sb.AppendLine();
        }

        if (!string.IsNullOrWhiteSpace(request.Instruction))
        {
            sb.AppendLine("Условие задания (что именно студент должен был сделать):");
            sb.AppendLine(request.Instruction!.Trim());
            sb.AppendLine();
        }

        sb.AppendLine("Текст задания (на которое отвечал студент):");
        sb.AppendLine(request.QuestionPrompt.Trim());
        sb.AppendLine();
        sb.AppendLine("Транскрипция устного ответа студента:");
        sb.Append('«').Append(request.TranscriptText.Trim()).AppendLine("»");
        sb.AppendLine();
        sb.Append("Оцени этот ответ согласно критериям (учитывай, выполнено ли условие задания).");

        return sb.ToString();
    }

    /// <summary>
    /// Turns one vendor's JSON answer into a <see cref="GraderResult"/>.
    ///
    /// <para>Deliberately forgiving, because the alternative is failing a student's attempt over a
    /// model's formatting habit: score strings are parsed as numbers, out-of-range scores are
    /// clamped, missing arrays become empty, and a missing <c>overall</c>/<c>level_overall</c> is
    /// derived from the four criteria. It throws only when the payload carries no usable judgement
    /// at all — then the chain falls through to the next vendor, which is the right answer.</para>
    ///
    /// <para><paramref name="modelThatActuallyRan"/> is what the API reported serving, never the
    /// configured model name: after a fallback the configured name is a lie, and
    /// <c>evaluations.llm_model</c> is the record of what really graded the answer (docs/07 §7.9).</para>
    /// </summary>
    public static GraderResult Parse(string json, string modelThatActuallyRan)
    {
        var payload = ExtractJsonObject(json);
        if (payload.Length == 0)
            throw new InvalidOperationException("grader returned no JSON object at all.");

        JsonDocument document;
        try
        {
            document = JsonDocument.Parse(payload);
        }
        catch (JsonException ex)
        {
            throw new InvalidOperationException(
                $"grader returned text that is not valid JSON: {Excerpt(payload)}", ex);
        }

        using (document)
        {
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object)
                throw new InvalidOperationException(
                    $"grader returned a JSON {root.ValueKind}, expected an object: {Excerpt(payload)}");

            // The pre-rewrite grader nested the six scores under "scores". Reading both shapes costs
            // one line and means a stored response never becomes unreadable.
            var scores = root.TryGetProperty("scores", out var nested) && nested.ValueKind == JsonValueKind.Object
                ? nested
                : root;

            var fluency = Number(scores, "fluency");
            var lexical = Number(scores, "lexical");
            var grammar = Number(scores, "grammar");
            var relevance = Number(scores, "relevance");

            var present = new[] { fluency, lexical, grammar, relevance }.Where(v => v is not null).ToArray();
            if (present.Length == 0)
                throw new InvalidOperationException(
                    $"grader payload carries none of the four criteria: {Excerpt(payload)}");

            // A criterion the model skipped is filled from the ones it did answer rather than from
            // zero — a silent zero would knock ~25 points off a band nobody meant to lower.
            var mean = present.Average(v => v!.Value);
            var four = new
            {
                Fluency = Clamp(fluency ?? mean),
                Lexical = Clamp(lexical ?? mean),
                Grammar = Clamp(grammar ?? mean),
                Relevance = Clamp(relevance ?? mean),
            };
            var criteriaMean = (four.Fluency + four.Lexical + four.Grammar + four.Relevance) / 4.0;

            var overall = Clamp(Number(scores, "overall") ?? criteriaMean);
            var levelOverall = Clamp(Number(scores, "level_overall") ?? overall);

            return new GraderResult
            {
                Scores = new GraderScores(
                    four.Fluency, four.Lexical, four.Grammar, four.Relevance, overall, levelOverall),
                Summary = Text(root, "summary"),
                Strengths = Strings(root, "strengths"),
                Improvements = Strings(root, "improvements"),
                Corrections = Corrections(root),
                VocabularySuggestions = Strings(root, "vocabulary_suggestions"),
                Model = string.IsNullOrWhiteSpace(modelThatActuallyRan) ? null : modelThatActuallyRan,
            };
        }
    }

    /// <summary>
    /// True when "original" and "corrected" differ only by punctuation, letter case, whitespace or
    /// the ё/е spelling — i.e. by something the student could not possibly have SAID.
    ///
    /// <para>This is C6, and it is enforced here rather than left to the prompt because the prompt is
    /// a request and this is a guarantee. Speech-to-text emits no punctuation and no capitals, so a
    /// model that slips back into proofreading mode produces a correction card reading "you said X,
    /// say X" — which teaches nothing and makes the whole feedback panel look broken.</para>
    /// </summary>
    public static bool IsCosmeticOnly(string? original, string? corrected)
        => string.Equals(NormalizeForCompare(original), NormalizeForCompare(corrected), StringComparison.Ordinal);

    /// <summary>
    /// The image MIME type to actually send, or <c>null</c> when there is no usable picture.
    ///
    /// <para>The declared <c>ImageMime</c> is trusted only when it names a format all three vendors
    /// accept; otherwise the bytes are sniffed. Guessing "probably JPEG" the way the old code did
    /// gets a 400 from every vendor the moment a PNG arrives, and a 400 here costs the student a
    /// fallback hop for no reason.</para>
    /// </summary>
    public static string? ResolveImageMime(GraderRequest request)
    {
        var bytes = request.ImageBytes;
        if (bytes is null || bytes.Length < 12)
            return null;

        var declared = request.ImageMime?.Trim().ToLowerInvariant();
        if (declared is "image/jpeg" or "image/png" or "image/webp" or "image/gif")
            return declared;
        if (declared == "image/jpg")
            return "image/jpeg";

        if (bytes[0] == 0xFF && bytes[1] == 0xD8 && bytes[2] == 0xFF)
            return "image/jpeg";
        if (bytes[0] == 0x89 && bytes[1] == 0x50 && bytes[2] == 0x4E && bytes[3] == 0x47)
            return "image/png";
        if (bytes[0] == 0x47 && bytes[1] == 0x49 && bytes[2] == 0x46 && bytes[3] == 0x38)
            return "image/gif";
        if (bytes[0] == 0x52 && bytes[1] == 0x49 && bytes[2] == 0x46 && bytes[3] == 0x46
            && bytes[8] == 0x57 && bytes[9] == 0x45 && bytes[10] == 0x42 && bytes[11] == 0x50)
            return "image/webp";

        return null;
    }

    /// <summary>
    /// Pulls the JSON object out of whatever the model wrapped it in. Structured output is supposed
    /// to make this unnecessary, and on Claude it does; Gemini and OpenAI still occasionally return
    /// the object inside a <c>```json</c> fence or with a sentence in front of it, and a strict
    /// parser would turn that cosmetic habit into a failed attempt.
    /// </summary>
    private static string ExtractJsonObject(string? raw)
    {
        var text = (raw ?? string.Empty).Trim();
        if (text.Length == 0)
            return string.Empty;

        if (text.StartsWith("```", StringComparison.Ordinal))
        {
            var firstBreak = text.IndexOf('\n');
            if (firstBreak >= 0)
                text = text[(firstBreak + 1)..];
            var fenceEnd = text.LastIndexOf("```", StringComparison.Ordinal);
            if (fenceEnd >= 0)
                text = text[..fenceEnd];
            text = text.Trim();
        }

        if (text.StartsWith('{') && text.EndsWith('}'))
            return text;

        var open = text.IndexOf('{');
        var close = text.LastIndexOf('}');
        return open >= 0 && close > open ? text[open..(close + 1)] : string.Empty;
    }

    private static double Clamp(double value) => Math.Clamp(double.IsFinite(value) ? value : 0.0, 0.0, 100.0);

    /// <summary>Reads a score whether the model emitted it as a number or as a quoted string —
    /// both happen, and the difference is not worth a fallback hop.</summary>
    private static double? Number(JsonElement owner, string name)
    {
        if (!owner.TryGetProperty(name, out var element))
            return null;

        return element.ValueKind switch
        {
            JsonValueKind.Number when element.TryGetDouble(out var number) => number,
            JsonValueKind.String when double.TryParse(
                element.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed) => parsed,
            _ => null,
        };
    }

    private static string Text(JsonElement owner, string name)
        => owner.TryGetProperty(name, out var element) && element.ValueKind == JsonValueKind.String
            ? element.GetString()?.Trim() ?? string.Empty
            : string.Empty;

    private static IReadOnlyList<string> Strings(JsonElement owner, string name)
    {
        if (!owner.TryGetProperty(name, out var element) || element.ValueKind != JsonValueKind.Array)
            return Array.Empty<string>();

        return element.EnumerateArray()
            .Where(item => item.ValueKind == JsonValueKind.String)
            .Select(item => item.GetString()!.Trim())
            .Where(value => value.Length > 0)
            .ToArray();
    }

    private static IReadOnlyList<GraderCorrection> Corrections(JsonElement root)
    {
        if (!root.TryGetProperty("corrections", out var element) || element.ValueKind != JsonValueKind.Array)
            return Array.Empty<GraderCorrection>();

        var corrections = new List<GraderCorrection>();
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
                continue;

            var original = Text(item, "original");
            var corrected = Text(item, "corrected");
            if (original.Length == 0 || corrected.Length == 0 || IsCosmeticOnly(original, corrected))
                continue;

            // The category is kept as the model wrote it rather than validated against the enum:
            // it is displayed through a lookup that falls back to the raw string, so an unfamiliar
            // label costs a nicer caption — dropping the correction would cost the student the
            // lesson in it.
            var type = Text(item, "type").ToLowerInvariant();
            corrections.Add(new GraderCorrection(
                original, corrected, type.Length > 0 ? type : "grammar", Text(item, "explanation")));
        }

        return corrections;
    }

    private static string NormalizeForCompare(string? value)
    {
        var text = (value ?? string.Empty).ToLowerInvariant().Replace('ё', 'е');
        return CollapseWhitespace().Replace(NonWordCharacters().Replace(text, " "), " ").Trim();
    }

    /// <summary>Trims a vendor payload down to something an operator can read in a log line without
    /// pasting a whole transcript — or a whole vendor error page — into it. Shared by the REST
    /// backends, which quote error bodies for the same reason.</summary>
    public static string Excerpt(string? payload, int limit = 300)
    {
        var text = (payload ?? string.Empty).Trim();
        return text.Length <= limit ? text : text[..limit] + "…";
    }

    private static JsonObject ParseSchema()
        => JsonNode.Parse(SchemaJson) as JsonObject
           ?? throw new InvalidOperationException("the grader schema constant is not a JSON object.");

    private static IReadOnlyDictionary<string, JsonElement> BuildAnthropicSchema()
    {
        using var document = JsonDocument.Parse(SchemaJson);
        return document.RootElement.EnumerateObject()
            .ToDictionary(property => property.Name, property => property.Value.Clone());
    }

    /// <summary>
    /// Rewrites a JSON Schema node in place into Gemini's OpenAPI subset. It walks the schema
    /// STRUCTURALLY — recursing through <c>properties</c> values and <c>items</c> — so that the
    /// <c>type</c> keyword gets upper-cased while the correction object's property NAMED "type" is
    /// left alone. A blind key rename would corrupt exactly that field.
    /// </summary>
    private static void ToGeminiDialect(JsonObject schema)
    {
        schema.Remove("additionalProperties");

        if (schema["type"]?.GetValueKind() == JsonValueKind.String)
            schema["type"] = schema["type"]!.GetValue<string>().ToUpperInvariant();

        if (schema["properties"] is JsonObject properties)
            foreach (var property in properties)
                if (property.Value is JsonObject child)
                    ToGeminiDialect(child);

        if (schema["items"] is JsonObject items)
            ToGeminiDialect(items);
    }

    [GeneratedRegex(@"[^\w\s]")]
    private static partial Regex NonWordCharacters();

    [GeneratedRegex(@"\s+")]
    private static partial Regex CollapseWhitespace();
}
