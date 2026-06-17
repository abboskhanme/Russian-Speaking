import secrets
import uuid
from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_teacher
from app.db.session import get_db
from app.models import Assignment, Group, GroupMember, Question, Submission, User, UserRole
from app.schemas.group import (
    AddMembers,
    GroupCreate,
    GroupDetailOut,
    GroupMemberOut,
    GroupOut,
    GroupOverview,
    GroupTask,
    GroupUpdate,
    JoinGroup,
    MemberStat,
    TaskDueUpdate,
    TaskStudent,
)
from app.services import notifications


def _eff_band(s: Submission) -> float | None:
    if s.teacher_band is not None:
        return s.teacher_band
    if s.evaluation is not None:
        return s.evaluation.overall_band
    return None

router = APIRouter(prefix="/groups", tags=["groups"])

# Unambiguous code alphabet (no 0/O/1/I).
_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def _gen_code(db: Session) -> str:
    while True:
        code = "".join(secrets.choice(_ALPHABET) for _ in range(6))
        if not db.scalar(select(Group).where(Group.join_code == code)):
            return code


def _group_out(db: Session, g: Group) -> GroupOut:
    count = db.scalar(select(func.count(GroupMember.id)).where(GroupMember.group_id == g.id)) or 0
    teacher = db.get(User, g.teacher_id)
    return GroupOut(
        id=g.id,
        name=g.name,
        join_code=g.join_code,
        member_count=count,
        teacher_name=teacher.full_name if teacher else None,
        created_at=g.created_at,
    )


def _group_detail(db: Session, g: Group) -> GroupDetailOut:
    member_ids = list(
        db.scalars(select(GroupMember.student_id).where(GroupMember.group_id == g.id)).all()
    )
    counts: dict[uuid.UUID, int] = {}
    if member_ids:
        counts = dict(
            db.execute(
                select(Submission.student_id, func.count(Submission.id))
                .where(Submission.student_id.in_(member_ids))
                .group_by(Submission.student_id)
            ).all()
        )
    users = {
        u.id: u for u in db.scalars(select(User).where(User.id.in_(member_ids)))
    } if member_ids else {}
    members = []
    for sid in member_ids:
        u = users.get(sid)
        if u:
            members.append(
                GroupMemberOut(
                    id=u.id,
                    full_name=u.full_name,
                    email=u.email,
                    is_premium=u.is_premium,
                    submission_count=counts.get(sid, 0),
                )
            )
    base = _group_out(db, g)
    return GroupDetailOut(**base.model_dump(), members=members)


@router.post("", response_model=GroupOut, status_code=status.HTTP_201_CREATED)
def create_group(
    payload: GroupCreate,
    teacher: User = Depends(require_teacher),
    db: Session = Depends(get_db),
) -> GroupOut:
    g = Group(teacher_id=teacher.id, name=payload.name.strip() or "Группа", join_code=_gen_code(db))
    db.add(g)
    db.commit()
    db.refresh(g)
    return _group_out(db, g)


@router.get("", response_model=list[GroupOut])
def list_groups(
    teacher: User = Depends(require_teacher),
    db: Session = Depends(get_db),
) -> list[GroupOut]:
    stmt = select(Group).order_by(Group.created_at.desc())
    if teacher.role != UserRole.admin:  # admin sees every teacher's groups
        stmt = stmt.where(Group.teacher_id == teacher.id)
    gs = db.scalars(stmt).all()
    return [_group_out(db, g) for g in gs]


