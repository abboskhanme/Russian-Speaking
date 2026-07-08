import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from datetime import datetime, timezone

from app.api.deps import get_current_user, require_teacher_or_admin
from app.api.v1.questions import active_assignment
from app.core.ratelimit import rate_limit
from app.core.config import settings
from app.db.session import get_db
from app.models import (
    Group,
    GroupMember,
    Question,
    ReviewItem,
    Submission,
    SubmissionStatus,
    User,
    UserRole,
)
from app.schemas.gamification import ExplainOut
from app.schemas.submission import (
    AudioUploadURL,
    AudioUploadURLRequest,
    ShadowCreate,
    ShadowUploadURLRequest,
    SubmissionCreate,
    SubmissionOut,
    TeacherFeedback,
)
from app.services import access, llm, storage
from app.services.text import html_to_text
from app.workers.tasks import process_submission

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/submissions", tags=["submissions"])

_EXT_BY_CONTENT_TYPE = {
    "audio/webm": "webm",
    "audio/ogg": "ogg",
    "audio/mpeg": "mp3",
    "audio/mp4": "mp4",
    "audio/wav": "wav",
}


def _enforce_quota(db: Session, student: User) -> None:
    """Cap how many answer audios one student can accumulate (storage guard).
    Admins/teachers are exempt; 0 means unlimited."""
    if settings.STUDENT_UPLOAD_QUOTA <= 0 or student.role != UserRole.student:
        return
    count = db.scalar(
        select(func.count(Submission.id)).where(Submission.student_id == student.id)
    ) or 0
    if count >= settings.STUDENT_UPLOAD_QUOTA:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Storage quota reached. Please delete old answers or contact your teacher.",
        )


def _to_out(sub: Submission) -> SubmissionOut:
    out = SubmissionOut.model_validate(sub)
    out.audio_url = storage.presigned_get(sub.audio_key)
    if sub.student is not None:
        out.student_name = sub.student.full_name
    if sub.question is not None:
        out.question_title = sub.question.title
        out.question_topic = sub.question.topic
        out.question_level = sub.question.level
    # Prefer the fresh per-attempt exemplar; fall back to the question's stored one.
    out.model_answer_text = sub.model_answer_text or (
        sub.question.model_answer_text if sub.question is not None else None
    )
    return out


@router.post("/upload-url", response_model=AudioUploadURL)
def audio_upload_url(
    payload: AudioUploadURLRequest,
    student: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AudioUploadURL:
    q = db.get(Question, payload.question_id)
    if q is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Question not found")
    _enforce_quota(db, student)
    ext = _EXT_BY_CONTENT_TYPE.get(payload.content_type, "webm")
    key = storage.new_key("answers", ext)
    url = storage.presigned_put(key, payload.content_type)
    return AudioUploadURL(upload_url=url, audio_key=key)


@router.post(
    "",
    response_model=SubmissionOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(rate_limit("submit", 20, 600))],
)
def create_submission(
    payload: SubmissionCreate,
    student: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SubmissionOut:
    q = db.get(Question, payload.question_id)
    if q is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Question not found")

    # A submission counts against an assignment (for class-leaderboard scoping)
    # when one is open for this task.
    assignment = active_assignment(db, student.id, q.id)
    if student.role != UserRole.admin:
        # Reachable via its module (official public / the student's teacher's
        # group), a still-open assignment, or a pending review item.
        in_review = db.scalar(
            select(ReviewItem.id).where(
                ReviewItem.student_id == student.id,
                ReviewItem.question_id == q.id,
                ReviewItem.completed.is_(False),
            )
        )
        reachable = (
            access.can_reach(db, student, q)
            or assignment is not None
            or in_review is not None
        )
        if not reachable:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "This task isn't assigned to you, or its deadline has passed.",
            )
        # Positional freemium: official public modules gate everything past the
        # free preview; teacher/assigned content is never self-serve paywalled.
        if access.needs_premium(db, student, q):
            raise HTTPException(
                status.HTTP_402_PAYMENT_REQUIRED,
                "This task needs premium. Upgrade to continue this module.",
            )

    sub = Submission(
        student_id=student.id,
        question_id=payload.question_id,
        assignment_id=assignment.id if assignment else None,
        audio_key=payload.audio_key,
        audio_duration_sec=payload.audio_duration_sec,
    )
    db.add(sub)
    db.commit()
    db.refresh(sub)

    # Kick off the async STT + analysis pipeline.
    process_submission.delay(str(sub.id))
    return _to_out(sub)


