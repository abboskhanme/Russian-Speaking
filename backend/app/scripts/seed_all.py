"""Seed a full, interconnected demo dataset for local testing.

Creates 5 teachers; each teacher gets 5 students, a group (with those students),
2 modules (blocks), 5 tasks (some in modules, some public/assigned) and graded
submissions with transcripts + evaluations + XP + streaks — so every screen
(admin / teacher / student) shows real, linked data.

Run:  docker compose exec backend python -m app.scripts.seed_all
Idempotent: entities are matched by email / (teacher, name) / (teacher, title);
per-student submissions are only created when the student has none yet.
"""

import random
import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select

from app.core.security import hash_password
from app.db.session import SessionLocal
from app.models import (
    Assignment,
    Evaluation,
    Group,
    GroupMember,
    Question,
    QuestionBlock,
    Submission,
    SubmissionStatus,
    Transcript,
    User,
    UserRole,
    XpEvent,
)
from app.models.enums import QuestionType

random.seed(42)
_PW = hash_password("test1234")
_ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

# ── 5 teachers ──────────────────────────────────────────────────────────────
TEACHERS = [
    ("Ойбек Каримов", "teacher1@demo.uz", "@oybek_teacher", "+998901112201"),
    ("Нигора Юсупова", "teacher2@demo.uz", "@nigora_teach", "+998901112202"),
    ("Жасур Рахимов", "teacher3@demo.uz", "@jasur_ru", "+998901112203"),
    ("Малика Тошева", "teacher4@demo.uz", "@malika_ru", "+998901112204"),
    ("Бекзод Алиев", "teacher5@demo.uz", "@bekzod_teach", "+998901112205"),
]

# ── 25 students (5 per teacher) ─────────────────────────────────────────────
_STUDENT_NAMES = [
    "Анна Иванова", "Иван Петров", "Мария Сидорова", "Дмитрий Смирнов", "Елена Кузнецова",
    "Алексей Попов", "Ольга Васильева", "Сергей Новиков", "Наталья Морозова", "Павел Волков",
    "Татьяна Соколова", "Андрей Лебедев", "Ирина Козлова", "Никита Егоров", "Юлия Павлова",
    "Артём Орлов", "Дарья Макарова", "Максим Никитин", "София Захарова", "Роман Фёдоров",
    "Виктория Белова", "Кирилл Тарасов", "Полина Романова", "Глеб Медведев", "Алиса Ковалёва",
]

# ── 2 module templates + 5 task templates (reused per teacher) ──────────────
MODULES = [
    ("Обычный русский · Быт", "Знакомство", "A1", "regular"),
    ("Живой русский · Общение", "Разговор", "B1", "live"),
]
# (title, instruction/"shart", prompt, level, topic, ru_style, model_answer)
TASKS = [
    ("Расскажите о себе",
     "Представьтесь: имя, возраст, чем занимаетесь. 3–4 предложения.",
     "Расскажите немного о себе.",
     "A1", "Знакомство", "regular",
     "Меня зовут Анвар, мне двадцать лет. Я студент, учусь в университете. В свободное время я люблю читать и гулять."),
    ("Мой обычный день",
     "Опишите свой обычный день по порядку: утро, день, вечер.",
     "Расскажите, как проходит ваш обычный день.",
     "A2", "Быт", "regular",
     "Утром я встаю в семь часов, завтракаю и иду на работу. Днём я работаю и обедаю с коллегами. Вечером я возвращаюсь домой, ужинаю и отдыхаю."),
    ("Любимое место в городе",
     "Расскажите о любимом месте в городе и почему оно вам нравится.",
     "Опишите ваше любимое место в городе.",
     "B1", "Город", "live",
     "Больше всего я люблю старый парк в центре. Там тихо, много зелени, и можно спокойно посидеть. Я часто хожу туда с друзьями по выходным."),
    ("Планы на выходные",
     "Расскажите о планах на выходные: что, где, с кем.",
     "Какие у вас планы на выходные?",
     "B1", "Досуг", "live",
     "В эти выходные я хочу отдохнуть. В субботу встречусь с друзьями, а в воскресенье поеду за город. Думаю, будет здорово."),
    ("Еда и вкусы",
     "Расскажите, что вы любите есть и какую кухню предпочитаете.",
     "Расскажите о вашей любимой еде.",
     "A2", "Еда", "regular",
     "Я очень люблю плов и домашнюю еду. Ещё мне нравится итальянская кухня, особенно паста. А вот острое я почти не ем."),
]

