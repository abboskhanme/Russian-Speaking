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
    question_count: int = 0
    created_at: datetime


class BlockAddQuestions(BaseModel):
    question_ids: list[uuid.UUID] = Field(min_length=1, max_length=500)
