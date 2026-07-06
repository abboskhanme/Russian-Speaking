import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_current_user, require_teacher
from app.db.session import get_db
from app.models import (
    Assignment,
    Group,
    GroupMember,
    Question,
    QuestionBlock,
    ReviewItem,
    Submission,
    User,
    UserRole,
    XpEvent,
)
from app.schemas.gamification import (
    AssignmentCreate,
    AssignmentOut,
    LeaderboardEntry,
    ModuleAssignmentCreate,
    ReviewItemCreate,
    ReviewItemOut,
)
from app.services import notifications, scoring

router = APIRouter(tags=["engagement"])


# ─── Leaderboard ───────────────────────────────────────────────────────────
@router.get("/leaderboard", response_model=list[LeaderboardEntry])
def leaderboard(
    group_id: uuid.UUID | None = Query(default=None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[LeaderboardEntry]:
    """Ranked by weekly XP then all-time XP.

    Global (no group_id): every student, ranked by ALL their XP (open tasks,
    assigned tasks and practice mixed). Group/class (group_id): only that group's
    members, ranked by XP earned on this group's ASSIGNED (internal) tasks only."""
    week_ago = datetime.now(timezone.utc) - timedelta(days=7)

    # ── Group/class leaderboard: scored from this group's ASSIGNED tasks only ──
    if group_id is not None:
        if user.role == UserRole.student:
            is_member = db.scalar(
                select(GroupMember.id).where(
                    GroupMember.group_id == group_id, GroupMember.student_id == user.id
                )
            )
            if not is_member:
                raise HTTPException(status.HTTP_403_FORBIDDEN, "Not a member of this group")
        members = list(
            db.scalars(
                select(User)
                .join(GroupMember, GroupMember.student_id == User.id)
                .where(GroupMember.group_id == group_id, User.role == UserRole.student)
            ).all()
        )
        # XP from submissions linked to an assignment belonging to THIS group.
        rows = db.execute(
            select(XpEvent.student_id, XpEvent.amount, XpEvent.created_at)
            .join(Submission, XpEvent.submission_id == Submission.id)
            .join(Assignment, Submission.assignment_id == Assignment.id)
            .where(Assignment.group_id == group_id)
        ).all()
        total: dict = {}
        weekly: dict = {}
        for sid, amt, created in rows:
            total[sid] = total.get(sid, 0) + (amt or 0)
            if created and created >= week_ago:
                weekly[sid] = weekly.get(sid, 0) + (amt or 0)
        ranked = sorted(
            members, key=lambda s: (weekly.get(s.id, 0), total.get(s.id, 0)), reverse=True
        )
        return [
            LeaderboardEntry(
                rank=i,
                id=s.id,
                full_name=s.full_name,
                xp=total.get(s.id, 0),
                weekly_xp=weekly.get(s.id, 0),
                current_streak=s.current_streak or 0,
                is_me=(s.id == user.id),
            )
            for i, s in enumerate(ranked[:50], start=1)
        ]

    # ── Global leaderboard: all students, all XP ──
    scope = [User.role == UserRole.student]
    # Rank in SQL (weekly XP, then all-time XP) so we never load every student.
    weekly_sq = (
        select(XpEvent.student_id, func.sum(XpEvent.amount).label("weekly_xp"))
        .where(XpEvent.created_at >= week_ago)
        .group_by(XpEvent.student_id)
        .subquery()
    )
    weekly_col = func.coalesce(weekly_sq.c.weekly_xp, 0)
    xp_col = func.coalesce(User.xp, 0)
    ranked_q = (
        select(User, weekly_col.label("weekly_xp"))
        .outerjoin(weekly_sq, weekly_sq.c.student_id == User.id)
        .where(*scope)
        .order_by(weekly_col.desc(), xp_col.desc())
        .limit(50)
    )
    rows = db.execute(ranked_q).all()
    top = [
        LeaderboardEntry(
            rank=i,
            id=s.id,
            full_name=s.full_name,
            xp=s.xp or 0,
            weekly_xp=int(w or 0),
            current_streak=s.current_streak or 0,
            is_me=(s.id == user.id),
        )
        for i, (s, w) in enumerate(rows, start=1)
    ]
    if user.role == UserRole.student and not any(e.is_me for e in top):
        my_weekly = int(
            db.scalar(
                select(func.coalesce(func.sum(XpEvent.amount), 0)).where(
                    XpEvent.student_id == user.id, XpEvent.created_at >= week_ago
                )
            )
            or 0
        )
        # rank = students (within scope) strictly ahead of me + 1
        better = db.scalar(
            select(func.count())
            .select_from(User)
            .outerjoin(weekly_sq, weekly_sq.c.student_id == User.id)
            .where(
                *scope,
                (weekly_col > my_weekly)
                | ((weekly_col == my_weekly) & (xp_col > (user.xp or 0))),
            )
        )
        top.append(
            LeaderboardEntry(
                rank=int(better or 0) + 1,
                id=user.id,
                full_name=user.full_name,
                xp=user.xp or 0,
                weekly_xp=my_weekly,
                current_streak=user.current_streak or 0,
                is_me=True,
            )
        )
    return top


# ─── Spaced-repetition review ──────────────────────────────────────────────
@router.get("/review", response_model=list[ReviewItemOut])
def my_reviews(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ReviewItemOut]:
    now = datetime.now(timezone.utc)
    items = db.scalars(
        select(ReviewItem)
        .where(
            ReviewItem.student_id == user.id,
            ReviewItem.completed.is_(False),
            ReviewItem.due_at <= now,
        )
        .order_by(ReviewItem.due_at)
    ).all()
    qmap = {
        q.id: q
        for q in db.scalars(
            select(Question).where(Question.id.in_({it.question_id for it in items}))
        )
    } if items else {}
    out: list[ReviewItemOut] = []
    seen: set[uuid.UUID] = set()
    for it in items:
        if it.question_id in seen:
            continue
        seen.add(it.question_id)
        q = qmap.get(it.question_id)
        out.append(
            ReviewItemOut(
                id=it.id,
                question_id=it.question_id,
                question_title=q.title if q else None,
                question_topic=q.topic if q else None,
                question_level=q.level if q else None,
                weakness_dim=it.weakness_dim,
                due_at=it.due_at,
            )
        )
    return out


@router.post("/review", response_model=list[ReviewItemOut], status_code=status.HTTP_201_CREATED)
def create_reviews(
    payload: ReviewItemCreate,
    teacher: User = Depends(require_teacher),
    db: Session = Depends(get_db),
) -> list[ReviewItemOut]:
    """Teacher adds question(s) to a student's (or whole group's) review queue.

    Items surface immediately (due now) and are tagged 'teacher'. Duplicates of an
    already-pending item for the same (student, question) are skipped."""
    # Validate the questions belong to this teacher (admin: any).
    qstmt = select(Question).where(Question.id.in_(payload.question_ids))
    if teacher.role != UserRole.admin:
        qstmt = qstmt.where(Question.teacher_id == teacher.id)
    questions = {q.id: q for q in db.scalars(qstmt).all()}
    if not questions:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No matching questions")

    # Resolve target students: explicit ids ∪ a whole group's members.
    target_ids = set(payload.student_ids)
    if payload.group_id is not None:
        target_ids.update(
            db.scalars(
                select(GroupMember.student_id).where(GroupMember.group_id == payload.group_id)
            ).all()
        )
    # A teacher may only queue reviews for their OWN students (members of a group
    # they own); admins may target anyone. Without this, a teacher could inject
    # review items into any student's queue — and, since a pending review item
    # unlocks submission of an assigned task, grant access to students they don't
    # teach. Filtering target_ids through the roster covers both the explicit
    # student_ids and group_id paths.
    stmt = select(User.id).where(User.id.in_(target_ids), User.role == UserRole.student)
    if teacher.role != UserRole.admin:
        roster = (
            select(GroupMember.student_id)
            .join(Group, GroupMember.group_id == Group.id)
            .where(Group.teacher_id == teacher.id)
        )
        stmt = stmt.where(User.id.in_(roster))
    valid_ids = set(db.scalars(stmt).all())
    if not valid_ids:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No target students")

    now = datetime.now(timezone.utc)
    created: list[ReviewItem] = []
    for sid in valid_ids:
        made = 0
        for qid in questions:
            # Skip if an identical pending review already exists.
            exists = db.scalar(
                select(ReviewItem.id).where(
                    ReviewItem.student_id == sid,
                    ReviewItem.question_id == qid,
                    ReviewItem.completed.is_(False),
                )
            )
            if exists:
                continue
            item = ReviewItem(
                student_id=sid,
                question_id=qid,
                weakness_dim="teacher",
                interval_index=0,
                due_at=now,
                completed=False,
            )
            db.add(item)
            created.append(item)
            made += 1
        # Only ping the student when something was actually added — re-adding
        # questions they already have pending must not spam a notification.
        if made:
            notifications.notify(
                db,
                user_id=sid,
                type="review_added",
                title="Takrorlash uchun yangi mashqlar",
                body="O'qituvchi sizga takrorlash uchun mashq(lar) qo'shdi.",
                link="/review",
                commit=False,
            )
    db.commit()
    for it in created:
        db.refresh(it)
    out: list[ReviewItemOut] = []
    for it in created:
        q = questions.get(it.question_id)
        out.append(
            ReviewItemOut(
                id=it.id,
                question_id=it.question_id,
                question_title=q.title if q else None,
                question_topic=q.topic if q else None,
                question_level=q.level if q else None,
                weakness_dim=it.weakness_dim,
                due_at=it.due_at,
            )
        )
    return out


# ─── Assignments ───────────────────────────────────────────────────────────
def _assignments_out(db: Session, items: list[Assignment]) -> list[AssignmentOut]:
    """Serialize assignments with bulk lookups (3 queries total, not 3 per row)."""
    if not items:
        return []
    student_ids = {a.student_id for a in items}
    question_ids = {a.question_id for a in items}
    students = {
        u.id: u for u in db.scalars(select(User).where(User.id.in_(student_ids)))
    }
    questions = {
        q.id: q for q in db.scalars(select(Question).where(Question.id.in_(question_ids)))
    }
    # Latest matching submission per (student, question), newest first so the
    # first hit wins.
    subs = db.scalars(
        select(Submission)
        .options(selectinload(Submission.evaluation))
        .where(
            Submission.student_id.in_(student_ids),
            Submission.question_id.in_(question_ids),
        )
        .order_by(Submission.created_at.desc())
    ).all()

    out: list[AssignmentOut] = []
    for a in items:
        sub = next(
            (
                s
                for s in subs
                if s.student_id == a.student_id
                and s.question_id == a.question_id
                and s.created_at >= a.created_at
            ),
            None,
        )
        student = students.get(a.student_id)
        q = questions.get(a.question_id)
        out.append(
            AssignmentOut(
                id=a.id,
                student_id=a.student_id,
                student_name=student.full_name if student else None,
                question_id=a.question_id,
                question_title=q.title if q else None,
                question_topic=q.topic if q else None,
                question_level=q.level if q else None,
                due_at=a.due_at,
                created_at=a.created_at,
                completed=sub is not None,
                submission_id=sub.id if sub else None,
                # Level-relative score (not the absolute band) — one consistent
                # number everywhere. Field name kept for API compatibility.
                overall_band=scoring.effective_band(sub) if sub else None,
            )
        )
    return out


@router.post("/assignments", response_model=list[AssignmentOut], status_code=status.HTTP_201_CREATED)
def create_assignments(
    payload: AssignmentCreate,
    teacher: User = Depends(require_teacher),
    db: Session = Depends(get_db),
) -> list[AssignmentOut]:
    q = db.get(Question, payload.question_id)
    if q is None or (teacher.role != UserRole.admin and q.teacher_id != teacher.id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Question not found")
    # In the module model any of the teacher's own tasks can be assigned with a
    # deadline (the old open-vs-assigned distinction is gone).

    # Resolve the target students: explicit ids ∪ a whole group's members.
    target_ids = set(payload.student_ids)
    if payload.group_id is not None:
        member_ids = db.scalars(
            select(GroupMember.student_id).where(GroupMember.group_id == payload.group_id)
        ).all()
        target_ids.update(member_ids)

    valid_ids = set(
        db.scalars(
            select(User.id).where(User.id.in_(target_ids), User.role == UserRole.student)
        ).all()
    )
    created: list[Assignment] = []
    for sid in valid_ids:
        a = Assignment(
            teacher_id=teacher.id,
            student_id=sid,
            question_id=payload.question_id,
            group_id=payload.group_id,
            due_at=payload.due_at,
        )
        db.add(a)
        created.append(a)
        # Notify the student about the new assignment.
        notifications.notify(
            db,
            user_id=sid,
            type="assignment_new",
            title="Yangi topshiriq",
            body=f"Sizga yangi topshiriq berildi: «{q.title}»",
            link="/assignments",
            commit=False,
        )
    db.commit()
    for a in created:
        db.refresh(a)
    return _assignments_out(db, created)


def _resolve_students(db: Session, student_ids: list[uuid.UUID], group_id: uuid.UUID | None) -> set[uuid.UUID]:
    target = set(student_ids)
    if group_id is not None:
        target.update(
            db.scalars(select(GroupMember.student_id).where(GroupMember.group_id == group_id)).all()
        )
    return set(
        db.scalars(select(User.id).where(User.id.in_(target), User.role == UserRole.student)).all()
    )


@router.post("/assignments/module", response_model=list[AssignmentOut], status_code=status.HTTP_201_CREATED)
def create_module_assignments(
    payload: ModuleAssignmentCreate,
    teacher: User = Depends(require_teacher),
    db: Session = Depends(get_db),
) -> list[AssignmentOut]:
    """Assign every published task of a module to a group / students in one go."""
    block = db.get(QuestionBlock, payload.block_id)
    if block is None or (teacher.role != UserRole.admin and block.teacher_id != teacher.id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Module not found")

    tasks = list(
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
    if not tasks:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Module has no published tasks")

    student_ids = _resolve_students(db, payload.student_ids, payload.group_id)
    qids = [q.id for q in tasks]
    created: list[Assignment] = []
    for sid in student_ids:
        # Skip tasks this student already has an assignment for (avoid duplicates
        # on re-assigning the same module).
        existing = set(
            db.scalars(
                select(Assignment.question_id).where(
                    Assignment.student_id == sid, Assignment.question_id.in_(qids)
                )
            ).all()
        )
        for q in tasks:
            if q.id in existing:
                continue
            a = Assignment(
                teacher_id=teacher.id,
                student_id=sid,
                question_id=q.id,
                group_id=payload.group_id,
                due_at=payload.due_at,
            )
            db.add(a)
            created.append(a)
        # One notification per student for the whole module.
        notifications.notify(
            db,
            user_id=sid,
            type="assignment_new",
            title="Yangi modul",
            body=f"Sizga yangi modul biriktirildi: «{block.name}»",
            link="/assignments",
            commit=False,
        )
    db.commit()
    for a in created:
        db.refresh(a)
    return _assignments_out(db, created)


@router.get("/assignments", response_model=list[AssignmentOut])
def list_assignments_teacher(
    teacher: User = Depends(require_teacher),
    db: Session = Depends(get_db),
) -> list[AssignmentOut]:
    stmt = select(Assignment).order_by(Assignment.created_at.desc())
    if teacher.role != UserRole.admin:  # admin sees every teacher's assignments
        stmt = stmt.where(Assignment.teacher_id == teacher.id)
    items = db.scalars(stmt).all()
    return _assignments_out(db, list(items))


@router.get("/assignments/mine", response_model=list[AssignmentOut])
def list_assignments_student(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[AssignmentOut]:
    items = db.scalars(
        select(Assignment).where(Assignment.student_id == user.id).order_by(Assignment.created_at.desc())
    ).all()
    return _assignments_out(db, list(items))


@router.delete("/assignments/{assignment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_assignment(
    assignment_id: uuid.UUID,
    teacher: User = Depends(require_teacher),
    db: Session = Depends(get_db),
) -> None:
    a = db.get(Assignment, assignment_id)
    if a is None or (teacher.role != UserRole.admin and a.teacher_id != teacher.id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Assignment not found")
    db.delete(a)
    db.commit()
