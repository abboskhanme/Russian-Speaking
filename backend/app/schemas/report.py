import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr


class GradebookRow(BaseModel):
    student_id: uuid.UUID
    full_name: str
    email: EmailStr | str
    attempts: int
    avg_band: float | None = None
    best_band: float | None = None
    last_activity: datetime | None = None


class CriterionAvg(BaseModel):
    fluency: float | None = None
    lexical: float | None = None
    grammar: float | None = None
    relevance: float | None = None
    overall: float | None = None


class Analytics(BaseModel):
    total_submissions: int
    evaluated: int
    active_students_7d: int
    student_count: int
    averages: CriterionAvg
    weakest: str | None = None
    band_distribution: dict[str, int]
