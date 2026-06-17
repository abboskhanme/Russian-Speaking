import csv
import io
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_teacher_or_admin
from app.db.session import get_db
from app.models import Group, GroupMember, Question, Submission, User, UserRole
from app.schemas.report import Analytics, CriterionAvg, GradebookRow

router = APIRouter(prefix="/reports", tags=["reports"])


def _effective_band(sub: Submission) -> float | None:
    if sub.teacher_band is not None:
        return sub.teacher_band
    if sub.evaluation is not None:
        return sub.evaluation.overall_band
    return None


def _relevant_submissions(
    db: Session, user: User, group_id: uuid.UUID | None
) -> list[Submission]:
    stmt = select(Submission)
    if user.role == UserRole.teacher:
        # Only the teacher's own questions AND only their own students (group
        # members) — never a student who doesn't belong to this teacher.
        roster = (
            select(GroupMember.student_id)
            .join(Group, GroupMember.group_id == Group.id)
            .where(Group.teacher_id == user.id)
        )
        stmt = (
            stmt.join(Question, Submission.question_id == Question.id)
            .where(Question.teacher_id == user.id)
            .where(Submission.student_id.in_(roster))
        )
    if group_id is not None:
        member_ids = list(
            db.scalars(select(GroupMember.student_id).where(GroupMember.group_id == group_id)).all()
        )
        if not member_ids:
            return []
        stmt = stmt.where(Submission.student_id.in_(member_ids))
    return list(db.scalars(stmt).all())


def _gradebook(db: Session, subs: list[Submission]) -> list[GradebookRow]:
    agg: dict[uuid.UUID, dict] = {}
    for s in subs:
        r = agg.setdefault(s.student_id, {"attempts": 0, "bands": [], "last": None})
        r["attempts"] += 1
        b = _effective_band(s)
        if b is not None:
            r["bands"].append(b)
        if r["last"] is None or s.created_at > r["last"]:
            r["last"] = s.created_at
    rows: list[GradebookRow] = []
    for sid, r in agg.items():
        u = db.get(User, sid)
        bands = r["bands"]
        rows.append(
            GradebookRow(
                student_id=sid,
                full_name=u.full_name if u else "—",
                email=u.email if u else "",
                attempts=r["attempts"],
                avg_band=round(sum(bands) / len(bands), 2) if bands else None,
                best_band=max(bands) if bands else None,
                last_activity=r["last"],
            )
        )
    rows.sort(key=lambda x: x.full_name.lower())
    return rows


@router.get("/gradebook", response_model=list[GradebookRow])
def gradebook(
    group_id: uuid.UUID | None = Query(default=None),
    user: User = Depends(require_teacher_or_admin),
    db: Session = Depends(get_db),
) -> list[GradebookRow]:
    return _gradebook(db, _relevant_submissions(db, user, group_id))


@router.get("/gradebook.csv")
def gradebook_csv(
    group_id: uuid.UUID | None = Query(default=None),
    user: User = Depends(require_teacher_or_admin),
    db: Session = Depends(get_db),
) -> Response:
    rows = _gradebook(db, _relevant_submissions(db, user, group_id))
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Student", "Email", "Attempts", "Average band", "Best band", "Last activity"])
    for r in rows:
        w.writerow([
            r.full_name,
            r.email,
            r.attempts,
            "" if r.avg_band is None else r.avg_band,
            "" if r.best_band is None else r.best_band,
            r.last_activity.date().isoformat() if r.last_activity else "",
        ])
    return Response(
        content=buf.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=gradebook.csv"},
    )


@router.get("/analytics", response_model=Analytics)
def analytics(
    group_id: uuid.UUID | None = Query(default=None),
    user: User = Depends(require_teacher_or_admin),
    db: Session = Depends(get_db),
) -> Analytics:
    subs = _relevant_submissions(db, user, group_id)
    fl, lx, gr, rel, ov = [], [], [], [], []
    for s in subs:
        ev = s.evaluation
        if ev is None:
            continue
        fl.append(ev.fluency_score)
        lx.append(ev.lexical_score)
        gr.append(ev.grammar_score)
        if ev.relevance_score is not None:
            rel.append(ev.relevance_score)
        b = _effective_band(s)
        if b is not None:
            ov.append(b)

    def avg(xs: list[float]) -> float | None:
        return round(sum(xs) / len(xs), 2) if xs else None

    averages = CriterionAvg(
        fluency=avg(fl), lexical=avg(lx), grammar=avg(gr), relevance=avg(rel), overall=avg(ov)
    )
    cand = {
        "fluency": averages.fluency,
        "lexical": averages.lexical,
        "grammar": averages.grammar,
        "relevance": averages.relevance,
    }
    cand = {k: v for k, v in cand.items() if v is not None}
    weakest = min(cand, key=cand.get) if cand else None

    week_ago = datetime.now(timezone.utc) - timedelta(days=7)
    active = len({s.student_id for s in subs if s.created_at >= week_ago})

    buckets = {"<55": 0, "55–69": 0, "70–84": 0, "85+": 0}
    for s in subs:
        b = _effective_band(s)
        if b is None:
            continue
        if b < 55:
            buckets["<55"] += 1
        elif b < 70:
            buckets["55–69"] += 1
        elif b < 85:
            buckets["70–84"] += 1
        else:
            buckets["85+"] += 1

    return Analytics(
        total_submissions=len(subs),
        evaluated=sum(1 for s in subs if s.evaluation is not None),
        active_students_7d=active,
        student_count=len({s.student_id for s in subs}),
        averages=averages,
        weakest=weakest,
        band_distribution=buckets,
    )
