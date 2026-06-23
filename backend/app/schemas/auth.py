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
    # Self-service sign-up always creates a STUDENT. Teacher accounts are created
    # by an admin only, so there is no role field here.
    email: EmailStr
    password: str
    full_name: str
    phone: str
    # Mandatory student profile fields collected on the registration form.
    age: int
    region: str
    district: str
    # Proof that the email was verified via an OTP code (from /auth/email/verify-code).
    # Optional: required only when email sending (SMTP) is configured on the server.
    email_verify_token: str | None = None
    # Optional group join code from a teacher's referral link — the new student is
    # auto-added to that group right after sign-up.
    group_code: str | None = None

    @field_validator("phone")
    @classmethod
    def _check_phone(cls, v: str) -> str:
        return normalize_uz_phone(v)

    @field_validator("age")
    @classmethod
    def _check_age(cls, v: int) -> int:
        if v < 5 or v > 100:
            raise ValueError("Yoshni to'g'ri kiriting")
        return v

    @field_validator("region", "district")
    @classmethod
    def _check_address(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("Manzilni tanlang")
        return v


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class EmailCodeRequest(BaseModel):
    email: EmailStr


class EmailCodeVerify(BaseModel):
    email: EmailStr
    code: str


class EmailVerifyToken(BaseModel):
    # Returned by /auth/email/verify-code; passed back in UserRegister.
    email_verify_token: str


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
    age: int | None = None
    region: str | None = None
    district: str | None = None
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
    age: int | None = None
    region: str | None = None
    district: str | None = None
    preferred_language: str | None = None
    password: str | None = None
    daily_goal: int | None = None

    @field_validator("phone")
    @classmethod
    def _check_phone(cls, v: str | None) -> str | None:
        return normalize_uz_phone(v) if v is not None else None

    @field_validator("age")
    @classmethod
    def _check_age(cls, v: int | None) -> int | None:
        if v is not None and (v < 5 or v > 100):
            raise ValueError("Yoshni to'g'ri kiriting")
        return v
