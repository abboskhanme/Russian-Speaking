"""Admin-only runtime configuration of the AI grader providers.

Lets a super-admin set Azure OpenAI / Gemini credentials from the UI (stored in
the DB, not the .env file) and choose which provider grades answers. Secrets are
never returned to the client — only masked.
"""

import time

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import require_admin
from app.db.session import get_db
from app.models import User
from app.schemas.admin_settings import (
    AiSettingsOut,
    AiSettingsUpdate,
    AiTestResult,
    KnownModel,
    LinksOut,
    LinksUpdate,
    RevealOut,
    SecretState,
)
from app.services import app_settings, llm

router = APIRouter(prefix="/admin/settings", tags=["admin"])

_PROVIDERS = {"auto", "azure", "gemini"}
_STT_PROVIDERS = {"auto", "azure", "whisper"}
_TRUE = {"true", "1", "yes", "on"}
_FALSE = {"false", "0", "no", "off"}


def _current() -> AiSettingsOut:
    st = app_settings.masked_state()
    provider = str(st["llm_provider"]) or "auto"
    gemini_key: dict = st["gemini_api_key"]        # {"set": bool, "hint": str}
    azure_key: dict = st["azure_openai_api_key"]
    azure_ready = bool(
        st["azure_openai_endpoint"] and azure_key["set"] and st["azure_openai_deployment"]
    )
    active = "azure" if (azure_ready and provider in ("azure", "auto")) else "gemini"

    # Speech-to-text status.
    stt_provider = str(st["stt_provider"]) or "auto"
    speech_key: dict = st["azure_speech_key"]
    openai_key: dict = st["openai_api_key"]
    azure_speech_ready = bool(speech_key["set"] and st["azure_speech_region"])
    if stt_provider in ("azure", "whisper"):
        stt_active = stt_provider
    elif speech_key["set"]:
        stt_active = "azure"
    elif openai_key["set"]:
        stt_active = "whisper"
    else:
        stt_active = "none"

    return AiSettingsOut(
        llm_provider=provider,
        gemini_model=str(st["gemini_model"]),
        orthoepy_enabled=app_settings.orthoepy_enabled(),
        known_gemini_models=[KnownModel(**m) for m in app_settings.KNOWN_MODELS],
        azure_openai_endpoint=str(st["azure_openai_endpoint"]),
        azure_openai_deployment=str(st["azure_openai_deployment"]),
        azure_openai_api_version=str(st["azure_openai_api_version"]),
        gemini_api_key=SecretState(**gemini_key),
        azure_openai_api_key=SecretState(**azure_key),
        azure_ready=azure_ready,
        active_provider=active,
        stt_provider=stt_provider,
        azure_speech_region=str(st["azure_speech_region"]),
        whisper_model=str(st["whisper_model"]),
        azure_speech_key=SecretState(**speech_key),
        openai_api_key=SecretState(**openai_key),
        azure_speech_ready=azure_speech_ready,
        stt_active_provider=stt_active,
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
    if "stt_provider" in vals and vals["stt_provider"] not in _STT_PROVIDERS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"stt_provider must be one of {sorted(_STT_PROVIDERS)}",
        )
    if "orthoepy_enabled" in vals and vals["orthoepy_enabled"] is not None:
        norm = str(vals["orthoepy_enabled"]).strip().lower()
        if norm not in _TRUE and norm not in _FALSE:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "orthoepy_enabled must be 'true' or 'false'",
            )
        vals["orthoepy_enabled"] = "true" if norm in _TRUE else "false"
    app_settings.set_many(db, vals)
    return _current()


@router.post("/ai/test", response_model=AiTestResult)
def test_ai_connection(_: User = Depends(require_admin)) -> AiTestResult:
    """Run a TINY real grader call to diagnose credential/quota problems.

    Grades a 2-word dummy transcript through the live grader path (the same
    provider selection real submissions use) and reports latency or the exact
    error — the key tool for chasing down free-tier rate-limit failures."""
    c = app_settings.resolve_llm()
    azure_ready = bool(c["azure_endpoint"] and c["azure_api_key"] and c["azure_deployment"])
    use_azure = azure_ready and c["provider"] in ("azure", "auto")
    provider = "azure" if use_azure else "gemini"
    model = c["azure_deployment"] if use_azure else c["gemini_model"]

    t0 = time.monotonic()
    try:
        llm.analyze(
            question_prompt="Тест",
            transcript_text="привет мир",
            level="A1",
        )
        latency_ms = int((time.monotonic() - t0) * 1000)
        return AiTestResult(ok=True, provider=provider, model=model, latency_ms=latency_ms)
    except Exception as exc:  # noqa: BLE001 — surface the raw error to the admin
        latency_ms = int((time.monotonic() - t0) * 1000)
        return AiTestResult(
            ok=False, provider=provider, model=model, latency_ms=latency_ms, error=str(exc)[:500]
        )


@router.get("/reveal/{key}", response_model=RevealOut)
def reveal_secret(key: str, _: User = Depends(require_admin)) -> RevealOut:
    """Return the raw stored value of one secret setting so the admin can view or
    edit it. Restricted to known secret keys."""
    if key not in app_settings.SECRET_KEYS:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown secret key")
    return RevealOut(key=key, value=app_settings.get(key))


@router.get("/links", response_model=LinksOut)
def get_links(_: User = Depends(require_admin)) -> LinksOut:
    return LinksOut(**app_settings.resolve_links())


@router.patch("/links", response_model=LinksOut)
def update_links(
    payload: LinksUpdate,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> LinksOut:
    app_settings.set_many(db, payload.model_dump(exclude_unset=True))
    return LinksOut(**app_settings.resolve_links())
