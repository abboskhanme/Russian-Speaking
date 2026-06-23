"""add age and address (region/district) to users

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-06-23 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f6a7b8c9d0e1'
down_revision: Union[str, None] = 'e5f6a7b8c9d0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Nullable so existing accounts (and admin-created teachers / Google sign-ups)
    # stay valid; new student sign-ups fill them in via the registration form.
    op.add_column('users', sa.Column('age', sa.Integer(), nullable=True))
    op.add_column('users', sa.Column('region', sa.String(length=64), nullable=True))
    op.add_column('users', sa.Column('district', sa.String(length=64), nullable=True))


def downgrade() -> None:
    op.drop_column('users', 'district')
    op.drop_column('users', 'region')
    op.drop_column('users', 'age')
