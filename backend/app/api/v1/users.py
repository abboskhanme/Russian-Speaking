import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_teacher_or_admin
from app.db.session import get_db
from app.models import Group, GroupMember, Submission, User, UserRole
from app.schemas.user import PremiumUpdate, StudentManageOut, TeacherContactOut
from app.services import notifications

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/my-teachers", response_model=list[TeacherContactOut])
def my_teachers(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[TeacherContactOut]:
    """The current student's teachers (owners of the groups they belong to),
    with contact details for the Contact (Bog'lanish) page."""
    teachers = db.scalars(
        select(User)
        .join(Group, Group.teacher_id == User.id)
        .join(GroupMember, GroupMember.group_id == Group.id)
        .where(GroupMember.student_id == user.id)
        .distinct()
        .order_by(User.full_name)
    ).all()
    return [TeacherContactOut.model_validate(t) for t in teachers]


def _roster_ids(teacher_id):
    """Subquery of student ids in a teacher's groups (their roster)."""
    return (
        select(GroupMember.student_id)
        .join(Group, GroupMember.group_id == Group.id)
        .where(Group.teacher_id == teacher_id)
    )


def _student_out(student: User, count: int) -> StudentManageOut:
    out = StudentManageOut.model_validate(student)
    out.submission_count = count
    return out


@router.get("/students", response_model=list[StudentManageOut])
def list_students(
    search: str | None = Query(default=None, max_length=100),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    teacher_id: uuid.UUID | None = Query(default=None),
    caller: User = Depends(require_teacher_or_admin),
    db: Session = Depends(get_db),
) -> list[StudentManageOut]:
    """Students for premium management. A teacher sees ONLY their own students
    (members of their groups); admin sees everyone, or one teacher's roster when
    `teacher_id` is passed. Students in no group are independent app users."""
    stmt = select(User).where(User.role == UserRole.student)
    if caller.role != UserRole.admin:
        stmt = stmt.where(User.id.in_(_roster_ids(caller.id)))
    elif teacher_id is not None:  # admin drilling into one teacher's roster
        stmt = stmt.where(User.id.in_(_roster_ids(teacher_id)))
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
    caller: User = Depends(require_teacher_or_admin),
    db: Session = Depends(get_db),
) -> StudentManageOut:
    """Grant or revoke premium. A teacher may only manage their own students;
    admin may manage anyone. Notifies the student."""
    student = db.get(User, student_id)
    if student is None or student.role != UserRole.student:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Student not found")
    if caller.role != UserRole.admin:
        in_roster = db.scalar(
            select(GroupMember.id)
            .join(Group, GroupMember.group_id == Group.id)
            .where(Group.teacher_id == caller.id, GroupMember.student_id == student.id)
        )
        if not in_roster:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "This student is not in your group")
    changed = student.is_premium != payload.is_premium
    student.is_premium = payload.is_premium
    if changed:
        notifications.notify(
            db,
            user_id=student.id,
            type="premium",
            title="Premium ochildi" if payload.is_premium else "Premium o'zgartirildi",
            body="Sizga premium kirish berildi 🎉" if payload.is_premium
            else "Premium kirishingiz olib tashlandi.",
            link="/premium",
            commit=False,
        )
    db.commit()
    db.refresh(student)
    count = db.scalar(
        select(func.count(Submission.id)).where(Submission.student_id == student.id)
    ) or 0
    return _student_out(student, count)
