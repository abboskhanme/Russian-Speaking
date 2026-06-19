"""Speech-to-text for Russian, with two interchangeable backends.

`transcribe()` picks a provider (see STT_PROVIDER / _provider):

* **Azure AI Speech** (preferred) — acoustically faithful transcript that does NOT
  auto-correct the learner, PLUS pronunciation assessment (accuracy, fluency,
  prosody at utterance + word + phoneme level). Recognition is always UNSCRIPTED so
  a target sentence never biases what is "heard"; for shadowing, the real transcript
  is compared to the target in our own code (see `_reference_match`). Phoneme
  granularity is on so we can show the learner WHICH sounds (letters) were
  mispronounced inside each word, not just a per-word score.
* **OpenAI Whisper** (fallback when no Azure key) — transcribes only; no
  pronunciation assessment, and it tends to silently correct learner errors. Used
  so the app keeps working before an Azure key is provisioned.

Runs in a Celery worker on bytes already downloaded from object storage.
"""

import difflib
import json
import os
import re
import subprocess
import tempfile
import threading

import azure.cognitiveservices.speech as speechsdk

from app.core.breaker import azure_speech_breaker
from app.core.config import settings

# Azure reports offsets/durations in 100-nanosecond ticks.
_TICKS_PER_SEC = 10_000_000
# Hard ceiling on how long we wait for recognition of a single answer.
_TIMEOUT_SEC = 180
# Reject absurdly large uploads before transcoding (2-min answers are ~2 MB).
_MAX_AUDIO_BYTES = 25 * 1024 * 1024


def _to_wav(audio_bytes: bytes) -> str:
    """Transcode arbitrary browser audio (webm/opus, m4a, …) to 16 kHz mono PCM WAV.

    Azure's file recognizer expects PCM WAV; ffmpeg (already in the image) handles
    whatever the browser's MediaRecorder produced. Returns a temp file path that
    the caller must delete.
    """
    src = tempfile.NamedTemporaryFile(suffix=".bin", delete=False)
    try:
        src.write(audio_bytes)
        src.flush()
    finally:
        src.close()

    dst_path = src.name + ".wav"
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-i", src.name, "-ar", "16000", "-ac", "1", dst_path],
            check=True,
            capture_output=True,
            timeout=60,
        )
    finally:
        os.unlink(src.name)
    return dst_path


def _parse_segment(json_result: str) -> dict | None:
    """Pull text, per-word timing and pronunciation scores out of one recognized
    segment's detailed JSON."""
    try:
        data = json.loads(json_result)
    except (ValueError, TypeError):
        return None

    nbest = data.get("NBest") or []
    if not nbest:
        return None
    best = nbest[0]
    pa = best.get("PronunciationAssessment") or {}

    words = []
    for w in best.get("Words") or []:
        offset = w.get("Offset")
        duration = w.get("Duration")
        w_pa = w.get("PronunciationAssessment") or {}
        # Per-phoneme (letter-sound) accuracy — present because we run at Phoneme
        # granularity. Lets the UI highlight exactly which sounds were off inside a
        # word, e.g. a soft "ь" or a stressed vowel the learner missed.
        phonemes = [
            {
                "phoneme": p.get("Phoneme"),
                "accuracy": (p.get("PronunciationAssessment") or {}).get("AccuracyScore"),
            }
            for p in (w.get("Phonemes") or [])
            if p.get("Phoneme")
        ]
        words.append(
            {
                "word": w.get("Word"),
                "start": offset / _TICKS_PER_SEC if offset is not None else None,
                "end": (offset + duration) / _TICKS_PER_SEC
                if offset is not None and duration is not None
                else None,
                "accuracy": w_pa.get("AccuracyScore"),
                "error_type": w_pa.get("ErrorType"),
                "phonemes": phonemes or None,
            }
        )

    return {
        # Lexical = raw recognized words, verbatim. We deliberately avoid "Display"
        # (capitalised + punctuated + inverse-text-normalised) so the transcript
        # shows what the learner ACTUALLY said, mistakes included — not a tidied-up
        # version.
        "text": best.get("Lexical") or best.get("Display") or data.get("DisplayText") or "",
        "words": words,
        "scores": {
            "accuracy": pa.get("AccuracyScore"),
            "fluency": pa.get("FluencyScore"),
            "completeness": pa.get("CompletenessScore"),
            "prosody": pa.get("ProsodyScore"),
            "pronunciation": pa.get("PronScore"),
        },
        "n_words": len(words),
    }


