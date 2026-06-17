import uuid

from sqlalchemy import Float, ForeignKey, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, uuid_pk


class Evaluation(Base, TimestampMixin):
    __tablename__ = "evaluations"

    id: Mapped[uuid.UUID] = uuid_pk()
    submission_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("submissions.id", ondelete="CASCADE"), unique=True, nullable=False
    )

    # Per-criterion scores, 0–100, ABSOLUTE (vs an educated native / C2 standard).
    fluency_score: Mapped[float] = mapped_column(Float, nullable=False)
    lexical_score: Mapped[float] = mapped_column(Float, nullable=False)
    grammar_score: Mapped[float] = mapped_column(Float, nullable=False)
    relevance_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    pronunciation_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    # Overall on the absolute C2 scale (0–100) — the "true" CEFR position.
    overall_band: Mapped[float] = mapped_column(Float, nullable=False)
    # Overall relative to the task's own CEFR level (0–100) — morale-friendly,
    # and what XP / progress are based on. Null when the task has no level.
    level_score: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Structured feedback: { summary, strengths[], improvements[], vocabulary_suggestions[] }
    feedback: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    # List of { original, corrected, type, explanation }
    corrections: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    # Cached "explain my answer" follow-up: { explanation, improved_sentence }
    explanation: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    llm_model: Mapped[str | None] = mapped_column(String(64), nullable=True)

    submission: Mapped["Submission"] = relationship(back_populates="evaluation")  # noqa: F821
