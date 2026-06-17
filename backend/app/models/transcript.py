import uuid

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, uuid_pk


class Transcript(Base, TimestampMixin):
    __tablename__ = "transcripts"

    id: Mapped[uuid.UUID] = uuid_pk()
    submission_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("submissions.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    text: Mapped[str] = mapped_column(Text, nullable=False)
    language: Mapped[str | None] = mapped_column(String(16), nullable=True)
    # Word-level timestamps from the recognizer (also carries per-word accuracy)
    word_timestamps: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    # Azure pronunciation assessment (0–100): {accuracy, fluency, completeness,
    # prosody, pronunciation}
    pronunciation: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    stt_model: Mapped[str | None] = mapped_column(String(64), nullable=True)

    submission: Mapped["Submission"] = relationship(back_populates="transcript")  # noqa: F821
