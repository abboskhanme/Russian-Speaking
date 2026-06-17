"""Tiny redis-backed rate limiter (fixed window) — no extra dependencies.

Usage:
    @router.post("/login", dependencies=[Depends(rate_limit("login", 10, 300))])

Counts requests per (scope, client IP) in a fixed window; returns 429 when over.
Fails open if redis is unreachable — rate limiting must never take the API down.
"""

from fastapi import HTTPException, Request, status
from redis import Redis
from redis.exceptions import RedisError

from app.core.config import settings

_redis = Redis.from_url(settings.REDIS_URL, decode_responses=True)


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def rate_limit(scope: str, max_requests: int, window_sec: int):
    """Return a FastAPI dependency enforcing `max_requests` per `window_sec`."""

    def dependency(request: Request) -> None:
        key = f"rl:{scope}:{_client_ip(request)}"
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
