import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_teacher
from app.core.ratelimit import rate_limit
from app.db.session import get_db
from app.models import Assignment, Question, QuestionType, User, UserRole
from app.schemas.question import (
    BulkActionResult,
    BulkIds,
    MediaUploadRequest,
    MediaUploadURL,
    QuestionCreate,
    QuestionGenerateRequest,
    QuestionGenerateResult,
    QuestionOut,
    QuestionUpdate,
)
from app.services import llm, storage, question_gen
from app.services.text import html_to_text

router = APIRouter(prefix="/questions", tags=["questions"])


def active_assignment(db: Session, student_id: uuid.UUID, question_id: uuid.UUID) -> Assignment | None:
    """The student's still-open assignment for this question, or None.

    "Open" = no due date, or a due date still in the future. Used to gate access
    to ASSIGNED (non-public) tasks.
    """
    now = datetime.now(timezone.utc)
    return db.scalar(
        select(Assignment).where(
            Assignment.student_id == student_id,
            Assignment.question_id == question_id,
            (Assignment.due_at.is_(None)) | (Assignment.due_at >= now),
        )
    )


def _to_out(q: Question) -> QuestionOut:
    out = QuestionOut.model_validate(q)
    out.teacher_name = q.teacher.full_name if q.teacher else None
    if q.media_key:
        out.media_url = storage.presigned_get(q.media_key)
    return out


@router.post("", response_model=QuestionOut, status_code=status.HTTP_201_CREATED)
def create_question(
    payload: QuestionCreate,
    teacher: User = Depends(require_teacher),
    db: Session = Depends(get_db),
) -> QuestionOut:
    q = Question(teacher_id=teacher.id, **payload.model_dump())
    db.add(q)
    db.commit()
    db.refresh(q)
    return _to_out(q)


@router.post("/generate", response_model=QuestionGenerateResult, status_code=status.HTTP_201_CREATED)
def generate_questions(
    payload: QuestionGenerateRequest,
    teacher: User = Depends(require_teacher),
    db: Session = Depends(get_db),
) -> QuestionGenerateResult:
    """AI-generate a batch of DRAFT questions owned by the current teacher.

    Synchronous and bounded (see question_gen caps) — large libraries use the
    `generate_questions` CLI script. Drafts are reviewed/published in the UI.
    """
    types = [t.value for t in payload.types]
    cells = len(payload.levels) * len(payload.topics) * len(types)
    if cells > question_gen.MAX_CELLS_PER_REQUEST:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"Too many combinations ({cells}); max {question_gen.MAX_CELLS_PER_REQUEST}. "
            "Pick fewer levels/topics/types.",
        )
    if cells * payload.count_per_cell > question_gen.MAX_PER_REQUEST:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"Too many at once; max {question_gen.MAX_PER_REQUEST} per request. Lower the count.",
        )
    created, skipped = question_gen.generate_batch(
        db,
        teacher_id=teacher.id,
        levels=payload.levels,
        topics=payload.topics,
        types=types,
        count_per_cell=payload.count_per_cell,
        limit_sec=payload.answer_time_limit_sec,
        publish=False,
        custom=payload.custom_instructions,
    )
    db.commit()
    for q in created:
        db.refresh(q)
    return QuestionGenerateResult(
        created=len(created),
        skipped_no_media=skipped,
        questions=[_to_out(q) for q in created],
    )


def _owned_questions(db: Session, ids: list[uuid.UUID], user: User):
    """The caller's (admin: anyone's) non-deleted questions among `ids`."""
    stmt = select(Question).where(Question.id.in_(ids), Question.is_deleted.is_(False))
    if user.role != UserRole.admin:
        stmt = stmt.where(Question.teacher_id == user.id)
    return db.scalars(stmt).all()


@router.post("/bulk-publish", response_model=BulkActionResult)
def bulk_publish(
    payload: BulkIds,
    teacher: User = Depends(require_teacher),
    db: Session = Depends(get_db),
) -> BulkActionResult:
    rows = _owned_questions(db, payload.ids, teacher)
    for q in rows:
        q.is_published = True
    db.commit()
    return BulkActionResult(count=len(rows))


@router.post("/bulk-delete", response_model=BulkActionResult)
def bulk_delete(
    payload: BulkIds,
    teacher: User = Depends(require_teacher),
    db: Session = Depends(get_db),
) -> BulkActionResult:
    rows = _owned_questions(db, payload.ids, teacher)
    for q in rows:
        q.is_deleted = True
        q.is_published = False
    db.commit()
    return BulkActionResult(count=len(rows))


@router.post("/{question_id}/media-url", response_model=MediaUploadURL)
def media_upload_url(
    question_id: uuid.UUID,
    payload: MediaUploadRequest,
    teacher: User = Depends(require_teacher),
    db: Session = Depends(get_db),
) -> MediaUploadURL:
    q = db.get(Question, question_id)
    if q is None or (teacher.role != UserRole.admin and q.teacher_id != teacher.id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Question not found")
    if q.type == QuestionType.text:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Text questions have no media")

    # The URL must be signed for the EXACT content-type the browser will send,
    # otherwise MinIO/S3 rejects the upload with a signature mismatch.
    content_type = payload.content_type
    expected = "image/" if q.type == QuestionType.image else "video/"
    if not content_type.startswith(expected):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Content-Type must be {expected}* for a {q.type.value} question",
        )

    ext = content_type.split("/", 1)[-1].split(";")[0] or q.type.value
    key = storage.new_key(f"questions/{q.type.value}", ext)
    url = storage.presigned_put(key, content_type)

    # Persist the key immediately; the browser PUTs the bytes to the URL next.
    q.media_key = key
    db.commit()
    return MediaUploadURL(upload_url=url, media_key=key)


