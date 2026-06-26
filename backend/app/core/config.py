from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # General
    ENV: str = "development"
    SECRET_KEY: str = "change-me"
    API_V1_PREFIX: str = "/api/v1"
    BACKEND_CORS_ORIGINS: str = "http://localhost:5173"

    # Database
    DATABASE_URL: str
    DB_POOL_SIZE: int = 5
    DB_MAX_OVERFLOW: int = 10

    # Redis / Celery
    REDIS_URL: str = "redis://redis:6379/0"
    CELERY_BROKER_URL: str = "redis://redis:6379/1"
    CELERY_RESULT_BACKEND: str = "redis://redis:6379/2"

    # Observability / ops
    LOG_LEVEL: str = "INFO"
    LOG_JSON: bool = True  # structured JSON logs (set false for human-readable dev logs)
    SENTRY_DSN: str = ""  # error tracking; disabled when empty
    # Per-student storage quota (max stored answer audios). 0 = unlimited.
    STUDENT_UPLOAD_QUOTA: int = 500

    # Object storage (S3 / MinIO)
    S3_ENDPOINT_URL: str
    S3_PUBLIC_URL: str
    S3_ACCESS_KEY: str
    S3_SECRET_KEY: str
    S3_BUCKET: str = "russpeak-media"
    S3_REGION: str = "us-east-1"

    # AI — Speech-to-text. STT_PROVIDER: "auto" (Azure if its key is set, else
    # Whisper), or force "azure" / "whisper".
    STT_PROVIDER: str = "auto"
    STT_LANGUAGE: str = "ru-RU"  # Azure uses BCP-47 locale; Whisper takes "ru"
    # Azure Speech (preferred — adds pronunciation assessment)
    AZURE_SPEECH_KEY: str = ""
    AZURE_SPEECH_REGION: str = ""  # e.g. "eastus", "westeurope"
    STT_MODEL: str = "azure-speech-pa"  # label stored on transcripts
    # OpenAI Whisper (fallback — transcription only)
    OPENAI_API_KEY: str = ""
    WHISPER_MODEL: str = "whisper-1"

    # AI — Gemini (text analysis)
    GEMINI_API_KEY: str = ""
    GEMINI_MODEL: str = "gemini-2.5-flash"

    # Pexels — stock photos/videos for auto-generated media questions.
    # Free key: https://www.pexels.com/api/  (one key covers both photo + video)
    PEXELS_API_KEY: str = ""

    # Auth
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # Google Sign-In (OAuth). Set the OAuth 2.0 Web Client ID here.
    GOOGLE_CLIENT_ID: str = ""

    # Freemium: number of free speaking attempts before premium is required.
    FREE_ATTEMPT_LIMIT: int = 10

    # Email (SMTP) — provider-agnostic. Works with Gmail (smtp.gmail.com:587, an
    # app password) or any transactional provider (Resend/Mailgun/SendGrid) that
    # speaks SMTP. When SMTP_HOST/SMTP_USER are empty, emails are not sent — the
    # verification code is logged instead (handy in local development).
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM: str = ""  # defaults to SMTP_USER when empty
    SMTP_FROM_NAME: str = "Govori"
    SMTP_STARTTLS: bool = True  # True for port 587; False uses SMTP_SSL (port 465)

    # Email verification (one-time code sent at sign-up)
    EMAIL_OTP_LENGTH: int = 6
    EMAIL_OTP_TTL_SEC: int = 600  # code lifetime (10 minutes)
    EMAIL_OTP_MAX_ATTEMPTS: int = 5  # wrong tries before the code is burned
    EMAIL_VERIFY_TOKEN_EXPIRE_MINUTES: int = 20  # proof-of-verification token TTL

    @property
    def email_enabled(self) -> bool:
        return bool(self.SMTP_HOST and self.SMTP_USER)

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.BACKEND_CORS_ORIGINS.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
