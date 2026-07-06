"""Public (no-auth) guest demo: try one Russian phrase, get instant AI feedback.

The funnel's "value first": a first-time visitor records the demo phrase, we run
the SAME Azure pronunciation assessment used in the app (reused from stt.py),
return per-criterion scores + the weakest words + a rough CEFR level — all without
an account. Rate-limited by IP; nothing is stored.
"""

import re

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status

from app.core.ratelimit import rate_limit
from app.services import stt, tts

router = APIRouter(prefix="/guest", tags=["guest"])

# The one fixed demo phrase (scripted repeat-after-me).
DEMO_PHRASE = "Привет! Меня зовут Антон. Я хочу учить русский язык."
_ALLOWED_WORDS = set(re.findall(r"\w+", DEMO_PHRASE.lower(), flags=re.UNICODE))
_MAX_AUDIO_BYTES = 10 * 1024 * 1024


def _round(v):
    return round(v) if v is not None else None


def _blend(*vals):
    xs = [v for v in vals if v is not None]
    return round(sum(xs) / len(xs)) if xs else None


def _level(overall: int | None) -> str:
    """Rough CEFR estimate from the overall pronunciation score."""
    if overall is None:
        return "A1"
    if overall < 45:
        return "A0"
    if overall < 60:
        return "A1"
    if overall < 72:
        return "A1+"
    if overall < 85:
        return "A2"
    return "B1"


@router.get("/demo")
def demo() -> dict:
    return {"phrase": DEMO_PHRASE}


@router.post("/assess", dependencies=[Depends(rate_limit("guest_assess", 15, 3600))])
async def assess(request: Request) -> dict:
    """Assess a guest's spoken attempt at the demo phrase (raw audio body)."""
    audio = await request.body()
    if not audio:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No audio")
    if len(audio) > _MAX_AUDIO_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Audio too large")

    try:
        r = stt.transcribe(audio, filename="demo.webm", reference_text=DEMO_PHRASE)
    except Exception:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Speech analysis failed, try again")

    pa = r.get("pronunciation") or {}
    match = pa.get("reference_match") or {}
    completeness = pa.get("completeness")
    # For a scripted repeat, "grammar" = how completely/correctly the target was
    # reproduced (a fixed correct phrase — the learner isn't composing grammar).
    grammar = completeness if completeness is not None else (
        round(match["similarity"] * 100) if match.get("similarity") is not None else None
    )
    criteria = {
        "pronunciation": _round(pa.get("accuracy")),                 # talaffuz
        "stress": _round(pa.get("prosody")),                          # urg'u
        "intonation": _blend(pa.get("prosody"), pa.get("fluency")),   # intonatsiya
        "fluency": _round(pa.get("fluency")),                         # ravonlik
        "grammar": _round(grammar),                                   # grammatika
    }
    overall = _round(pa.get("pronunciation")) or _blend(*criteria.values())

    # Weakest 3 spoken words (lowest per-word accuracy) as concrete errors.
    words = [w for w in (r.get("words") or []) if w.get("word") and w.get("accuracy") is not None]
    weak = sorted((w for w in words if w["accuracy"] < 80), key=lambda w: w["accuracy"])[:3]
    errors = [
        {"word": w["word"], "accuracy": round(w["accuracy"]), "error_type": w.get("error_type")}
        for w in weak
    ]

    return {
        "transcript": r.get("text"),
        "phrase": DEMO_PHRASE,
        "overall": overall,
        "criteria": criteria,
        "errors": errors,
        "level": _level(overall),
        "on_topic": match.get("on_topic", True),
        "scored": pa != {},  # False on the Whisper fallback (no pronunciation data)
    }


@router.get("/tts", dependencies=[Depends(rate_limit("guest_tts", 60, 3600))])
def guest_tts(text: str = Query(..., min_length=1, max_length=300)) -> Response:
    """Synthesize the correct pronunciation — restricted to the demo phrase's own
    words so the public endpoint can't be used for arbitrary TTS."""
    req_words = re.findall(r"\w+", text.lower(), flags=re.UNICODE)
    if not req_words or any(w not in _ALLOWED_WORDS for w in req_words):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Only the demo phrase can be synthesized")
    try:
        audio = tts.synthesize(text)
    except Exception:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "TTS unavailable")
    return Response(
        content=audio,
        media_type="audio/mpeg",
        headers={"Cache-Control": "public, max-age=86400"},
    )
