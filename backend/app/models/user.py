import uuid
from datetime import date

from sqlalchemy import Boolean, Date, Enum, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, uuid_pk
from app.models.enums import UserRole


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = uuid_pk()
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    # Nullable: Google-authenticated accounts have no local password.
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[UserRole] = mapped_column(
        Enum(UserRole, name="user_role"), default=UserRole.student, nullable=False
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # Freemium flag — premium students bypass the free-attempt limit.
    is_premium: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false", nullable=False
    )
    # Google account subject id (set when signing in with Google).
    google_sub: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True)
    # UI language preference: uz | ru | en
    preferred_language: Mapped[str] = mapped_column(
        String(8), default="uz", server_default="uz", nullable=False
    )

    # Gamification / engagement
    xp: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    daily_goal: Mapped[int] = mapped_column(Integer, default=1, server_default="1", nullable=False)
    streak_freezes: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    current_streak: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    longest_streak: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    last_practice_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    questions: Mapped[list["Question"]] = relationship(  # noqa: F821
        back_populates="teacher", cascade="all, delete-orphan"
    )
    submissions: Mapped[list["Submission"]] = relationship(  # noqa: F821
        back_populates="student",
        cascade="all, delete-orphan",
        foreign_keys="Submission.student_id",
    )
