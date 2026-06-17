"""add is_premium, google_sub, nullable password to users

Revision ID: c1a2b3d4e5f6
Revises: bdb587957991
Create Date: 2026-06-11 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c1a2b3d4e5f6'
down_revision: Union[str, None] = 'bdb587957991'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'users',
        sa.Column('is_premium', sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column('users', sa.Column('google_sub', sa.String(length=255), nullable=True))
    op.create_unique_constraint('uq_users_google_sub', 'users', ['google_sub'])
    op.alter_column('users', 'password_hash', existing_type=sa.String(length=255), nullable=True)


def downgrade() -> None:
    op.alter_column('users', 'password_hash', existing_type=sa.String(length=255), nullable=False)
    op.drop_constraint('uq_users_google_sub', 'users', type_='unique')
    op.drop_column('users', 'google_sub')
    op.drop_column('users', 'is_premium')
