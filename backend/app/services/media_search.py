"""Fetch stock photos/videos from Pexels for auto-generated media questions.

One free API key (PEXELS_API_KEY) covers both photos and videos. Each helper
searches by English keywords, downloads one result, and returns the raw bytes
ready to push to object storage. Returns ``None`` (never raises) when the key is
missing, the search has no results, or the network fails — callers then skip the
media for that question instead of aborting a long batch run.
"""

import logging

import httpx

from app.core.config import settings

logger = logging.getLogger("media_search")

_PHOTO_URL = "https://api.pexels.com/v1/search"
_VIDEO_URL = "https://api.pexels.com/videos/search"
_TIMEOUT = httpx.Timeout(30.0)

# (bytes, content_type, extension)
MediaResult = tuple[bytes, str, str]


def available() -> bool:
    return bool(settings.PEXELS_API_KEY)


def _headers() -> dict[str, str]:
    return {"Authorization": settings.PEXELS_API_KEY}


def _download(url: str) -> bytes | None:
    try:
        with httpx.Client(timeout=_TIMEOUT, follow_redirects=True) as c:
            r = c.get(url)
            r.raise_for_status()
            return r.content
    except Exception as e:  # noqa: BLE001
        logger.warning("media download failed: %s", e)
        return None


def search_photo(query: str, index: int = 0) -> MediaResult | None:
    """Return one stock photo (JPEG bytes) for the query, or None."""
    if not available() or not query.strip():
        return None
    # Spread picks across the result page so many questions on the same query
    # don't all land on the identical top photo.
    per_page = 15
    page = index // per_page + 1
    try:
        with httpx.Client(timeout=_TIMEOUT) as c:
            r = c.get(
                _PHOTO_URL,
                headers=_headers(),
                params={"query": query, "per_page": per_page, "page": page},
            )
            r.raise_for_status()
            photos = r.json().get("photos", [])
    except Exception as e:  # noqa: BLE001
        logger.warning("photo search failed for %r: %s", query, e)
        return None
    if not photos:
        return None
    src = photos[index % len(photos)]["src"]
    url = src.get("large") or src.get("medium") or src.get("original")
    data = _download(url) if url else None
    return (data, "image/jpeg", "jpg") if data else None


def search_video(query: str, index: int = 0) -> MediaResult | None:
    """Return one short stock video (MP4 bytes) for the query, or None."""
    if not available() or not query.strip():
        return None
    per_page = 10
    page = index // per_page + 1
    try:
        with httpx.Client(timeout=_TIMEOUT) as c:
            r = c.get(
                _VIDEO_URL,
                headers=_headers(),
                params={"query": query, "per_page": per_page, "page": page},
            )
            r.raise_for_status()
            videos = r.json().get("videos", [])
    except Exception as e:  # noqa: BLE001
        logger.warning("video search failed for %r: %s", query, e)
        return None
    if not videos:
        return None
    video = videos[index % len(videos)]
    # Prefer a compact MP4 (SD or smallest HD) to keep storage/bandwidth sane.
    files = [f for f in video.get("video_files", []) if f.get("file_type") == "video/mp4"]
    if not files:
        return None
    files.sort(key=lambda f: (f.get("width") or 0))
    chosen = next((f for f in files if (f.get("height") or 0) >= 480), files[-1])
    data = _download(chosen["link"]) if chosen.get("link") else None
    return (data, "video/mp4", "mp4") if data else None
