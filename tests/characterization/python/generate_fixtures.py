"""Freeze the current Python behavior as language-neutral JSON fixtures.

The C# port consumes these exact files. One source of truth, two languages:
if C# disagrees with a fixture, the port changed behavior — which is a bug,
not an improvement. Improvements happen after cutover, deliberately.

Why this exists: the audit found 13 tests over 5 functions. That is not enough
to claim a 9,398-line port is faithful. These fixtures are the safety net.

Run inside the backend container (the user installs nothing locally):
    docker compose run --rm backend python /app/../tests/characterization/python/generate_fixtures.py
"""

from __future__ import annotations

import json
import os
import pathlib
import sys

# The JWT vectors must be reproducible by the C# test, so pin the signing key
# BEFORE app.core.config is imported (Settings reads env at import time and is
# @lru_cache'd). This value is mirrored in JwtCharacterizationTests.TestSecret.
TEST_SECRET = "characterization-test-secret-key-do-not-use-in-prod"
os.environ["SECRET_KEY"] = TEST_SECRET

# Settings has required fields with no defaults; supply dummies so the module
# imports without a real .env (same trick as backend/conftest.py:12-21).
os.environ.setdefault("DATABASE_URL", "postgresql+psycopg2://u:p@localhost/db")
os.environ.setdefault("S3_ENDPOINT_URL", "http://localhost:9000")
os.environ.setdefault("S3_PUBLIC_URL", "http://localhost:9000")
os.environ.setdefault("S3_ACCESS_KEY", "dummy")
os.environ.setdefault("S3_SECRET_KEY", "dummy")

# The generator imports the REAL production modules — never a reimplementation.
# If an import breaks, the fixture is worthless and we want to know loudly.
sys.path.insert(0, "/app")

FIXTURES = pathlib.Path(__file__).resolve().parents[1] / "fixtures"
FIXTURES.mkdir(parents=True, exist_ok=True)


def write(name: str, payload: object) -> None:
    path = FIXTURES / name
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    n = len(payload["cases"]) if isinstance(payload, dict) and "cases" in payload else "?"
    print(f"  wrote {name:28} ({n} cases)")


# ---------------------------------------------------------------------------
# C1 — bcrypt. Getting this wrong locks out all 50 users.
# ---------------------------------------------------------------------------
def gen_bcrypt() -> None:
    from app.core.security import hash_password, verify_password

    # Includes the byte-72 boundary cases: Python truncates BYTES, not chars.
    # A Cyrillic password whose 72nd byte splits a character is the trap —
    # C# must slice the UTF-8 byte array identically.
    passwords = [
        "password123",
        "P@ssw0rd!",
        "parol",
        "Тест1234",                 # Cyrillic, 2 bytes/char
        "парол" * 10,               # 100 bytes > 72 → truncation active
        "a" * 71,                   # just under
        "a" * 72,                   # exactly at
        "a" * 73,                   # just over → 73rd byte dropped
        "я" * 36,                   # 72 bytes exactly (2 bytes each)
        "я" * 37,                   # 74 bytes → truncation splits a char
        "🎤" * 20,                  # 4 bytes/char → 80 bytes
        "",                         # empty
        " leading and trailing ",
    ]

    cases = []
    for pw in passwords:
        h = hash_password(pw)
        assert verify_password(pw, h), f"self-check failed for {pw!r}"
        cases.append({
            "password": pw,
            "password_utf8_bytes": len(pw.encode("utf-8")),
            "hash": h,
            "verifies": True,
            "wrong_password_verifies": verify_password(pw + "x", h),
        })

    # Known-good hashes: these must verify in C# byte-for-byte.
    # A $2b$12$ hash generated today must still verify years from now.
    write("bcrypt_corpus.json", {
        "_doc": "C# BCrypt.Net-Next must verify every hash here. Truncation is on BYTES.",
        "algorithm": "bcrypt",
        "prefix": "$2b$",
        "cost": 12,
        "truncate_bytes": 72,
        "cases": cases,
    })


