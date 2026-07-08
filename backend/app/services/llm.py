"""Russian speech analysis via the configured LLM grader with structured output.

The grader provider is resolved at runtime (Azure OpenAI when configured, else
Google Gemini as the fallback) from app_settings, so an admin can switch
providers or rotate keys from the UI without a redeploy.

Given a transcript of a student's spoken answer, returns 0–100 scores on two
scales — absolute (vs a typical native speaker in everyday COLLOQUIAL/spoken
Russian, not literary/written norms) and relative to the task's own CEFR level —
plus targeted corrections and Uzbek feedback. Punctuation is ignored (the input
is a raw speech transcript).

Uses the Gemini free tier — see https://aistudio.google.com/apikey for an API key.
"""

import base64
import logging
import re
import time

from google import genai
from google.genai import errors as genai_errors
from google.genai import types
from openai import AzureOpenAI
from pydantic import BaseModel, Field

from app.core.breaker import azure_llm_breaker, gemini_besteffort_breaker, gemini_breaker
from app.services import app_settings as _cfg

log = logging.getLogger(__name__)

# Gemini sometimes returns transient 503 (overloaded) / 429 (rate) errors.
# Retry with backoff — this runs in a background Celery worker, so the wait is invisible to users.
_RETRYABLE_CODES = {429, 500, 503}
_MAX_ATTEMPTS = 4


# ─── Provider resolution (Azure OpenAI preferred, Gemini fallback) ──────────
# Config is resolved fresh on each call (cheap — cached in app_settings) so an
# admin can flip providers or rotate keys from the UI without a restart. Azure
# OpenAI is used as the grader when configured; Gemini is the emergency fallback.
def _llm_conf() -> tuple[dict, bool]:
    """Return (resolved config, use_azure). use_azure is True only when Azure is
    selected (provider 'azure' or 'auto') AND fully configured."""
    c = _cfg.resolve_llm()
    azure_ready = bool(c["azure_endpoint"] and c["azure_api_key"] and c["azure_deployment"])
    use_azure = azure_ready and c["provider"] in ("azure", "auto")
    return c, use_azure


_gemini_clients: dict[str, genai.Client] = {}
_azure_clients: dict[tuple, AzureOpenAI] = {}


def _gemini_client(api_key: str) -> genai.Client:
    """Cached Gemini client per API key. Deferring construction keeps the app
    importable when no key is set — only the AI call itself fails, not boot."""
    cli = _gemini_clients.get(api_key)
    if cli is None:
        cli = genai.Client(api_key=api_key)
        _gemini_clients[api_key] = cli
    return cli


def _azure_client(c: dict) -> AzureOpenAI:
    """Cached Azure OpenAI client keyed by (endpoint, key, api_version)."""
    key = (c["azure_endpoint"], c["azure_api_key"], c["azure_api_version"])
    cli = _azure_clients.get(key)
    if cli is None:
        cli = AzureOpenAI(
            azure_endpoint=c["azure_endpoint"],
            api_key=c["azure_api_key"],
            api_version=c["azure_api_version"],
        )
        _azure_clients[key] = cli
    return cli


@azure_llm_breaker
def _azure_structured(
    c, system, user_text, schema, *, image_bytes=None, image_mime=None, temperature=0.4
):
    """One structured (schema-validated) Azure OpenAI chat call → pydantic model."""
    content: list = [{"type": "text", "text": user_text}]
    if image_bytes:
        b64 = base64.b64encode(image_bytes).decode()
        content.append(
            {
                "type": "image_url",
                "image_url": {"url": f"data:{image_mime or 'image/jpeg'};base64,{b64}"},
            }
        )
    completion = _azure_client(c).beta.chat.completions.parse(
        model=c["azure_deployment"],
        messages=[{"role": "system", "content": system}, {"role": "user", "content": content}],
        response_format=schema,
        temperature=temperature,
    )
    parsed = completion.choices[0].message.parsed
    if parsed is None:
        raise ValueError("Azure OpenAI returned no parseable content")
    return parsed


