"""Canonical student scoring — level-relative and stable.

Two design choices fix long-standing "the score keeps changing / two different
numbers" confusion:

1. We score on the LEVEL-relative result (`Evaluation.level_score` — how well the
   answer met the TASK's own CEFR level), NOT the absolute C2 band
   (`overall_band`). It is fairer to beginners and varies far less between answers.
   `overall_band` is kept in the DB for diagnostics but is no longer surfaced as a
   competing "ball".

2. A student's headline score is the average of their most recent `RECENT_WINDOW`
   graded answers — so one bad attempt doesn't yank a long history around, and
   ancient early attempts don't dilute current ability. The same definition runs
   on the frontend (LEVEL_WINDOW in useStats), so student and teacher always see
   the identical number.
"""

from app.models import Submission

# Keep in sync with the frontend LEVEL_WINDOW (lib/useStats.ts) so the student's
# own "level" and every teacher/admin view of that student agree exactly.
RECENT_WINDOW = 10


def effective_band(sub: Submission) -> float | None:
    """The single 0–100 score for ONE answer: a teacher's manual override wins,
    else the level-relative AI score, else (legacy rows with no level) the
    absolute band. None when the answer isn't graded yet."""
    if sub.teacher_band is not None:
        return sub.teacher_band
    ev = sub.evaluation
    if ev is None:
        return None
    return ev.level_score if ev.level_score is not None else ev.overall_band


def _graded_desc(subs: list[Submission]) -> list[float]:
    """Effective bands of the graded answers, newest first."""
    graded = [(s.created_at, effective_band(s)) for s in subs]
    graded = [(t, b) for t, b in graded if b is not None]
    graded.sort(key=lambda tb: tb[0], reverse=True)
    return [b for _, b in graded]


def rolling_avg(subs: list[Submission], window: int = RECENT_WINDOW) -> float | None:
    """Stable headline score: mean of the most recent `window` graded answers."""
    bands = _graded_desc(subs)[:window]
    return round(sum(bands) / len(bands), 2) if bands else None


def best_band(subs: list[Submission]) -> float | None:
    """Best single answer the student has ever produced (never decreases)."""
    bands = _graded_desc(subs)
    return round(max(bands), 2) if bands else None
