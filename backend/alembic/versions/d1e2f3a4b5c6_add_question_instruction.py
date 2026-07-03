"""add instruction_text (task condition/"shart") to questions

Revision ID: d1e2f3a4b5c6
Revises: f7a8b9c0d1e2
Create Date: 2026-07-03 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'd1e2f3a4b5c6'
down_revision: Union[str, None] = 'f7a8b9c0d1e2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Nullable so all existing questions stay valid (no separate condition yet).
    op.add_column('questions', sa.Column('instruction_text', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('questions', 'instruction_text')
