"""Redis-backed one-time codes for email verification.

A 6-digit code is stored under `emailotp:<email>` with a TTL. Wrong guesses are
counted under `emailotp_attempts:<email>`; once the limit is hit the code is
burned so it can't be brute-forced. Verification fails CLOSED if Redis is down —
we never let an unverifiable code through.
"""

import secrets

from redis import Redis

from app.core.config import settings

_redis = Redis.from_url(settings.REDIS_URL, decode_responses=True)


def _code_key(email: str) -> str:
    return f"emailotp:{email.lower()}"


def _attempts_key(email: str) -> str:
    return f"emailotp_attempts:{email.lower()}"


def generate_and_store(email: str) -> str:
    """Create a fresh code, store it with the configured TTL, and return it."""
    code = "".join(secrets.choice("0123456789") for _ in range(settings.EMAIL_OTP_LENGTH))
    _redis.setex(_code_key(email), settings.EMAIL_OTP_TTL_SEC, code)
    _redis.delete(_attempts_key(email))  # reset attempt counter for the new code
    return code


def verify(email: str, code: str) -> bool:
    """Return True iff `code` matches the stored code (one-shot, attempt-limited)."""
    stored = _redis.get(_code_key(email))
    if stored is None:
        return False  # never issued, or already expired/used

    attempts = _redis.incr(_attempts_key(email))
    if attempts == 1:
        _redis.expire(_attempts_key(email), settings.EMAIL_OTP_TTL_SEC)
    if attempts > settings.EMAIL_OTP_MAX_ATTEMPTS:
        _redis.delete(_code_key(email))  # burn the code after too many tries
        return False

    if secrets.compare_digest(stored, (code or "").strip()):
        _redis.delete(_code_key(email))
        _redis.delete(_attempts_key(email))
        return True
    return False
