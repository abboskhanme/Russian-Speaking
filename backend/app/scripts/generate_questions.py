"""AI-generate a large library of Russian speaking questions (CLI / bulk path).

Walks a (topic × level × type) matrix, asks Gemini for varied speaking tasks,
deduplicates, fetches stock media for image/video tasks (Pexels), and inserts
everything as DRAFTS owned by a chosen teacher for review in the UI. The core
lives in app.services.question_gen so this matches the in-app generator exactly.

Examples
--------
    python -m app.scripts.generate_questions --per-cell 8
    python -m app.scripts.generate_questions --per-cell 6 --image-per-cell 2 --video-per-cell 1
    python -m app.scripts.generate_questions --levels B1,B2 --topics Работа,Еда --per-cell 10 --teacher-email t@x.uz

Idempotent: tasks whose prompt already exists for the owner are skipped.
"""

import argparse

from sqlalchemy import select

from app.db.session import SessionLocal
from app.models import Question, User, UserRole
from app.services import media_search
from app.services.question_gen import _norm, generate_batch

TOPICS = [
    "Путешествия", "Работа", "Семья", "Еда", "Образование", "Хобби",
    "Город", "Природа", "Здоровье", "Спорт", "Технологии", "Покупки",
    "Праздники", "Транспорт", "Культура и искусство",
]
LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"]


def main() -> None:
    ap = argparse.ArgumentParser(description="AI-generate Russian speaking questions.")
    ap.add_argument("--levels", default=",".join(LEVELS), help="comma list or 'all'")
    ap.add_argument("--topics", default=",".join(TOPICS), help="comma list or 'all'")
    ap.add_argument("--per-cell", type=int, default=8, help="text tasks per (topic, level)")
    ap.add_argument("--image-per-cell", type=int, default=0, help="image tasks per cell")
    ap.add_argument("--video-per-cell", type=int, default=0, help="video tasks per cell")
    ap.add_argument("--limit-sec", type=int, default=120, help="answer time limit")
    ap.add_argument("--publish", action="store_true", help="publish immediately (default: draft)")
    ap.add_argument("--teacher-email", default=None, help="owner; default teacher@test.uz or first teacher/admin")
    args = ap.parse_args()

    levels = LEVELS if args.levels == "all" else [s.strip() for s in args.levels.split(",") if s.strip()]
    topics = TOPICS if args.topics == "all" else [s.strip() for s in args.topics.split(",") if s.strip()]

    if (args.image_per_cell or args.video_per_cell) and not media_search.available():
        print("! PEXELS_API_KEY not set — image/video tasks will be skipped (text still generated).")

    db = SessionLocal()
    try:
        teacher = None
        if args.teacher_email:
            teacher = db.scalar(select(User).where(User.email == args.teacher_email))
        if teacher is None:
            teacher = db.scalar(select(User).where(User.email == "teacher@test.uz"))
        if teacher is None:
            teacher = db.scalar(
                select(User).where(User.role.in_([UserRole.teacher, UserRole.admin])).order_by(User.created_at)
            )
        if teacher is None:
            print("No teacher/admin found. Create one first.")
            raise SystemExit(1)
        print(f"Owner: {teacher.email}  |  draft={'no' if args.publish else 'yes'}")

        # Load the dedupe set once; generate_batch mutates it in place across calls.
        existing: set[str] = {
            _norm(p) for p in db.scalars(
                select(Question.prompt_text).where(Question.teacher_id == teacher.id)
            ).all()
        }
        total = total_no_media = 0
        for topic in topics:
            for qtype, count in (
                ("text", args.per_cell),
                ("image", args.image_per_cell),
                ("video", args.video_per_cell),
            ):
                if count <= 0:
                    continue
                created, no_media = generate_batch(
                    db,
                    teacher_id=teacher.id,
                    levels=levels,
                    topics=[topic],
                    types=[qtype],
                    count_per_cell=count,
                    limit_sec=args.limit_sec,
                    publish=args.publish,
                    existing=existing,
                )
                total += len(created)
                total_no_media += no_media
            db.commit()
            print(f"  {topic}: +{total} so far")

        print(
            f"\nDone. Created {total} draft questions"
            + (f" ({total_no_media} media tasks skipped — no media)." if total_no_media else ".")
        )
    finally:
        db.close()


if __name__ == "__main__":
    main()
