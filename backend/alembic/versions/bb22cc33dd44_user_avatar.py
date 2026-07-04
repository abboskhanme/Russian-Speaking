"""users.avatar_key — user-uploaded avatar image

Revision ID: bb22cc33dd44
Revises: aa11bb22cc33
Create Date: 2026-07-04 01:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'bb22cc33dd44'
down_revision: Union[str, None] = 'aa11bb22cc33'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('avatar_key', sa.String(length=512), nullable=True))


def downgrade() -> None:
    op.drop_column('users', 'avatar_key')