@router.post("/shadow/upload-url", response_model=AudioUploadURL)
def shadow_upload_url(
    payload: ShadowUploadURLRequest,
    student: User = Depends(get_current_user),
) -> AudioUploadURL:
    ext = _EXT_BY_CONTENT_TYPE.get(payload.content_type, "webm")
    key = storage.new_key("shadow", ext)
    url = storage.presigned_put(key, payload.content_type)
    return AudioUploadURL(upload_url=url, audio_key=key)


@router.post(
    "/shadow",
    response_model=SubmissionOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(rate_limit("submit_shadow", 30, 600))],
)
def create_shadow(
    payload: ShadowCreate,
    student: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SubmissionOut:
    """Shadowing / read-aloud practice: scored against a target sentence. Free
    (no freemium gate, no question), pronunciation-only — no LLM, no academic band."""
    sub = Submission(
        student_id=student.id,
        question_id=None,
        reference_text=payload.reference_text.strip(),
        audio_key=payload.audio_key,
        audio_duration_sec=payload.audio_duration_sec,
    )
    db.add(sub)
    db.commit()
    db.refresh(sub)
    process_submission.delay(str(sub.id))
    return _to_out(sub)


@router.get("", response_model=list[SubmissionOut])
def list_submissions(
    question_id: uuid.UUID | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[SubmissionOut]:
    stmt = select(Submission).where(Submission.reference_text.is_(None))
    if user.role == UserRole.student:
        # Students see only their own answers.
        stmt = stmt.where(Submission.student_id == user.id)
    elif user.role == UserRole.teacher:
        # Teachers see answers to their own questions AND only from their own
        # students (group members) — never a non-roster student.
        roster = (
            select(GroupMember.student_id)
            .join(Group, GroupMember.group_id == Group.id)
            .where(Group.teacher_id == user.id)
        )
        stmt = (
            stmt.join(Question, Submission.question_id == Question.id)
            .where(Question.teacher_id == user.id)
            .where(Submission.student_id.in_(roster))
        )
    # admin: all submissions
    if question_id is not None:
        stmt = stmt.where(Submission.question_id == question_id)
    stmt = (
        stmt.options(
            selectinload(Submission.student),
            selectinload(Submission.question),
            selectinload(Submission.evaluation),
            selectinload(Submission.transcript),
        )
        .order_by(Submission.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    return [_to_out(s) for s in db.scalars(stmt).all()]


def _teacher_denied(db: Session, teacher_id, sub: Submission) -> bool:
    """A teacher may view a submission only if it answers their own question AND
    the student is in their roster (a member of one of their groups)."""
    q = sub.question
    if q is None or q.teacher_id != teacher_id:
        return True
    in_roster = db.scalar(
        select(GroupMember.id)
        .join(Group, GroupMember.group_id == Group.id)
        .where(Group.teacher_id == teacher_id, GroupMember.student_id == sub.student_id)
    )
    return in_roster is None


@router.get("/{submission_id}", response_model=SubmissionOut)
def get_submission(
    submission_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SubmissionOut:
    sub = db.get(Submission, submission_id)
    if sub is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Submission not found")
    # Anyone can always read their OWN submission — including a teacher/admin who
    # did a shadowing practice themselves (no question → the roster check below
    # would wrongly 404 it).
    if sub.student_id == user.id:
        return _to_out(sub)
    # Students read only their own; teachers only their own students' answers.
    if user.role == UserRole.student:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Submission not found")
    if user.role == UserRole.teacher and _teacher_denied(db, user.id, sub):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Submission not found")
    return _to_out(sub)


@router.post("/{submission_id}/explain", response_model=ExplainOut)
def explain_submission(
    submission_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ExplainOut:
    """AI coaching follow-up: deeper explanation + a rewritten weak sentence (cached)."""
    sub = db.get(Submission, submission_id)
    if sub is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Submission not found")
    if user.role == UserRole.student and sub.student_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Submission not found")
    if user.role == UserRole.teacher and _teacher_denied(db, user.id, sub):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Submission not found")

    ev = sub.evaluation
    if ev is None or sub.transcript is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Submission is not evaluated yet")
    if ev.explanation:
        return ExplainOut(**ev.explanation)

    result = llm.explain_answer(
        question_prompt=html_to_text(sub.question.prompt_text),
        transcript_text=sub.transcript.text,
    )
    ev.explanation = {
        "explanation": result.explanation,
        "improved_sentence": result.improved_sentence,
    }
    db.commit()
    return ExplainOut(explanation=result.explanation, improved_sentence=result.improved_sentence)


@router.post("/{submission_id}/model-answer", response_model=SubmissionOut)
def submission_model_answer(
    submission_id: uuid.UUID,
    refresh: bool = Query(default=False),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SubmissionOut:
    """Lazily generate a fresh exemplar answer for THIS attempt, on demand.

    Grading no longer produces an exemplar on every submission (it cost a 3rd
    Gemini call and burned the free tier); the UI asks for one here only when the
    student opens it. The result is cached on the submission; ``?refresh=true``
    forces a new variant. A generation failure is swallowed — the response falls
    back to the question's stored model answer."""
    sub = db.get(Submission, submission_id)
    if sub is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Submission not found")
    if user.role == UserRole.student and sub.student_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Submission not found")
    if user.role == UserRole.teacher and _teacher_denied(db, user.id, sub):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Submission not found")

    q = sub.question
    if q is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "This submission has no question to model."
        )
    # Return the cached exemplar unless a fresh variant was explicitly requested.
    if sub.model_answer_text and not refresh:
        return _to_out(sub)

    variant_hint = str(sub.id)
    if refresh:
        variant_hint = f"{sub.id}-{int(datetime.now(timezone.utc).timestamp())}"
    try:
        text = llm.generate_model_answer(
            question_prompt=html_to_text(q.prompt_text),
            question_title=q.title,
            level=q.level,
            topic=q.topic,
            ru_style=q.ru_style,
            variant_hint=variant_hint,
        ) or None
    except Exception:  # noqa: BLE001 — best-effort; UI falls back to the stored answer
        logger.warning("model-answer generation failed", extra={"submission_id": str(sub.id)})
        text = None
    if text:
        sub.model_answer_text = text
        db.commit()
        db.refresh(sub)
    return _to_out(sub)


@router.post("/{submission_id}/retry", response_model=SubmissionOut)
def retry_submission(
    submission_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SubmissionOut:
    """Re-run the pipeline for a FAILED submission (used by the failed-result
    screen). Resets it to pending, clears the error, and re-enqueues processing.
    The worker resumes from the persisted transcript when one exists, so a retry
    doesn't re-bill speech-to-text."""
    sub = db.get(Submission, submission_id)
    if sub is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Submission not found")
    if user.role == UserRole.student and sub.student_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Submission not found")
    if user.role == UserRole.teacher and _teacher_denied(db, user.id, sub):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Submission not found")
    if sub.status != SubmissionStatus.failed:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Only a failed submission can be retried."
        )
    sub.status = SubmissionStatus.pending
    sub.error_message = None
    db.commit()
    db.refresh(sub)
    process_submission.delay(str(sub.id))
    return _to_out(sub)


@router.patch("/{submission_id}/feedback", response_model=SubmissionOut)
def teacher_feedback(
    submission_id: uuid.UUID,
    payload: TeacherFeedback,
    teacher: User = Depends(require_teacher_or_admin),
    db: Session = Depends(get_db),
) -> SubmissionOut:
    """A teacher leaves a manual comment and/or overrides the AI band."""
    sub = db.get(Submission, submission_id)
    if sub is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Submission not found")
    if teacher.role == UserRole.teacher and _teacher_denied(db, teacher.id, sub):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Submission not found")
    sub.teacher_comment = (payload.comment or "").strip() or None
    sub.teacher_band = payload.band
    sub.reviewed_by = teacher.id
    sub.reviewed_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(sub)
    return _to_out(sub)
