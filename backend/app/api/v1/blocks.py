import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_teacher_or_admin
from app.db.session import get_db
from app.models import Block, Question, User, UserRole
from app.schemas.block import (
    BlockAddQuestions,
    BlockCreate,
    BlockOut,
    BlockUpdate,
    ReorderIds,
)

router = APIRouter(prefix="/blocks", tags=["blocks"])


def _task_counts(db: Session, block_ids: list[uuid.UUID], *, student: bool) -> dict:
    """Map block_id → number of tasks. Students only count OPEN published tasks
    (what they can actually reach); teachers/admin count all live tasks."""
    if not block_ids:
        return {}
    stmt = (
        select(Question.block_id, func.count(Question.id))
        .where(Question.block_id.in_(block_ids), Question.is_deleted.is_(False))
        .group_by(Question.block_id)
    )
    if student:
        stmt = stmt.where(Question.is_published.is_(True), Question.is_public.is_(True))
    return {bid: n for bid, n in db.execute(stmt).all()}


def _out(block: Block, count: int) -> BlockOut:
    o = BlockOut.model_validate(block)
    o.task_count = count
    return o


@router.get("", response_model=list[BlockOut])
def list_blocks(
    register: str | None = Query(default=None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[BlockOut]:
    """Students see PUBLISHED blocks (any teacher); teachers see their own; admin
    all. Ordered by sort_order then name. Optional ?register= filter."""
    stmt = select(Block)
    if user.role == UserRole.student:
        stmt = stmt.where(Block.is_published.is_(True))
    elif user.role == UserRole.teacher:
        stmt = stmt.where(Block.teacher_id == user.id)
    if register is not None:
        stmt = stmt.where(Block.register == register)
    stmt = stmt.order_by(Block.sort_order, Block.name)
    blocks = list(db.scalars(stmt).all())
    counts = _task_counts(db, [b.id for b in blocks], student=user.role == UserRole.student)
    out = [_out(b, counts.get(b.id, 0)) for b in blocks]
    # Hide empty blocks from students (nothing to practise there yet).
    if user.role == UserRole.student:
        out = [o for o in out if o.task_count > 0]
    return out


@router.post("/reorder", status_code=status.HTTP_204_NO_CONTENT)
def reorder_blocks(
    payload: ReorderIds,
    teacher: User = Depends(require_teacher_or_admin),
    db: Session = Depends(get_db),
) -> None:
    """Persist a new module order (drag-and-drop): index → sort_order."""
    stmt = select(Block).where(Block.id.in_(payload.ids))
    if teacher.role != UserRole.admin:
        stmt = stmt.where(Block.teacher_id == teacher.id)
    owned = {b.id: b for b in db.scalars(stmt).all()}
    for i, bid in enumerate(payload.ids):
        b = owned.get(bid)
        if b is not None:
            b.sort_order = i
    db.commit()


@router.post("", response_model=BlockOut, status_code=status.HTTP_201_CREATED)
def create_block(
    payload: BlockCreate,
    teacher: User = Depends(require_teacher_or_admin),
    db: Session = Depends(get_db),
) -> BlockOut:
    block = Block(teacher_id=teacher.id, **payload.model_dump())
    db.add(block)
    db.commit()
    db.refresh(block)
    return _out(block, 0)


def _owned_block(db: Session, block_id: uuid.UUID, user: User) -> Block:
    block = db.get(Block, block_id)
    if block is None or (user.role != UserRole.admin and block.teacher_id != user.id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Block not found")
    return block


@router.patch("/{block_id}", response_model=BlockOut)
def update_block(
    block_id: uuid.UUID,
    payload: BlockUpdate,
    teacher: User = Depends(require_teacher_or_admin),
    db: Session = Depends(get_db),
) -> BlockOut:
    block = _owned_block(db, block_id, teacher)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(block, field, value)
    db.commit()
    db.refresh(block)
    counts = _task_counts(db, [block.id], student=False)
    return _out(block, counts.get(block.id, 0))


@router.delete("/{block_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_block(
    block_id: uuid.UUID,
    teacher: User = Depends(require_teacher_or_admin),
    db: Session = Depends(get_db),
) -> None:
    block = _owned_block(db, block_id, teacher)
    db.delete(block)  # questions.block_id → NULL (SET NULL); tasks survive
    db.commit()


@router.post("/{block_id}/questions", response_model=BlockOut)
def add_questions(
    block_id: uuid.UUID,
    payload: BlockAddQuestions,
    teacher: User = Depends(require_teacher_or_admin),
    db: Session = Depends(get_db),
) -> BlockOut:
    """Move the given (owned) tasks into this block."""
    block = _owned_block(db, block_id, teacher)
    stmt = select(Question).where(
        Question.id.in_(payload.question_ids), Question.is_deleted.is_(False)
    )
    if teacher.role != UserRole.admin:
        stmt = stmt.where(Question.teacher_id == teacher.id)
    for q in db.scalars(stmt).all():
        q.block_id = block.id
    db.commit()
    counts = _task_counts(db, [block.id], student=False)
    return _out(block, counts.get(block.id, 0))


@router.post("/{block_id}/tasks/reorder", status_code=status.HTTP_204_NO_CONTENT)
def reorder_tasks(
    block_id: uuid.UUID,
    payload: ReorderIds,
    teacher: User = Depends(require_teacher_or_admin),
    db: Session = Depends(get_db),
) -> None:
    """Persist a new task order within one module (drag-and-drop)."""
    block = _owned_block(db, block_id, teacher)
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