_SUMMARY = "Хороший ответ. Старайтесь использовать больше связок между мыслями и следить за падежами."
_STRENGTHS = ["Понятная речь", "Хороший словарный запас"]
_IMPROVEMENTS = ["Падежи существительных", "Темп речи"]
_CORRECTIONS = [
    {"original": "я ходил в магазин вчера", "corrected": "вчера я ходил в магазин",
     "type": "word_order", "explanation": "Обстоятельство времени лучше поставить в начало."},
]
_VOCAB = ["впечатление", "путешествие", "достопримечательность"]


def _code(db) -> str:
    while True:
        c = "".join(secrets.choice(_ALPHA) for _ in range(6))
        if not db.scalar(select(Group).where(Group.join_code == c)):
            return c


def _eval(sub_id):
    fl = round(random.uniform(50, 88), 1)
    lx = round(random.uniform(45, 88), 1)
    gr = round(random.uniform(45, 84), 1)
    rel = round(random.uniform(50, 92), 1)
    overall = round((fl + lx + gr + rel) / 4, 1)
    level = round(min(100.0, overall + random.uniform(8, 20)), 1)
    return Evaluation(
        submission_id=sub_id,
        fluency_score=fl, lexical_score=lx, grammar_score=gr,
        relevance_score=rel, pronunciation_score=None,
        overall_band=overall, level_score=level,
        feedback={"summary": _SUMMARY, "strengths": _STRENGTHS,
                  "improvements": _IMPROVEMENTS, "vocabulary_suggestions": _VOCAB},
        corrections=_CORRECTIONS, llm_model="demo",
    ), overall


def _get_or_create_user(db, *, email, full_name, role, telegram=None, phone=None, is_premium=False):
    u = db.scalar(select(User).where(User.email == email))
    if u is None:
        u = User(email=email, password_hash=_PW, full_name=full_name, role=role,
                 telegram=telegram, phone=phone, is_premium=is_premium)
        db.add(u)
        db.flush()
    return u


