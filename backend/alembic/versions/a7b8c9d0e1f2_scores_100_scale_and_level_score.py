"""Move evaluation scores to a 0–100 scale and add level_score.

Previously scores were IELTS-style 0–9 bands. We now use a 0–100 scale and add a
separate ``level_score`` (overall relative to the task's own CEFR level). Existing
rows are rescaled (×100/9, capped at 100); ``level_score`` is backfilled from the
absolute overall as a best-effort default.

Revision ID: a7b8c9d0e1f2
Revises: d4e5f6a7b8c9
Create Date: 2026-06-16
"""

from typing import Union

import sqlalchemy as sa

from alembic import op

revision: str = "a7b8c9d0e1f2"
down_revision: Union[str, None] = "d4e5f6a7b8c9"
branch_labels = None
depends_on = None

# 0–9 band → 0–100, capped at 100.
_RESCALE_EVAL = """
UPDATE evaluations SET
    fluency_score       = LEAST(100, ROUND((fluency_score       * 100.0 / 9.0)::numeric, 1)),
    lexical_score       = LEAST(100, ROUND((lexical_score       * 100.0 / 9.0)::numeric, 1)),
    grammar_score       = LEAST(100, ROUND((grammar_score       * 100.0 / 9.0)::numeric, 1)),
    relevance_score     = CASE WHEN relevance_score IS NULL THEN NULL
                               ELSE LEAST(100, ROUND((relevance_score     * 100.0 / 9.0)::numeric, 1)) END,
    pronunciation_score = CASE WHEN pronunciation_score IS NULL THEN NULL
                               ELSE LEAST(100, ROUND((pronunciation_score * 100.0 / 9.0)::numeric, 1)) END,
    overall_band        = LEAST(100, ROUND((overall_band        * 100.0 / 9.0)::numeric, 1))
"""

_RESCALE_TEACHER = """
UPDATE submissions SET
    teacher_band = LEAST(100, ROUND((teacher_band * 100.0 / 9.0)::numeric, 1))
WHERE teacher_band IS NOT NULL
"""


def upgrade() -> None:
    op.add_column("evaluations", sa.Column("level_score", sa.Float(), nullable=True))
    op.execute(_RESCALE_EVAL)
    op.execute(_RESCALE_TEACHER)
    # Backfill level_score from the (now rescaled) absolute overall.
    op.execute("UPDATE evaluations SET level_score = overall_band WHERE level_score IS NULL")


def downgrade() -> None:
    # Reverse the rescale (×9/100) before dropping the new column.
    op.execute(
        "UPDATE evaluations SET "
        "fluency_score = ROUND((fluency_score * 9.0 / 100.0)::numeric, 1), "
        "lexical_score = ROUND((lexical_score * 9.0 / 100.0)::numeric, 1), "
        "grammar_score = ROUND((grammar_score * 9.0 / 100.0)::numeric, 1), "
        "relevance_score = CASE WHEN relevance_score IS NULL THEN NULL "
        "ELSE ROUND((relevance_score * 9.0 / 100.0)::numeric, 1) END, "
        "pronunciation_score = CASE WHEN pronunciation_score IS NULL THEN NULL "
        "ELSE ROUND((pronunciation_score * 9.0 / 100.0)::numeric, 1) END, "
        "overall_band = ROUND((overall_band * 9.0 / 100.0)::numeric, 1)"
    )
    op.execute(
        "UPDATE submissions SET teacher_band = ROUND((teacher_band * 9.0 / 100.0)::numeric, 1) "
        "WHERE teacher_band IS NOT NULL"
    )
    op.drop_column("evaluations", "level_score")