@router.get("", response_model=list[QuestionOut])
def list_questions(
    type: QuestionType | None = None,
    level: str | None = None,
    topic: str | None = None,
    published_only: bool = Query(default=False),
    teacher_id: uuid.UUID | None = Query(default=None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[QuestionOut]:
    stmt = select(Question).where(Question.is_deleted.is_(False))
    # Students browse only OPEN published questions (any teacher). Assigned
    # tasks never appear here — they're reached via assignments. Teachers see
    # only their own. Admin sees everything (or one teacher's via teacher_id).
    if user.role == UserRole.student:
        stmt = stmt.where(Question.is_published.is_(True), Question.is_public.is_(True))
    elif user.role == UserRole.teacher:
        stmt = stmt.where(Question.teacher_id == user.id)
        if published_only:
            stmt = stmt.where(Question.is_published.is_(True))
    elif teacher_id is not None:  # admin drilling into one teacher
        stmt = stmt.where(Question.teacher_id == teacher_id)
    if type is not None:
        stmt = stmt.where(Question.type == type)
    if level:
        stmt = stmt.where(Question.level == level)
    if topic:
        stmt = stmt.where(Question.topic == topic)
    stmt = stmt.order_by(Question.created_at.desc())
    out = [_to_out(q) for q in db.scalars(stmt).all()]
    if user.role == UserRole.student:
        for o in out:  # never leak the exemplar answer before submitting
            o.model_answer_text = None
    return out


@router.get("/meta/topics", response_model=list[str])
def list_topics(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[str]:
    """Distinct, non-empty topics — used to build category filters in the UI."""
    stmt = (
        select(Question.topic)
        .where(Question.topic.is_not(None), Question.is_deleted.is_(False))
        .distinct()
    )
    if user.role.value == "student":
        stmt = stmt.where(Question.is_published.is_(True), Question.is_public.is_(True))
    return sorted({t for t in db.scalars(stmt).all() if t})


@router.get("/{question_id}", response_model=QuestionOut)
def get_question(
    question_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> QuestionOut:
    q = db.get(Question, question_id)
    if q is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Question not found")
    if user.role == UserRole.student:
        if not q.is_published:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Question not found")
        # Assigned task: only reachable with a still-open assignment.
        if not q.is_public and active_assignment(db, user.id, q.id) is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Question not found")
    if user.role == UserRole.teacher and q.teacher_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Question not found")
    out = _to_out(q)
    if user.role == UserRole.student:
        out.model_answer_text = None  # revealed only on the result page
    return out


@router.post(
    "/{question_id}/generate-model-answer",
    response_model=QuestionOut,
    dependencies=[Depends(rate_limit("genmodel", 20, 600))],
)
def generate_model_answer(
    question_id: uuid.UUID,
    teacher: User = Depends(require_teacher),
    db: Session = Depends(get_db),
) -> QuestionOut:
    """Generate an exemplar answer with Gemini and save it on the question."""
    q = db.get(Question, question_id)
    if q is None or (teacher.role != UserRole.admin and q.teacher_id != teacher.id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Question not found")
    text = llm.generate_model_answer(
        question_prompt=html_to_text(q.prompt_text),
        question_title=q.title,
        level=q.level,
        topic=q.topic,
    )
    q.model_answer_text = text
    db.commit()
    db.refresh(q)
    return _to_out(q)


@router.patch("/{question_id}", response_model=QuestionOut)
def update_question(
    question_id: uuid.UUID,
    payload: QuestionUpdate,
    teacher: User = Depends(require_teacher),
    db: Session = Depends(get_db),
) -> QuestionOut:
    q = db.get(Question, question_id)
    if q is None or (teacher.role != UserRole.admin and q.teacher_id != teacher.id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Question not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(q, field, value)
    db.commit()
    db.refresh(q)
    return _to_out(q)


@router.post("/{question_id}/duplicate", response_model=QuestionOut, status_code=status.HTTP_201_CREATED)
def duplicate_question(
    question_id: uuid.UUID,
    teacher: User = Depends(require_teacher),
    db: Session = Depends(get_db),
) -> QuestionOut:
    """Clone a question as a fresh draft (unpublished). Media is shared by key —
    copies point at the same object; deleting one never affects the other's row."""
    src = db.get(Question, question_id)
    if src is None or (teacher.role != UserRole.admin and src.teacher_id != teacher.id) or src.is_deleted:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Question not found")
    copy = Question(
        teacher_id=teacher.id,
        type=src.type,
        title=f"{src.title} (копия)"[:255],
        prompt_text=src.prompt_text,
        media_key=src.media_key,
        level=src.level,
        topic=src.topic,
        prep_time_sec=src.prep_time_sec,
        answer_time_limit_sec=src.answer_time_limit_sec,
        is_published=False,  # always a draft
        model_answer_text=src.model_answer_text,
    )
    db.add(copy)
    db.commit()
    db.refresh(copy)
    return _to_out(copy)


@router.delete("/{question_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_question(
    question_id: uuid.UUID,
    teacher: User = Depends(require_teacher),
    db: Session = Depends(get_db),
) -> None:
    q = db.get(Question, question_id)
    if q is None or (teacher.role != UserRole.admin and q.teacher_id != teacher.id) or q.is_deleted:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Question not found")
    # Soft delete: unpublish + hide, but keep submissions/evaluations history.
    q.is_deleted = True
    q.is_published = False
    db.commit()
