import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr


class TeacherCreate(BaseModel):
    email: EmailStr
    password: str
    full_name: str


class TeacherUpdate(BaseModel):
    full_name: str | None = None
    is_active: bool | None = None
    password: str | None = None


class TeacherOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: EmailStr
    full_name: str
    is_active: bool
    created_at: datetime
    question_count: int = 0


class UserAdminUpdate(BaseModel):
    full_name: str | None = None
    is_active: bool | None = None
    password: str | None = None


class StudentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: EmailStr
    full_name: str
    is_active: bool
    created_at: datetime
    submission_count: int = 0


class AdminStats(BaseModel):
    teachers: int = 0
    students: int = 0
    questions: int = 0
    published_questions: int = 0
    submissions: int = 0
    evaluated_submissions: int = 0
