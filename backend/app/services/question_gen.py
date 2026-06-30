"""Shared AI question-generation core used by both the CLI script and the
in-app teacher endpoint, so generation behaves identically everywhere.

Walks a (topic × level × type) matrix, asks Gemini for varied speaking tasks,
deduplicates against what the owner already has, fetches a stock photo/video
for media tasks, and adds Question rows to the session as DRAFTS. The caller
owns the transaction (commits / rolls back).
"""

import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Question, QuestionType, Topic
from app.services import llm, media_search, storage

logger = logging.getLogger("question_gen")

# Keep a single in-app request bounded so it stays synchronous and responsive;
# the CLI (which loops + commits per cell) is the path for massive libraries.
# Bounded so a single in-app request finishes inside nginx's 120s proxy window
# (large counts are chunked into several model calls). For thousands, use the CLI.
MAX_PER_REQUEST = 150
MAX_CELLS_PER_REQUEST = 10


def _norm(text: str) -> str:
    return " ".join(text.split()).strip().lower()


def _store_media(qtype: str, query: str, index: int) -> str | None:
    """Fetch + store a stock photo/video; return its object key, or None."""
    result = (
        media_search.search_photo(query, index)
        if qtype == "image"
        else media_search.search_video(query, index)
    )
    if not result:
        return None
    data, content_type, ext = result
    key = storage.new_key(f"questions/{qtype}", ext)
    storage.upload_bytes(key, data, content_type)
    return key


def generate_batch(
    db: Session,
    *,
    teacher_id,
    levels: list[str],
    topics: list[str],
    types: list[str],
    count_per_cell: int,
    limit_sec: int = 120,
    publish: bool = False,
    existing: set[str] | None = None,
    custom: str | None = None,
) -> tuple[list[Question], int]:
    """Generate drafts across the matrix. Returns (created rows, #media skipped).

    Does NOT commit — the caller controls the transaction. `existing` is a set of
    normalised prompts to dedupe against; it's loaded once if not supplied and is
    updated in place so repeated calls (e.g. the CLI per-topic loop) stay deduped.
    """
    if existing is None:
        existing = {
            _norm(p)
            for p in db.scalars(
                select(Question.prompt_text).where(Question.teacher_id == teacher_id)
            ).all()
        }

    created: list[Question] = []
    skipped_no_media = 0
    # Empty topic list → one general cell (topic not mandatory).
    for topic in (topics or [""]):
        topic = (topic or "").strip()
        if topic and not db.scalar(
            select(Topic).where(Topic.teacher_id == teacher_id, Topic.name == topic)
        ):
            db.add(Topic(teacher_id=teacher_id, name=topic))
            db.flush()
        for level in levels:
            for qtype in types:
                if count_per_cell <= 0:
                    continue
                try:
                    items = llm.generate_questions(
                        level=level, topic=topic, qtype=qtype, count=count_per_cell, custom=custom
                    )
                except Exception as e:  # noqa: BLE001
                    logger.warning("generation failed [%s/%s/%s]: %s", topic, level, qtype, e)
                    continue
                for i, item in enumerate(items):
                    prompt = (item.prompt_text or "").strip()
                    if not prompt or _norm(prompt) in existing:
                        continue
                    media_key = None
                    if qtype in ("image", "video"):
                        media_key = _store_media(qtype, item.media_query or topic, i)
                        if media_key is None:
                            skipped_no_media += 1
                            continue  # never create a media task without media
                    q = Question(
                        teacher_id=teacher_id,
                        type=QuestionType(qtype),
                        title=(item.title or prompt[:60]).strip()[:255],
                        prompt_text=prompt,
                        model_answer_text=(item.model_answer_text or "").strip() or None,
                        media_key=media_key,
                        level=level,
                        topic=topic or None,
                        answer_time_limit_sec=limit_sec,
                        is_published=publish,
                        is_public=True,  # library questions live in the public pool
                    )
                    db.add(q)
                    created.append(q)
                    existing.add(_norm(prompt))
    return created, skipped_no_media
