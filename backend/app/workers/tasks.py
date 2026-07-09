"""Background processing pipeline: STT + pronunciation (Azure) → analysis (Gemini)."""

import logging
import time
import uuid

from celery.exceptions import SoftTimeLimitExceeded
from sqlalchemy import delete, select
from datetime import datetime, timedelta, timezone

from app.core.breaker import CircuitOpenError
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
    User,
    UserRole,
)
from app.services import app_settings, gamification, llm, notifications, stt, storage
from app.services.text import html_to_text
from app.workers.celery_app import celery

logger = logging.getLogger("worker.process")

# How hard an orthoepy slip (reading a word AS SPELLED) hits the overall band/XP.
ORTHOEPY_PENALTY_PER_ERROR = 4.0
ORTHOEPY_PENALTY_CAP = 20.0

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
    # Level-relative score (fairer, matches every other view), not the absolute band.
    band = evaluation.level_score if evaluation.level_score is not None else evaluation.overall_band
    notifications.notify(
        db,
        user_id=sub.student_id,
        type="result_ready",
        title="Natija tayyor",
        body=f"Javobingiz baholandi. Ball: {band:.0f}/100" if band is not None else "Javobingiz baholandi.",
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

        orthoepy_on = app_settings.orthoepy_enabled()
        filename = sub.audio_key.rsplit("/", 1)[-1]
        # Audio bytes are downloaded lazily — a retry that already has a transcript
        # skips STT entirely (no re-billing Azure), and only re-fetches the bytes if
        # the best-effort orthoepy pass genuinely needs them.
        audio: bytes | None = None

        def _load_audio() -> bytes:
            nonlocal audio
            if audio is None:
                audio = storage.download_bytes(sub.audio_key)
            return audio

        # RESUME-FROM-TRANSCRIPT: on a retry the STT step may have already run and
        # persisted a Transcript. Reuse it instead of downloading + re-transcribing
        # (Azure STT is billed per call), rebuilding the stt_result-equivalent data.
        transcript = db.scalar(select(Transcript).where(Transcript.submission_id == sub.id))
        if transcript is not None:
            stt_result = {
                "text": transcript.text,
                "language": transcript.language,
                "words": transcript.word_timestamps,
                "pronunciation": transcript.pronunciation,
                "model": transcript.stt_model,
                "duration": sub.audio_duration_sec,
            }
            logger.info("reusing persisted transcript", extra={"submission_id": submission_id})
        else:
            # 1. Download audio from object storage
            audio = _load_audio()

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
            # Orthoepy check: flag words read AS SPELLED (written ≠ spoken).
            # Best-effort — must never break the (free) shadowing flow — and gated
            # behind the admin `orthoepy_enabled` setting (an extra Gemini call).
            if orthoepy_on:
                try:
                    oe = llm.detect_orthoepy(
                        audio_bytes=stt.to_mp3_bytes(_load_audio()),
                        reference_text=sub.reference_text,
                        transcript_text=stt_result.get("text"),
                    )
                    if oe:
                        pron = dict(transcript.pronunciation or {})
                        pron["orthoepy_errors"] = [e.model_dump() for e in oe]
                        transcript.pronunciation = pron
                except Exception:  # noqa: BLE001
                    logger.warning("orthoepy check failed", extra={"submission_id": submission_id})
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
        # Text-only analysis: the LLM judges the transcript. Delivery is graded
        # separately — Azure's pronunciation score is folded into the final band
        # below (5th criterion), so the recording itself is not sent to the LLM.
        _t_llm = time.monotonic()
        result = llm.analyze(
            question_prompt=html_to_text(question.prompt_text),
            transcript_text=stt_result["text"],
            instruction=html_to_text(question.instruction_text) if question.instruction_text else None,
            question_title=question.title,
            level=question.level,
            topic=question.topic,
            image_bytes=image_bytes,
            image_mime=image_mime,
        )
        logger.info(
            "llm done",
            extra={"submission_id": submission_id, "llm_secs": round(time.monotonic() - _t_llm, 2)},
        )

        # Orthoepy (separate AUDIO pass — the text analysis above can't hear it).
        # Reading words AS SPELLED lowers the overall band and, in turn, the XP.
        # Best-effort and gated behind the admin `orthoepy_enabled` setting; runs on
        # its own circuit so a failure here can never open the grader's breaker.
        orthoepy_errors: list = []
        if orthoepy_on:
            try:
                orthoepy_errors = llm.detect_orthoepy(
                    audio_bytes=stt.to_mp3_bytes(_load_audio()),
                    transcript_text=stt_result["text"],
                )
            except Exception:  # noqa: BLE001
                logger.warning("orthoepy check failed", extra={"submission_id": submission_id})
        oe_penalty = min(len(orthoepy_errors) * ORTHOEPY_PENALTY_PER_ERROR, ORTHOEPY_PENALTY_CAP)

        # Azure pronunciation (PronScore, 0–100) becomes a 5th, equally-weighted
        # criterion alongside the LLM's four text criteria. The LLM `overall`/
        # `level_overall` are the aggregate of those four, so blending pronunciation
        # in as (text*4 + pron) / 5 makes it one of five equal parts. Falls back to
        # the text-only score when Azure reports no pronunciation (e.g. Whisper path).
        pron_score = (stt_result.get("pronunciation") or {}).get("pronunciation")

        def _with_pron(text_score: float) -> float:
            if pron_score is None:
                return text_score
            return (text_score * 4 + pron_score) / 5

        overall_band = max(0.0, _with_pron(result.scores.overall) - oe_penalty)
        level_score = max(0.0, _with_pron(result.scores.level_overall) - oe_penalty)

        evaluation = Evaluation(
            submission_id=sub.id,
            fluency_score=result.scores.fluency,
            lexical_score=result.scores.lexical,
            grammar_score=result.scores.grammar,
            relevance_score=result.scores.relevance,
            pronunciation_score=round(pron_score, 1) if pron_score is not None else None,
            overall_band=overall_band,
            level_score=level_score,
            feedback={
                "summary": result.summary,
                "strengths": result.strengths,
                "improvements": result.improvements,
                "vocabulary_suggestions": result.vocabulary_suggestions,
                "orthoepy_errors": [e.model_dump() for e in orthoepy_errors],
            },
            corrections=[c.model_dump() for c in result.corrections],
            llm_model=settings.GEMINI_MODEL,
        )
        # On a retry an Evaluation from a prior partial run may already exist
        # (submission_id is unique); replace it so the insert can't collide.
        db.execute(delete(Evaluation).where(Evaluation.submission_id == sub.id))
        db.add(evaluation)

        # NOTE: the fresh per-attempt exemplar answer is no longer generated here.
        # It cost a 3rd Gemini call on every submission (exhausting the free tier);
        # it's now produced lazily on demand via POST /submissions/{id}/model-answer,
        # and the UI falls back to the question's stored model answer meanwhile.

        sub.status = SubmissionStatus.done
        sub.completed_at = datetime.now(timezone.utc)
        db.commit()

        # Engagement side-effects — must never break the pipeline. A silent /
        # empty recording (nothing transcribed) earns no XP, no streak and no
        # spaced-repetition review — the student only gets rewards for actually
        # speaking.
        answered = bool((stt_result.get("text") or "").strip())
        try:
            db.refresh(evaluation)
            gamification.award_submission(db, sub, evaluation, answered=answered)
            if answered:
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
        # A soft time-limit or an open circuit is NOT transient — retrying just
        # re-runs the whole (billed) pipeline and hits the same wall. Fail such
        # submissions TERMINALLY with a helpful message and don't retry. Only
        # genuinely transient errors go through self.retry (max_retries=3).
        terminal = isinstance(exc, (SoftTimeLimitExceeded, CircuitOpenError))
        sub = db.get(Submission, uuid.UUID(submission_id))
        if sub is not None:
            sub.status = SubmissionStatus.failed
            if terminal:
                sub.error_message = (
                    "The AI grader is temporarily overloaded or rate-limited. "
                    "Please try again in a few minutes."
                )
            else:
                sub.error_message = str(exc)[:1000]
            db.commit()
        if terminal:
            return "failed"
        raise self.retry(exc=exc)
    finally:
        db.close()


@celery.task(name="fail_stuck_submissions")
def fail_stuck_submissions() -> int:
    """Recover submissions that a worker never finished so students aren't left
    staring at a spinner. Covers two cases:

    * stuck in 'processing' for >15 min — a worker crashed mid-task;
    * stuck in 'pending' for >20 min — the task was lost before it ever started
      (e.g. the worker died between enqueue and pickup).
    """
    now = datetime.now(timezone.utc)
    processing_cutoff = now - timedelta(minutes=15)
    pending_cutoff = now - timedelta(minutes=20)
    db = SessionLocal()
    try:
        stuck = db.scalars(
            select(Submission).where(
                (
                    (Submission.status == SubmissionStatus.processing)
                    & (Submission.updated_at < processing_cutoff)
                )
                | (
                    (Submission.status == SubmissionStatus.pending)
                    & (Submission.updated_at < pending_cutoff)
                )
            )
        ).all()
        for sub in stuck:
            sub.status = SubmissionStatus.failed
            sub.error_message = "Processing timed out — please try again."
        db.commit()
        return len(stuck)
    finally:
        db.close()


@celery.task(name="cleanup_test_submissions")
def cleanup_test_submissions() -> int:
    """Teacher/admin submissions are throwaway TEST runs — they can view the
    result, but it isn't kept. Purge non-student submissions (and their audio)
    older than 6h. Transcript/Evaluation cascade on delete."""
    cutoff = datetime.now(timezone.utc) - timedelta(hours=6)
    db = SessionLocal()
    try:
        rows = db.execute(
            select(Submission.id, Submission.audio_key)
            .join(User, Submission.student_id == User.id)
            .where(User.role != UserRole.student, Submission.created_at < cutoff)
        ).all()
        if not rows:
            return 0
        ids = [r[0] for r in rows]
        keys = [r[1] for r in rows if r[1]]
        db.execute(delete(Submission).where(Submission.id.in_(ids)))
        db.commit()
        if keys:
            storage.delete_keys(keys)
        return len(ids)
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