def _aggregate_scores(segments: list[dict]) -> dict:
    """Combine per-segment scores into one set, weighting each segment by its word
    count (a 10-word sentence should count more than a 2-word one)."""

    def weighted(key: str) -> float | None:
        pairs = [
            (s["scores"][key], s["n_words"])
            for s in segments
            if s["scores"].get(key) is not None and s["n_words"] > 0
        ]
        if not pairs:
            return None
        total_w = sum(n for _, n in pairs)
        return round(sum(v * n for v, n in pairs) / total_w, 1) if total_w else None

    return {
        "accuracy": weighted("accuracy"),
        "fluency": weighted("fluency"),
        "completeness": weighted("completeness"),
        "prosody": weighted("prosody"),
        "pronunciation": weighted("pronunciation"),
    }


def _normalize_words(text: str | None) -> list[str]:
    """Lowercase, drop punctuation, split into bare words for content comparison."""
    cleaned = re.sub(r"[^\w\s]", " ", (text or "").lower(), flags=re.UNICODE)
    return [w for w in cleaned.split() if w]


def _reference_match(spoken_text: str, reference_text: str) -> dict | None:
    """Compare what the learner actually said against the target sentence.

    We run Azure UNSCRIPTED (no reference bias), so the transcript is faithful.
    Here we measure, in our own code, how much of the target was really spoken:

    * ``completeness`` – % of reference words that appear, in order (0–100).
    * ``similarity``  – overall word-sequence similarity ratio (0–1).
    * ``on_topic``    – False when the answer barely matches the target (e.g. the
      learner said something completely different), so the caller can refuse to
      treat an off-topic answer as a correct repetition.

    Returns None when there is no reference to compare against.
    """
    ref = _normalize_words(reference_text)
    if not ref:
        return None
    spoken = _normalize_words(spoken_text)
    matcher = difflib.SequenceMatcher(None, ref, spoken, autojunk=False)
    matched = sum(block.size for block in matcher.get_matching_blocks())
    completeness = round(matched / len(ref) * 100, 1)
    similarity = round(matcher.ratio(), 3)
    return {
        "completeness": completeness,
        "similarity": similarity,
        "matched_words": matched,
        "reference_words": len(ref),
        "spoken_words": len(spoken),
        # Heuristic gate: needs at least half the target words present.
        "on_topic": completeness >= 50.0,
    }


@azure_speech_breaker
def _transcribe_azure(
    audio_bytes: bytes,
    filename: str = "answer.webm",
    reference_text: str | None = None,
) -> dict:
    """Azure path: faithful transcript + pronunciation assessment.

    Always runs UNSCRIPTED (no reference text handed to Azure). Supplying a
    reference biases the recognizer toward "hearing" that sentence, which makes
    off-topic answers score as correct and tidies the transcript toward the
    target. We instead recognise freely and, for shadowing, compare the real
    transcript to the target ourselves (see ``_reference_match``).
    """
    if len(audio_bytes) > _MAX_AUDIO_BYTES:
        raise ValueError("Audio file too large")
    wav_path = _to_wav(audio_bytes)
    try:
        speech_config = speechsdk.SpeechConfig(
            subscription=settings.AZURE_SPEECH_KEY,
            region=settings.AZURE_SPEECH_REGION,
        )
        speech_config.speech_recognition_language = settings.STT_LANGUAGE
        speech_config.output_format = speechsdk.OutputFormat.Detailed
        speech_config.request_word_level_timestamps()

        audio_config = speechsdk.audio.AudioConfig(filename=wav_path)
        recognizer = speechsdk.SpeechRecognizer(
            speech_config=speech_config, audio_config=audio_config
        )

        # Unscripted assessment (empty reference, miscue OFF) so the recognizer is
        # never biased toward a target sentence. Phoneme granularity gives us a
        # per-sound (letter) breakdown inside every word — word-level accuracy alone
        # was too coarse to tell the learner what to fix. Prosody is on too, so the
        # whole assessment Azure offers is used.
        pa_config = speechsdk.PronunciationAssessmentConfig(
            reference_text="",
            grading_system=speechsdk.PronunciationAssessmentGradingSystem.HundredMark,
            granularity=speechsdk.PronunciationAssessmentGranularity.Phoneme,
            enable_miscue=False,
        )
        pa_config.enable_prosody_assessment()
        pa_config.apply_to(recognizer)

        segments: list[dict] = []
        done = threading.Event()
        cancel: dict[str, str | None] = {}

        def on_recognized(evt: speechsdk.SpeechRecognitionEventArgs) -> None:
            if evt.result.reason != speechsdk.ResultReason.RecognizedSpeech:
                return
            raw = evt.result.properties.get(
                speechsdk.PropertyId.SpeechServiceResponse_JsonResult
            )
            seg = _parse_segment(raw) if raw else None
            if seg and seg["text"]:
                segments.append(seg)

        def on_canceled(evt: speechsdk.SpeechRecognitionCanceledEventArgs) -> None:
            if evt.reason == speechsdk.CancellationReason.Error:
                cancel["error"] = evt.error_details
            done.set()

        def on_stopped(_evt) -> None:
            done.set()

        recognizer.recognized.connect(on_recognized)
        recognizer.canceled.connect(on_canceled)
        recognizer.session_stopped.connect(on_stopped)

        recognizer.start_continuous_recognition()
        finished = done.wait(timeout=_TIMEOUT_SEC)
        recognizer.stop_continuous_recognition()

        if not finished:
            raise RuntimeError("Azure STT timed out")
        # Surface a hard error only if we got nothing usable back.
        if cancel.get("error") and not segments:
            raise RuntimeError(f"Azure STT failed: {cancel['error']}")

        words = [w for seg in segments for w in seg["words"]]
        text = " ".join(seg["text"] for seg in segments if seg["text"]).strip()
        duration = max((w["end"] for w in words if w["end"] is not None), default=None)

        pronunciation = _aggregate_scores(segments) if segments else None
        # Shadowing / read-aloud: measure how well the real transcript matches the
        # target ourselves, and fold "completeness" in (Azure can't report it in
        # unscripted mode) so an off-topic answer can't pass as a repetition.
        ref = (reference_text or "").strip()
        if ref:
            match = _reference_match(text, ref)
            if match is not None and pronunciation is not None:
                pronunciation["completeness"] = match["completeness"]
                pronunciation["reference_match"] = match

        return {
            "text": text,
            "language": settings.STT_LANGUAGE,
            "words": words,
            "duration": duration,
            "pronunciation": pronunciation,
            "model": settings.STT_MODEL,
        }
    finally:
        if os.path.exists(wav_path):
            os.unlink(wav_path)


