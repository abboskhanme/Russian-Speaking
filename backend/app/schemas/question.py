import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import QuestionType


class QuestionCreate(BaseModel):
    type: QuestionType
    title: str = Field(min_length=1, max_length=200)
    # Rich-text (sanitised HTML) — the markup inflates length, so allow headroom.
    prompt_text: str = Field(min_length=1, max_length=20000)
    level: str | None = Field(default=None, max_length=8)
    topic: str | None = Field(default=None, max_length=100)
    prep_time_sec: int = 30
    answer_time_limit_sec: int = 120
    is_published: bool = False
    # True → open task (public pool); False → assigned task (group/student only).
    is_public: bool = False
    model_answer_text: str | None = Field(default=None, max_length=10000)


class QuestionUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    prompt_text: str | None = Field(default=None, min_length=1, max_length=20000)
    level: str | None = Field(default=None, max_length=8)
    topic: str | None = Field(default=None, max_length=100)
    prep_time_sec: int | None = None
    answer_time_limit_sec: int | None = None
    is_published: bool | None = None
    is_public: bool | None = None
    model_answer_text: str | None = Field(default=None, max_length=10000)


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
    topics: list[str] = Field(min_length=1, max_length=30)
    types: list[QuestionType] = Field(default_factory=lambda: [QuestionType.text], min_length=1)
    count_per_cell: int = Field(default=5, ge=1, le=50)
    answer_time_limit_sec: int = Field(default=120, ge=30, le=600)


class QuestionGenerateResult(BaseModel):
    created: int
    skipped_no_media: int
    questions: list[QuestionOut]


class BulkIds(BaseModel):
    ids: list[uuid.UUID] = Field(min_length=1, max_length=2000)


class BulkActionResult(BaseModel):
    count: int
