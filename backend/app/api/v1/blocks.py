import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_teacher
from app.api.v1.questions import _to_out as question_to_out
from app.db.session import get_db
from app.models import Question, QuestionBlock, User, UserRole
from app.schemas.block import (
    RU_STYLES,
    BlockAddQuestions,
    BlockCreate,
    BlockOut,
    BlockUpdate,
    ReorderIds,
)
from app.schemas.question import QuestionOut

router = APIRouter(prefix="/blocks", tags=["blocks"])


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
    db.commit()
    db.refresh(block)
    count = _counts(db, [block.id]).get(block.id, 0)
    return _to_out(block, count)


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