# ---------------------------------------------------------------------------
# C2 — JWT. Getting this wrong logs out every user.
# ---------------------------------------------------------------------------
def gen_jwt() -> None:
    from datetime import timedelta

    from app.core.config import settings
    from app.core.security import _create_token, decode_token

    # If this trips, the env var was set too late and the vectors would be
    # signed with a key C# does not know — a silently useless fixture.
    assert settings.SECRET_KEY == TEST_SECRET, (
        f"SECRET_KEY is {settings.SECRET_KEY!r}, expected the pinned test key. "
        "Set it before importing app.core.config."
    )

    cases = []
    for subject, ttl, ttype in [
        ("11111111-1111-1111-1111-111111111111", timedelta(minutes=30), "access"),
        ("22222222-2222-2222-2222-222222222222", timedelta(days=7), "refresh"),
        ("user@example.com", timedelta(minutes=20), "email_verify"),
    ]:
        token = _create_token(subject, ttl, ttype)
        decoded = decode_token(token)
        cases.append({
            "subject": subject,
            "type": ttype,
            "token": token,
            "decoded_claims": sorted(decoded.keys()),
            "sub": decoded["sub"],
        })

    write("jwt_vectors.json", {
        "_doc": (
            "C# must (a) emit exactly these claims and no others, "
            "(b) accept tokens signed with the same SECRET_KEY. "
            "ValidateIssuer=false, ValidateAudience=false, ClockSkew=Zero."
        ),
        "algorithm": "HS256",
        "key_source": "settings.SECRET_KEY, raw UTF-8 (NOT base64-decoded)",
        "test_secret": TEST_SECRET,
        "claims": ["sub", "type", "iat", "exp"],
        "absent_claims": ["iss", "aud", "nbf", "jti", "role"],
        "cases": cases,
    })


# ---------------------------------------------------------------------------
# C8 — XP curve.
# ---------------------------------------------------------------------------
def gen_xp() -> None:
    from app.services.gamification import xp_for_band

    bands = [None, 0, 10, 26.9, 27, 28, 40, 52, 60, 72, 80, 88, 95, 100]
    write("xp_cases.json", {
        "_doc": "xp_for_band: 0 if pct < 27 else round(pct/4). None → 0.",
        "cases": [{"band": b, "xp": xp_for_band(b)} for b in bands],
    })


# ---------------------------------------------------------------------------
# C5 — the score arithmetic every user sees.
# ---------------------------------------------------------------------------
def gen_pron_math() -> None:
    # Mirrors workers/tasks.py:241-247 exactly. Kept as literal arithmetic
    # because the real function is inline in the task body.
    ORTHOEPY_PENALTY_PER_ERROR = 4.0
    ORTHOEPY_PENALTY_CAP = 20.0

    def with_pron(x: float, pron: float | None) -> float:
        return x if pron is None else (x * 4 + pron) / 5

    cases = []
    for text_score in [0, 40, 52.5, 74, 88, 100]:
        for pron in [None, 0, 45, 70, 92, 100]:
            for n_errors in [0, 1, 3, 5, 8]:
                penalty = min(n_errors * ORTHOEPY_PENALTY_PER_ERROR, ORTHOEPY_PENALTY_CAP)
                cases.append({
                    "text_score": text_score,
                    "pron_score": pron,
                    "orthoepy_errors": n_errors,
                    "expected": max(0.0, with_pron(text_score, pron) - penalty),
                })

    write("pron_math_cases.json", {
        "_doc": (
            "level_score = max(0, with_pron(x) - min(n*4, 20)); "
            "with_pron(x) = x if pron is None else (x*4 + pron)/5. "
            "pron is None on the Whisper path — text-only scoring."
        ),
        "penalty_per_error": ORTHOEPY_PENALTY_PER_ERROR,
        "penalty_cap": ORTHOEPY_PENALTY_CAP,
        "cases": cases,
    })


# ---------------------------------------------------------------------------
# C6 — the cosmetic-correction filter. The audit calls this a correctness
# guard, not a nicety: STT emits no punctuation, so the model "fixes" it.
# ---------------------------------------------------------------------------
def gen_cosmetic() -> None:
    from app.services.llm import _norm_for_compare

    pairs = [
        ("я иду в магазин", "Я иду в магазин."),      # capitalization + period → DROP
        ("что ты делаешь", "Что ты делаешь?"),        # → DROP
        ("я идти в магазин", "я иду в магазин"),      # real grammar fix → KEEP
        ("ежик", "ёжик"),                             # ё normalization → DROP
        ("привет  мир", "привет мир"),                # whitespace → DROP
        ("он поехать", "он поехал"),                  # real fix → KEEP
    ]
    write("cosmetic_filter_cases.json", {
        "_doc": (
            "_norm_for_compare: lower → ё=е → strip punctuation → collapse whitespace. "
            "Keep the correction iff normalized(original) != normalized(corrected)."
        ),
        "cases": [{
            "original": o,
            "corrected": c,
            "norm_original": _norm_for_compare(o),
            "norm_corrected": _norm_for_compare(c),
            "keep": _norm_for_compare(o) != _norm_for_compare(c),
        } for o, c in pairs],
    })


