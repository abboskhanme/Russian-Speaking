import uuid

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import decode_token
from app.db.session import get_db
from app.models import User, UserRole

oauth2_scheme = OAuth2PasswordBearer(tokenUrl=f"{settings.API_V1_PREFIX}/auth/login")


def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    creds_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    payload = decode_token(token)
    if payload is None or payload.get("type") != "access":
        raise creds_exc
    sub = payload.get("sub")
    if sub is None:
        raise creds_exc
    user = db.get(User, uuid.UUID(sub))
    if user is None or not user.is_active:
        raise creds_exc
    return user


def require_teacher(user: User = Depends(get_current_user)) -> User:
    # Admin is a super-user: it passes every teacher gate. Ownership checks let
    # admin act on ALL teachers' content (see `is_owner_or_admin`).
    if user.role not in (UserRole.teacher, UserRole.admin):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Teacher role required")
    return user


def is_owner_or_admin(user: User, owner_id) -> bool:
    """True if the user owns the resource, or is an admin (super-user)."""
    return user.role == UserRole.admin or owner_id == user.id


def resolve_content_owner(
    db: Session, requester: User, teacher_id: uuid.UUID | None
) -> uuid.UUID:
    """Owner id for newly created content (questions / modules / …).

    A teacher always owns what they create. An admin may attribute the content
    to a specific teacher (via a `teacher_id` picked from a dropdown); without
    one it falls back to the admin's own id. Non-admins can't reassign ownership.
    """
    if teacher_id is None or requester.role != UserRole.admin:
        return requester.id
    target = db.get(User, teacher_id)
    if target is None or target.role not in (UserRole.teacher, UserRole.admin):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid teacher")
    return target.id


def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != UserRole.admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required")
    return user


def require_teacher_or_admin(user: User = Depends(get_current_user)) -> User:
    if user.role not in (UserRole.teacher, UserRole.admin):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Teacher or admin role required"
        )
    return user