@azure_llm_breaker
def _azure_text(c, system, user_text, temperature):
    """One plain-text Azure OpenAI chat call → str."""
    completion = _azure_client(c).chat.completions.create(
        model=c["azure_deployment"],
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user_text}],
        temperature=temperature,
    )
    return (completion.choices[0].message.content or "").strip()


def _gemini_generate_impl(*, api_key, model, contents, system, schema=None, temperature=None):
    """One Gemini call with retry/backoff on transient errors. Returns the raw
    response object (caller reads .parsed / .text). Not circuit-guarded itself —
    call one of the breaker-wrapped aliases below instead."""
    cfg_kwargs: dict = {
        "system_instruction": system,
        "thinking_config": types.ThinkingConfig(thinking_budget=0),
    }
    if schema is not None:
        cfg_kwargs["response_mime_type"] = "application/json"
        cfg_kwargs["response_schema"] = schema
    if temperature is not None:
        cfg_kwargs["temperature"] = temperature
    config = types.GenerateContentConfig(**cfg_kwargs)
    for attempt in range(_MAX_ATTEMPTS):
        try:
            return _gemini_client(api_key).models.generate_content(
                model=model, contents=contents, config=config
            )
        except genai_errors.APIError as e:
            if getattr(e, "code", None) in _RETRYABLE_CODES and attempt < _MAX_ATTEMPTS - 1:
                time.sleep(2 * (attempt + 1))
                continue
            raise
    raise RuntimeError("unreachable")


# The grader (analyze) runs on the MAIN circuit — its health decides whether the
# next student can be graded. Best-effort extras (orthoepy, exemplar answers) run
# on a SEPARATE circuit so their rate-limit failures can never open the grader's.
_gemini_generate = gemini_breaker(_gemini_generate_impl)
_gemini_generate_besteffort = gemini_besteffort_breaker(_gemini_generate_impl)


# ─── Structured output schema ──────────────────────────────────────────────
class Scores(BaseModel):
    # Only TEXT-based criteria — delivery scores (произношение, темп, интонация,
    # естественность/близость к живой речи) were removed: they need reliable
    # acoustic analysis of Russian, which we don't have, so we no longer score them.
    fluency: float = Field(ge=0, le=100, description="Беглость и связность (0–100)")
    lexical: float = Field(ge=0, le=100, description="Лексический запас (0–100)")
    grammar: float = Field(ge=0, le=100, description="Грамматика (0–100)")
    relevance: float = Field(ge=0, le=100, description="Соответствие теме / релевантность (0–100)")
    overall: float = Field(
        ge=0, le=100, description="Общий балл по абсолютной шкале (стандарт C2) (0–100)"
    )
    level_overall: float = Field(
        ge=0,
        le=100,
        description="Общий балл относительно уровня самого задания (A1..C2) (0–100)",
    )


class Correction(BaseModel):
    original: str
    corrected: str
    type: str = Field(description="grammar | lexis | word_order | other")
    explanation: str


class EvaluationResult(BaseModel):
    scores: Scores
    summary: str = Field(description="Краткое резюме на УЗБЕКСКОМ языке (O'zbekcha)")
    strengths: list[str]
    improvements: list[str]
    corrections: list[Correction]
    vocabulary_suggestions: list[str]


# Speech-to-text can't produce punctuation or capitals, so the grader must never
# turn a punctuation/case-only difference into a "grammar error". The prompt asks
# for this, but the model still rationalises it (e.g. "split the sentences") — so
# we ALSO drop such corrections deterministically here.
_PUNCT_RE = re.compile(r"[^\w\s]", re.UNICODE)


def _norm_for_compare(s: str) -> str:
    # Lowercase, treat ё/е the same (a common transcript artifact), drop
    # punctuation, and collapse whitespace.
    s = (s or "").lower().replace("ё", "е")
    s = _PUNCT_RE.sub(" ", s)
    return re.sub(r"\s+", " ", s).strip()


