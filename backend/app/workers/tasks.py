"""Background processing pipeline: STT + pronunciation (Azure) → analysis (Gemini)."""

import logging
import time
import uuid

from sqlalchemy import select
from datetime import datetime, timedelta, timezone

from app.core.config import settings
from app.db.session import SessionLocal
from app.models import (
    Assignment,
    Evaluation,
    Question,
    QuestionType,
    Submission,
    SubmissionStatus,
    Transcript,
)
from app.services import gamification, llm, notifications, stt, storage
from app.workers.celery_app import celery

logger = logging.getLogger("worker.process")

_IMAGE_MIME = {
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "png": "image/png",
    "webp": "image/webp",
    "gif": "image/gif",
}


def _image_mime(key: str) -> str:
    ext = key.rsplit(".", 1)[-1].lower() if "." in key else ""
    return _IMAGE_MIME.get(ext, "image/jpeg")


def _notify_after_done(db, sub: Submission, evaluation: Evaluation) -> None:
    """Tell the student their result is ready, and — if this answered an
    assignment — tell the teacher who assigned it that it's completed."""
    band = evaluation.overall_band
    notifications.notify(
        db,
        user_id=sub.student_id,
        type="result_ready",
        title="Natija tayyor",
        body=f"Javobingiz baholandi. Umumiy ball: {band:.0f}/100" if band is not None else "Javobingiz baholandi.",
        link=f"/submissions/{sub.id}",
        commit=False,
    )
    # Was this answer fulfilling a teacher's assignment? If so, notify the teacher.
    assignment = db.scalar(
        select(Assignment).where(
            Assignment.student_id == sub.student_id,
            Assignment.question_id == sub.question_id,
        )
    )
    if assignment is not None:
        q = db.get(Question, sub.question_id)
        sname = sub.student.full_name if sub.student else "O'quvchi"
        qtitle = q.title if q else "topshiriq"
        notifications.notify(
            db,
            user_id=assignment.teacher_id,
            type="assignment_done",
            title="Topshiriq bajarildi",
            body=f"{sname} «{qtitle}» topshirig'ini bajardi.",
            link=f"/submissions/{sub.id}",
            commit=False,
        )
    db.commit()


