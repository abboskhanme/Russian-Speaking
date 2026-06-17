"""gamification fields, model answers, assignments, reviews, xp events

Revision ID: d2e3f4a5b6c7
Revises: c1a2b3d4e5f6
Create Date: 2026-06-11 01:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision: str = 'd2e3f4a5b6c7'
down_revision: Union[str, None] = 'c1a2b3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # users — gamification fields
    op.add_column('users', sa.Column('xp', sa.Integer(), nullable=False, server_default='0'))
    op.add_column('users', sa.Column('daily_goal', sa.Integer(), nullable=False, server_default='1'))
    op.add_column('users', sa.Column('streak_freezes', sa.Integer(), nullable=False, server_default='0'))
    op.add_column('users', sa.Column('current_streak', sa.Integer(), nullable=False, server_default='0'))
    op.add_column('users', sa.Column('longest_streak', sa.Integer(), nullable=False, server_default='0'))
    op.add_column('users', sa.Column('last_practice_date', sa.Date(), nullable=True))

    # questions — model answer
    op.add_column('questions', sa.Column('model_answer_text', sa.Text(), nullable=True))

    # evaluations — explain-my-answer cache
    op.add_column('evaluations', sa.Column('explanation', JSONB(), nullable=True))

    # assignments
    op.create_table(
        'assignments',
        sa.Column('id', sa.Uuid(), primary_key=True),
        sa.Column('teacher_id', sa.Uuid(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('student_id', sa.Uuid(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('question_id', sa.Uuid(), sa.ForeignKey('questions.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('due_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # review_items
    op.create_table(
        'review_items',
        sa.Column('id', sa.Uuid(), primary_key=True),
        sa.Column('student_id', sa.Uuid(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('question_id', sa.Uuid(), sa.ForeignKey('questions.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('weakness_dim', sa.String(length=32), nullable=False),
        sa.Column('interval_index', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('due_at', sa.DateTime(timezone=True), nullable=False, index=True),
        sa.Column('completed', sa.Boolean(), nullable=False, server_default=sa.false(), index=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # xp_events
    op.create_table(
        'xp_events',
        sa.Column('id', sa.Uuid(), primary_key=True),
        sa.Column('student_id', sa.Uuid(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('submission_id', sa.Uuid(), sa.ForeignKey('submissions.id', ondelete='SET NULL'), nullable=True),
        sa.Column('amount', sa.Integer(), nullable=False),
        sa.Column('reason', sa.String(length=32), nullable=False, server_default='submission'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table('xp_events')
    op.drop_table('review_items')
    op.drop_table('assignments')
    op.drop_column('evaluations', 'explanation')
    op.drop_column('questions', 'model_answer_text')
    for col in ('last_practice_date', 'longest_streak', 'current_streak', 'streak_freezes', 'daily_goal', 'xp'):
        op.drop_column('users', col)