def _drop_cosmetic_corrections(result: "EvaluationResult") -> "EvaluationResult":
    """Remove corrections whose only change is punctuation / capitalisation."""
    result.corrections = [
        c for c in result.corrections
        if _norm_for_compare(c.original) != _norm_for_compare(c.corrected)
    ]
    return result


# ─── Rubric (system instruction) ───────────────────────────────────────────
RUBRIC_SYSTEM = """Ты — доброжелательный преподаватель РАЗГОВОРНОГО русского языка. \
Студент учит язык, чтобы свободно общаться в быту и на улице, в живом разговоре, \
а НЕ для книжной, литературной или официальной речи. Оценивай устную речь по \
100-балльной шкале (0–100) по нормам ЖИВОЙ РАЗГОВОРНОЙ речи.

Тебе дают задание (тема, название, уровень CEFR) и транскрипцию устного ответа студента. \
Оцени ответ ТОЛЬКО по тексту транскрипции (аудио ты НЕ слушаешь) по четырём критериям \
(0–100) по АБСОЛЮТНОЙ шкале — относительно того, как говорит обычный носитель в живом \
бытовом разговоре. Для начинающего нормально, что абсолютные баллы невысокие.

ВАЖНО — НЕ ОЦЕНИВАЙ ПРОИЗНОШЕНИЕ И ПОДАЧУ: ты работаешь только с текстом, поэтому \
НИКОГДА не суди о произношении, акценте, интонации, темпе, паузах, ритме или «звучании» \
речи и не упоминай их — этих данных у тебя нет.

ВАЖНО — ЭТО УСТНАЯ РЕЧЬ, А НЕ ТЕКСТ:
- Транскрипция получена из аудио и НЕ содержит знаков препинания и заглавных букв. \
НИКОГДА не считай отсутствие или неверность точек, запятых, заглавных букв ошибкой, \
не упоминай пунктуацию и не добавляй её в corrections.
- НИКОГДА не создавай correction, где original и corrected отличаются ТОЛЬКО \
пунктуацией, заглавными буквами или разбиением одного потока речи на предложения — \
это НЕ ошибка (студент не может произнести знаки препинания).
- НЕ снижай балл за разговорные слова, сленг, сокращения, неполные предложения, \
свободный порядок слов, повторы и слова-паразиты («ну», «вот», «короче», «это самое») — \
в живой речи это нормально и естественно.
- Оценивай ГЛАВНОЕ: понятно ли и естественно ли человек доносит мысль в разговоре, \
а не книжную сложность и не «правильность» письменной нормы.

Критерии:
1. Беглость и связность (fluency) — связность и плавность изложения по тексту: логичность, \
связь идей, отсутствие обрывов и бессвязных повторов.
2. Лексический запас (lexical) — уместные повседневные/разговорные слова и точность; \
ценится богатый БЫТОВОЙ словарь, а НЕ книжная изысканность.
3. Грамматика (grammar) — оценивай МЯГКО, по разговорной норме. Отмечай ТОЛЬКО реальные \
ошибки, которые мешают пониманию или звучат неправильно даже в разговорной речи \
(падежи, согласование, форма глагола). НЕ «исправляй» естественную разговорную форму на \
книжную.
4. Соответствие теме (relevance) — отвечает ли студент на вопрос и раскрывает ли тему.

ДВА ОБЩИХ БАЛЛА (это ключевое требование):
- overall — среднее ЧЕТЫРЁХ критериев (fluency, lexical, grammar, relevance) по \
абсолютной РАЗГОВОРНОЙ шкале (0–100). Показывает реальное место студента относительно \
обычного носителя.
- level_overall — оцени ТОТ ЖЕ ответ относительно ОЖИДАНИЙ для уровня самого задания \
(поле «Уровень»). Если задание уровня A1 и студент хорошо справляется с требованиями \
A1 — ставь высокий level_overall (80–100), даже если overall невысокий. Это балл «для \
своего уровня», чтобы не демотивировать студента. Если уровень не указан — \
level_overall равен overall.

ВАЖНО — ЯЗЫК ОБРАТНОЙ СВЯЗИ: весь пояснительный текст (summary, strengths, improvements и \
explanation в corrections) пиши ТОЛЬКО на узбекском языке (O'zbekcha), без русского \
перевода. По-русски оставляй лишь сам corrected и слова в vocabulary_suggestions — это \
изучаемый язык.

КРИТИЧЕСКОЕ ПРАВИЛО — РУССКИЙ ТОЛЬКО КИРИЛЛИЦЕЙ: любой русский текст (original, corrected, \
vocabulary_suggestions и ЛЮБЫЕ русские слова, которые ты упоминаешь внутри узбекского \
объяснения) пиши ТОЛЬКО русскими буквами — кириллицей (например: «яблоки», «они все \
зелёные», «на тарелке»). НИКОГДА не транслитерируй русские слова латиницей или «узбекским \
чтением» (НЕ "yabloki", НЕ "oni vse zelennie", НЕ "vse yabloki"). Узбекский текст — \
латиницей, но русские слова внутри него — в кавычках и кириллицей.

Требования к ответу:
- summary: 2–3 предложения, на узбекском языке (O'zbekcha).
- strengths и improvements: конкретные пункты, на узбекском языке (O'zbekcha).
- corrections: только реальные ошибки, мешающие живому общению — original (как сказал \
студент), corrected (естественный РАЗГОВОРНЫЙ вариант, не книжный), type, explanation \
(кратко, на узбекском языке). НЕ включай пунктуацию и книжные стилистические «улучшения».
- vocabulary_suggestions: 3–5 полезных ПОВСЕДНЕВНЫХ/разговорных слов или выражений по \
теме (не книжных и не редких).

Будь доброжелательным. Не выдумывай ошибки, которых нет в речи. \
Если транскрипция пустая или бессмысленная, ставь низкие баллы и объясни это в summary \
(на узбекском языке)."""


