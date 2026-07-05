import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_teacher
from app.api.v1.questions import _to_out as question_to_out
from app.db.session import get_db
from app.models import (
    Group,
    GroupMember,
    Question,
    QuestionBlock,
    Submission,
    SubmissionStatus,
    User,
    UserRole,
)
from app.core.config import settings
from app.schemas.block import (
    RU_STYLES,
    BlockAddQuestions,
    BlockCreate,
    BlockOut,
    BlockUpdate,
    ModuleStudentProgress,
    ReorderIds,
    StudentModule,
    StudentTask,
)
from app.schemas.question import MediaUploadURL, MediaUploadRequest, QuestionOut
from app.services import access, storage

router = APIRouter(prefix="/blocks", tags=["blocks"])

# Module visibility values (mirrors QuestionBlock.visibility).
_VISIBILITIES = {"public", "group"}


def _clean_style(value: str | None) -> str | None:
    v = (value or "").strip().lower()
    if not v:
        return None
    if v not in RU_STYLES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid ru_style")
    return v


def _owned_block(block_id: uuid.UUID, teacher: User, db: Session) -> QuestionBlock:
    block = db.get(QuestionBlock, block_id)
    if block is None or (teacher.role != UserRole.admin and block.teacher_id != teacher.id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Block not found")
    return block


def _counts(db: Session, block_ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
    if not block_ids:
        return {}
    rows = db.execute(
        select(Question.block_id, func.count(Question.id))
        .where(Question.block_id.in_(block_ids), Question.is_deleted.is_(False))
        .group_by(Question.block_id)
    ).all()
    return {bid: n for bid, n in rows}


def _to_out(block: QuestionBlock, count: int = 0) -> BlockOut:
    out = BlockOut.model_validate(block)
    out.question_count = count
    if block.cover_key:
        out.cover_url = storage.presigned_get(block.cover_key)
    return out


@router.get("", response_model=list[BlockOut])
def list_blocks(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[BlockOut]:
    """A teacher's blocks (admin: everyone's), newest first, with question counts."""
    stmt = select(QuestionBlock).order_by(QuestionBlock.sort_order, QuestionBlock.created_at)
    if user.role != UserRole.admin:
        stmt = stmt.where(QuestionBlock.teacher_id == user.id)
    blocks = list(db.scalars(stmt).all())
    counts = _counts(db, [b.id for b in blocks])
    return [_to_out(b, counts.get(b.id, 0)) for b in blocks]


@router.get("/student", response_model=list[StudentModule])
def student_modules(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[StudentModule]:
    """Modules the student can work through: official PUBLIC modules (everyone,
    incl. teacherless students) plus their own teachers' GROUP modules. Two locks
    per task — SEQUENTIAL (previous task not done yet) and PREMIUM (beyond the free
    preview of an official module)."""
    teacher_ids = access.student_teacher_ids(db, user.id)
    cond = QuestionBlock.visibility == "public"
    if teacher_ids:
        cond = or_(
            cond,
            and_(
                QuestionBlock.visibility == "group",
                QuestionBlock.teacher_id.in_(teacher_ids),
            ),
        )
    blocks = list(
        db.scalars(
            select(QuestionBlock)
            .where(QuestionBlock.is_published.is_(True), cond)
            # Teacher (group) modules first, then official public ones; each by order.
            .order_by(QuestionBlock.visibility, QuestionBlock.sort_order, QuestionBlock.created_at)
        ).all()
    )
    if not blocks:
        return []
    done_qids = set(
        db.scalars(
            select(Submission.question_id)
            .where(
                Submission.student_id == user.id,
                Submission.status == SubmissionStatus.done,
                Submission.question_id.is_not(None),
            )
            .distinct()
        ).all()
    )
    free_n = settings.FREE_TASKS_PER_MODULE
    out: list[StudentModule] = []
    for b in blocks:
        qs = list(
            db.scalars(
                select(Question)
                .where(
                    Question.block_id == b.id,
                    Question.is_deleted.is_(False),
                    Question.is_published.is_(True),
                )
                .order_by(Question.sort_order, Question.created_at)
            ).all()
        )
        if not qs:
            continue
        # Positional freemium applies only to official public modules.
        gated = b.visibility == "public" and not user.is_premium and free_n > 0
        tasks: list[StudentTask] = []
        prev_done = True  # the first task is always sequentially unlocked
        next_id: uuid.UUID | None = None
        done_count = 0
        for idx, q in enumerate(qs):
            done = q.id in done_qids
            seq_locked = not prev_done
            premium_locked = gated and idx >= free_n
            if done:
                done_count += 1
            elif not seq_locked and not premium_locked and next_id is None:
                next_id = q.id
            tasks.append(
                StudentTask(
                    id=q.id, title=q.title, type=q.type.value, level=q.level,
                    sort_order=q.sort_order, done=done, locked=seq_locked,
                    premium_locked=premium_locked,
                )
            )
            prev_done = done
        out.append(
            StudentModule(
                id=b.id, name=b.name, topic=b.topic, level=b.level, ru_style=b.ru_style,
                visibility=b.visibility,
                cover_url=storage.presigned_get(b.cover_key) if b.cover_key else None,
                total=len(qs), done_count=done_count, next_task_id=next_id, tasks=tasks,
            )
        )
    return out


@router.get("/{block_id}/progress", response_model=list[ModuleStudentProgress])
def block_progress(
    block_id: uuid.UUID,
    teacher: User = Depends(require_teacher),
    db: Session = Depends(get_db),
) -> list[ModuleStudentProgress]:
    """Per-student progress through one module (teacher view): how many tasks each
    student finished and which task they are on."""
    block = _owned_block(block_id, teacher, db)
    qs = list(
        db.scalars(
            select(Question)
            .where(
                Question.block_id == block.id,
                Question.is_deleted.is_(False),
                Question.is_published.is_(True),
            )
            .order_by(Question.sort_order, Question.created_at)
        ).all()
    )
    total = len(qs)
    qids = [q.id for q in qs]
    rows = db.execute(
        select(User.id, User.full_name)
        .join(GroupMember, GroupMember.student_id == User.id)
        .join(Group, Group.id == GroupMember.group_id)
        .where(Group.teacher_id == block.teacher_id)
        .distinct()
    ).all()
    out: list[ModuleStudentProgress] = []
    for sid, full_name in rows:
        if qids:
            done_qids = set(
                db.scalars(
                    select(Submission.question_id)
                    .where(
                        Submission.student_id == sid,
                        Submission.status == SubmissionStatus.done,
                        Submission.question_id.in_(qids),
                    )
                    .distinct()
                ).all()
            )
        else:
            done_qids = set()
        done_count = sum(1 for q in qs if q.id in done_qids)
        current = next((q.title for q in qs if q.id not in done_qids), None)
        percent = round(done_count / total * 100) if total else 0
        out.append(
            ModuleStudentProgress(
                student_id=sid, full_name=full_name, done_count=done_count,
                total=total, percent=percent, current_task_title=current,
            )
        )
    out.sort(key=lambda p: p.percent, reverse=True)
    return out


def _clean_visibility(value: str | None, teacher: User) -> str:
    """Only admins may create/keep an official PUBLIC module; teachers are 'group'."""
    v = (value or "").strip().lower()
    if v and v not in _VISIBILITIES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid visibility")
    if v == "public" and teacher.role != UserRole.admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only admins can create public modules")
    return v or "group"


@router.post("", response_model=BlockOut, status_code=status.HTTP_201_CREATED)
def create_block(
    payload: BlockCreate,
    teacher: User = Depends(require_teacher),
    db: Session = Depends(get_db),
) -> BlockOut:
    block = QuestionBlock(
        teacher_id=teacher.id,
        name=payload.name.strip(),
        topic=(payload.topic or "").strip() or None,
        level=(payload.level or "").strip() or None,
        ru_style=_clean_style(payload.ru_style),
        visibility=_clean_visibility(payload.visibility, teacher),
        # New modules start live so existing "create = visible" behaviour holds;
        # the editor can move a module back to draft with is_published=false.
        is_published=True,
    )
    db.add(block)
    db.commit()
    db.refresh(block)
    return _to_out(block, 0)


@router.patch("/{block_id}", response_model=BlockOut)
def update_block(
    block_id: uuid.UUID,
    payload: BlockUpdate,
    teacher: User = Depends(require_teacher),
    db: Session = Depends(get_db),
) -> BlockOut:
    block = _owned_block(block_id, teacher, db)
    data = payload.model_dump(exclude_unset=True)
    if "name" in data and data["name"] is not None:
        block.name = data["name"].strip()
    if "topic" in data:
        block.topic = (data["topic"] or "").strip() or None
    if "level" in data:
        block.level = (data["level"] or "").strip() or None
    if "ru_style" in data:
        block.ru_style = _clean_style(data["ru_style"])
    if "is_published" in data and data["is_published"] is not None:
        block.is_published = bool(data["is_published"])
    if "visibility" in data and data["visibility"] is not None:
        block.visibility = _clean_visibility(data["visibility"], teacher)
    db.commit()
    db.refresh(block)
    count = _counts(db, [block.id]).get(block.id, 0)
    return _to_out(block, count)


@router.post("/{block_id}/cover-url", response_model=MediaUploadURL)
def block_cover_url(
    block_id: uuid.UUID,
    payload: MediaUploadRequest,
    teacher: User = Depends(require_teacher),
    db: Session = Depends(get_db),
) -> MediaUploadURL:
    """Presigned PUT for a module cover image; stores the key on the module."""
    block = _owned_block(block_id, teacher, db)
    ext = "jpg" if "jpeg" in payload.content_type else payload.content_type.split("/")[-1]
    key = storage.new_key("covers", ext)
    url = storage.presigned_put(key, payload.content_type)
    block.cover_key = key
    db.commit()
    return MediaUploadURL(upload_url=url, media_key=key)


@router.delete("/{block_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_block(
    block_id: uuid.UUID,
    teacher: User = Depends(require_teacher),
    db: Session = Depends(get_db),
) -> None:
    """Delete a block. Its questions are kept (their block_id is cleared)."""
    block = _owned_block(block_id, teacher, db)
    db.delete(block)
    db.commit()


@router.get("/{block_id}/questions", response_model=list[QuestionOut])
def block_questions(
    block_id: uuid.UUID,
    teacher: User = Depends(require_teacher),
    db: Session = Depends(get_db),
) -> list[QuestionOut]:
    block = _owned_block(block_id, teacher, db)
    items = db.scalars(
        select(Question)
        .where(Question.block_id == block.id, Question.is_deleted.is_(False))
        .order_by(Question.sort_order, Question.created_at)
    ).all()
    return [question_to_out(q) for q in items]


@router.post("/{block_id}/questions", response_model=BlockOut)
def add_questions(
    block_id: uuid.UUID,
    payload: BlockAddQuestions,
    teacher: User = Depends(require_teacher),
    db: Session = Depends(get_db),
) -> BlockOut:
    """Add the teacher's own questions to this block. Empty topic/level/ru_style on
    a question are filled in from the block's defaults."""
    block = _owned_block(block_id, teacher, db)
    stmt = select(Question).where(
        Question.id.in_(payload.question_ids), Question.is_deleted.is_(False)
    )
    if teacher.role != UserRole.admin:
        stmt = stmt.where(Question.teacher_id == teacher.id)
    for q in db.scalars(stmt).all():
        q.block_id = block.id
        if block.ru_style and not q.ru_style:
            q.ru_style = block.ru_style
        if block.topic and not q.topic:
            q.topic = block.topic
        if block.level and not q.level:
            q.level = block.level
    db.commit()
    count = _counts(db, [block.id]).get(block.id, 0)
    return _to_out(block, count)


@router.delete("/{block_id}/questions/{question_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_question(
    block_id: uuid.UUID,
    question_id: uuid.UUID,
    teacher: User = Depends(require_teacher),
    db: Session = Depends(get_db),
) -> None:
    """Detach a single question from a block (the question itself is kept)."""
    block = _owned_block(block_id, teacher, db)
    q = db.get(Question, question_id)
    if q is None or q.block_id != block.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Question not in this block")
    if teacher.role != UserRole.admin and q.teacher_id != teacher.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Question not found")
    q.block_id = None
    db.commit()


@router.post("/reorder", status_code=status.HTTP_204_NO_CONTENT)
def reorder_blocks(
    payload: ReorderIds,
    teacher: User = Depends(require_teacher),
    db: Session = Depends(get_db),
) -> None:
    """Persist a new module order (drag-and-drop): index → sort_order."""
    stmt = select(QuestionBlock).where(QuestionBlock.id.in_(payload.ids))
    if teacher.role != UserRole.admin:
        stmt = stmt.where(QuestionBlock.teacher_id == teacher.id)
    owned = {b.id: b for b in db.scalars(stmt).all()}
    for i, bid in enumerate(payload.ids):
        b = owned.get(bid)
        if b is not None:
            b.sort_order = i
    db.commit()


@router.post("/{block_id}/tasks/reorder", status_code=status.HTTP_204_NO_CONTENT)
def reorder_tasks(
    block_id: uuid.UUID,
    payload: ReorderIds,
    teacher: User = Depends(require_teacher),
    db: Session = Depends(get_db),
) -> None:
    """Persist a new task order within one module (drag-and-drop)."""
    block = _owned_block(block_id, teacher, db)
    q_map = {
        q.id: q
        for q in db.scalars(
            select(Question).where(
                Question.block_id == block.id, Question.id.in_(payload.ids)
            )
        ).all()
    }
    for i, qid in enumerate(payload.ids):
        q = q_map.get(qid)
        if q is not None:
            q.sort_order = i
    db.commit()