# ─── Whisper fallback (OpenAI) ──────────────────────────────────────────────
# Used when no Azure key is configured. Whisper transcribes but does NOT assess
# pronunciation (and tends to auto-correct learner errors), so `pronunciation`
# comes back None and per-word accuracy is absent — the UI degrades gracefully.
def _transcribe_whisper(
    audio_bytes: bytes,
    filename: str = "answer.webm",
    reference_text: str | None = None,  # ignored — Whisper has no scripted mode
) -> dict:
    if len(audio_bytes) > _MAX_AUDIO_BYTES:
        raise ValueError("Audio file too large")
    import io

    from openai import OpenAI

    client = OpenAI(api_key=settings.OPENAI_API_KEY)
    buf = io.BytesIO(audio_bytes)
    buf.name = filename  # the SDK infers format from the filename

    resp = client.audio.transcriptions.create(
        model=settings.WHISPER_MODEL,
        file=buf,
        language=settings.STT_LANGUAGE.split("-")[0],  # "ru-RU" -> "ru"
        response_format="verbose_json",
        timestamp_granularities=["word"],
    )
    words = [
        {
            "word": getattr(w, "word", None),
            "start": getattr(w, "start", None),
            "end": getattr(w, "end", None),
            "accuracy": None,
            "error_type": None,
            "phonemes": None,
        }
        for w in (getattr(resp, "words", None) or [])
    ]
    return {
        "text": resp.text,
        "language": getattr(resp, "language", settings.STT_LANGUAGE),
        "words": words,
        "duration": getattr(resp, "duration", None),
        "pronunciation": None,  # Whisper cannot assess pronunciation
        "model": settings.WHISPER_MODEL,
    }


# ─── Provider dispatch ──────────────────────────────────────────────────────
def _provider() -> str:
    """Pick the STT backend. STT_PROVIDER=azure|whisper forces one; 'auto'
    (default) uses Azure when its key is set, else Whisper."""
    forced = settings.STT_PROVIDER.lower()
    if forced in ("azure", "whisper"):
        return forced
    if settings.AZURE_SPEECH_KEY:
        return "azure"
    if settings.OPENAI_API_KEY:
        return "whisper"
    raise RuntimeError(
        "No STT provider configured — set AZURE_SPEECH_KEY (preferred) or OPENAI_API_KEY"
    )


def transcribe(
    audio_bytes: bytes,
    filename: str = "answer.webm",
    reference_text: str | None = None,
) -> dict:
    """Transcribe Russian audio. Returns {text, language, words, duration,
    pronunciation, model}. `pronunciation` is None on the Whisper fallback.

    Pass `reference_text` for scripted (shadowing) scoring — honoured by Azure,
    ignored by Whisper.
    """
    if _provider() == "azure":
        return _transcribe_azure(audio_bytes, filename, reference_text)
    return _transcribe_whisper(audio_bytes, filename, reference_text)
