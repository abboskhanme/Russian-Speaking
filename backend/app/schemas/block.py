import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

# Allowed Russian-style tags for a block / question.
RU_STYLES = {"regular", "live"}


class BlockCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    topic: str | None = Field(default=None, max_length=128)
    level: str | None = Field(default=None, max_length=8)
    ru_style: str | None = Field(default=None, max_length=8)


class BlockUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    topic: str | None = Field(default=None, max_length=128)
    level: str | None = Field(default=None, max_length=8)
    ru_style: str | None = Field(default=None, max_length=8)


class BlockOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    teacher_id: uuid.UUID
    name: str
    topic: str | None = None
    level: str | None = None
    ru_style: str | None = None
    sort_order: int = 0
    question_count: int = 0
    created_at: datetime


class BlockAddQuestions(BaseModel):
    question_ids: list[uuid.UUID] = Field(min_length=1, max_length=500)


class ReorderIds(BaseModel):
    """Ordered id list — index becomes the new sort_order (drag-and-drop)."""

    ids: list[uuid.UUID] = Field(max_length=2000)


# ── Student-facing module view (sequential progression) ─────────────────────
class StudentTask(BaseModel):
    id: uuid.UUID
    title: str
    type: str
    level: str | None = None
    sort_order: int = 0
    done: bool = False
    locked: bool = False  # previous task not completed yet


class StudentModule(BaseModel):
    id: uuid.UUID
    name: str
    topic: str | None = None
    level: str | None = None
    ru_style: str | None = None
    total: int = 0
    done_count: int = 0
    next_task_id: uuid.UUID | None = None  # the current actionable (unlocked, not done) task
    tasks: list[StudentTask] = []


# ── Teacher-facing per-module progress ──────────────────────────────────────
class ModuleStudentProgress(BaseModel):
    student_id: uuid.UUID
    full_name: str
    done_count: int = 0
    total: int = 0
    percent: int = 0
    current_task_title: str | None = None  # next task the student should do (None = finished)