@celery.task(
    name="process_submission",
    bind=True,
    max_retries=3,
    retry_backoff=30,  # 30s, 60s, 120s
    retry_backoff_max=300,
    retry_jitter=True,
)
def process_submission(self, submission_id: str) -> str:
    db = SessionLocal()
    try:
        sub = db.get(Submission, uuid.UUID(submission_id))
        if sub is None:
            return "not_found"

        sub.status = SubmissionStatus.processing
        db.commit()

        # 1. Download audio from object storage
        audio = storage.download_bytes(sub.audio_key)
        filename = sub.audio_key.rsplit("/", 1)[-1]

        # 2. Speech-to-text + pronunciation assessment (Russian, Azure).
        # Shadowing passes the target sentence for scripted (reference) scoring.
        _t_stt = time.monotonic()
        stt_result = stt.transcribe(
            audio, filename=filename, reference_text=sub.reference_text
        )
        stt_secs = time.monotonic() - _t_stt
        logger.info(
            "stt done", extra={"submission_id": submission_id, "stt_secs": round(stt_secs, 2)}
        )
        transcript = Transcript(
            submission_id=sub.id,
            text=stt_result["text"],
            language=stt_result.get("language"),
            word_timestamps=stt_result.get("words"),
            pronunciation=stt_result.get("pronunciation"),
            stt_model=stt_result.get("model") or settings.STT_MODEL,
        )
        db.add(transcript)
        if stt_result.get("duration") and not sub.audio_duration_sec:
            sub.audio_duration_sec = stt_result["duration"]
        db.commit()

        # Shadowing: pronunciation-only. No LLM, no academic Evaluation (keeps the
        # gradebook clean); just a small fixed engagement reward — but only when the
        # learner actually repeated the target. An off-topic answer (said something
        # else) fails the content check and earns no reward.
        if sub.reference_text:
            sub.status = SubmissionStatus.done
            sub.completed_at = datetime.now(timezone.utc)
            db.commit()
            match = (stt_result.get("pronunciation") or {}).get("reference_match") or {}
            if match.get("on_topic", True):
                try:
                    gamification.award_practice(db, sub)
                except Exception:  # noqa: BLE001
                    db.rollback()
            return "done"

        # 3. Analyze transcript with Gemini. For picture tasks, also feed the
        # image so Gemini can judge how well the student described it.
        question = sub.question
        image_bytes = image_mime = None
        if question.type == QuestionType.image and question.media_key:
            try:
                image_bytes = storage.download_bytes(question.media_key)
                image_mime = _image_mime(question.media_key)
            except Exception:  # noqa: BLE001 — fall back to text-only analysis
                image_bytes = image_mime = None
        # Hand the actual recording to Gemini (multimodal) so it judges delivery —
        # intonation, pace, naturalness — from the real sound, not just the text.
        # Best-effort: if transcoding fails, fall back to text-only analysis.
        try:
            audio_for_llm = stt.to_mp3_bytes(audio)
        except Exception:  # noqa: BLE001
            audio_for_llm = None
        _t_llm = time.monotonic()
        result = llm.analyze(
            question_prompt=question.prompt_text,
            transcript_text=stt_result["text"],
            question_title=question.title,
            level=question.level,
            topic=question.topic,
            image_bytes=image_bytes,
            image_mime=image_mime,
            audio_bytes=audio_for_llm,
        )
        logger.info(
            "llm done",
            extra={"submission_id": submission_id, "llm_secs": round(time.monotonic() - _t_llm, 2)},
        )

        # Azure pronunciation is already 0–100 — same scale as the rest now.
        pron = (stt_result.get("pronunciation") or {}).get("pronunciation")
        pronunciation_score = round(pron, 1) if pron is not None else None

        evaluation = Evaluation(
            submission_id=sub.id,
            fluency_score=result.scores.fluency,
            lexical_score=result.scores.lexical,
            grammar_score=result.scores.grammar,
            relevance_score=result.scores.relevance,
            pronunciation_score=pronunciation_score,
            naturalness_score=result.scores.naturalness,
            speech_rate_score=result.scores.speech_rate,
            intonation_score=result.scores.intonation,
            overall_band=result.scores.overall,
            level_score=result.scores.level_overall,
            native_likeness=result.scores.native_likeness,
            feedback={
                "summary": result.summary,
                "strengths": result.strengths,
                "improvements": result.improvements,
                "vocabulary_suggestions": result.vocabulary_suggestions,
                "pronunciation_feedback": result.pronunciation_feedback,
            },
            corrections=[c.model_dump() for c in result.corrections],
            llm_model=settings.GEMINI_MODEL,
        )
        db.add(evaluation)

        sub.status = SubmissionStatus.done
        sub.completed_at = datetime.now(timezone.utc)
        db.commit()

        # Engagement side-effects — must never break the pipeline.
        try:
            db.refresh(evaluation)
            gamification.award_submission(db, sub, evaluation)
            gamification.schedule_review(db, sub, evaluation)
        except Exception:  # noqa: BLE001
            db.rollback()

        # Notifications — best-effort.
        try:
            _notify_after_done(db, sub, evaluation)
        except Exception:  # noqa: BLE001
            db.rollback()
        return "done"

    except Exception as exc:  # noqa: BLE001
        db.rollback()
        sub = db.get(Submission, uuid.UUID(submission_id))
        if sub is not None:
            sub.status = SubmissionStatus.failed
            sub.error_message = str(exc)[:1000]
            db.commit()
        raise self.retry(exc=exc)
    finally:
        db.close()


@celery.task(name="fail_stuck_submissions")
def fail_stuck_submissions() -> int:
    """Mark submissions stuck in 'processing' for >15 min as failed so students
    aren't left staring at a spinner after a worker crash."""
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=15)
    db = SessionLocal()
    try:
        stuck = db.scalars(
            select(Submission).where(
                Submission.status == SubmissionStatus.processing,
                Submission.updated_at < cutoff,
            )
        ).all()
        for sub in stuck:
            sub.status = SubmissionStatus.failed
            sub.error_message = "Processing timed out — please try again."
        db.commit()
        return len(stuck)
    finally:
        db.close()


@celery.task(name="cleanup_orphan_uploads")
def cleanup_orphan_uploads() -> int:
    """Delete audio objects older than 24h that never became a submission
    (e.g. presigned upload succeeded but the create call failed)."""
    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
    db = SessionLocal()
    try:
        orphans: list[str] = []
        for prefix in ("answers/", "shadow/"):
            for key, last_modified in storage.list_objects(prefix):
                if last_modified >= cutoff:
                    continue  # too new — a submission may still be in flight
                if not db.scalar(select(Submission.id).where(Submission.audio_key == key)):
                    orphans.append(key)
        storage.delete_keys(orphans)
        return len(orphans)
    finally:
        db.close()
