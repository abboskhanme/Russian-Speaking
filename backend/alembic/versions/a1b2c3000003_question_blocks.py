"""add question blocks and ru_style

Revision ID: a1b2c3000003
Revises: a1b2c3000002
Create Date: 2026-06-30 00:00:03.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a1b2c3000003'
down_revision: Union[str, None] = 'a1b2c3000002'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'question_blocks',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('teacher_id', sa.Uuid(), nullable=False),
        sa.Column('name', sa.String(length=128), nullable=False),
        sa.Column('topic', sa.String(length=128), nullable=True),
        sa.Column('level', sa.String(length=8), nullable=True),
        sa.Column('ru_style', sa.String(length=8), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['teacher_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_question_blocks_teacher_id'), 'question_blocks', ['teacher_id'], unique=False)

    op.add_column('questions', sa.Column('block_id', sa.Uuid(), nullable=True))
    op.add_column('questions', sa.Column('ru_style', sa.String(length=8), nullable=True))
    op.create_index(op.f('ix_questions_block_id'), 'questions', ['block_id'], unique=False)
    op.create_index(op.f('ix_questions_ru_style'), 'questions', ['ru_style'], unique=False)
    op.create_foreign_key(
        'fk_questions_block_id', 'questions', 'question_blocks', ['block_id'], ['id'], ondelete='SET NULL'
    )


def downgrade() -> None:
    op.drop_constraint('fk_questions_block_id', 'questions', type_='foreignkey')
    op.drop_index(op.f('ix_questions_ru_style'), table_name='questions')
    op.drop_index(op.f('ix_questions_block_id'), table_name='questions')
    op.drop_column('questions', 'ru_style')
    op.drop_column('questions', 'block_id')
    op.drop_index(op.f('ix_question_blocks_teacher_id'), table_name='question_blocks')
    op.drop_table('question_blocks')