def analyze(
    *,
    question_prompt: str,
    transcript_text: str,
    instruction: str | None = None,
    question_title: str | None = None,
    level: str | None = None,
    topic: str | None = None,
    image_bytes: bytes | None = None,
    image_mime: str | None = None,
) -> EvaluationResult:
    """Analyze a Russian spoken answer and return structured band scores + feedback.

    Text-only: the model judges the transcript, NOT the audio — delivery
    (pronunciation, intonation, pace) is no longer scored. For picture-description
    tasks, pass `image_bytes` (+ `image_mime`): Gemini sees the picture and judges
    the description (relevance)."""
    context_lines = []
    if question_title:
        context_lines.append(f"Название задания: {question_title}")
    if topic:
        context_lines.append(f"Тема: {topic}")
    if level:
        context_lines.append(f"Уровень (CEFR): {level}")
    context_block = ("\n".join(context_lines) + "\n\n") if context_lines else ""

    image_note = (
        "К заданию приложено изображение (см. картинку). Студент должен описать его. "
        "При оценке relevance учитывай, насколько точно и полно ответ соответствует "
        "тому, что действительно изображено на картинке.\n\n"
        if image_bytes
        else ""
    )

    instruction_block = (
        f"Условие задания (что именно студент должен был сделать):\n{instruction.strip()}\n\n"
        if instruction and instruction.strip()
        else ""
    )
    user_content = (
        f"{context_block}{image_note}{instruction_block}"
        f"Текст задания (на которое отвечал студент):\n{question_prompt}\n\n"
        f"Транскрипция устного ответа студента:\n«{transcript_text}»\n\n"
        f"Оцени этот ответ согласно критериям (учитывай, выполнено ли условие задания)."
    )

    # Multimodal contents: attach the picture for picture-description tasks.
    parts: list = []
    if image_bytes:
        parts.append(types.Part.from_bytes(data=image_bytes, mime_type=image_mime or "image/jpeg"))
    parts.append(user_content)
    contents: object = parts if len(parts) > 1 else user_content

    c, use_azure = _llm_conf()
    if use_azure:
        try:
            return _drop_cosmetic_corrections(
                _azure_structured(
                    c, RUBRIC_SYSTEM, user_content, EvaluationResult,
                    image_bytes=image_bytes, image_mime=image_mime, temperature=0.3,
                )
            )
        except Exception as e:
            log.warning("Azure OpenAI grader failed; falling back to Gemini: %s", e)

    response = _gemini_generate(
        api_key=c["gemini_api_key"],
        model=c["gemini_model"],
        contents=contents,
        system=RUBRIC_SYSTEM,
        schema=EvaluationResult,
    )
    result = response.parsed
    if not isinstance(result, EvaluationResult):
        raise ValueError("LLM did not return a parseable evaluation")
    return _drop_cosmetic_corrections(result)


