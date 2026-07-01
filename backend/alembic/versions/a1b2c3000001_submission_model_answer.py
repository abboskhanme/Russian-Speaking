"""add per-submission model answer

Revision ID: a1b2c3000001
Revises: f6a7b8c9d0e1
Create Date: 2026-06-30 00:00:01.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a1b2c3000001'
down_revision: Union[str, None] = 'f6a7b8c9d0e1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('submissions', sa.Column('model_answer_text', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('submissions', 'model_answer_text')
