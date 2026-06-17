"""Sentry error tracking — a no-op unless SENTRY_DSN is set, so dev/CI run clean."""

from app.core.config import settings


def init_sentry() -> None:
    if not settings.SENTRY_DSN:
        return
    try:
        import sentry_sdk
    except ImportError:  # dependency not installed — skip silently
        return
    sentry_sdk.init(
        dsn=settings.SENTRY_DSN,
        environment=settings.ENV,
        traces_sample_rate=0.1,
        send_default_pii=False,
    )