# ─── Explain my answer ─────────────────────────────────────────────────────
class ExplainResult(BaseModel):
    explanation: str = Field(description="Подробное объяснение на УЗБЕКСКОМ языке (O'zbekcha)")
    improved_sentence: str = Field(description="Переписанный, улучшенный вариант слабого предложения (на русском)")


_EXPLAIN_SYSTEM = """Ты — доброжелательный преподаватель РАЗГОВОРНОГО русского языка. \
Студент учит язык для живого бытового общения, а не для книжной речи. \
Студенту дали задание, он ответил устно (есть транскрипция из аудио — без знаков \
препинания и заглавных букв; пунктуацию НЕ считай ошибкой и не упоминай). \
Объясни простыми словами, что можно улучшить в РАЗГОВОРНОЙ речи и почему, и приведи один \
переписанный, более естественный РАЗГОВОРНЫЙ вариант его самого слабого предложения \
(не книжный). Не «исправляй» нормальную разговорную форму на литературную. \
explanation пиши ТОЛЬКО на узбекском языке (O'zbekcha), без русского текста. \
explanation: 3–5 предложений на узбекском языке (O'zbekcha). \
improved_sentence: одно улучшенное разговорное предложение на русском (это изучаемый язык). \
КРИТИЧЕСКОЕ ПРАВИЛО: improved_sentence и ЛЮБЫЕ русские слова, которые ты упоминаешь в \
explanation, пиши ТОЛЬКО русскими буквами (кириллицей: «они все зелёные», «яблоки»). \
НИКОГДА не транслитерируй русские слова латиницей (НЕ "oni vse zelennie", НЕ "yabloki")."""


def explain_answer(*, question_prompt: str, transcript_text: str) -> ExplainResult:
    """Deeper coaching follow-up for one student answer."""
    user_content = (
        f"Задание:\n{question_prompt}\n\n"
        f"Ответ студента (транскрипция):\n«{transcript_text}»\n\n"
        f"Объясни, как улучшить ответ, и перепиши самое слабое предложение."
    )
    c, use_azure = _llm_conf()
    if use_azure:
        try:
            return _azure_structured(c, _EXPLAIN_SYSTEM, user_content, ExplainResult, temperature=0.4)
        except Exception as e:
            log.warning("Azure OpenAI explain failed; falling back to Gemini: %s", e)
    response = _gemini_generate(
        api_key=c["gemini_api_key"],
        model=c["gemini_model"],
        contents=user_content,
        system=_EXPLAIN_SYSTEM,
        schema=ExplainResult,
    )
    result = response.parsed
    if not isinstance(result, ExplainResult):
        raise ValueError("LLM did not return a parseable explanation")
    return result


