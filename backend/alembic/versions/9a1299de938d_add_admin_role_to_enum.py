"""add admin role to enum

Revision ID: 9a1299de938d
Revises: f8f624b844ca
Create Date: 2026-06-09 12:42:09.833248
"""
from typing import Sequence, Union

from alembic import op


revision: str = '9a1299de938d'
down_revision: Union[str, None] = 'f8f624b844ca'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add the new 'admin' value to the existing PostgreSQL enum type.
    op.execute("ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'admin'")


def downgrade() -> None:
    # PostgreSQL does not support removing enum values; no-op.
    pass