# ---------------------------------------------------------------------------
# C7 — shadowing reference match.
# ---------------------------------------------------------------------------
def gen_reference_match() -> None:
    from app.services.stt import _reference_match

    pairs = [
        ("я иду в магазин", "я иду в магазин"),        # exact
        ("я иду в магазин", "я иду в магазин сегодня"),  # extra words
        ("я иду в магазин", "я иду"),                    # partial → below gate?
        ("я иду в магазин", "погода хорошая"),           # off-topic
        ("я иду в магазин", ""),                         # silence
    ]
    cases = []
    for ref, spoken in pairs:
        # Signature is _reference_match(spoken_text, reference_text) — spoken first.
        r = _reference_match(spoken, ref)
        cases.append({"reference": ref, "spoken": spoken, "result": r})

    write("reference_match_cases.json", {
        "_doc": "difflib.SequenceMatcher; on_topic = completeness >= 50.0. Gate for shadowing XP.",
        "on_topic_threshold": 50.0,
        "cases": cases,
    })


# ---------------------------------------------------------------------------
# C10 — phone normalization (sign-up).
# ---------------------------------------------------------------------------
def gen_phone() -> None:
    from app.schemas.auth import normalize_uz_phone

    inputs = [
        "901234567", "+998901234567", "998901234567",
        "90 123 45 67", "+998 90 123-45-67", "8901234567",
        "123", "abcdefghi", "", "+9989012345678",
    ]
    cases = []
    for raw in inputs:
        try:
            cases.append({"input": raw, "output": normalize_uz_phone(raw), "raises": False})
        except Exception as e:
            cases.append({"input": raw, "output": None, "raises": True, "error": type(e).__name__})

    write("phone_cases.json", {
        "_doc": "normalize_uz_phone → canonical +998XXXXXXXXX, or raises.",
        "cases": cases,
    })