# ─── Model (exemplar) answer ───────────────────────────────────────────────
_MODEL_ANSWER_SYSTEM = """Ты — носитель русского языка и преподаватель устной речи. \
Напиши образцовый УСТНЫЙ ответ на задание — уровня, указанного в задании \
(или B1, если уровень не указан). Подбирай ответ ПОД САМО ЗАДАНИЕ: отвечай именно на \
то, что спрашивают, и раскрывай тему. 4–7 предложений на русском языке, ТОЛЬКО русскими \
буквами (кириллицей); НИКОГДА не транслитерируй латиницей. Верни только текст ответа, \
без пояснений.

СТИЛЬ:
- Если задан стиль «live» (живой/разговорный): говори так, как обычный человек в живом \
бытовом разговоре на улице — естественные разговорные обороты, простые предложения, \
повседневная лексика, можно «ну», «вот», «короче». НЕ книжно.
- Если задан стиль «regular» (обычный): говори правильной, нейтральной устной речью — \
грамотно и понятно, без сленга и без лишней книжности.

ВАЖНО — КАЖДЫЙ РАЗ ДАВАЙ НОВЫЙ ВАРИАНТ: придумывай свежий, отличающийся ответ \
(другие детали, примеры, формулировки), а не повторяй один и тот же шаблон."""


def generate_model_answer(
    *,
    question_prompt: str,
    question_title: str | None = None,
    level: str | None = None,
    topic: str | None = None,
    ru_style: str | None = None,
    variant_hint: str | None = None,
) -> str:
    """Generate an exemplar spoken answer (plain Russian text), adapted to the task.

    `ru_style` ("regular" | "live") steers register. `variant_hint` is any free
    string mixed into the prompt so repeated calls yield a fresh, different answer."""
    ctx = []
    if question_title:
        ctx.append(f"Название: {question_title}")
    if topic:
        ctx.append(f"Тема: {topic}")
    if level:
        ctx.append(f"Уровень: {level}")
    style = (ru_style or "").strip().lower()
    if style in ("regular", "live"):
        ctx.append(f"Стиль: {style}")
    block = ("\n".join(ctx) + "\n\n") if ctx else ""
    nudge = f"\n\n(Дай новый, отличающийся вариант ответа. Метка варианта: {variant_hint})" if variant_hint else ""
    user_content = f"{block}Задание:\n{question_prompt}\n\nНапиши образцовый ответ.{nudge}"
    c, use_azure = _llm_conf()
    if use_azure:
        try:
            return _azure_text(c, _MODEL_ANSWER_SYSTEM, user_content, 1.0)
        except Exception as e:
            log.warning("Azure OpenAI model-answer failed; falling back to Gemini: %s", e)
    # Higher temperature → a fresh variant each attempt. Best-effort circuit: a
    # rate-limit here must never open the grader's breaker.
    response = _gemini_generate_besteffort(
        api_key=c["gemini_api_key"],
        model=c["gemini_model"],
        contents=user_content,
        system=_MODEL_ANSWER_SYSTEM,
        temperature=1.1,
    )
    return (response.text or "").strip()


# ─── Bulk question generation ──────────────────────────────────────────────
class GeneratedQuestion(BaseModel):
    title: str = Field(description="Краткое название задания (3–6 слов), на русском (кириллица)")
    prompt_text: str = Field(
        description="Текст задания для УСТНОГО ответа — что студент должен рассказать/описать. На русском."
    )
    model_answer_text: str = Field(
        description="Образцовый РАЗГОВОРНЫЙ ответ носителя на это задание: 4–7 живых предложений, только кириллица."
    )
    media_query: str = Field(
        default="",
        description=(
            "Для image/video заданий — 2–4 АНГЛИЙСКИХ ключевых слова для подбора стокового "
            "фото/видео (например 'family dinner table'). Для текстовых заданий — пустая строка."
        ),
    )


class _GeneratedBatch(BaseModel):
    questions: list[GeneratedQuestion]


