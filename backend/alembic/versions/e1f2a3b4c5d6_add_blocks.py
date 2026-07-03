"""add blocks (track → block → task) and questions.block_id

Revision ID: e1f2a3b4c5d6
Revises: d1e2f3a4b5c6
Create Date: 2026-07-03 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'e1f2a3b4c5d6'
down_revision: Union[str, None] = 'd1e2f3a4b5c6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'blocks',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('teacher_id', sa.Uuid(), nullable=False),
        sa.Column('register', sa.String(length=16), nullable=False),
        sa.Column('name', sa.String(length=128), nullable=False),
        sa.Column('level', sa.String(length=8), nullable=True),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('sort_order', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('is_published', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['teacher_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_blocks_teacher_id'), 'blocks', ['teacher_id'], unique=False)
    op.create_index(op.f('ix_blocks_register'), 'blocks', ['register'], unique=False)
    op.create_index(op.f('ix_blocks_is_published'), 'blocks', ['is_published'], unique=False)

    op.add_column('questions', sa.Column('block_id', sa.Uuid(), nullable=True))
    op.create_index(op.f('ix_questions_block_id'), 'questions', ['block_id'], unique=False)
    op.create_foreign_key(
        'fk_questions_block_id', 'questions', 'blocks', ['block_id'], ['id'], ondelete='SET NULL'
    )


def downgrade() -> None:
    op.drop_constraint('fk_questions_block_id', 'questions', type_='foreignkey')
    op.drop_index(op.f('ix_questions_block_id'), table_name='questions')
    op.drop_column('questions', 'block_id')
    op.drop_index(op.f('ix_blocks_is_published'), table_name='blocks')
    op.drop_index(op.f('ix_blocks_register'), table_name='blocks')
    op.drop_index(op.f('ix_blocks_teacher_id'), table_name='blocks')
    op.drop_table('blocks')
