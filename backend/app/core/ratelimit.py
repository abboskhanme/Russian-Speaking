"""Tiny redis-backed rate limiter (fixed window) — no extra dependencies.

Usage:
    @router.post("/login", dependencies=[Depends(rate_limit("login", 10, 300))])

Counts requests per (scope, client identity) in a fixed window; returns 429 when
over. Identity is the authenticated user id when the request carries a valid
bearer token, falling back to client IP otherwise (e.g. login/register, where
there's no user yet). IP-only keying was a real classroom bug: a school lab or
shared Wi-Fi puts 20-30 students behind one NAT'd IP, so they all shared a
single counter and a handful of students got spuriously rate-limited while
their classmates succeeded. Fails open if redis is unreachable — rate limiting
must never take the API down.
"""

from fastapi import HTTPException, Request, status
from redis import Redis
from redis.exceptions import RedisError

from app.core.config import settings
from app.core.security import decode_token

_redis = Redis.from_url(settings.REDIS_URL, decode_responses=True)


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _client_identity(request: Request) -> str:
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        payload = decode_token(auth[7:].strip())
        sub = payload.get("sub") if payload else None
        if sub:
            return f"u:{sub}"
    return f"ip:{_client_ip(request)}"


def rate_limit(scope: str, max_requests: int, window_sec: int):
    """Return a FastAPI dependency enforcing `max_requests` per `window_sec`."""

    def dependency(request: Request) -> None:
        key = f"rl:{scope}:{_client_identity(request)}"
        try:
            count = _redis.incr(key)
            if count == 1:
                _redis.expire(key, window_sec)
        except RedisError:
            return  # fail open
        if count > max_requests:
            raise HTTPException(
                status.HTTP_429_TOO_MANY_REQUESTS,
                "Too many requests. Please try again later.",
            )

    return dependency
