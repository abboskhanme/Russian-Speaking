from pydantic import BaseModel


class SecretState(BaseModel):
    """A secret value is never sent to the client — only whether it's set and its
    last 4 characters as a hint."""

    set: bool
    hint: str = ""


class KnownModel(BaseModel):
    """One entry in the curated Gemini-model dropdown shown to admins."""

    id: str
    label: str
    note: str = ""


class AiSettingsOut(BaseModel):
    llm_provider: str  # auto | azure | gemini
    gemini_model: str
    azure_openai_endpoint: str
    azure_openai_deployment: str
    azure_openai_api_version: str
    gemini_api_key: SecretState
    azure_openai_api_key: SecretState
    # Best-effort orthoepy AUDIO pass — an extra Gemini call per graded submission.
    orthoepy_enabled: bool
    # Curated Gemini models for the dropdown (custom free-text is still allowed).
    known_gemini_models: list[KnownModel] = []
    # Derived, read-only status for the UI.
    azure_ready: bool         # Azure fully configured (endpoint + key + deployment)
    active_provider: str      # which provider will actually handle grading now
    # Speech-to-text (Azure Speech preferred, Whisper fallback).
    stt_provider: str         # auto | azure | whisper
    azure_speech_region: str
    whisper_model: str
    azure_speech_key: SecretState
    openai_api_key: SecretState
    azure_speech_ready: bool  # key + region present
    stt_active_provider: str  # which STT backend will run now


class RevealOut(BaseModel):
    """The raw value of one secret setting — admin-only, on explicit request."""

    key: str
    value: str


class LinksOut(BaseModel):
    """Outbound links shown in the sidebar contact menu."""

    tg_support_url: str
    tg_channel_url: str


class LinksUpdate(BaseModel):
    tg_support_url: str | None = None
    tg_channel_url: str | None = None


class AiSettingsUpdate(BaseModel):
    """All fields optional. For secrets: omit to keep unchanged, send "" to clear
    (revert to the env default), or a new value to store it."""

    llm_provider: str | None = None
    gemini_model: str | None = None
    gemini_api_key: str | None = None
    orthoepy_enabled: str | None = None  # "true" | "false"
    azure_openai_endpoint: str | None = None
    azure_openai_api_key: str | None = None
    azure_openai_deployment: str | None = None
    azure_openai_api_version: str | None = None
    # Speech-to-text
    stt_provider: str | None = None
    azure_speech_region: str | None = None
    whisper_model: str | None = None
    azure_speech_key: str | None = None
    openai_api_key: str | None = None


class AiTestResult(BaseModel):
    """Outcome of a live grader test call (POST /admin/settings/ai/test)."""

    ok: bool
    provider: str          # which provider actually handled the test call
    model: str             # the deployment / model id used
    latency_ms: int
    error: str | None = None