# ---------------------------------------------------------------------------
# C3 — the score numbers every user sees: effective_band / rolling_avg /
# best_band. Ported from services/scoring.py:26-55. These are PURE functions of
# the Submission ORM objects handed to them, so we feed the REAL functions
# lightweight duck-typed stand-ins (SimpleNamespace) carrying only the four
# attributes the code touches (created_at, teacher_band, evaluation.level_score,
# evaluation.overall_band). No DB is involved — the functions never query.
#
# created_at is emitted as an integer "tick": the code only ever ORDERS by it
# (newest-first), so an int surrogate is faithful and language-neutral. Ties in
# created_at are resolved by Python's stable sort (original list order kept),
# which C#'s LINQ OrderByDescending reproduces.
# ---------------------------------------------------------------------------
def gen_scoring() -> None:
    from datetime import datetime, timedelta
    from types import SimpleNamespace

    from app.services import scoring

    BASE = datetime(2026, 1, 1)

    def build_scenario(name: str, specs: list[dict], window: int | None = None) -> dict:
        subs = []
        emitted = []
        for sp in specs:
            ev = (
                SimpleNamespace(level_score=sp["level_score"], overall_band=sp["overall_band"])
                if sp["has_evaluation"]
                else None
            )
            sub = SimpleNamespace(
                created_at=BASE + timedelta(seconds=sp["created_at"]),
                teacher_band=sp["teacher_band"],
                evaluation=ev,
            )
            subs.append(sub)
            emitted.append({
                "created_at": sp["created_at"],
                "teacher_band": sp["teacher_band"],
                "has_evaluation": sp["has_evaluation"],
                "level_score": sp["level_score"],
                "overall_band": sp["overall_band"],
                # The REAL production function decides this per-answer number.
                "effective_band": scoring.effective_band(sub),
            })

        win = scoring.RECENT_WINDOW if window is None else window
        return {
            "name": name,
            "window": win,
            "submissions": emitted,
            "rolling_avg": scoring.rolling_avg(subs, win),
            "best_band": scoring.best_band(subs),
        }

    def graded(created_at, level=None, overall=None):
        return {"created_at": created_at, "teacher_band": None, "has_evaluation": True,
                "level_score": level, "overall_band": overall}

    def teacher(created_at, band, level=None, overall=None):
        # A teacher override may sit on top of an existing evaluation.
        return {"created_at": created_at, "teacher_band": band,
                "has_evaluation": level is not None or overall is not None,
                "level_score": level, "overall_band": overall}

    def ungraded(created_at):
        return {"created_at": created_at, "teacher_band": None, "has_evaluation": False,
                "level_score": None, "overall_band": None}

    cases = [
        build_scenario("empty", []),
        build_scenario("all_ungraded", [ungraded(1), ungraded(2), ungraded(3)]),
        # teacher_band=0 is NOT None → must win (the `is not None` trap: 0 is falsy).
        build_scenario("teacher_override_zero", [teacher(1, 0.0, level=90.0)]),
        build_scenario("teacher_override_wins", [teacher(1, 95.0, level=40.0, overall=88.0)]),
        # level_score present → used; overall_band ignored.
        build_scenario("level_score_used", [graded(1, level=74.0, overall=88.0)]),
        # legacy row: no level_score → falls back to overall_band.
        build_scenario("legacy_overall_fallback", [graded(1, level=None, overall=61.0)]),
        # ungraded answers are filtered out before averaging.
        build_scenario("mixed_graded_ungraded",
                       [graded(1, level=40.0), ungraded(2), graded(3, level=80.0)]),
        # 12 graded, distinct ticks: rolling_avg averages only the newest 10;
        # best_band ignores the window (the max sits on the OLDEST, tick=1).
        build_scenario("rolling_window_truncation",
                       [graded(1, level=100.0), graded(2, level=0.0)]
                       + [graded(t, level=50.0) for t in range(3, 13)]),
        # window boundary tie: three answers share tick=5; window=2 must keep the
        # first two in ORIGINAL order (stable sort), dropping the third.
        build_scenario("window_tie_break_stable_order",
                       [graded(5, level=100.0), graded(5, level=60.0), graded(5, level=20.0)],
                       window=2),
        # rounding to 2 decimals (repeating): 223/3 = 74.3333... → 74.33.
        build_scenario("rolling_avg_rounds_two_decimals",
                       [graded(1, level=74.0), graded(2, level=74.0), graded(3, level=75.0)]),
        # banker's-rounding midpoint: 148.25/2 = 74.125 (exact eighth) → 74.12.
        build_scenario("rolling_avg_midpoint_half_even",
                       [graded(1, level=74.0), graded(2, level=74.25)]),
        # best_band picks the max regardless of recency.
        build_scenario("best_band_basic",
                       [graded(1, level=40.0), graded(2, level=88.0),
                        graded(3, level=61.0), graded(4, level=74.0)]),
    ]

    write("scoring_cases.json", {
        "_doc": (
            "services/scoring.py:26-55. PURE functions of Submission objects — "
            "characterized by feeding the REAL effective_band/rolling_avg/best_band "
            "duck-typed stand-ins. "
            "effective_band = teacher_band if not None else (level_score if not None else overall_band); "
            "None if ungraded. "
            "rolling_avg = round(mean of newest `window` effective bands, 2), None if none graded. "
            "best_band = round(max effective band, 2), None if none graded. "
            "created_at is an integer tick (ordering only). Ties keep original list order (stable sort)."
        ),
        "recent_window": scoring.RECENT_WINDOW,
        "cases": cases,
    })