_GEN_SYSTEM = """Ты — методист и преподаватель русского как иностранного (РКИ). \
Твоя задача — генерировать РАЗНООБРАЗНЫЕ задания для развития УСТНОЙ разговорной речи.

Требования:
- Строго соблюдай уровень CEFR (A1–C2): лексика, грамматика и сложность темы должны \
соответствовать уровню. A1/A2 — простые бытовые вопросы; B1/B2 — рассуждение и сравнение; \
C1/C2 — абстрактные темы, аргументация.
- Каждое задание — отдельный коммуникативный повод и РАЗНЫЙ формат: описать, рассказать о \
своём опыте, сравнить, высказать и обосновать мнение, ролевая ситуация, дать совет и т.п.
- НИКАКИХ повторов и почти-дубликатов между заданиями.
- Образцовый ответ (model_answer_text) — живая РАЗГОВОРНАЯ речь носителя, НЕ книжная, только кириллица.
- Всё на русском языке (кириллица), кроме media_query (английские ключевые слова).
- Для image-заданий: студент ОПИСЫВАЕТ фотографию — сформулируй задание так, чтобы на него \
можно было ответить, глядя на фото; дай media_query.
- Для video-заданий: студент смотрит короткое видео и реагирует/описывает; дай media_query."""


# Per-call ceiling: asking the model for too many items at once truncates the
# JSON and hurts variety, so larger counts are split into several calls.
_GEN_CHUNK = 20


def _generate_chunk(
    *,
    level: str,
    topic: str,
    qtype: str,
    count: int,
    avoid_titles: list[str] | None = None,
    custom: str | None = None,
) -> list[GeneratedQuestion]:
    """Generate up to ~`count` varied speaking tasks in a single model call.

    `custom` is optional free-text guidance from the teacher (desired format,
    tone, focus). It steers generation but must never override the safety/format
    rules in the system prompt.
    """
    type_hint = {
        "text": "Тип заданий: устный ответ БЕЗ медиа. media_query оставь пустым.",
        "image": "Тип заданий: студент ОПИСЫВАЕТ фотографию. Обязательно заполни media_query.",
        "video": "Тип заданий: студент смотрит короткое видео и реагирует. Обязательно заполни media_query.",
    }.get(qtype, "Тип заданий: устный ответ.")
    avoid = ""
    if avoid_titles:
        sample = "\n- ".join(avoid_titles[:40])
        avoid = f"\n\nНЕ повторяй эти уже существующие задания:\n- {sample}"
    extra = ""
    if custom and custom.strip():
        extra = (
            "\n\nДополнительные пожелания преподавателя (учитывай их при составлении "
            f"заданий, но не нарушай требования формата и уровня):\n{custom.strip()}"
        )
    # Topic is optional — when absent, let the model pick varied everyday themes.
    topic_line = f"Тема: {topic}\n" if (topic or "").strip() else "Тема: любые разнообразные бытовые темы\n"
    user_content = (
        f"Уровень CEFR: {level}\n{topic_line}{type_hint}\n\n"
        f"Сгенерируй ровно {count} разных заданий.{avoid}{extra}"
    )
    c, use_azure = _llm_conf()
    if use_azure:
        try:
            batch = _azure_structured(c, _GEN_SYSTEM, user_content, _GeneratedBatch, temperature=1.0)
            if isinstance(batch, _GeneratedBatch):
                return batch.questions
        except Exception as e:
            log.warning("Azure OpenAI question-gen failed; falling back to Gemini: %s", e)
    response = _gemini_generate(
        api_key=c["gemini_api_key"],
        model=c["gemini_model"],
        contents=user_content,
        system=_GEN_SYSTEM,
        schema=_GeneratedBatch,
        temperature=1.1,  # higher temperature → more variety across the library
    )
    parsed = _GeneratedBatch.model_validate_json(response.text or '{"questions": []}')
    return parsed.questions


def generate_questions(
    *,
    level: str,
    topic: str,
    qtype: str,
    count: int,
    avoid_titles: list[str] | None = None,
    custom: str | None = None,
) -> list[GeneratedQuestion]:
    """Generate `count` varied tasks, chunking large counts across calls.

    Each chunk is told the titles already produced so the model keeps varying
    instead of repeating itself. `custom` carries optional teacher guidance.
    """
    if count <= _GEN_CHUNK:
        return _generate_chunk(
            level=level, topic=topic, qtype=qtype, count=count, avoid_titles=avoid_titles, custom=custom
        )
    out: list[GeneratedQuestion] = []
    seen: list[str] = list(avoid_titles or [])
    remaining = count
    guard = 0
    while remaining > 0 and guard < 20:
        guard += 1
        n = min(_GEN_CHUNK, remaining)
        batch = _generate_chunk(
            level=level, topic=topic, qtype=qtype, count=n, avoid_titles=seen[-60:], custom=custom
        )
        if not batch:
            break
        out.extend(batch)
        seen.extend(q.title for q in batch)
        remaining -= len(batch)
    return out


