"""Seed realistic demo data so every screen has something to show.

Creates sample students, groups + memberships, group assignments (with a mix of
who-did / who-didn't), and graded submissions (transcripts + evaluations + XP),
plus streaks — so the gradebook, group stats, leaderboard and dashboards look alive.

Run:  docker compose exec backend python -m app.scripts.seed_demo
Idempotent: students/groups are matched by email/name; per-student submissions are
only created when the student has none yet.
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
    Submission,
    SubmissionStatus,
    Transcript,
    User,
    UserRole,
    XpEvent,
)

random.seed(7)

STUDENTS = [
    ("Анна Иванова", "anna.ivanova@demo.uz"),
    ("Иван Петров", "ivan.petrov@demo.uz"),
    ("Мария Сидорова", "maria.sidorova@demo.uz"),
    ("Дмитрий Смирнов", "dmitry.smirnov@demo.uz"),
    ("Елена Кузнецова", "elena.kuznetsova@demo.uz"),
    ("Алексей Попов", "alexey.popov@demo.uz"),
    ("Ольга Васильева", "olga.vasileva@demo.uz"),
    ("Сергей Новиков", "sergey.novikov@demo.uz"),
    ("Наталья Морозова", "natalia.morozova@demo.uz"),
    ("Павел Волков", "pavel.volkov@demo.uz"),
    ("Татьяна Соколова", "tatiana.sokolova@demo.uz"),
    ("Андрей Лебедев", "andrey.lebedev@demo.uz"),
]
GROUPS = ["Группа A1 (утро)", "Группа B1 (вечер)", "Группа B2 (онлайн)"]

_SUMMARY = "Хороший ответ. Старайтесь использовать больше прошедшего времени и связок между мыслями."
_STRENGTHS = ["Понятная речь", "Хороший словарный запас"]
_IMPROVEMENTS = ["Падежи существительных", "Темп речи"]
_CORRECTIONS = [
    {"original": "я ходил в магазин вчера", "corrected": "вчера я ходил в магазин",
     "type": "word_order", "explanation": "Обстоятельство времени лучше поставить в начало."},
]
_VOCAB = ["впечатление", "путешествие", "достопримечательность"]
_ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def _code(db):
    while True:
        c = "".join(secrets.choice(_ALPHA) for _ in range(6))
        if not db.scalar(select(Group).where(Group.join_code == c)):
            return c


def _eval(sub_id):
    # 0–100 absolute scores; level_score sits a bit higher (relative to the task level).
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


def main() -> None:
    db = SessionLocal()
    try:
        teacher = db.scalar(select(User).where(User.email == "teacher@test.uz")) or db.scalar(
            select(User).where(User.role == UserRole.teacher).order_by(User.created_at)
        )
        if teacher is None:
            print("No teacher found — create one first.")
            return
        questions = list(
            db.scalars(select(Question).where(Question.teacher_id == teacher.id).order_by(Question.created_at)).all()
        )
        if not questions:
            print("No questions for teacher — run seed_questions first.")
            return

        now = datetime.now(timezone.utc)

        # 1) students
        students: list[User] = []
        for full_name, email in STUDENTS:
            u = db.scalar(select(User).where(User.email == email))
            if u is None:
                u = User(email=email, password_hash=hash_password("test1234"),
                         full_name=full_name, role=UserRole.student)
                db.add(u)
                db.flush()
            students.append(u)
        db.commit()

        # 2) groups
        groups: list[Group] = []
        for name in GROUPS:
            g = db.scalar(select(Group).where(Group.teacher_id == teacher.id, Group.name == name))
            if g is None:
                g = Group(teacher_id=teacher.id, name=name, join_code=_code(db))
                db.add(g)
                db.flush()
            groups.append(g)
        db.commit()

        # 3) memberships — spread students across groups
        for i, u in enumerate(students):
            g = groups[i % len(groups)]
            if not db.scalar(select(GroupMember).where(
                GroupMember.group_id == g.id, GroupMember.student_id == u.id)):
                db.add(GroupMember(group_id=g.id, student_id=u.id))
        db.commit()

        # 4) graded submissions + XP + streaks per student
        for u in students:
            if db.scalar(select(func.count(Submission.id)).where(Submission.student_id == u.id)):
                continue
            picks = random.sample(questions, random.randint(3, 8))
            total_xp = 0
            last = None
            for q in picks:
                created = now - timedelta(days=random.randint(0, 12), hours=random.randint(0, 20))
                sub = Submission(
                    student_id=u.id, question_id=q.id,
                    audio_key=f"demo/{u.id}/{q.id}.webm",
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
                db.add(XpEvent(student_id=u.id, submission_id=sub.id, amount=xp,
                               reason="submission", created_at=created))
                last = created if last is None else max(last, created)
            u.xp = (u.xp or 0) + total_xp
            u.current_streak = random.randint(1, 9)
            u.longest_streak = max(u.longest_streak or 0, u.current_streak)
            u.last_practice_date = (last or now).date()
            db.commit()

        # 5) group assignments + partial completion (who did / didn't)
        for g in groups:
            member_ids = list(db.scalars(
                select(GroupMember.student_id).where(GroupMember.group_id == g.id)).all())
            if not member_ids:
                continue
            if db.scalar(select(func.count(Assignment.id)).where(Assignment.group_id == g.id)):
                continue
            a_created = now - timedelta(days=7)
            for k, q in enumerate(random.sample(questions, min(2, len(questions)))):
                due = now + timedelta(days=3 + k)
                assigns_by_sid: dict = {}
                for sid in member_ids:
                    a = Assignment(teacher_id=teacher.id, student_id=sid, question_id=q.id,
                                   group_id=g.id, due_at=due, created_at=a_created)
                    db.add(a)
                    assigns_by_sid[sid] = a
                db.flush()  # assign ids
                # ~60% complete it (a submission after the assignment date)
                for sid in member_ids[: max(1, int(len(member_ids) * 0.6))]:
                    cr = a_created + timedelta(days=1, hours=random.randint(0, 20))
                    sub = Submission(student_id=sid, question_id=q.id,
                                     assignment_id=assigns_by_sid[sid].id,
                                     audio_key=f"demo/{sid}/{q.id}-task.webm",
                                     audio_duration_sec=60.0, status=SubmissionStatus.done,
                                     created_at=cr, completed_at=cr)
                    db.add(sub)
                    db.flush()
                    db.add(Transcript(submission_id=sub.id, text="Демо-ответ на задание группы.",
                                      language="ru", stt_model="demo"))
                    ev, _ = _eval(sub.id)
                    db.add(ev)
                    # XP so the class/group leaderboard (assigned tasks only) is alive
                    db.add(XpEvent(student_id=sid, submission_id=sub.id, amount=20,
                                   reason="submission", created_at=cr))
            db.commit()

        print(f"Demo seeded: {len(students)} students, {len(groups)} groups, assignments + graded submissions.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
