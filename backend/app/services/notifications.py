"""Create in-app notifications. Best-effort: a failure here must never break the
core flow that triggered it (assignment creation, submission processing)."""

import uuid

from sqlalchemy.orm import Session

from app.models import Notification


def notify(
    db: Session,
    *,
    user_id: uuid.UUID,
    type: str,
    title: str,
    body: str | None = None,
    link: str | None = None,
    commit: bool = True,
) -> None:
    db.add(
        Notification(
            user_id=user_id,
            type=type,
            title=title,
            body=body,
            link=link,
        )
    )
    if commit:
        db.commit()
