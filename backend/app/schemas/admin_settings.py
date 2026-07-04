from pydantic import BaseModel


class SecretState(BaseModel):
    """A secret value is never sent to the client — only whether it's set and its
    last 4 characters as a hint."""

    set: bool
    hint: str = ""


class AiSettingsOut(BaseModel):
    llm_provider: str  # auto | azure | gemini
    gemini_model: str
    azure_openai_endpoint: str
    azure_openai_deployment: str
    azure_openai_api_version: str
    gemini_api_key: SecretState
    azure_openai_api_key: SecretState
    # Derived, read-only status for the UI.
    azure_ready: bool         # Azure fully configured (endpoint + key + deployment)
    active_provider: str      # which provider will actually handle grading now


class AiSettingsUpdate(BaseModel):
    """All fields optional. For secrets: omit to keep unchanged, send "" to clear
    (revert to the env default), or a new value to store it."""

    llm_provider: str | None = None
    gemini_model: str | None = None
    gemini_api_key: str | None = None
    azure_openai_endpoint: str | None = None
    azure_openai_api_key: str | None = None
    azure_openai_deployment: str | None = None
    azure_openai_api_version: str | None = None
