import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.block import REGISTERS


class BlockCreate(BaseModel):
    register: str
    name: str = Field(min_length=1, max_length=128)
    level: str | None = Field(default=None, max_length=8)
    description: str | None = Field(default=None, max_length=2000)
    sort_order: int = 0
    is_published: bool = True

    @field_validator("register")
    @classmethod
    def _valid_register(cls, v: str) -> str:
        if v not in REGISTERS:
            raise ValueError(f"register must be one of {REGISTERS}")
        return v


class BlockUpdate(BaseModel):
    register: str | None = None
    name: str | None = Field(default=None, min_length=1, max_length=128)
    level: str | None = Field(default=None, max_length=8)
    description: str | None = Field(default=None, max_length=2000)
    sort_order: int | None = None
    is_published: bool | None = None

    @field_validator("register")
    @classmethod
    def _valid_register(cls, v: str | None) -> str | None:
        if v is not None and v not in REGISTERS:
            raise ValueError(f"register must be one of {REGISTERS}")
        return v


class BlockOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    register: str
    name: str
    level: str | None = None
    description: str | None = None
    sort_order: int
    is_published: bool
    task_count: int = 0
    created_at: datetime


class BlockAddQuestions(BaseModel):
    question_ids: list[uuid.UUID] = Field(min_length=1)


class ReorderIds(BaseModel):
    """Ordered id list — index becomes the new sort_order."""

    ids: list[uuid.UUID]
