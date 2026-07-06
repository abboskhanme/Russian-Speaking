import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr


class GroupCreate(BaseModel):
    name: str


class GroupUpdate(BaseModel):
    name: str


class GroupTeacherUpdate(BaseModel):
    teacher_id: uuid.UUID


class TaskDueUpdate(BaseModel):
    due_at: datetime | None = None


class GroupMemberOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    full_name: str
    email: EmailStr
    is_premium: bool = False
    submission_count: int = 0


class GroupOut(BaseModel):
    id: uuid.UUID
    name: str
    join_code: str
    member_count: int = 0
    teacher_id: uuid.UUID | None = None
    teacher_name: str | None = None
    created_at: datetime


class GroupDetailOut(GroupOut):
    members: list[GroupMemberOut] = []


class AddMembers(BaseModel):
    student_ids: list[uuid.UUID] = []
    # Add students by exact email too — works for independent (self-registered)
    # users who never entered a join code.
    emails: list[str] = []


class JoinGroup(BaseModel):
    code: str


# ─── Group overview (statistics + task completion) ─────────────────────────
class MemberStat(BaseModel):
    id: uuid.UUID
    full_name: str
    avg_band: float | None = None
    attempts: int = 0
    tasks_done: int = 0
    tasks_total: int = 0
    last_activity: datetime | None = None


class TaskStudent(BaseModel):
    student_id: uuid.UUID
    full_name: str
    completed: bool = False
    submission_id: uuid.UUID | None = None
    band: float | None = None


class GroupTask(BaseModel):
    question_id: uuid.UUID
    question_title: str | None = None
    question_topic: str | None = None
    block_id: uuid.UUID | None = None
    block_name: str | None = None
    due_at: datetime | None = None
    created_at: datetime
    total: int = 0
    done: int = 0
    students: list[TaskStudent] = []


class GroupOverview(BaseModel):
    id: uuid.UUID
    name: str
    join_code: str
    member_count: int = 0
    avg_band: float | None = None
    members: list[MemberStat] = []
    tasks: list[GroupTask] = []
