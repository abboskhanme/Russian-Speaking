import uuid

from sqlalchemy import Boolean, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, uuid_pk


class Notification(Base, TimestampMixin):
    """A single in-app notification for one recipient.

    Kept deliberately simple: a typed message with an optional deep-link. Events
    that create them: a new assignment (→ student), an assignment completed
    (→ teacher), a result ready (→ student).
    """

    __tablename__ = "notifications"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # assignment_new | assignment_done | result_ready (free-form, not an enum, so
    # new kinds don't need a migration)
    type: Mapped[str] = mapped_column(String(32), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Frontend route to open when tapped, e.g. "/submissions/<id>".
    link: Mapped[str | None] = mapped_column(String(300), nullable=True)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)
