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
    naturalness: float = Field(
        ge=0, le=100, description="Естественность выражений — звучит ли по-живому, а не заученно (0–100)"
    )
    speech_rate: float = Field(
        ge=0, le=100, description="Темп речи — естественность скорости и пауз по аудио (0–100)"
    )
    intonation: float = Field(
        ge=0, le=100, description="Интонация — мелодика, ударения, ритм по аудио (0–100)"
    )
    overall: float = Field(
        ge=0, le=100, description="Общий балл по абсолютной шкале (стандарт C2) (0–100)"
    )
    level_overall: float = Field(
        ge=0,
        le=100,
        description="Общий балл относительно уровня самого задания (A1..C2) (0–100)",
    )
    native_likeness: float = Field(
        ge=0,
        le=100,
        description=(
            "Близость к ЖИВОЙ РАЗГОВОРНОЙ (уличной/бытовой) речи носителя в процентах "
            "(0–100): насколько естественно человек звучит для обычного носителя в "
            "повседневном разговоре. НЕ книжность и НЕ литературность"
        ),
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
    pronunciation_feedback: str = Field(
        description=(
            "Профессиональный разбор ПРОИЗНОШЕНИЯ И ПОДАЧИ по аудиозаписи: интонация, "
            "ударения, темп, паузы, естественность и акцент. 2–4 предложения на "
            "УЗБЕКСКОМ (O'zbekcha); русские слова — кириллицей."
        )
    )


# ─── Rubric (system instruction) ───────────────────────────────────────────
RUBRIC_SYSTEM = """Ты — доброжелательный преподаватель РАЗГОВОРНОГО русского языка. \
Студент учит язык, чтобы свободно общаться в быту и на улице, в живом разговоре, \
а НЕ для книжной, литературной или официальной речи. Оценивай устную речь по \
100-балльной шкале (0–100) по нормам ЖИВОЙ РАЗГОВОРНОЙ речи.

Тебе дают задание (тема, название, уровень CEFR), транскрипцию устного ответа студента \
и, как правило, САМО АУДИО ответа. Оцени ответ по четырём критериям (0–100) по \
АБСОЛЮТНОЙ шкале — относительно того, как говорит обычный носитель в живом бытовом \
разговоре. Для начинающего нормально, что абсолютные баллы невысокие.

АУДИО — СЛУШАЙ ЕГО (это ключевой источник, а не только текст):
- Если приложено аудио, ОБЯЗАТЕЛЬНО прослушай его и оценивай произношение, интонацию, \
ударения, темп, паузы, ритм, естественность и акцент по РЕАЛЬНОМУ ЗВУКУ, а не по тексту. \
Транскрипция — лишь вспомогательная опора; источник истины — само аудио.
- Беглость (fluency) оценивай по тому, как человек реально звучит: гладко ли, есть ли \
долгие паузы, заминки, повторы, мычание; естественный ли темп и интонация живой речи.
- Заполни поле pronunciation_feedback: профессиональный, но доброжелательный разбор \
ПОДАЧИ по аудио — что со звуками, ударениями, интонацией и темпом хорошо, а что стоит \
подтянуть; дай 1–2 конкретных совета. Пиши на узбекском (O'zbekcha), русские примеры — \
кириллицей. Если аудио нет, дай общий совет по произношению по транскрипции.

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

ЕЩЁ ТРИ КРИТЕРИЯ — ОЦЕНИВАЙ ИХ ПО АУДИО (если аудио нет — по транскрипции, осторожно):
5. Естественность выражений (naturalness) — звучат ли фразы как живая речь носителя, \
а не как заученный или дословно переведённый с родного языка текст. Естественные \
разговорные обороты — это плюс; кальки и неуклюжие книжные конструкции — минус.
6. Темп речи (speech_rate) — естественна ли скорость по аудио: не слишком ли медленно \
с долгими паузами и заминками и не слишком ли тороплива и неразборчива речь. \
Оценивай естественность темпа живого разговора, а не «быстрее = лучше».
7. Интонация (intonation) — мелодика, ударения и ритм по аудио: звучит ли речь живо и \
естественно, правильно ли расставлены смысловые и фразовые ударения, нет ли «роботизной» \
или монотонной подачи.

ДВА ОБЩИХ БАЛЛА (это ключевое требование):
- overall — среднее ЧЕТЫРЁХ ОСНОВНЫХ критериев (fluency, lexical, grammar, relevance) по \
абсолютной РАЗГОВОРНОЙ шкале (0–100). Показывает реальное место студента относительно \
обычного носителя. Критерии 5–7 (естественность, темп, интонация) — диагностические, \
в overall их НЕ усредняй.
- level_overall — оцени ТОТ ЖЕ ответ относительно ОЖИДАНИЙ для уровня самого задания \
(поле «Уровень»). Если задание уровня A1 и студент хорошо справляется с требованиями \
A1 — ставь высокий level_overall (80–100), даже если overall невысокий. Это балл «для \
своего уровня», чтобы не демотивировать студента. Если уровень не указан — \
level_overall равен overall.

ПРОЦЕНТ БЛИЗОСТИ К РЕЧИ НОСИТЕЛЯ (native_likeness, 0–100 %):
- Оцени, насколько речь студента похожа на ЖИВУЮ РАЗГОВОРНУЮ (уличную, бытовую) речь \
обычного носителя — НЕ на книжную, литературную или официальную. Это процент «звучит как \
свой человек в обычном разговоре», а не «образованный диктор».
- Опирайся на РЕАЛЬНЫЙ ЗВУК (аудио): естественность произношения, интонацию, ударения, \
темп, паузы, редукцию гласных, отсутствие сильного иностранного акцента, живость подачи, \
а также естественность лексики и оборотов.
- Ориентир по шкале: 0–20 совсем начинающий; 21–40 базовый; 41–60 уверенный; \
61–80 продвинутый; 81–90 почти как носитель; 91–100 звучит как носитель в живом разговоре. \
Для начинающего низкий процент — это нормально, не завышай из вежливости; это \
ОТДЕЛЬНЫЙ от level_overall, объективный показатель.

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
    audio_bytes: bytes | None = None,
    audio_mime: str = "audio/mp3",
) -> EvaluationResult:
    """Analyze a Russian spoken answer and return structured band scores + feedback.

    Pass `audio_bytes` (Gemini is multimodal) so it LISTENS to the real recording
    and judges pronunciation, intonation, pace and naturalness from the actual sound
    — not just the transcript. For picture-description tasks, pass `image_bytes`
    (+ `image_mime`): Gemini sees the picture and judges the description (relevance)."""
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
    audio_note = (
        "Приложено АУДИО ответа студента — прослушай его и оценивай произношение, "
        "интонацию, темп и естественность по реальному звуку; заполни "
        "pronunciation_feedback по аудио.\n\n"
        if audio_bytes
        else ""
    )

    user_content = (
        f"{context_block}{image_note}{audio_note}"
        f"Задание (на которое отвечал студент):\n{question_prompt}\n\n"
        f"Транскрипция устного ответа студента:\n«{transcript_text}»\n\n"
        f"Оцени этот ответ согласно критериям."
    )

    # Multimodal contents: attach the picture and/or the actual audio recording.
    parts: list = []
    if image_bytes:
        parts.append(types.Part.from_bytes(data=image_bytes, mime_type=image_mime or "image/jpeg"))
    if audio_bytes:
        parts.append(types.Part.from_bytes(data=audio_bytes, mime_type=audio_mime or "audio/mp3"))
    parts.append(user_content)
    contents: object = parts if len(parts) > 1 else user_content

    config = types.GenerateContentConfig(
        system_instruction=RUBRIC_SYSTEM,
        response_mime_type="application/json",
        response_schema=EvaluationResult,
        # "Thinking" stays off for latency; the audio itself is the quality lever and
        # the rubric is structured. Audio reasoning works fine without it.
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


@gemini_breaker
def _generate_chunk(
    *,
    level: str,
    topic: str,
    qtype: str,
    count: int,
    avoid_titles: list[str] | None = None,
) -> list[GeneratedQuestion]:
    """Generate up to ~`count` varied speaking tasks in a single model call."""
    type_hint = {
        "text": "Тип заданий: устный ответ БЕЗ медиа. media_query оставь пустым.",
        "image": "Тип заданий: студент ОПИСЫВАЕТ фотографию. Обязательно заполни media_query.",
        "video": "Тип заданий: студент смотрит короткое видео и реагирует. Обязательно заполни media_query.",
    }.get(qtype, "Тип заданий: устный ответ.")
    avoid = ""
    if avoid_titles:
        sample = "\n- ".join(avoid_titles[:40])
        avoid = f"\n\nНЕ повторяй эти уже существующие задания:\n- {sample}"
    user_content = (
        f"Уровень CEFR: {level}\nТема: {topic}\n{type_hint}\n\n"
        f"Сгенерируй ровно {count} разных заданий.{avoid}"
    )
    config = types.GenerateContentConfig(
        system_instruction=_GEN_SYSTEM,
        response_mime_type="application/json",
        response_schema=_GeneratedBatch,
        temperature=1.1,  # higher temperature → more variety across the library
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
    parsed = _GeneratedBatch.model_validate_json(response.text or '{"questions": []}')
    return parsed.questions


def generate_questions(
    *,
    level: str,
    topic: str,
    qtype: str,
    count: int,
    avoid_titles: list[str] | None = None,
) -> list[GeneratedQuestion]:
    """Generate `count` varied tasks, chunking large counts across calls.

    Each chunk is told the titles already produced so the model keeps varying
    instead of repeating itself.
    """
    if count <= _GEN_CHUNK:
        return _generate_chunk(
            level=level, topic=topic, qtype=qtype, count=count, avoid_titles=avoid_titles
        )
    out: list[GeneratedQuestion] = []
    seen: list[str] = list(avoid_titles or [])
    remaining = count
    guard = 0
    while remaining > 0 and guard < 20:
        guard += 1
        n = min(_GEN_CHUNK, remaining)
        batch = _generate_chunk(
            level=level, topic=topic, qtype=qtype, count=n, avoid_titles=seen[-60:]
        )
        if not batch:
            break
        out.extend(batch)
        seen.extend(q.title for q in batch)
        remaining -= len(batch)
    return out
