import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_teacher
from app.db.session import get_db
from app.models import Topic, TopicImage, User, UserRole
from app.schemas.topic import (
    ImageCreate,
    ImageUploadRequest,
    ImageUploadURL,
    TopicCreate,
    TopicImageOut,
    TopicOut,
    TopicUpdate,
)
from app.services import storage

router = APIRouter(prefix="/topics", tags=["topics"])


def _to_out(topic: Topic) -> TopicOut:
    return TopicOut(
        id=topic.id,
        name=topic.name,
        images=[
            TopicImageOut(id=img.id, url=storage.presigned_get(img.image_key))
            for img in topic.images
        ],
    )


def _owned_topic(topic_id: uuid.UUID, teacher: User, db: Session) -> Topic:
    topic = db.get(Topic, topic_id)
    if topic is None or (teacher.role != UserRole.admin and topic.teacher_id != teacher.id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Topic not found")
    return topic


@router.get("", response_model=list[TopicOut])
def list_topics(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[TopicOut]:
    """Managed topics. Teachers see only their own; admin sees all."""
    stmt = select(Topic).order_by(Topic.name)
    if user.role == UserRole.teacher:
        stmt = stmt.where(Topic.teacher_id == user.id)
    return [_to_out(t) for t in db.scalars(stmt).all()]


@router.get("/meta/images", response_model=dict[str, list[str]])
def topic_images_map(
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, list[str]]:
    """Map of topic name -> image URLs, merged across teachers.

    Used by the student UI to show a random topic image on each test card.
    """
    rows = db.execute(
        select(Topic.name, TopicImage.image_key).join(TopicImage, TopicImage.topic_id == Topic.id)
    ).all()
    result: dict[str, list[str]] = {}
    for name, key in rows:
        result.setdefault(name, []).append(storage.presigned_get(key))
    return result


@router.post("", response_model=TopicOut, status_code=status.HTTP_201_CREATED)
def create_topic(
    payload: TopicCreate,
    teacher: User = Depends(require_teacher),
    db: Session = Depends(get_db),
) -> TopicOut:
    name = payload.name.strip()
    if not name:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Topic name is required")
    existing = db.scalar(
        select(Topic).where(Topic.teacher_id == teacher.id, Topic.name == name)
    )
    if existing:
        return _to_out(existing)
    topic = Topic(teacher_id=teacher.id, name=name)
    db.add(topic)
    db.commit()
    db.refresh(topic)
    return _to_out(topic)


@router.patch("/{topic_id}", response_model=TopicOut)
def rename_topic(
    topic_id: uuid.UUID,
    payload: TopicUpdate,
    teacher: User = Depends(require_teacher),
    db: Session = Depends(get_db),
) -> TopicOut:
    topic = _owned_topic(topic_id, teacher, db)
    name = payload.name.strip()
    if not name:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Topic name is required")
    topic.name = name
    db.commit()
    db.refresh(topic)
    return _to_out(topic)


@router.delete("/{topic_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_topic(
    topic_id: uuid.UUID,
    teacher: User = Depends(require_teacher),
    db: Session = Depends(get_db),
) -> None:
    topic = _owned_topic(topic_id, teacher, db)
    db.delete(topic)
    db.commit()


# ─── Topic images ──────────────────────────────────────────────────────────
@router.post("/{topic_id}/images/upload-url", response_model=ImageUploadURL)
def image_upload_url(
    topic_id: uuid.UUID,
    payload: ImageUploadRequest,
    teacher: User = Depends(require_teacher),
    db: Session = Depends(get_db),
) -> ImageUploadURL:
    _owned_topic(topic_id, teacher, db)
    if not payload.content_type.startswith("image/"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Content-Type must be image/*")
    ext = payload.content_type.split("/", 1)[-1].split(";")[0] or "jpg"
    key = storage.new_key(f"topics/{topic_id}", ext)
    return ImageUploadURL(upload_url=storage.presigned_put(key, payload.content_type), image_key=key)


@router.post("/{topic_id}/images", response_model=TopicImageOut, status_code=status.HTTP_201_CREATED)
def add_image(
    topic_id: uuid.UUID,
    payload: ImageCreate,
    teacher: User = Depends(require_teacher),
    db: Session = Depends(get_db),
) -> TopicImageOut:
    _owned_topic(topic_id, teacher, db)
    img = TopicImage(topic_id=topic_id, image_key=payload.image_key)
    db.add(img)
    db.commit()
    db.refresh(img)
    return TopicImageOut(id=img.id, url=storage.presigned_get(img.image_key))


@router.delete("/{topic_id}/images/{image_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_image(
    topic_id: uuid.UUID,
    image_id: uuid.UUID,
    teacher: User = Depends(require_teacher),
    db: Session = Depends(get_db),
) -> None:
    _owned_topic(topic_id, teacher, db)
    img = db.get(TopicImage, image_id)
    if img is None or img.topic_id != topic_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Image not found")
    db.delete(img)
    db.commit()
