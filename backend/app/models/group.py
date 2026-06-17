import uuid

from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, uuid_pk


class Group(Base, TimestampMixin):
    """A class/cohort owned by a teacher; students join with a code."""

    __tablename__ = "groups"

    id: Mapped[uuid.UUID] = uuid_pk()
    teacher_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    join_code: Mapped[str] = mapped_column(String(12), unique=True, index=True, nullable=False)


class GroupMember(Base, TimestampMixin):
    __tablename__ = "group_members"
    __table_args__ = (UniqueConstraint("group_id", "student_id", name="uq_group_member"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    group_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("groups.id", ondelete="CASCADE"), index=True, nullable=False
    )
    student_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
