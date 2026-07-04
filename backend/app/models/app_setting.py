from sqlalchemy import Boolean, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class AppSetting(Base, TimestampMixin):
    """Runtime-editable key/value configuration so an admin can change
    integrations (AI provider endpoints, API keys, tokens) from the UI without
    a redeploy — an alternative to baking everything into the .env file.

    Values fall back to the corresponding env var (app.core.config.settings) when
    a key is absent here, so a fresh install keeps working from env alone.

    Secret values (`is_secret=True`) are stored as-is but are NEVER returned raw
    by the API — the admin endpoints mask them (only "set / not set" + last 4)."""

    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_secret: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
