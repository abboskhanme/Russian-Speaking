import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, Float, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, uuid_pk
from app.models.enums import SubmissionStatus


class Submission(Base, TimestampMixin):
    __tablename__ = "submissions"

    id: Mapped[uuid.UUID] = uuid_pk()
    student_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # Null for shadowing/pronunciation-drill attempts (no underlying question).
    question_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("questions.id", ondelete="CASCADE"), index=True, nullable=True
    )
    # Target sentence for shadowing (scripted assessment). Null for free answers.
    reference_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    # S3 key of the recorded audio answer
    audio_key: Mapped[str] = mapped_column(String(512), nullable=False)
    audio_duration_sec: Mapped[float | None] = mapped_column(Float, nullable=True)
    status: Mapped[SubmissionStatus] = mapped_column(
        Enum(SubmissionStatus, name="submission_status"),
        default=SubmissionStatus.pending,
        nullable=False,
        index=True,
    )
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Human-in-the-loop: a teacher's manual note and optional band override.
    teacher_comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    teacher_band: Mapped[float | None] = mapped_column(Float, nullable=True)
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    student: Mapped["User"] = relationship(  # noqa: F821
        back_populates="submissions", foreign_keys=[student_id]
    )
    question: Mapped["Question"] = relationship(back_populates="submissions")  # noqa: F821
    transcript: Mapped["Transcript | None"] = relationship(  # noqa: F821
        back_populates="submission", cascade="all, delete-orphan", uselist=False
    )
    evaluation: Mapped["Evaluation | None"] = relationship(  # noqa: F821
        back_populates="submission", cascade="all, delete-orphan", uselist=False
    )
