import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr


class StudentManageOut(BaseModel):
    """A student as seen by a teacher/admin managing premium access."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: EmailStr
    full_name: str
    phone: str | None = None
    region: str | None = None
    district: str | None = None
    age: int | None = None
    is_active: bool
    is_premium: bool
    created_at: datetime
    submission_count: int = 0


class PremiumUpdate(BaseModel):
    is_premium: bool


class TeacherContactOut(BaseModel):
    """A teacher's contact card, shown to their students on the Contact page."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    full_name: str
    email: EmailStr | None = None
    phone: str | None = None
    telegram: str | None = None
