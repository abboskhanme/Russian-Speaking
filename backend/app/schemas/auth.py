import re
import uuid

from pydantic import BaseModel, ConfigDict, EmailStr, field_validator

from app.models.enums import UserRole


def normalize_uz_phone(raw: str) -> str:
    """Validate an Uzbek phone number and return it canonical as '+998XXXXXXXXX'.

    Accepts whatever the user typed (spaces, +, leading 998/8) and keeps the 9
    national digits. Raises ValueError if it isn't a valid Uzbek mobile number.
    """
    digits = re.sub(r"\D", "", raw or "")
    if digits.startswith("998"):
        digits = digits[3:]
    if len(digits) != 9:
        raise ValueError("Telefon raqami noto'g'ri (masalan: +998 90 123 45 67)")
    return "+998" + digits


class UserRegister(BaseModel):
    email: EmailStr
    password: str
    full_name: str
    phone: str
    role: UserRole = UserRole.student
    # Optional group join code from a teacher's referral link — the new student is
    # auto-added to that group right after sign-up.
    group_code: str | None = None

    @field_validator("phone")
    @classmethod
    def _check_phone(cls, v: str) -> str:
        return normalize_uz_phone(v)


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
    # Optional referral group code (see UserRegister.group_code).
    group_code: str | None = None


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: EmailStr
    full_name: str
    phone: str | None = None
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
    phone: str | None = None
    preferred_language: str | None = None
    password: str | None = None
    daily_goal: int | None = None

    @field_validator("phone")
    @classmethod
    def _check_phone(cls, v: str | None) -> str | None:
        return normalize_uz_phone(v) if v is not None else None
