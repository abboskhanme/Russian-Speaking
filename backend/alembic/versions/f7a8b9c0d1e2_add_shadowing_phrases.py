"""add shadowing_phrases table (teacher-managed target sentences)

Revision ID: f7a8b9c0d1e2
Revises: f6a7b8c9d0e1
Create Date: 2026-07-02 00:00:00.000000
"""
import uuid
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'f7a8b9c0d1e2'
down_revision: Union[str, None] = 'f6a7b8c9d0e1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# The phrases that used to be hard-coded in the frontend — seeded so the page
# isn't empty on first load. created_by is NULL (system-seeded).
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
        [
            {"id": uuid.uuid4(), "created_by": None, "text": text, "level": level, "is_active": True}
            for level, text in _SEED
        ],
    )


def downgrade() -> None:
    op.drop_index(op.f('ix_shadowing_phrases_is_active'), table_name='shadowing_phrases')
    op.drop_index(op.f('ix_shadowing_phrases_created_by'), table_name='shadowing_phrases')
    op.drop_table('shadowing_phrases')
