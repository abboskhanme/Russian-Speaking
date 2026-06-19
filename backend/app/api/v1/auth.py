import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.api.v1.groups import add_member_by_code
from app.core.ratelimit import rate_limit
from app.core.config import settings
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)
from app.db.session import get_db
from app.models import User, UserRole
from app.schemas.auth import (
    GoogleAuth,
    ProfileUpdate,
    RefreshRequest,
    TokenPair,
    UserOut,
    UserRegister,
)

router = APIRouter(prefix="/auth", tags=["auth"])


def _verify_google_token(credential: str) -> dict:
    """Validate a Google ID token and return its claims (email, name, sub)."""
    if not settings.GOOGLE_CLIENT_ID:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Google sign-in is not configured")
    try:
        resp = httpx.get(
            "https://oauth2.googleapis.com/tokeninfo",
            params={"id_token": credential},
            timeout=10,
        )
    except httpx.HTTPError:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Could not reach Google")
    if resp.status_code != 200:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid Google token")
    data = resp.json()
    if data.get("aud") != settings.GOOGLE_CLIENT_ID:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Google token audience mismatch")
    if str(data.get("email_verified")).lower() != "true":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Google email is not verified")
    if not data.get("email"):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Google token has no email")
    return data


@router.post(
    "/register",
    response_model=UserOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(rate_limit("register", 10, 3600))],
)
def register(payload: UserRegister, db: Session = Depends(get_db)) -> User:
    existing = db.scalar(select(User).where(User.email == payload.email))
    if existing:
        raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered")
    # Students are active immediately. A teacher sign-up creates a teacher account
    # that is INACTIVE (pending) until an admin approves it. Admin can't be
    # self-registered.
    is_teacher = payload.role == UserRole.teacher
    user = User(
        email=payload.email,
        password_hash=hash_password(payload.password),
        full_name=payload.full_name,
        phone=payload.phone,  # already normalised to +998XXXXXXXXX by the schema
        role=UserRole.teacher if is_teacher else UserRole.student,
        is_active=not is_teacher,  # teachers wait for admin approval
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    # Referral sign-up: auto-join the teacher's group. Only students join groups.
    if payload.group_code and user.role == UserRole.student:
        add_member_by_code(db, user, payload.group_code)
        db.commit()
    return user


@router.post(
    "/login",
    response_model=TokenPair,
    dependencies=[Depends(rate_limit("login", 10, 300))],
)
def login(
    form: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
) -> TokenPair:
    # OAuth2 form uses "username" — we treat it as email.
    user = db.scalar(select(User).where(User.email == form.username))
    if user is None or user.password_hash is None or not verify_password(
        form.password, user.password_hash
    ):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Incorrect email or password")
    if not user.is_active:
        if user.role == UserRole.teacher:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "Your teacher account is awaiting admin approval.",
            )
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Account is blocked")
    sub = str(user.id)
    return TokenPair(
        access_token=create_access_token(sub),
        refresh_token=create_refresh_token(sub),
    )


@router.post(
    "/google",
    response_model=TokenPair,
    dependencies=[Depends(rate_limit("login", 20, 300))],
)
def google_auth(payload: GoogleAuth, db: Session = Depends(get_db)) -> TokenPair:
    """Sign in (or sign up) with a Google ID token. Always creates a student."""
    info = _verify_google_token(payload.credential)
    email = info["email"].lower()
    user = db.scalar(select(User).where(User.email == email))
    if user is None:
        user = User(
            email=email,
            password_hash=None,
            full_name=info.get("name") or email.split("@")[0],
            role=UserRole.student,
            google_sub=info.get("sub"),
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        # Referral link → auto-join the group. Phone is collected afterwards by the
        # complete-profile step (Google sign-up never asks for it inline).
        if payload.group_code:
            add_member_by_code(db, user, payload.group_code)
            db.commit()
    else:
        if not user.is_active:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Account is blocked")
        if not user.google_sub and info.get("sub"):
            user.google_sub = info["sub"]
            db.commit()
    sub = str(user.id)
    return TokenPair(
        access_token=create_access_token(sub),
        refresh_token=create_refresh_token(sub),
    )


@router.post("/refresh", response_model=TokenPair)
def refresh(payload: RefreshRequest) -> TokenPair:
    data = decode_token(payload.refresh_token)
    if data is None or data.get("type") != "refresh":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid refresh token")
    sub = data["sub"]
    return TokenPair(
        access_token=create_access_token(sub),
        refresh_token=create_refresh_token(sub),
    )


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)) -> User:
    return user


@router.patch("/me", response_model=UserOut)
def update_me(
    payload: ProfileUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> User:
    if payload.full_name is not None:
        user.full_name = payload.full_name
    if payload.phone is not None:
        user.phone = payload.phone  # normalised by the schema validator
    if payload.preferred_language is not None:
        user.preferred_language = payload.preferred_language
    if payload.daily_goal is not None:
        user.daily_goal = max(1, min(10, payload.daily_goal))
    if payload.password:
        user.password_hash = hash_password(payload.password)
    db.commit()
    db.refresh(user)
    return user
