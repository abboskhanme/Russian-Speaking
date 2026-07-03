import uuid

from pydantic import BaseModel, Field

# Difficulty bands the shadowing UI groups sentences under.
SHADOW_LEVELS = ("A1–A2", "B1–B2", "C1")


class ShadowingPhraseCreate(BaseModel):
    text: str = Field(min_length=1, max_length=500)
    level: str = Field(default="A1–A2", max_length=16)


class ShadowingPhraseOut(BaseModel):
    id: uuid.UUID
    text: str
    level: str

    model_config = {"from_attributes": True}
