import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import require_admin
from app.core.security import hash_password
from app.db.session import get_db
from app.models import (
    Question,
    Submission,
    SubmissionStatus,
    User,
    UserRole,
)
from app.schemas.admin import (
    AdminStats,
    AdminStudentDetail,
    StudentCreate,
    StudentOut,
    TeacherCreate,
    TeacherOut,
    TeacherUpdate,
    UserAdminUpdate,
)
from app.services.students import build_student_detail

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/stats", response_model=AdminStats)
def admin_stats(
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> AdminStats:
    return AdminStats(
        teachers=db.scalar(select(func.count(User.id)).where(User.role == UserRole.teacher)) or 0,
        students=db.scalar(select(func.count(User.id)).where(User.role == UserRole.student)) or 0,
        questions=db.scalar(select(func.count(Question.id))) or 0,
        published_questions=db.scalar(
            select(func.count(Question.id)).where(Question.is_published.is_(True))
        ) or 0,
        submissions=db.scalar(select(func.count(Submission.id))) or 0,
        evaluated_submissions=db.scalar(
            select(func.count(Submission.id)).where(Submission.status == SubmissionStatus.done)
        ) or 0,
    )


def _teacher_out(teacher: User, count: int) -> TeacherOut:
    out = TeacherOut.model_validate(teacher)
    out.question_count = count
    return out


@router.get("/teachers", response_model=list[TeacherOut])
def list_teachers(
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> list[TeacherOut]:
    teachers = list(
        db.scalars(select(User).where(User.role == UserRole.teacher).order_by(User.created_at)).all()
    )
    counts = dict(
        db.execute(
            select(Question.teacher_id, func.count(Question.id)).group_by(Question.teacher_id)
        ).all()
    )
    return [_teacher_out(t, counts.get(t.id, 0)) for t in teachers]


@router.post("/teachers", response_model=TeacherOut, status_code=status.HTTP_201_CREATED)
def create_teacher(
    payload: TeacherCreate,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> TeacherOut:
    if db.scalar(select(User).where(User.email == payload.email)):
        raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered")
    teacher = User(
        email=payload.email,
        password_hash=hash_password(payload.password),
        full_name=payload.full_name,
        role=UserRole.teacher,
    )
    db.add(teacher)
    db.commit()
    db.refresh(teacher)
    return _teacher_out(teacher, 0)


@router.patch("/teachers/{teacher_id}", response_model=TeacherOut)
def update_teacher(
    teacher_id: uuid.UUID,
    payload: TeacherUpdate,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> TeacherOut:
    teacher = db.get(User, teacher_id)
    if teacher is None or teacher.role != UserRole.teacher:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Teacher not found")
    if payload.full_name is not None:
        teacher.full_name = payload.full_name
    if payload.is_active is not None:
        teacher.is_active = payload.is_active
    if payload.password:
        teacher.password_hash = hash_password(payload.password)
    db.commit()
    db.refresh(teacher)
    count = db.scalar(
        select(func.count(Question.id)).where(Question.teacher_id == teacher.id)
    ) or 0
    return _teacher_out(teacher, count)


@router.delete("/teachers/{teacher_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_teacher(
    teacher_id: uuid.UUID,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> None:
    teacher = db.get(User, teacher_id)
    if teacher is None or teacher.role != UserRole.teacher:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Teacher not found")
    db.delete(teacher)
    db.commit()


# ─── Students ──────────────────────────────────────────────────────────────
def _student_out(student: User, count: int) -> StudentOut:
    out = StudentOut.model_validate(student)
    out.submission_count = count
    return out


@router.get("/students", response_model=list[StudentOut])
def list_students(
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> list[StudentOut]:
    students = list(
        db.scalars(select(User).where(User.role == UserRole.student).order_by(User.created_at)).all()
    )
    counts = dict(
        db.execute(
            select(Submission.student_id, func.count(Submission.id)).group_by(Submission.student_id)
        ).all()
    )
    return [_student_out(s, counts.get(s.id, 0)) for s in students]


@router.post("/students", response_model=StudentOut, status_code=status.HTTP_201_CREATED)
def create_student(
    payload: StudentCreate,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> StudentOut:
    if db.scalar(select(User).where(User.email == payload.email)):
        raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered")
    student = User(
        email=payload.email,
        password_hash=hash_password(payload.password),
        full_name=payload.full_name,
        role=UserRole.student,
    )
    db.add(student)
    db.commit()
    db.refresh(student)
    return _student_out(student, 0)


@router.patch("/students/{student_id}", response_model=StudentOut)
def update_student(
    student_id: uuid.UUID,
    payload: UserAdminUpdate,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> StudentOut:
    student = db.get(User, student_id)
    if student is None or student.role != UserRole.student:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Student not found")
    if payload.full_name is not None:
        student.full_name = payload.full_name
    if payload.is_active is not None:
        student.is_active = payload.is_active
    if payload.is_premium is not None:
        student.is_premium = payload.is_premium
    if payload.password:
        student.password_hash = hash_password(payload.password)
    db.commit()
    db.refresh(student)
    count = db.scalar(
        select(func.count(Submission.id)).where(Submission.student_id == student.id)
    ) or 0
    return _student_out(student, count)


@router.delete("/students/{student_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_student(
    student_id: uuid.UUID,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> None:
    student = db.get(User, student_id)
    if student is None or student.role != UserRole.student:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Student not found")
    db.delete(student)
    db.commit()


@router.get("/students/{student_id}/detail", response_model=AdminStudentDetail)
def student_detail(
    student_id: uuid.UUID,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> AdminStudentDetail:
    """Full picture of one student: contact info, their groups (+ teacher),
    tests solved with results, and progress stats."""
    s = db.get(User, student_id)
    if s is None or s.role != UserRole.student:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Student not found")
    return build_student_detail(db, s)