def main() -> None:
    db = SessionLocal()
    now = datetime.now(timezone.utc)
    try:
        # ── Canonical simple logins (all password: test1234) ──────────────────
        _get_or_create_user(db, email="admin@test.uz", full_name="Admin",
                            role=UserRole.admin)
        _get_or_create_user(db, email="teacher@test.uz", full_name="Teacher",
                            role=UserRole.teacher)
        _get_or_create_user(db, email="student@test.uz", full_name="Student",
                            role=UserRole.student)
        db.commit()

        for ti, (t_name, t_email, t_tg, t_phone) in enumerate(TEACHERS):
            teacher = _get_or_create_user(db, email=t_email, full_name=t_name,
                                          role=UserRole.teacher, telegram=t_tg, phone=t_phone)

            # 5 students for this teacher
            students: list[User] = []
            for si in range(5):
                idx = ti * 5 + si
                name = _STUDENT_NAMES[idx]
                email = f"student{idx + 1}@demo.uz"
                st = _get_or_create_user(db, email=email, full_name=name, role=UserRole.student,
                                         phone=f"+9989912{idx:05d}", is_premium=(si == 0))
                students.append(st)
            db.commit()

            # A group with all 5 students
            gname = f"Группа {t_name.split()[0]}"
            group = db.scalar(select(Group).where(Group.teacher_id == teacher.id, Group.name == gname))
            if group is None:
                group = Group(teacher_id=teacher.id, name=gname, join_code=_code(db))
                db.add(group)
                db.flush()
            for st in students:
                if not db.scalar(select(GroupMember).where(
                        GroupMember.group_id == group.id, GroupMember.student_id == st.id)):
                    db.add(GroupMember(group_id=group.id, student_id=st.id))
            db.commit()

            # 2 modules (blocks)
            blocks: list[QuestionBlock] = []
            for bi, (bname, btopic, blevel, bstyle) in enumerate(MODULES):
                b = db.scalar(select(QuestionBlock).where(
                    QuestionBlock.teacher_id == teacher.id, QuestionBlock.name == bname))
                if b is None:
                    b = QuestionBlock(teacher_id=teacher.id, name=bname, topic=btopic,
                                      level=blevel, ru_style=bstyle, sort_order=bi)
                    db.add(b)
                    db.flush()
                blocks.append(b)
            db.commit()

            # 5 tasks: first 4 split across the 2 modules, last one standalone + public
            questions: list[Question] = []
            for qi, (title, instr, prompt, level, topic, style, model) in enumerate(TASKS):
                q = db.scalar(select(Question).where(
                    Question.teacher_id == teacher.id, Question.title == title))
                if q is None:
                    block_id = blocks[qi % 2].id if qi < 4 else None
                    q = Question(
                        teacher_id=teacher.id, type=QuestionType.text, title=title,
                        instruction_text=instr, prompt_text=prompt, level=level, topic=topic,
                        ru_style=style, block_id=block_id, sort_order=qi,
                        is_published=True, is_public=(qi >= 3), model_answer_text=model,
                    )
                    db.add(q)
                    db.flush()
                questions.append(q)
            db.commit()

            # Assign 2 tasks to the whole group (due in a few days)
            member_ids = [s.id for s in students]
            if not db.scalar(select(func.count(Assignment.id)).where(Assignment.group_id == group.id)):
                a_created = now - timedelta(days=6)
                assigns: dict = {}
                for k, q in enumerate(questions[:2]):
                    due = now + timedelta(days=3 + k)
                    for sid in member_ids:
                        a = Assignment(teacher_id=teacher.id, student_id=sid, question_id=q.id,
                                       group_id=group.id, due_at=due, created_at=a_created)
                        db.add(a)
                        db.flush()
                        assigns[(sid, q.id)] = a.id
                db.commit()
            else:
                assigns = {}

            # Graded submissions per student (skip if the student already has any)
            for st in students:
                if db.scalar(select(func.count(Submission.id)).where(Submission.student_id == st.id)):
                    continue
                picks = random.sample(questions, random.randint(3, 5))
                total_xp = 0
                last = None
                for q in picks:
                    created = now - timedelta(days=random.randint(0, 10), hours=random.randint(0, 20))
                    a_id = assigns.get((st.id, q.id))
                    sub = Submission(
                        student_id=st.id, question_id=q.id, assignment_id=a_id,
                        audio_key=f"demo/{st.id}/{q.id}.webm",
                        audio_duration_sec=round(random.uniform(30, 110), 1),
                        status=SubmissionStatus.done, created_at=created, completed_at=created,
                    )
                    db.add(sub)
                    db.flush()
                    db.add(Transcript(submission_id=sub.id,
                                      text="Это демонстрационный ответ, добавленный для примера статистики.",
                                      language="ru", stt_model="demo"))
                    ev, overall = _eval(sub.id)
                    db.add(ev)
                    xp = 10 + int(round(overall)) * 2
                    total_xp += xp
                    db.add(XpEvent(student_id=st.id, submission_id=sub.id, amount=xp,
                                   reason="submission", created_at=created))
                    last = created if last is None else max(last, created)
                st.xp = (st.xp or 0) + total_xp
                st.current_streak = random.randint(1, 9)
                st.longest_streak = max(st.longest_streak or 0, st.current_streak)
                st.last_practice_date = (last or now).date()
                db.commit()

            print(f"  ✓ {t_name}: 5 students, 1 group, {len(blocks)} modules, {len(questions)} tasks")

        print("Demo data seeded: 5 teachers × (5 students, 1 group, 2 modules, 5 tasks) + submissions.")
        print("Simple logins (password: test1234):")
        print("  admin@test.uz  ·  teacher@test.uz  ·  student@test.uz")
        print("Demo logins: teacher1@demo.uz / student1@demo.uz … password: test1234")
    finally:
        db.close()


if __name__ == "__main__":
    main()
