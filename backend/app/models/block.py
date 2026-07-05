import uuid

from sqlalchemy import Boolean, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, uuid_pk


class QuestionBlock(Base, TimestampMixin):
    """A named bundle/set of questions a teacher groups together (e.g. a 10-task
    block on one topic). Questions can be added to a block at any time. Each block
    can be tagged with a Russian style — "regular" (обычный/книжный) or
    "live" (живой/разговорный) — which its questions inherit by default."""

    __tablename__ = "question_blocks"

    id: Mapped[uuid.UUID] = uuid_pk()
    teacher_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    # Optional defaults the block's questions inherit.
    topic: Mapped[str | None] = mapped_column(String(128), nullable=True)
    level: Mapped[str | None] = mapped_column(String(8), nullable=True)
    # Russian style: "regular" (Обычный) | "live" (Живой). None = unset.
    ru_style: Mapped[str | None] = mapped_column(String(8), nullable=True)
    # Manual ordering of modules (drag-and-drop). Lower = earlier.
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # Who can reach this module (replaces the old per-question is_public flag):
    #   "public" → official platform module: visible to EVERY student, including
    #              self-registered ones with no teacher. Created by admins.
    #   "group"  → private teacher module: only that teacher's group students.
    visibility: Mapped[str] = mapped_column(
        String(8), default="group", server_default="group", nullable=False, index=True
    )
    # Draft vs live at the module level — students only see published modules.
    is_published: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false", nullable=False
    )
    # S3 key of the module's cover image (None = generated placeholder).
    cover_key: Mapped[str | None] = mapped_column(String(512), nullable=True)

    questions: Mapped[list["Question"]] = relationship(  # noqa: F821
        back_populates="block"
    )
