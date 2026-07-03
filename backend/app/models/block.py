import uuid

from sqlalchemy import Boolean, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, uuid_pk

# The two top-level tracks a block belongs to.
REGISTER_OBYCHNYY = "obychnyy"  # Обычный русский (standard everyday)
REGISTER_ZHIVOY = "zhivoy"      # Живой русский (living / colloquial)
REGISTERS = (REGISTER_OBYCHNYY, REGISTER_ZHIVOY)


class Block(Base, TimestampMixin):
    """A named collection of tasks (e.g. "Знакомство") inside one track
    (Обычный / Живой русский). Teachers group ~10 tasks per block and keep
    adding to it; students browse track → block → tasks."""

    __tablename__ = "blocks"

    id: Mapped[uuid.UUID] = uuid_pk()
    teacher_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    register: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    level: Mapped[str | None] = mapped_column(String(8), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_published: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, index=True)
