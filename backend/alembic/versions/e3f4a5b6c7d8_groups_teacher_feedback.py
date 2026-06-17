"""groups + group_members, teacher feedback on submissions

Revision ID: e3f4a5b6c7d8
Revises: d2e3f4a5b6c7
Create Date: 2026-06-11 02:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e3f4a5b6c7d8'
down_revision: Union[str, None] = 'd2e3f4a5b6c7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # submissions — teacher manual feedback
    op.add_column('submissions', sa.Column('teacher_comment', sa.Text(), nullable=True))
    op.add_column('submissions', sa.Column('teacher_band', sa.Float(), nullable=True))
    op.add_column(
        'submissions',
        sa.Column('reviewed_by', sa.Uuid(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
    )
    op.add_column('submissions', sa.Column('reviewed_at', sa.DateTime(timezone=True), nullable=True))

    # groups
    op.create_table(
        'groups',
        sa.Column('id', sa.Uuid(), primary_key=True),
        sa.Column('teacher_id', sa.Uuid(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('name', sa.String(length=128), nullable=False),
        sa.Column('join_code', sa.String(length=12), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint('join_code', name='uq_groups_join_code'),
    )

    # group_members
    op.create_table(
        'group_members',
        sa.Column('id', sa.Uuid(), primary_key=True),
        sa.Column('group_id', sa.Uuid(), sa.ForeignKey('groups.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('student_id', sa.Uuid(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint('group_id', 'student_id', name='uq_group_member'),
    )


def downgrade() -> None:
    op.drop_table('group_members')
    op.drop_table('groups')
    for col in ('reviewed_at', 'reviewed_by', 'teacher_band', 'teacher_comment'):
        op.drop_column('submissions', col)
