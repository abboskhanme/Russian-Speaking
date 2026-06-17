import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import require_teacher_or_admin
from app.db.session import get_db
from app.models import Submission, User, UserRole
from app.schemas.user import PremiumUpdate, StudentManageOut

router = APIRouter(prefix="/users", tags=["users"])


def _student_out(student: User, count: int) -> StudentManageOut:
    out = StudentManageOut.model_validate(student)
    out.submission_count = count
    return out


@router.get("/students", response_model=list[StudentManageOut])
def list_students(
    search: str | None = Query(default=None, max_length=100),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    _: User = Depends(require_teacher_or_admin),
    db: Session = Depends(get_db),
) -> list[StudentManageOut]:
    """Students with their attempt counts — for managing premium access."""
    stmt = select(User).where(User.role == UserRole.student)
    if search:
        like = f"%{search.strip()}%"
        stmt = stmt.where(User.full_name.ilike(like) | User.email.ilike(like))
    students = list(db.scalars(stmt.order_by(User.created_at).limit(limit).offset(offset)).all())
    counts = {}
    if students:
        counts = dict(
            db.execute(
                select(Submission.student_id, func.count(Submission.id))
                .where(Submission.student_id.in_([s.id for s in students]))
                .group_by(Submission.student_id)
            ).all()
        )
    return [_student_out(s, counts.get(s.id, 0)) for s in students]


@router.patch("/students/{student_id}/premium", response_model=StudentManageOut)
def set_premium(
    student_id: uuid.UUID,
    payload: PremiumUpdate,
    _: User = Depends(require_teacher_or_admin),
    db: Session = Depends(get_db),
) -> StudentManageOut:
    """Grant or revoke premium access for a student (teacher/admin)."""
    student = db.get(User, student_id)
    if student is None or student.role != UserRole.student:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Student not found")
    student.is_premium = payload.is_premium
    db.commit()
    db.refresh(student)
    count = db.scalar(
        select(func.count(Submission.id)).where(Submission.student_id == student.id)
    ) or 0
    return _student_out(student, count)
