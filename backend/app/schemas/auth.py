import uuid

from pydantic import BaseModel, ConfigDict, EmailStr

from app.models.enums import UserRole


class UserRegister(BaseModel):
    email: EmailStr
    password: str
    full_name: str
    role: UserRole = UserRole.student


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class RefreshRequest(BaseModel):
    refresh_token: str


class GoogleAuth(BaseModel):
    # The Google Identity Services ID token (JWT credential) from the client.
    credential: str


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: EmailStr
    full_name: str
    role: UserRole
    is_active: bool
    is_premium: bool = False
    preferred_language: str
    xp: int = 0
    daily_goal: int = 1
    streak_freezes: int = 0
    current_streak: int = 0
    longest_streak: int = 0


class ProfileUpdate(BaseModel):
    full_name: str | None = None
    preferred_language: str | None = None
    password: str | None = None
    daily_goal: int | None = None