# ---------------------------------------------------------------------------
# C4 — needs_premium: the freemium paywall decision (services/access.py:78-89).
# NOT a pure function — its real signature is needs_premium(db, student, q) and
# it reads the DB (db.get(QuestionBlock, ...) and, via task_index, a COUNT(*)).
# We characterize the REAL decision logic end-to-end by driving the actual
# needs_premium + task_index functions with a fake Session that returns the two
# DB reads we inject: the module row (db.get) and the positional index
# (db.scalar of the COUNT). Only the DB *rows* are constructed; every branch,
# comparison and short-circuit is the production code's own.
# ---------------------------------------------------------------------------
def gen_needs_premium() -> None:
    import uuid as _uuid
    from datetime import datetime
    from types import SimpleNamespace

    from app.models import UserRole
    from app.services import access

    class FakeDB:
        """Returns the injected block for db.get and the injected index for the
        COUNT(*) that task_index issues via db.scalar. It never runs SQL — the
        SQLAlchemy select is built by the real code and then ignored."""
        def __init__(self, block, index):
            self._block = block
            self._index = index

        def get(self, model, ident):
            return self._block

        def scalar(self, stmt):
            return self._index

    orig_n = access.settings.FREE_TASKS_PER_MODULE

    def run(role, is_premium, block_id_present, block_exists, visibility, n, task_index):
        block = (
            SimpleNamespace(visibility=visibility)
            if (block_id_present and block_exists)
            else None
        )
        student = SimpleNamespace(role=role, is_premium=is_premium, id=_uuid.uuid4())
        q = SimpleNamespace(
            block_id=_uuid.uuid4() if block_id_present else None,
            sort_order=5,
            created_at=datetime(2026, 1, 1),
        )
        db = FakeDB(block, task_index)
        access.settings.FREE_TASKS_PER_MODULE = n
        try:
            result = access.needs_premium(db, student, q)
        finally:
            access.settings.FREE_TASKS_PER_MODULE = orig_n
        return {
            "role": role.value,
            "is_premium": is_premium,
            "block_id_present": block_id_present,
            "block_exists": block_exists,
            "visibility": visibility,
            "free_tasks_per_module": n,
            "task_index": task_index,
            "expected": result,
        }

    S, T, A = UserRole.student, UserRole.teacher, UserRole.admin
    cases = [
        # Free positions on an official PUBLIC module (default n=3).
        run(S, False, True, True, "public", 3, 0),
        run(S, False, True, True, "public", 3, 2),
        # First position that needs premium (index >= n).
        run(S, False, True, True, "public", 3, 3),
        run(S, False, True, True, "public", 3, 7),
        # n <= 0 means the whole module is free.
        run(S, False, True, True, "public", 0, 9),
        run(S, False, True, True, "public", -1, 9),
        # Teacher-governed (group) modules are never self-serve paywalled.
        run(S, False, True, True, "group", 3, 9),
        # Dangling block_id (db.get returns None) → not gated.
        run(S, False, True, False, None, 3, 9),
        # Task with no module at all → not gated.
        run(S, False, False, False, None, 3, 9),
        # Premium student bypasses the gate everywhere.
        run(S, True, True, True, "public", 3, 9),
        # Non-students (teacher/admin) are never gated.
        run(T, False, True, True, "public", 3, 9),
        run(A, False, True, True, "public", 3, 9),
    ]

    write("needs_premium_cases.json", {
        "_doc": (
            "services/access.py:78-89 (needs_premium) + 54-75 (task_index). Real "
            "signature needs_premium(db, student, q); characterized by running the "
            "REAL function with a fake Session injecting (a) the module row and (b) "
            "the positional COUNT. Decision: non-student OR premium → False; no "
            "module or visibility != 'public' → False; FREE_TASKS_PER_MODULE (n) "
            "<= 0 → False; else task_index >= n. Only PUBLIC modules are gated."
        ),
        "default_free_tasks_per_module": orig_n,
        "cases": cases,
    })


