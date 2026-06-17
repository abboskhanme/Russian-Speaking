"""shadowing: nullable question_id + reference_text on submissions

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-06-13 01:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c3d4e5f6a7b8'
down_revision: Union[str, None] = 'b2c3d4e5f6a7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('submissions', sa.Column('reference_text', sa.Text(), nullable=True))
    op.alter_column('submissions', 'question_id', existing_type=sa.UUID(), nullable=True)


def downgrade() -> None:
    op.alter_column('submissions', 'question_id', existing_type=sa.UUID(), nullable=False)
    op.drop_column('submissions', 'reference_text')
