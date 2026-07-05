"""Module-based content access + positional freemium — the restructure's core rules.

REACH (can a student open/see a task):
  * its module is PUBLIC and published        → every student (official curriculum)
  * its module is a published GROUP module of one of the student's teachers
  (assignment / review paths are checked by the callers, not here.)

FREEMIUM (may a NON-premium student ANSWER a reachable task):
  * premium students: always
  * teacher-governed content (group modules): always — the teacher grants premium
    and manages access, so there is no self-serve paywall on their tasks
  * official PUBLIC modules: only the first FREE_TASKS_PER_MODULE tasks (by order);
    the rest need premium
"""

import uuid

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import Group, GroupMember, Question, QuestionBlock, User, UserRole


def student_teacher_ids(db: Session, student_id: uuid.UUID) -> set[uuid.UUID]:
    """Teacher ids of every group the student belongs to."""
    return set(
        db.scalars(
            select(Group.teacher_id)
            .join(GroupMember, GroupMember.group_id == Group.id)
            .where(GroupMember.student_id == student_id)
            .distinct()
        ).all()
    )


def module_reachable(db: Session, student: User, block: QuestionBlock | None) -> bool:
    """Can the student reach content in this module (ignoring assignment/review)?"""
    if block is None or not block.is_published:
        return False
    if block.visibility == "public":
        return True
    return block.teacher_id in student_teacher_ids(db, student.id)


def can_reach(db: Session, student: User, q: Question) -> bool:
    """Module-path reachability for one task (public or the student's teacher's)."""
    if q.block_id is None:
        return False
    block = db.get(QuestionBlock, q.block_id)
    return module_reachable(db, student, block)


def task_index(db: Session, q: Question) -> int:
    """0-based position of the task among its module's published, live siblings —
    ordered the same way students see them (sort_order, then created_at)."""
    if q.block_id is None:
        return 0
    return (
        db.scalar(
            select(func.count(Question.id)).where(
                Question.block_id == q.block_id,
                Question.is_deleted.is_(False),
                Question.is_published.is_(True),
                or_(
                    Question.sort_order < q.sort_order,
                    and_(
                        Question.sort_order == q.sort_order,
                        Question.created_at < q.created_at,
                    ),
                ),
            )
        )
        or 0
    )


def needs_premium(db: Session, student: User, q: Question) -> bool:
    """True when a NON-premium student is blocked from answering this task by the
    positional freemium gate. Only official PUBLIC modules are gated."""
    if student.role != UserRole.student or student.is_premium:
        return False
    block = db.get(QuestionBlock, q.block_id) if q.block_id else None
    if block is None or block.visibility != "public":
        return False  # teacher-governed content is never self-serve paywalled
    n = settings.FREE_TASKS_PER_MODULE
    if n <= 0:
        return False  # 0 = whole module free
    return task_index(db, q) >= n
