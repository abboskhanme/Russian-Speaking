"""Russian speech analysis via Google Gemini with structured (JSON) output.

Given a transcript of a student's spoken answer, returns 0–100 scores on two
scales — absolute (vs a typical native speaker in everyday COLLOQUIAL/spoken
Russian, not literary/written norms) and relative to the task's own CEFR level —
plus targeted corrections and Uzbek feedback. Punctuation is ignored (the input
is a raw speech transcript).

Uses the Gemini free tier — see https://aistudio.google.com/apikey for an API key.
"""

import time

from google import genai
from google.genai import errors as genai_errors
from google.genai import types
from pydantic import BaseModel, Field

from app.core.breaker import gemini_breaker
from app.core.config import settings

_client = genai.Client(api_key=settings.GEMINI_API_KEY)

# Gemini sometimes returns transient 503 (overloaded) / 429 (rate) errors.
# Retry with backoff — this runs in a background Celery worker, so the wait is invisible to users.
_RETRYABLE_CODES = {429, 500, 503}
_MAX_ATTEMPTS = 4


# ─── Structured output schema ──────────────────────────────────────────────
class Scores(BaseModel):
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


# ─── Rubric (system instruction) ───────────────────────────────────────────
RUBRIC_SYSTEM = """Ты — доброжелательный преподаватель РАЗГОВОРНОГО русского языка. \
Студент учит язык, чтобы свободно общаться в быту и на улице, в живом разговоре, \
а НЕ для книжной, литературной или официальной речи. Оценивай устную речь по \
100-балльной шкале (0–100) по нормам ЖИВОЙ РАЗГОВОРНОЙ речи.

Тебе дают задание (тема, название, уровень CEFR) и транскрипцию устного ответа студента. \
Оцени ответ по четырём критериям (0–100) по АБСОЛЮТНОЙ шкале — относительно того, как \
говорит обычный носитель в живом бытовом разговоре. Для начинающего нормально, что \
абсолютные баллы невысокие.

ВАЖНО — ЭТО УСТНАЯ РЕЧЬ, А НЕ ТЕКСТ:
- Транскрипция получена из аудио и НЕ содержит знаков препинания и заглавных букв. \
НИКОГДА не считай отсутствие или неверность точек, запятых, заглавных букв ошибкой, \
не упоминай пунктуацию и не добавляй её в corrections.
- НЕ снижай балл за разговорные слова, сленг, сокращения, неполные предложения, \
свободный порядок слов, повторы и слова-паразиты («ну», «вот», «короче», «это самое») — \
в живой речи это нормально и естественно.
- Оценивай ГЛАВНОЕ: понятно ли и естественно ли человек доносит мысль в разговоре, \
а не книжную сложность и не «правильность» письменной нормы.

Критерии:
1. Беглость и связность (fluency) — темп, естественность, связь идей в разговоре.
2. Лексический запас (lexical) — уместные повседневные/разговорные слова и точность; \
ценится богатый БЫТОВОЙ словарь, а НЕ книжная изысканность.
3. Грамматика (grammar) — оценивай МЯГКО, по разговорной норме. Отмечай ТОЛЬКО реальные \
ошибки, которые мешают пониманию или звучат неправильно даже в разговорной речи \
(падежи, согласование, форма глагола). НЕ «исправляй» естественную разговорную форму на \
книжную.
4. Соответствие теме (relevance) — отвечает ли студент на вопрос и раскрывает ли тему.

ДВА ОБЩИХ БАЛЛА (это ключевое требование):
- overall — среднее четырёх критериев по абсолютной РАЗГОВОРНОЙ шкале (0–100). \
Показывает реальное место студента относительно обычного носителя.
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


@gemini_breaker
def analyze(
    *,
    question_prompt: str,
    transcript_text: str,
    question_title: str | None = None,
    level: str | None = None,
    topic: str | None = None,
    image_bytes: bytes | None = None,
    image_mime: str | None = None,
) -> EvaluationResult:
    """Analyze a Russian transcript and return structured band scores + feedback.

    For picture-description tasks, pass `image_bytes` (+ `image_mime`): Gemini is
    multimodal, so it sees the picture and judges whether the student described it
    correctly (relevance)."""
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

    user_content = (
        f"{context_block}{image_note}"
        f"Задание (на которое отвечал студент):\n{question_prompt}\n\n"
        f"Транскрипция устного ответа студента:\n«{transcript_text}»\n\n"
        f"Оцени этот ответ согласно критериям."
    )

    # Multimodal contents when a picture is attached.
    contents: object = user_content
    if image_bytes:
        contents = [
            types.Part.from_bytes(data=image_bytes, mime_type=image_mime or "image/jpeg"),
            user_content,
        ]

    config = types.GenerateContentConfig(
        system_instruction=RUBRIC_SYSTEM,
        response_mime_type="application/json",
        response_schema=EvaluationResult,
        # Disable "thinking" — for this structured rubric task it adds several
        # seconds of latency with no quality gain.
        thinking_config=types.ThinkingConfig(thinking_budget=0),
    )

    for attempt in range(_MAX_ATTEMPTS):
        try:
            response = _client.models.generate_content(
                model=settings.GEMINI_MODEL,
                contents=contents,
                config=config,
            )
            break
        except genai_errors.APIError as e:
            if getattr(e, "code", None) in _RETRYABLE_CODES and attempt < _MAX_ATTEMPTS - 1:
                time.sleep(2 * (attempt + 1))  # 2s, 4s, 6s
                continue
            raise

    result = response.parsed
    if not isinstance(result, EvaluationResult):
        raise ValueError("LLM did not return a parseable evaluation")
    return result


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


@gemini_breaker
def explain_answer(*, question_prompt: str, transcript_text: str) -> ExplainResult:
    """Deeper coaching follow-up for one student answer."""
    user_content = (
        f"Задание:\n{question_prompt}\n\n"
        f"Ответ студента (транскрипция):\n«{transcript_text}»\n\n"
        f"Объясни, как улучшить ответ, и перепиши самое слабое предложение."
    )
    config = types.GenerateContentConfig(
        system_instruction=_EXPLAIN_SYSTEM,
        response_mime_type="application/json",
        response_schema=ExplainResult,
        thinking_config=types.ThinkingConfig(thinking_budget=0),
    )
    for attempt in range(_MAX_ATTEMPTS):
        try:
            response = _client.models.generate_content(
                model=settings.GEMINI_MODEL, contents=user_content, config=config
            )
            break
        except genai_errors.APIError as e:
            if getattr(e, "code", None) in _RETRYABLE_CODES and attempt < _MAX_ATTEMPTS - 1:
                time.sleep(2 * (attempt + 1))
                continue
            raise
    result = response.parsed
    if not isinstance(result, ExplainResult):
        raise ValueError("LLM did not return a parseable explanation")
    return result


# ─── Model (exemplar) answer ───────────────────────────────────────────────
_MODEL_ANSWER_SYSTEM = """Ты — носитель русского языка и преподаватель РАЗГОВОРНОЙ речи. \
Напиши образцовый УСТНЫЙ, РАЗГОВОРНЫЙ ответ на задание — так, как сказал бы обычный \
человек в живом бытовом разговоре (на улице, в быту), уровня, указанного в задании \
(или B1, если уровень не указан). Это должна быть живая разговорная речь, а НЕ книжный, \
литературный или официальный текст: естественные обороты, простые предложения, \
повседневная лексика. 4–7 предложений на русском языке, ТОЛЬКО русскими буквами \
(кириллицей); НИКОГДА не транслитерируй латиницей. Верни только текст ответа, \
без пояснений."""


@gemini_breaker
def generate_model_answer(
    *,
    question_prompt: str,
    question_title: str | None = None,
    level: str | None = None,
    topic: str | None = None,
) -> str:
    """Generate a band-9 exemplar spoken answer (plain Russian text)."""
    ctx = []
    if question_title:
        ctx.append(f"Название: {question_title}")
    if topic:
        ctx.append(f"Тема: {topic}")
    if level:
        ctx.append(f"Уровень: {level}")
    block = ("\n".join(ctx) + "\n\n") if ctx else ""
    user_content = f"{block}Задание:\n{question_prompt}\n\nНапиши образцовый ответ."
    config = types.GenerateContentConfig(
        system_instruction=_MODEL_ANSWER_SYSTEM,
        thinking_config=types.ThinkingConfig(thinking_budget=0),
    )
    for attempt in range(_MAX_ATTEMPTS):
        try:
            response = _client.models.generate_content(
                model=settings.GEMINI_MODEL, contents=user_content, config=config
            )
            break
        except genai_errors.APIError as e:
            if getattr(e, "code", None) in _RETRYABLE_CODES and attempt < _MAX_ATTEMPTS - 1:
                time.sleep(2 * (attempt + 1))
                continue
            raise
    return (response.text or "").strip()
