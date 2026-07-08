"""Runtime-editable app settings, backed by the DB with env-var fallback.

Lets an admin change AI-provider credentials (Azure OpenAI / Gemini keys, tokens,
endpoints) from the UI without a redeploy. Resolution order for every key:

    DB override (app_settings)  →  env default (core.config.settings)  →  ""

Reads are cached briefly because the LLM grader resolves config on every
submission; the cache is cleared whenever an admin writes a new value.
"""

import time

from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import SessionLocal
from app.models.app_setting import AppSetting

# key -> (Settings attribute used as the env default, is_secret)
_SPEC: dict[str, tuple[str, bool]] = {
    "llm_provider": ("LLM_PROVIDER", False),
    "gemini_api_key": ("GEMINI_API_KEY", True),
    "gemini_model": ("GEMINI_MODEL", False),
    # Best-effort orthoepy AUDIO pass — an extra Gemini call per graded submission.
    # Stored as the string "true"/"false"; toggle off to save free-tier quota.
    "orthoepy_enabled": ("ORTHOEPY_ENABLED", False),
    "azure_openai_endpoint": ("AZURE_OPENAI_ENDPOINT", False),
    "azure_openai_api_key": ("AZURE_OPENAI_API_KEY", True),
    "azure_openai_deployment": ("AZURE_OPENAI_DEPLOYMENT", False),
    "azure_openai_api_version": ("AZURE_OPENAI_API_VERSION", False),
    # Speech-to-text (Azure Speech preferred, OpenAI Whisper fallback).
    "stt_provider": ("STT_PROVIDER", False),
    "azure_speech_key": ("AZURE_SPEECH_KEY", True),
    "azure_speech_region": ("AZURE_SPEECH_REGION", False),
    "openai_api_key": ("OPENAI_API_KEY", True),
    "whisper_model": ("WHISPER_MODEL", False),
    # Outbound links (sidebar contact menu) — managed at runtime.
    "tg_support_url": ("TG_SUPPORT_URL", False),
    "tg_channel_url": ("TG_CHANNEL_URL", False),
}

KEYS: list[str] = list(_SPEC)
SECRET_KEYS: set[str] = {k for k, (_, sec) in _SPEC.items() if sec}

# Curated Gemini models an admin can pick from in the UI. `gemini_model` stays
# free text on the backend (a custom id can always be stored) — this list is only
# a convenience dropdown with free-tier guidance. Ordered best-first.
KNOWN_MODELS: list[dict[str, str]] = [
    {
        "id": "gemini-3.1-flash-lite",
        "label": "Gemini 3.1 Flash Lite (recommended)",
        "note": "Fast and cheap; ~500 requests/day on the free tier.",
    },
    {
        "id": "gemini-2.5-flash-lite",
        "label": "Gemini 2.5 Flash Lite",
        "note": "Light and quick; generous free-tier limits.",
    },
    {
        "id": "gemini-2.5-flash",
        "label": "Gemini 2.5 Flash (avoid on free tier)",
        "note": "Higher quality but only ~20 requests/day free — exhausts quickly.",
    },
    {
        "id": "gemini-2.0-flash",
        "label": "Gemini 2.0 Flash",
        "note": "Previous-gen flash; solid free-tier limits.",
    },
    {
        "id": "gemini-1.5-flash",
        "label": "Gemini 1.5 Flash",
        "note": "Legacy fallback; widely available.",
    },
]

_CACHE_TTL = 30.0
_cache: dict[str, str | None] = {}
_cache_at: float = 0.0


def _env_default(key: str) -> str:
    attr = _SPEC.get(key, (None, False))[0]
    return str(getattr(settings, attr, "") or "") if attr else ""


def _overrides() -> dict[str, str | None]:
    """All DB overrides, cached for _CACHE_TTL seconds."""
    global _cache, _cache_at
    now = time.monotonic()
    if _cache_at and now - _cache_at < _CACHE_TTL:
        return _cache
    db = SessionLocal()
    try:
        _cache = {r.key: r.value for r in db.query(AppSetting).all()}
        _cache_at = now
        return _cache
    finally:
        db.close()


def invalidate() -> None:
    """Force the next read to hit the DB (called after a write)."""
    global _cache_at
    _cache_at = 0.0


def get(key: str, default: str = "") -> str:
    """Resolved value for `key`: DB override → env default → `default`."""
    ov = _overrides().get(key)
    if ov:
        return ov
    return _env_default(key) or default


def set_many(db: Session, values: dict[str, str | None]) -> None:
    """Upsert overrides from an admin edit.

    Per key: None → leave unchanged (used to keep an existing secret when the
    admin didn't retype it); "" → clear the override (revert to the env default);
    any other string → store it.
    """
    for key, val in values.items():
        if key not in _SPEC or val is None:
            continue
        row = db.get(AppSetting, key)
        if val == "":
            if row is not None:
                db.delete(row)
        elif row is None:
            db.add(AppSetting(key=key, value=val, is_secret=_SPEC[key][1]))
        else:
            row.value = val
    db.commit()
    invalidate()


def masked_state() -> dict[str, object]:
    """Config for the admin UI: plain values for non-secrets; secrets exposed
    only as {set: bool, hint: last-4-chars} so a key is never sent to the client."""
    out: dict[str, object] = {}
    for key, (_, sec) in _SPEC.items():
        val = get(key)
        if sec:
            out[key] = {"set": bool(val), "hint": val[-4:] if val else ""}
        else:
            out[key] = val
    return out


def orthoepy_enabled() -> bool:
    """Whether the best-effort orthoepy AUDIO pass runs on graded submissions.
    Enabled unless an admin has explicitly stored "false" (the env default is a
    bool, so accept "True"/"1"/"yes" too)."""
    return get("orthoepy_enabled", "true").strip().lower() in ("true", "1", "yes", "on")


def resolve_links() -> dict[str, str]:
    """Resolved outbound links for the sidebar contact menu."""
    return {
        "tg_support_url": get("tg_support_url"),
        "tg_channel_url": get("tg_channel_url"),
    }


def resolve_stt() -> dict[str, str]:
    """Resolved speech-to-text config."""
    return {
        "provider": (get("stt_provider", "auto") or "auto").lower(),
        "azure_speech_key": get("azure_speech_key"),
        "azure_speech_region": get("azure_speech_region"),
        "openai_api_key": get("openai_api_key"),
        "whisper_model": get("whisper_model", "whisper-1"),
    }


def resolve_llm() -> dict[str, str]:
    """Resolved LLM-grader config for services.llm."""
    return {
        "provider": (get("llm_provider", "auto") or "auto").lower(),
        "gemini_api_key": get("gemini_api_key"),
        "gemini_model": get("gemini_model", "gemini-2.5-flash"),
        "azure_endpoint": get("azure_openai_endpoint"),
        "azure_api_key": get("azure_openai_api_key"),
        "azure_deployment": get("azure_openai_deployment"),
        "azure_api_version": get("azure_openai_api_version", "2024-10-21"),
    }