# ─── Orthoepy: words read AS SPELLED (written ≠ spoken), from the audio ──────
class OrthoepyError(BaseModel):
    word: str = Field(description="Слово как НАПИСАНО, кириллицей (например: Молоко)")
    word_with_stress: str = Field(description="Слово с ударением (например: Молоко́)")
    correct: str = Field(description="Правильное произношение в [скобках] (например: [малако́])")
    said: str = Field(description="Как студент прочитал по буквам, в [скобках] (например: [молоко́])")
    rule_ru: str = Field(description="Короткое правило на русском")
    rule_uz: str = Field(description="Короткое правило на узбекском (O'zbekcha)")


class OrthoepyResult(BaseModel):
    errors: list[OrthoepyError]


_ORTHOEPY_SYSTEM = """Ты — преподаватель русского произношения. Тебе дают АУДИО, где \
студент читает русский текст вслух, и (возможно) сам текст. Найди слова, которые студент \
произнёс ТАК, КАК ОНИ ПИШУТСЯ, нарушив нормы устного русского (написание ≠ произношение):
- безударные «О»/«Е» → [а]/[и]: молоко→[малако́], сегодня→[сиво́дня];
- звонкие на конце оглушаются: друг→[друк], город→[го́рът]; и перед глухими: автобус→[афто́бус];
- «-ого»/«-его» → [-ова]/[-ева]: его→[йево́]; «что»→[што]; «-тся»/«-ться»→[ца];
- непроизносимые согласные: здравствуйте→[здра́ствуйте], солнце→[со́нце].
Для каждой ошибки заполни word, word_with_stress, correct (точная орфоэпическая запись всего \
слова в [скобках]), said (как прочитал по буквам). СТРОГО: пиши записи аккуратно и \
посимвольно, НЕ удваивай слоги; отмечай ТОЛЬКО реально услышанное «чтение по буквам»; \
если не уверен или всё верно — не включай слово (пустой список). rule_uz — на узбекском \
(O'zbekcha), rule_ru — на русском; все русские слова только кириллицей."""


def detect_orthoepy(
    *,
    audio_bytes: bytes,
    audio_mime: str = "audio/mp3",
    reference_text: str | None = None,
    transcript_text: str | None = None,
) -> list[OrthoepyError]:
    """Listen to a recording and flag words read AS SPELLED (orthoepy errors).
    Standalone audio pass (the main analysis is text-only). Best-effort: returns
    [] on any failure so it never breaks the pipeline."""
    if not audio_bytes:
        return []
    ref = (reference_text or transcript_text or "").strip()
    user_content = (
        (f"Текст, который читал студент:\n«{ref}»\n\n" if ref else "")
        + "Прослушай аудио и перечисли слова, прочитанные по написанию."
    )
    parts: list = [
        types.Part.from_bytes(data=audio_bytes, mime_type=audio_mime or "audio/mp3"),
        user_content,
    ]
    # Orthoepy needs the AUDIO, so it always runs on Gemini (the Azure chat
    # grader is text/image-only); provider selection doesn't apply here. Runs on
    # the best-effort circuit so a failure never opens the grader's breaker.
    c = _cfg.resolve_llm()
    response = _gemini_generate_besteffort(
        api_key=c["gemini_api_key"],
        model=c["gemini_model"],
        contents=parts,
        system=_ORTHOEPY_SYSTEM,
        schema=OrthoepyResult,
    )
    parsed = response.parsed
    return parsed.errors if isinstance(parsed, OrthoepyResult) else []
