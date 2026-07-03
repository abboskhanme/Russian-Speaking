import uuid

from sqlalchemy import Boolean, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, uuid_pk


class ShadowingPhrase(Base, TimestampMixin):
    """A target sentence for the 'Eshit va takrorla' (shadowing) practice.

    Teacher/admin authored, shown to every student. Grouped in the UI by the
    free-form `level` band (e.g. "A1–A2", "B1–B2", "C1")."""

    __tablename__ = "shadowing_phrases"

    id: Mapped[uuid.UUID] = uuid_pk()
    # Nullable so seeded rows (and rows whose author was deleted) survive.
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True, nullable=True
    )
    text: Mapped[str] = mapped_column(String(500), nullable=False)
    level: Mapped[str] = mapped_column(String(16), nullable=False, default="A1–A2")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, index=True)
