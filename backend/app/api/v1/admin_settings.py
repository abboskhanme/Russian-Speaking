"""Admin-only runtime configuration of the AI grader providers.

Lets a super-admin set Azure OpenAI / Gemini credentials from the UI (stored in
the DB, not the .env file) and choose which provider grades answers. Secrets are
never returned to the client — only masked.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import require_admin
from app.db.session import get_db
from app.models import User
from app.schemas.admin_settings import AiSettingsOut, AiSettingsUpdate, SecretState
from app.services import app_settings

router = APIRouter(prefix="/admin/settings", tags=["admin"])

_PROVIDERS = {"auto", "azure", "gemini"}


def _current() -> AiSettingsOut:
    st = app_settings.masked_state()
    provider = str(st["llm_provider"]) or "auto"
    gemini_key: dict = st["gemini_api_key"]        # {"set": bool, "hint": str}
    azure_key: dict = st["azure_openai_api_key"]
    azure_ready = bool(
        st["azure_openai_endpoint"] and azure_key["set"] and st["azure_openai_deployment"]
    )
    active = "azure" if (azure_ready and provider in ("azure", "auto")) else "gemini"
    return AiSettingsOut(
        llm_provider=provider,
        gemini_model=str(st["gemini_model"]),
        azure_openai_endpoint=str(st["azure_openai_endpoint"]),
        azure_openai_deployment=str(st["azure_openai_deployment"]),
        azure_openai_api_version=str(st["azure_openai_api_version"]),
        gemini_api_key=SecretState(**gemini_key),
        azure_openai_api_key=SecretState(**azure_key),
        azure_ready=azure_ready,
        active_provider=active,
    )


@router.get("/ai", response_model=AiSettingsOut)
def get_ai_settings(_: User = Depends(require_admin)) -> AiSettingsOut:
    return _current()


@router.patch("/ai", response_model=AiSettingsOut)
def update_ai_settings(
    payload: AiSettingsUpdate,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> AiSettingsOut:
    vals = payload.model_dump(exclude_unset=True)
    if "llm_provider" in vals and vals["llm_provider"] not in _PROVIDERS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"llm_provider must be one of {sorted(_PROVIDERS)}",
        )
    app_settings.set_many(db, vals)
    return _current()
