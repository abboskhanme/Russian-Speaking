"""XP, streaks (with freezes), and spaced-repetition review scheduling.

Called from the Celery worker after a submission is evaluated. All functions are
best-effort: a failure here must never break the core submission pipeline.
"""

from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Evaluation, ReviewItem, Submission, User, XpEvent

XP_BASE = 10
# Scores are 0–100; flag a skill for review below this (≈ the old 6.0/9 band).
REVIEW_THRESHOLD = 67.0
# Graduated spaced-repetition intervals (days) by review round.
REVIEW_INTERVALS_DAYS = [1, 3, 7, 16, 35]
# Earn one streak freeze on every Nth consecutive day.
FREEZE_EARN_EVERY = 5


def xp_for_band(score: float | None) -> int:
    """10 XP per attempt + up to 18 scaled by the 0–100 score (≈10–28)."""
    return XP_BASE + int(round((score or 0) / 100 * 18))


def award_submission(
    db: Session, sub: Submission, evaluation: Evaluation, *, answered: bool = True
) -> None:
    user = db.get(User, sub.student_id)
    if user is None:
        return
    # No spoken answer (silent / empty recording) → no XP, no streak. The student
    # only earns engagement rewards when they actually said something.
    if not answered:
        return
    # XP follows the level-relative score (motivating) when available, else the
    # absolute overall.
    basis = evaluation.level_score if evaluation.level_score is not None else evaluation.overall_band
    amount = xp_for_band(basis)
    db.add(XpEvent(student_id=user.id, submission_id=sub.id, amount=amount, reason="submission"))
    user.xp = (user.xp or 0) + amount
    _update_streak(user)
    db.commit()


PRACTICE_XP = 5  # fixed reward for a shadowing / drill attempt (not band-based)


def award_practice(db: Session, sub: Submission) -> None:
    """Reward a non-graded practice attempt (shadowing). Counts toward XP/streak
    for engagement, but carries no academic band."""
    user = db.get(User, sub.student_id)
    if user is None:
        return
    db.add(XpEvent(student_id=user.id, submission_id=sub.id, amount=PRACTICE_XP, reason="practice"))
    user.xp = (user.xp or 0) + PRACTICE_XP
    _update_streak(user)
    db.commit()


def _update_streak(user: User) -> None:
    today = date.today()
    last = user.last_practice_date
    if last == today:
        return  # already counted today

    if last is None:
        user.current_streak = 1
    else:
        gap = (today - last).days
        if gap == 1:
            user.current_streak = (user.current_streak or 0) + 1
        elif gap > 1:
            missed = gap - 1
            if (user.streak_freezes or 0) >= missed:
                # Spend freezes to bridge the missed days and keep the streak.
                user.streak_freezes -= missed
                user.current_streak = (user.current_streak or 0) + 1
            else:
                user.current_streak = 1

    user.last_practice_date = today
    user.longest_streak = max(user.longest_streak or 0, user.current_streak)
    if user.current_streak and user.current_streak % FREEZE_EARN_EVERY == 0:
        user.streak_freezes = (user.streak_freezes or 0) + 1


def schedule_review(db: Session, sub: Submission, evaluation: Evaluation) -> None:
    """Mark prior reviews for this question done; schedule a new one for the weakest skill."""
    prior = db.scalars(
        select(ReviewItem).where(
            ReviewItem.student_id == sub.student_id,
            ReviewItem.question_id == sub.question_id,
            ReviewItem.completed.is_(False),
        )
    ).all()
    for r in prior:
        r.completed = True

    dims = {
        "fluency": evaluation.fluency_score,
        "lexical": evaluation.lexical_score,
        "grammar": evaluation.grammar_score,
        "relevance": evaluation.relevance_score,
    }
    weak = [(d, s) for d, s in dims.items() if s is not None and s < REVIEW_THRESHOLD]
    if weak:
        dim, _ = min(weak, key=lambda kv: kv[1])
        due = datetime.now(timezone.utc) + timedelta(days=REVIEW_INTERVALS_DAYS[0])
        db.add(
            ReviewItem(
                student_id=sub.student_id,
                question_id=sub.question_id,
                weakness_dim=dim,
                interval_index=0,
                due_at=due,
                completed=False,
            )
        )
    db.commit()
