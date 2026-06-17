import uuid

from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, uuid_pk


class Topic(Base, TimestampMixin):
    """A reusable topic/category that a teacher manages and assigns to questions."""

    __tablename__ = "topics"
    __table_args__ = (UniqueConstraint("teacher_id", "name", name="uq_topic_teacher_name"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    teacher_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(128), nullable=False)

    images: Mapped[list["TopicImage"]] = relationship(
        back_populates="topic", cascade="all, delete-orphan", order_by="TopicImage.created_at"
    )


class TopicImage(Base, TimestampMixin):
    """An image attached to a topic; shown randomly on student test cards."""

    __tablename__ = "topic_images"

    id: Mapped[uuid.UUID] = uuid_pk()
    topic_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("topics.id", ondelete="CASCADE"), index=True, nullable=False
    )
    image_key: Mapped[str] = mapped_column(String(512), nullable=False)

    topic: Mapped["Topic"] = relationship(back_populates="images")