# ---------------------------------------------------------------------------
# C9 — task_index ordering: the 0-based freemium position of a task among its
# module siblings (services/access.py:54-75). The count itself is issued as a
# Postgres COUNT(*) (db.scalar), so it CANNOT run without a database. What we
# CAN and must characterize is the ordering DECISION it delegates to SQL: the
# WHERE predicate. This is transcribed below one-to-one from access.py:61-71 and
# the count is computed in-memory over constructed rows. The C# port mirrors the
# same predicate. (See report note: the SQL execution is the one part not
# reducible to a pure fixture.)
#
# Ordering key per row = (sort_order, created_at) ascending; a row is "before"
# the target iff that tuple is strictly less — exactly
#   sort_order < t.sort_order OR (sort_order == t.sort_order AND created_at < t.created_at).
# created_at is an integer tick (ordering only).
# ---------------------------------------------------------------------------
def gen_task_index() -> None:
    def task_index_pure(target: dict, siblings: list[dict]) -> int:
        # access.py:57-58 — no module → position 0.
        if not target["block_id_present"]:
            return 0
        count = 0
        for r in siblings:
            # access.py:61 — same module (Question.block_id == q.block_id).
            if r["block_id"] != target["block_id"]:
                continue
            # access.py:62-63 — live siblings only.
            if r["is_deleted"] or not r["is_published"]:
                continue
            # access.py:64-71 — strictly before in (sort_order, created_at).
            before = r["sort_order"] < target["sort_order"] or (
                r["sort_order"] == target["sort_order"]
                and r["created_at"] < target["created_at"]
            )
            if before:
                count += 1
        return count

    B = "block-A"  # shared module id for the sibling set

    def target(sort_order, created_at, block_id=B, present=True):
        return {"sort_order": sort_order, "created_at": created_at,
                "block_id": block_id, "block_id_present": present}

    def row(sort_order, created_at, block_id=B, published=True, deleted=False):
        return {"sort_order": sort_order, "created_at": created_at, "block_id": block_id,
                "is_published": published, "is_deleted": deleted}

    def case(name, tgt, siblings):
        return {"name": name, "block_id": B, "target": tgt, "siblings": siblings,
                "expected_index": task_index_pure(tgt, siblings)}

    cases = [
        # Only the target in the module → position 0.
        case("empty_block", target(0, 100), [row(0, 100)]),
        # Lowest sort_order → 0, even with later siblings.
        case("target_first", target(0, 100), [row(0, 100), row(1, 50), row(2, 50)]),
        # Three published siblings ahead by sort_order → 3.
        case("target_last",
             target(3, 100),
             [row(0, 10), row(1, 20), row(2, 30), row(3, 100)]),
        # created_at breaks sort_order ties: {so=1,ca=50} and {so=0,ca=999} are
        # before; {so=1,ca=150} is after → 2.
        case("sort_order_tie_broken_by_created_at",
             target(1, 100),
             [row(1, 50), row(1, 150), row(0, 999), row(1, 100)]),
        # Exact (sort_order, created_at) tie is NOT "before" (strict <) → 1.
        case("exact_tie_not_counted",
             target(1, 100),
             [row(1, 99), row(1, 100), row(1, 100)]),
        # A soft-deleted earlier sibling is excluded.
        case("excludes_deleted",
             target(2, 100),
             [row(0, 10), row(1, 20, deleted=True), row(2, 100)]),
        # An unpublished earlier sibling is excluded.
        case("excludes_unpublished",
             target(2, 100),
             [row(0, 10), row(1, 20, published=False), row(2, 100)]),
        # A sibling in a DIFFERENT module is excluded.
        case("excludes_other_block",
             target(2, 100),
             [row(0, 10), row(1, 20, block_id="block-B"), row(2, 100)]),
        # No module at all → 0 regardless of any rows.
        case("no_block_returns_zero",
             target(2, 100, block_id=None, present=False),
             [row(0, 10), row(1, 20)]),
        # Realistic mix: 2 valid-before, plus a deleted, an unpublished, and an
        # after → 2.
        case("mixed_realistic",
             target(5, 500),
             [row(1, 10), row(3, 999),
              row(2, 20, deleted=True), row(4, 30, published=False),
              row(6, 5), row(5, 500)]),
    ]

    write("task_index_cases.json", {
        "_doc": (
            "services/access.py:54-75 (task_index). DB-bound: the count is a "
            "Postgres COUNT(*) and cannot run without a database. We characterize "
            "the ordering PREDICATE it delegates to SQL (transcribed from "
            "access.py:61-71): among same-module, published, non-deleted siblings, "
            "count those strictly before the target in (sort_order, created_at). "
            "block_id absent → 0. created_at is an integer tick (ordering only)."
        ),
        "cases": cases,
    })


if __name__ == "__main__":
    print("Freezing Python behavior into fixtures...")
    for fn in (gen_bcrypt, gen_jwt, gen_xp, gen_pron_math,
               gen_cosmetic, gen_reference_match, gen_phone,
               gen_scoring, gen_needs_premium, gen_task_index):
        try:
            fn()
        except Exception as e:
            print(f"  FAILED {fn.__name__}: {type(e).__name__}: {e}")
            raise
    print(f"\nFixtures → {FIXTURES}")
    print("These are now the contract. The C# port must satisfy every one.")
