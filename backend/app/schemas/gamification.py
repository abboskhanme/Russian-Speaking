import uuid
from datetime import datetime

from pydantic import BaseModel


# ─── Leaderboard ───────────────────────────────────────────────────────────
class LeaderboardEntry(BaseModel):
    rank: int
    id: uuid.UUID
    full_name: str
    xp: int
    weekly_xp: int
    current_streak: int
    is_me: bool = False


# ─── Review (spaced repetition) ────────────────────────────────────────────
class ReviewItemOut(BaseModel):
    id: uuid.UUID
    question_id: uuid.UUID
    question_title: str | None = None
    question_topic: str | None = None
    question_level: str | None = None
    weakness_dim: str
    due_at: datetime


# ─── Explain my answer ─────────────────────────────────────────────────────
class ExplainOut(BaseModel):
    explanation: str
    improved_sentence: str


# ─── Assignments ───────────────────────────────────────────────────────────
class AssignmentCreate(BaseModel):
    question_id: uuid.UUID
    student_ids: list[uuid.UUID] = []
    group_id: uuid.UUID | None = None
    due_at: datetime | None = None


class AssignmentOut(BaseModel):
    id: uuid.UUID
    student_id: uuid.UUID
    student_name: str | None = None
    question_id: uuid.UUID
    question_title: str | None = None
    question_topic: str | None = None
    question_level: str | None = None
    due_at: datetime | None = None
    created_at: datetime
    completed: bool = False
    submission_id: uuid.UUID | None = None
    overall_band: float | None = None
