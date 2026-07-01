import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.enums import QuestionType

_RU_STYLES = {"regular", "live"}


def _norm_style(v: str | None) -> str | None:
    s = (v or "").strip().lower()
    if not s:
        return None
    if s not in _RU_STYLES:
        raise ValueError("ru_style must be 'regular' or 'live'")
    return s


class QuestionCreate(BaseModel):
    type: QuestionType
    title: str = Field(min_length=1, max_length=200)
    # Rich-text (sanitised HTML) — the markup inflates length, so allow headroom.
    prompt_text: str = Field(min_length=1, max_length=20000)
    level: str | None = Field(default=None, max_length=8)
    topic: str | None = Field(default=None, max_length=100)
    # Optional block membership + Russian style ("regular" | "live").
    block_id: uuid.UUID | None = None
    ru_style: str | None = Field(default=None, max_length=8)
    prep_time_sec: int = 30
    answer_time_limit_sec: int = 120
    is_published: bool = False
    # True → open task (public pool); False → assigned task (group/student only).
    is_public: bool = False
    model_answer_text: str | None = Field(default=None, max_length=10000)

    @field_validator("ru_style")
    @classmethod
    def _v_style(cls, v: str | None) -> str | None:
        return _norm_style(v)


class QuestionUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    prompt_text: str | None = Field(default=None, min_length=1, max_length=20000)
    level: str | None = Field(default=None, max_length=8)
    topic: str | None = Field(default=None, max_length=100)
    block_id: uuid.UUID | None = None
    ru_style: str | None = Field(default=None, max_length=8)
    prep_time_sec: int | None = None
    answer_time_limit_sec: int | None = None
    is_published: bool | None = None
    is_public: bool | None = None
    model_answer_text: str | None = Field(default=None, max_length=10000)

    @field_validator("ru_style")
    @classmethod
    def _v_style(cls, v: str | None) -> str | None:
        return _norm_style(v)


class QuestionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    teacher_id: uuid.UUID
    teacher_name: str | None = None
    type: QuestionType
    title: str
    prompt_text: str
    media_key: str | None
    media_url: str | None = None
    level: str | None
    topic: str | None
    block_id: uuid.UUID | None = None
    ru_style: str | None = None
    prep_time_sec: int
    answer_time_limit_sec: int
    is_published: bool
    is_public: bool = False
    model_answer_text: str | None = None
    created_at: datetime


class MediaUploadRequest(BaseModel):
    content_type: str


class MediaUploadURL(BaseModel):
    upload_url: str
    media_key: str
    fields: dict | None = None


class QuestionGenerateRequest(BaseModel):
    levels: list[str] = Field(min_length=1, max_length=6)
    # Topic is optional — empty means "no specific topic" (one general cell).
    topics: list[str] = Field(default_factory=list, max_length=30)
    types: list[QuestionType] = Field(default_factory=lambda: [QuestionType.text], min_length=1)
    count_per_cell: int = Field(default=5, ge=1, le=50)
    answer_time_limit_sec: int = Field(default=120, ge=30, le=600)
    # Free-text guidance the teacher types to steer the AI (format, tone, focus,
    # constraints). Optional — empty/None means use the default rubric only.
    custom_instructions: str | None = Field(default=None, max_length=2000)


class QuestionGenerateResult(BaseModel):
    created: int
    skipped_no_media: int
    questions: list[QuestionOut]


class BulkIds(BaseModel):
    ids: list[uuid.UUID] = Field(min_length=1, max_length=2000)


class BulkActionResult(BaseModel):
    count: int
