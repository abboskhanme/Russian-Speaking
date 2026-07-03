import uuid

from sqlalchemy import Boolean, Enum, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, uuid_pk
from app.models.enums import QuestionType


class Question(Base, TimestampMixin):
    __tablename__ = "questions"

    id: Mapped[uuid.UUID] = uuid_pk()
    teacher_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    type: Mapped[QuestionType] = mapped_column(
        Enum(QuestionType, name="question_type"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    # The task's condition/instruction ("shart") — what the student must do —
    # kept separate from the task content so the AI grader gets it explicitly.
    instruction_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    prompt_text: Mapped[str] = mapped_column(Text, nullable=False)
    # S3 key for image/video questions (None for text questions)
    media_key: Mapped[str | None] = mapped_column(String(512), nullable=True)
    # CEFR level: A1..C2 (optional)
    level: Mapped[str | None] = mapped_column(String(8), nullable=True, index=True)
    # Free-form topic/theme for categorization (e.g. "Путешествия", "Работа")
    topic: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    # Optional membership in a Block (track → block → task). SET NULL if the
    # block is deleted so the task itself survives.
    block_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("blocks.id", ondelete="SET NULL"), index=True, nullable=True
    )
    # Manual ordering within a module/block (drag-and-drop). Lower = earlier.
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    prep_time_sec: Mapped[int] = mapped_column(Integer, default=30, nullable=False)
    answer_time_limit_sec: Mapped[int] = mapped_column(Integer, default=120, nullable=False)
    is_published: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # Task type:
    #   True  → OPEN task: in the public pool for every student, always available.
    #   False → ASSIGNED task: never public; reachable only via an active
    #           assignment (group/student) within its due window.
    is_public: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false", nullable=False, index=True
    )
    # Soft delete: keeps student submissions/history intact when a teacher
    # removes a question.
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # Exemplar (band-9) answer revealed to the student after they submit.
    model_answer_text: Mapped[str | None] = mapped_column(Text, nullable=True)

    teacher: Mapped["User"] = relationship(back_populates="questions")  # noqa: F821
    submissions: Mapped[list["Submission"]] = relationship(  # noqa: F821
        back_populates="question", cascade="all, delete-orphan"
    )