@router.get("/mine", response_model=list[GroupOut])
def my_groups(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[GroupOut]:
    gids = db.scalars(select(GroupMember.group_id).where(GroupMember.student_id == user.id)).all()
    gs = db.scalars(select(Group).where(Group.id.in_(gids))).all() if gids else []
    return [_group_out(db, g) for g in gs]


@router.post("/join", response_model=GroupOut)
def join_group(
    payload: JoinGroup,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> GroupOut:
    g = db.scalar(select(Group).where(Group.join_code == payload.code.strip().upper()))
    if g is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invalid group code")
    exists = db.scalar(
        select(GroupMember).where(GroupMember.group_id == g.id, GroupMember.student_id == user.id)
    )
    if not exists:
        db.add(GroupMember(group_id=g.id, student_id=user.id))
        # Tell the group's teacher a new student joined.
        notifications.notify(
            db,
            user_id=g.teacher_id,
            type="group_joined",
            title="Yangi o'quvchi",
            body=f"{user.full_name} «{g.name}» guruhiga qo'shildi.",
            link=f"/teacher/groups/{g.id}",
            commit=False,
        )
        db.commit()
    return _group_out(db, g)


@router.get("/{group_id}", response_model=GroupDetailOut)
def group_detail(
    group_id: uuid.UUID,
    teacher: User = Depends(require_teacher),
    db: Session = Depends(get_db),
) -> GroupDetailOut:
    g = db.get(Group, group_id)
    if g is None or (teacher.role != UserRole.admin and g.teacher_id != teacher.id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Group not found")
    return _group_detail(db, g)


@router.get("/{group_id}/overview", response_model=GroupOverview)
def group_overview(
    group_id: uuid.UUID,
    teacher: User = Depends(require_teacher),
    db: Session = Depends(get_db),
) -> GroupOverview:
    """Per-group statistics: member progress + who did / didn't do each task."""
    g = db.get(Group, group_id)
    if g is None or (teacher.role != UserRole.admin and g.teacher_id != teacher.id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Group not found")

    member_ids = list(
        db.scalars(select(GroupMember.student_id).where(GroupMember.group_id == g.id)).all()
    )
    users = {
        u.id: u for u in db.scalars(select(User).where(User.id.in_(member_ids)))
    } if member_ids else {}

    subs: list[Submission] = []
    if member_ids:
        subs = list(db.scalars(select(Submission).where(Submission.student_id.in_(member_ids))).all())
    by_student: dict[uuid.UUID, list[Submission]] = defaultdict(list)
    by_sq: dict[tuple, list[Submission]] = defaultdict(list)
    for s in subs:
        by_student[s.student_id].append(s)
        by_sq[(s.student_id, s.question_id)].append(s)

    def completed_for(sid, qid, since):
        for s in by_sq.get((sid, qid), []):
            if s.created_at >= since:
                return s
        return None

    assigns: list[Assignment] = []
    if member_ids:
        assigns = list(
            db.scalars(
                select(Assignment).where(
                    Assignment.group_id == g.id, Assignment.student_id.in_(member_ids)
                )
            ).all()
        )
    # Submissions tied to THIS group's assignments — the basis for class ratings.
    group_assignment_ids = {a.id for a in assigns}
    task_map: dict[uuid.UUID, dict] = {}
    for a in assigns:
        info = task_map.setdefault(
            a.question_id, {"due_at": a.due_at, "created_at": a.created_at, "students": {}}
        )
        info["students"][a.student_id] = a

    tasks: list[GroupTask] = []
    m_total: dict[uuid.UUID, int] = defaultdict(int)
    m_done: dict[uuid.UUID, int] = defaultdict(int)
    questions = {
        q.id: q
        for q in db.scalars(select(Question).where(Question.id.in_(task_map.keys())))
    } if task_map else {}
    for qid, info in task_map.items():
        q = questions.get(qid)
        students: list[TaskStudent] = []
        done = 0
        for sid, a in info["students"].items():
            u = users.get(sid)
            s = completed_for(sid, qid, a.created_at)
            comp = s is not None
            done += 1 if comp else 0
            m_total[sid] += 1
            if comp:
                m_done[sid] += 1
            students.append(
                TaskStudent(
                    student_id=sid,
                    full_name=u.full_name if u else "—",
                    completed=comp,
                    submission_id=s.id if s else None,
                    band=_eff_band(s) if s else None,
                )
            )
        students.sort(key=lambda x: (x.completed, x.full_name.lower()))  # not-done first
        tasks.append(
            GroupTask(
                question_id=qid,
                question_title=q.title if q else None,
                question_topic=q.topic if q else None,
                due_at=info["due_at"],
                created_at=info["created_at"],
                total=len(info["students"]),
                done=done,
                students=students,
            )
        )
    tasks.sort(key=lambda x: x.created_at, reverse=True)

    members: list[MemberStat] = []
    all_bands: list[float] = []
    for sid in member_ids:
        u = users.get(sid)
        slist = by_student.get(sid, [])
        # Class rating: only this group's assigned-task submissions count.
        graded = [s for s in slist if s.assignment_id in group_assignment_ids]
        bands = [b for b in (_eff_band(s) for s in graded) if b is not None]
        all_bands += bands
        last = max((s.created_at for s in slist), default=None)
        members.append(
            MemberStat(
                id=sid,
                full_name=u.full_name if u else "—",
                avg_band=round(sum(bands) / len(bands), 2) if bands else None,
                attempts=len(slist),
                tasks_done=m_done.get(sid, 0),
                tasks_total=m_total.get(sid, 0),
                last_activity=last,
            )
        )
    members.sort(key=lambda x: x.full_name.lower())

    return GroupOverview(
        id=g.id,
        name=g.name,
        join_code=g.join_code,
        member_count=len(member_ids),
        avg_band=round(sum(all_bands) / len(all_bands), 2) if all_bands else None,
        members=members,
        tasks=tasks,
    )


@router.post("/{group_id}/members", response_model=GroupDetailOut)
def add_members(
    group_id: uuid.UUID,
    payload: AddMembers,
    teacher: User = Depends(require_teacher),
    db: Session = Depends(get_db),
) -> GroupDetailOut:
    g = db.get(Group, group_id)
    if g is None or (teacher.role != UserRole.admin and g.teacher_id != teacher.id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Group not found")
    valid_ids = set(
        db.scalars(
            select(User.id).where(
                User.id.in_(payload.student_ids), User.role == UserRole.student
            )
        ).all()
    )
    existing = set(
        db.scalars(
            select(GroupMember.student_id).where(
                GroupMember.group_id == g.id, GroupMember.student_id.in_(valid_ids)
            )
        ).all()
    )
    for sid in valid_ids - existing:
        db.add(GroupMember(group_id=g.id, student_id=sid))
        # Tell the student they were added to a class.
        notifications.notify(
            db,
            user_id=sid,
            type="group_added",
            title="Guruhga qo'shildingiz",
            body=f"Siz «{g.name}» guruhiga qo'shildingiz.",
            link="/assignments",
            commit=False,
        )
    db.commit()
    return _group_detail(db, g)


@router.delete("/{group_id}/members/{student_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_member(
    group_id: uuid.UUID,
    student_id: uuid.UUID,
    teacher: User = Depends(require_teacher),
    db: Session = Depends(get_db),
) -> None:
    g = db.get(Group, group_id)
    if g is None or (teacher.role != UserRole.admin and g.teacher_id != teacher.id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Group not found")
    m = db.scalar(
        select(GroupMember).where(
            GroupMember.group_id == group_id, GroupMember.student_id == student_id
        )
    )
    if m:
        db.delete(m)
        db.commit()


@router.post("/{group_id}/regenerate", response_model=GroupOut)
def regenerate_code(
    group_id: uuid.UUID,
    teacher: User = Depends(require_teacher),
    db: Session = Depends(get_db),
) -> GroupOut:
    g = db.get(Group, group_id)
    if g is None or (teacher.role != UserRole.admin and g.teacher_id != teacher.id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Group not found")
    g.join_code = _gen_code(db)
    db.commit()
    db.refresh(g)
    return _group_out(db, g)


@router.patch("/{group_id}", response_model=GroupOut)
def update_group(
    group_id: uuid.UUID,
    payload: GroupUpdate,
    teacher: User = Depends(require_teacher),
    db: Session = Depends(get_db),
) -> GroupOut:
    g = db.get(Group, group_id)
    if g is None or (teacher.role != UserRole.admin and g.teacher_id != teacher.id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Group not found")
    name = payload.name.strip()
    if name:
        g.name = name
    db.commit()
    db.refresh(g)
    return _group_out(db, g)


@router.delete("/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_group(
    group_id: uuid.UUID,
    teacher: User = Depends(require_teacher),
    db: Session = Depends(get_db),
) -> None:
    g = db.get(Group, group_id)
    if g is None or (teacher.role != UserRole.admin and g.teacher_id != teacher.id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Group not found")
    db.delete(g)
    db.commit()


def _owned_group(db: Session, group_id: uuid.UUID, teacher: User) -> Group:
    g = db.get(Group, group_id)
    if g is None or (teacher.role != UserRole.admin and g.teacher_id != teacher.id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Group not found")
    return g


@router.patch("/{group_id}/tasks/{question_id}", status_code=status.HTTP_204_NO_CONTENT)
def update_group_task(
    group_id: uuid.UUID,
    question_id: uuid.UUID,
    payload: TaskDueUpdate,
    teacher: User = Depends(require_teacher),
    db: Session = Depends(get_db),
) -> None:
    """Change the due date of a task assigned to the whole group."""
    _owned_group(db, group_id, teacher)
    rows = db.scalars(
        select(Assignment).where(
            Assignment.group_id == group_id, Assignment.question_id == question_id
        )
    ).all()
    for a in rows:
        a.due_at = payload.due_at
    db.commit()


@router.delete("/{group_id}/tasks/{question_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_group_task(
    group_id: uuid.UUID,
    question_id: uuid.UUID,
    teacher: User = Depends(require_teacher),
    db: Session = Depends(get_db),
) -> None:
    """Un-assign a task from the whole group (removes its assignments)."""
    _owned_group(db, group_id, teacher)
    rows = db.scalars(
        select(Assignment).where(
            Assignment.group_id == group_id, Assignment.question_id == question_id
        )
    ).all()
    for a in rows:
        db.delete(a)
    db.commit()
