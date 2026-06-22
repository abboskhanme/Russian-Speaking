"""Add delivery sub-scores (naturalness, speech_rate, intonation) and native_likeness.

These are diagnostic, audio-judged signals layered on top of the four core criteria.
All nullable so existing evaluation rows (scored before these existed) stay valid.

Revision ID: e5f6a7b8c9d0
Revises: c9d0e1f2a3b4
Create Date: 2026-06-22
"""

from typing import Union

import sqlalchemy as sa

from alembic import op

revision: str = "e5f6a7b8c9d0"
down_revision: Union[str, None] = "c9d0e1f2a3b4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("evaluations", sa.Column("naturalness_score", sa.Float(), nullable=True))
    op.add_column("evaluations", sa.Column("speech_rate_score", sa.Float(), nullable=True))
    op.add_column("evaluations", sa.Column("intonation_score", sa.Float(), nullable=True))
    op.add_column("evaluations", sa.Column("native_likeness", sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column("evaluations", "native_likeness")
    op.drop_column("evaluations", "intonation_score")
    op.drop_column("evaluations", "speech_rate_score")
    op.drop_column("evaluations", "naturalness_score")
