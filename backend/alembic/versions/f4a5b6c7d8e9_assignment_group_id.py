"""add group_id to assignments

Revision ID: f4a5b6c7d8e9
Revises: e3f4a5b6c7d8
Create Date: 2026-06-11 03:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f4a5b6c7d8e9'
down_revision: Union[str, None] = 'e3f4a5b6c7d8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'assignments',
        sa.Column('group_id', sa.Uuid(), sa.ForeignKey('groups.id', ondelete='SET NULL'), nullable=True, index=True),
    )


def downgrade() -> None:
    op.drop_column('assignments', 'group_id')
