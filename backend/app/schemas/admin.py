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


class StudentCreate(BaseModel):
    email: EmailStr
    password: str
    full_name: str


class UserAdminUpdate(BaseModel):
    full_name: str | None = None
    is_active: bool | None = None
    password: str | None = None
    is_premium: bool | None = None


class StudentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: EmailStr
    full_name: str
    phone: str | None = None
    region: str | None = None
    district: str | None = None
    age: int | None = None
    is_active: bool
    is_premium: bool = False
    created_at: datetime
    submission_count: int = 0


class StudentGroupOut(BaseModel):
    id: uuid.UUID
    name: str
    teacher_name: str | None = None


class StudentSubmissionOut(BaseModel):
    id: uuid.UUID
    question_title: str | None = None
    topic: str | None = None
    band: float | None = None  # 0–100, teacher override or AI overall
    status: str
    created_at: datetime


class AdminStudentDetail(BaseModel):
    id: uuid.UUID
    full_name: str
    email: EmailStr
    phone: str | None = None
    region: str | None = None
    district: str | None = None
    age: int | None = None
    created_at: datetime
    is_active: bool
    is_premium: bool = False
    xp: int = 0
    current_streak: int = 0
    longest_streak: int = 0
    attempts: int = 0
    avg_band: float | None = None
    best_band: float | None = None
    groups: list[StudentGroupOut] = []
    submissions: list[StudentSubmissionOut] = []


class AdminStats(BaseModel):
    teachers: int = 0
    students: int = 0
    questions: int = 0
    published_questions: int = 0
    submissions: int = 0
    evaluated_submissions: int = 0
