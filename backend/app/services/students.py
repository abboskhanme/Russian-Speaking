from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Group, GroupMember, Submission, User
from app.schemas.admin import AdminStudentDetail, StudentGroupOut, StudentSubmissionOut
from app.services import scoring


def build_student_detail(db: Session, s: User) -> AdminStudentDetail:
    """Full picture of one student: contact info, groups (+ their teacher), tests
    solved with results, and progress stats. Shared by the admin- and
    teacher-facing student-management endpoints."""
    grps = list(
        db.scalars(
            select(Group)
            .join(GroupMember, GroupMember.group_id == Group.id)
            .where(GroupMember.student_id == s.id)
            .order_by(Group.created_at.desc())
        ).all()
    )
    teacher_names = (
        {
            t.id: t.full_name
            for t in db.scalars(select(User).where(User.id.in_({g.teacher_id for g in grps})))
        }
        if grps
        else {}
    )
    groups = [
        StudentGroupOut(id=g.id, name=g.name, teacher_name=teacher_names.get(g.teacher_id))
        for g in grps
    ]

    subs = list(
        db.scalars(
            select(Submission)
            .where(Submission.student_id == s.id, Submission.question_id.is_not(None))
            .order_by(Submission.created_at.desc())
        ).all()
    )
    submissions = [
        StudentSubmissionOut(
            id=x.id,
            question_title=x.question.title if x.question else None,
            topic=x.question.topic if x.question else None,
            band=scoring.effective_band(x),
            status=x.status.value,
            created_at=x.created_at,
        )
        for x in subs[:50]
    ]
    return AdminStudentDetail(
        id=s.id,
        full_name=s.full_name,
        email=s.email,
        phone=s.phone,
        region=s.region,
        district=s.district,
        age=s.age,
        created_at=s.created_at,
        is_active=s.is_active,
        is_premium=s.is_premium,
        xp=s.xp or 0,
        current_streak=s.current_streak or 0,
        longest_streak=s.longest_streak or 0,
        attempts=len(subs),
        avg_band=scoring.rolling_avg(subs),
        best_band=scoring.best_band(subs),
        groups=groups,
        submissions=submissions,
    )
