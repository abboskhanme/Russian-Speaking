"""Seed a library of Russian speaking questions: 3 per topic, across levels and types.

Image questions get a generated SVG placeholder so they display. Run:
    python -m app.scripts.seed_questions
Idempotent: questions with an already-existing prompt are skipped.
"""

from sqlalchemy import select

from app.db.session import SessionLocal
from app.models import Question, QuestionType, Topic, User, UserRole
from app.services import storage

EMOJI = {
    "Путешествия": "✈️",
    "Работа": "💼",
    "Семья": "👨‍👩‍👧",
    "Еда": "🍽️",
    "Образование": "🎓",
    "Хобби": "🎨",
    "Город": "🏙️",
    "Природа": "🌳",
}

# topic -> list of (level, type, title, prompt)
DATA: dict[str, list[tuple[str, str, str, str]]] = {
    "Путешествия": [
        ("A2", "text", "Моё последнее путешествие",
         "Расскажите о своём последнем путешествии: куда вы ездили и что вам понравилось?"),
        ("B1", "image", "Опишите картинку: путешествие",
         "Опишите, что изображено на картинке. Где это может быть и что там происходит?"),
        ("B2", "video", "Место мечты",
         "Расскажите о месте, которое вы мечтаете посетить, и объясните, почему именно оно."),
    ],
    "Работа": [
        ("A2", "text", "Моя профессия",
         "Кем вы работаете или хотели бы работать в будущем? Почему?"),
        ("B1", "text", "Мой рабочий день",
         "Опишите свой обычный рабочий или учебный день."),
        ("B2", "image", "Опишите рабочее место",
         "Посмотрите на изображение и опишите, какая это профессия и чем занимается человек."),
    ],
    "Семья": [
        ("A1", "text", "Моя семья", "Расскажите о своей семье: кто в неё входит?"),
        ("A2", "image", "Семья на картинке",
         "Опишите семью на картинке: сколько человек и чем они заняты?"),
        ("B1", "text", "Семейные традиции",
         "Как изменились семейные традиции за последние десятилетия?"),
    ],
    "Еда": [
        ("A1", "text", "Любимое блюдо", "Какое ваше любимое блюдо? Опишите его."),
        ("A2", "text", "Мой рацион", "Что вы обычно едите на завтрак, обед и ужин?"),
        ("B1", "image", "Блюдо на фото",
         "Опишите блюдо на фотографии: что это и из чего оно приготовлено?"),
    ],
    "Образование": [
        ("A2", "text", "Где я учусь", "Где вы учились или учитесь сейчас? Расскажите об этом."),
        ("B1", "text", "Любимый предмет",
         "Какой школьный предмет был для вас самым интересным и почему?"),
        ("B2", "video", "Нужно ли высшее образование?",
         "Нужно ли каждому человеку высшее образование? Выскажите своё мнение и приведите аргументы."),
    ],
    "Хобби": [
        ("A1", "text", "Моё свободное время", "Чем вы любите заниматься в свободное время?"),
        ("A2", "image", "Хобби на картинке", "Опишите, каким хобби занят человек на картинке."),
        ("B1", "text", "Зачем нужны хобби?", "Почему хобби важны для жизни человека?"),
    ],
    "Город": [
        ("A2", "text", "Мой город", "Расскажите о городе, в котором вы живёте."),
        ("B1", "image", "Городская улица", "Опишите городскую улицу на фотографии: что вы видите?"),
        ("B2", "text", "Проблемы больших городов",
         "Какие проблемы есть в больших городах и как их можно решить?"),
    ],
    "Природа": [
        ("A2", "text", "Любимое время года",
         "Опишите своё любимое время года и объясните, почему оно вам нравится."),
        ("B1", "video", "Защита природы",
         "Как люди могут защищать природу в повседневной жизни?"),
        ("C1", "text", "Изменение климата",
         "Обсудите проблему изменения климата: причины, последствия и возможные решения."),
    ],
}


def _svg(topic: str, emoji: str) -> bytes:
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500" viewBox="0 0 800 500">'
        f'<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">'
        f'<stop offset="0" stop-color="#dbeafe"/><stop offset="1" stop-color="#ede9fe"/>'
        f'</linearGradient></defs>'
        f'<rect width="800" height="500" fill="url(#g)"/>'
        f'<text x="400" y="250" font-size="140" text-anchor="middle">{emoji}</text>'
        f'<text x="400" y="350" font-size="40" text-anchor="middle" fill="#475569" '
        f'font-family="sans-serif">{topic}</text>'
        f"</svg>"
    ).encode("utf-8")


def main() -> None:
    db = SessionLocal()
    try:
        teacher = db.scalar(select(User).where(User.email == "teacher@test.uz"))
        if teacher is None:
            teacher = db.scalar(
                select(User).where(User.role == UserRole.teacher).order_by(User.created_at)
            )
        if teacher is None:
            print("No teacher found. Create one first (admin -> teachers).")
            raise SystemExit(1)

        existing = set(
            db.scalars(
                select(Question.prompt_text).where(Question.teacher_id == teacher.id)
            ).all()
        )

        created = 0
        for topic_name, items in DATA.items():
            if not db.scalar(
                select(Topic).where(Topic.teacher_id == teacher.id, Topic.name == topic_name)
            ):
                db.add(Topic(teacher_id=teacher.id, name=topic_name))

            for level, qtype, title, prompt in items:
                if prompt in existing:
                    continue
                media_key = None
                if qtype == "image":
                    media_key = storage.new_key("questions/image", "svg")
                    storage.upload_bytes(media_key, _svg(topic_name, EMOJI[topic_name]), "image/svg+xml")
                db.add(
                    Question(
                        teacher_id=teacher.id,
                        type=QuestionType(qtype),
                        title=title,
                        prompt_text=prompt,
                        media_key=media_key,
                        level=level,
                        topic=topic_name,
                        answer_time_limit_sec=120,
                        is_published=True,
                    )
                )
                created += 1

        db.commit()
        print(f"Seeded {created} questions ({len(DATA)} topics) for teacher {teacher.email}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
