"""Sentry error tracking — a no-op unless SENTRY_DSN is set, so dev/CI run clean."""

from app.core.config import settings


def init_sentry() -> None:
    # A bare `SENTRY_DSN=   # comment` line in .env can reach us as the comment
    # text itself (env-file parsers strip the leading space but keep "# off ..."),
    # which is truthy and would crash sentry_sdk.init with BadDsn. Require a real
    # URL ("scheme://...") so any non-DSN placeholder is treated as "off".
    dsn = (settings.SENTRY_DSN or "").strip()
    if "://" not in dsn:
        return
    try:
        import sentry_sdk
    except ImportError:  # dependency not installed — skip silently
        return
    sentry_sdk.init(
        dsn=dsn,
        environment=settings.ENV,
        traces_sample_rate=0.1,
        send_default_pii=False,
    )
