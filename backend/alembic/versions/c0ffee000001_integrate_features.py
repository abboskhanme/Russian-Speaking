"""integrate: shadowing phrases, question instruction/sort_order, block sort_order

Revision ID: c0ffee000001
Revises: a1b2c3000003
Create Date: 2026-07-03 00:00:00.000000
"""
import uuid
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'c0ffee000001'
down_revision: Union[str, None] = 'a1b2c3000003'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_SEED = [
    ("A1–A2", "Привет! Меня зовут Анна."),
    ("A1–A2", "Сегодня хорошая погода."),
    ("A1–A2", "Я люблю читать книги."),
    ("A1–A2", "Где находится библиотека?"),
    ("A1–A2", "Мне нравится русская музыка."),
    ("B1–B2", "Вчера я ходил в кино с друзьями."),
    ("B1–B2", "Мне кажется, что это очень интересный вопрос."),
    ("B1–B2", "Если будет время, я обязательно тебе позвоню."),
    ("B1–B2", "Этот город известен своей красивой архитектурой."),
    ("C1", "Несмотря на трудности, мы продолжали работать над проектом."),
    ("C1", "Чем больше я узнаю, тем больше понимаю, как мало знаю."),
]


def upgrade() -> None:
    # Shadowing target sentences (teacher-managed).
    table = op.create_table(
        'shadowing_phrases',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('created_by', sa.Uuid(), nullable=True),
        sa.Column('text', sa.String(length=500), nullable=False),
        sa.Column('level', sa.String(length=16), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_shadowing_phrases_created_by'), 'shadowing_phrases', ['created_by'], unique=False)
    op.create_index(op.f('ix_shadowing_phrases_is_active'), 'shadowing_phrases', ['is_active'], unique=False)
    op.bulk_insert(
        table,
        [{"id": uuid.uuid4(), "created_by": None, "text": t, "level": lvl, "is_active": True} for lvl, t in _SEED],
    )

    # Task condition ("shart") + drag-and-drop ordering within a module.
    op.add_column('questions', sa.Column('instruction_text', sa.Text(), nullable=True))
    op.add_column('questions', sa.Column('sort_order', sa.Integer(), nullable=False, server_default='0'))
    # Module (question_blocks) ordering for drag-and-drop.
    op.add_column('question_blocks', sa.Column('sort_order', sa.Integer(), nullable=False, server_default='0'))


def downgrade() -> None:
    op.drop_column('question_blocks', 'sort_order')
    op.drop_column('questions', 'sort_order')
    op.drop_column('questions', 'instruction_text')
    op.drop_index(op.f('ix_shadowing_phrases_is_active'), table_name='shadowing_phrases')
    op.drop_index(op.f('ix_shadowing_phrases_created_by'), table_name='shadowing_phrases')
    op.drop_table('shadowing_phrases')
