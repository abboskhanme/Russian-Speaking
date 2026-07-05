"""Module visibility/publish/cover + backfill every task into a module.

Part of the "everything is module-based" restructure (Phase 1). Adds to
question_blocks:
  * visibility  — "public" (official platform module, visible to every student
                  incl. teacherless ones) | "group" (private teacher module).
  * is_published — draft vs live at the module level.
  * cover_key    — S3 key of the module cover image.

Data backfill (behaviour-preserving):
  * Existing modules were always live (no publish flag existed) → is_published=true.
  * Every task with no module (block_id IS NULL) is placed into one:
      - public tasks (is_public=true)  → a single official "Ochiq mashqlar"
        module (visibility=public), owned by an admin (fallback: the task owner).
      - assigned tasks (is_public=false) → a per-teacher "Umumiy" module
        (visibility=group).
    This keeps the current public-pool / assigned behaviour intact; Phase 2 moves
    access gating onto the module.

`questions.block_id` stays NULLABLE for now — making it NOT NULL requires settling
module-deletion semantics (Phase 2/3), so it is deferred to a later migration.

Revision ID: c1d2e3f4a5b6
Revises: bb22cc33dd44
Create Date: 2026-07-05
"""

import uuid
from typing import Union

import sqlalchemy as sa

from alembic import op

revision: str = "c1d2e3f4a5b6"
down_revision: Union[str, None] = "bb22cc33dd44"
branch_labels = None
depends_on = None


_INSERT_MODULE = sa.text(
    "INSERT INTO question_blocks (id, teacher_id, name, sort_order, visibility, is_published) "
    "VALUES (:id, :tid, :name, :so, :vis, true)"
)
_ATTACH = sa.text("UPDATE questions SET block_id = :bid, sort_order = :so WHERE id = :qid")


def upgrade() -> None:
    # ── Schema ──────────────────────────────────────────────────────────────
    op.add_column(
        "question_blocks",
        sa.Column("visibility", sa.String(8), nullable=False, server_default="group"),
    )
    op.create_index("ix_question_blocks_visibility", "question_blocks", ["visibility"])
    op.add_column(
        "question_blocks",
        sa.Column("is_published", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.add_column("question_blocks", sa.Column("cover_key", sa.String(512), nullable=True))

    # Existing modules were live before a publish flag existed — keep them visible.
    op.execute("UPDATE question_blocks SET is_published = true")

    bind = op.get_bind()

    # ── Backfill: public orphan tasks → one official public module ──────────
    admin_id = bind.execute(
        sa.text("SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1")
    ).scalar()
    public_orphans = bind.execute(
        sa.text(
            "SELECT id, teacher_id FROM questions "
            "WHERE block_id IS NULL AND is_public = true ORDER BY created_at"
        )
    ).fetchall()
    if public_orphans:
        owner = admin_id or public_orphans[0].teacher_id
        mod_id = uuid.uuid4()
        bind.execute(
            _INSERT_MODULE,
            {"id": mod_id, "tid": owner, "name": "Ochiq mashqlar", "so": 0, "vis": "public"},
        )
        for i, row in enumerate(public_orphans):
            bind.execute(_ATTACH, {"bid": mod_id, "so": i, "qid": row.id})

    # ── Backfill: assigned orphan tasks → per-teacher "Umumiy" module ───────
    teacher_ids = [
        r.teacher_id
        for r in bind.execute(
            sa.text(
                "SELECT DISTINCT teacher_id FROM questions "
                "WHERE block_id IS NULL AND is_public = false"
            )
        ).fetchall()
    ]
    for tid in teacher_ids:
        next_so = bind.execute(
            sa.text("SELECT COALESCE(MAX(sort_order), -1) + 1 FROM question_blocks WHERE teacher_id = :tid"),
            {"tid": tid},
        ).scalar()
        mod_id = uuid.uuid4()
        bind.execute(
            _INSERT_MODULE,
            {"id": mod_id, "tid": tid, "name": "Umumiy", "so": next_so, "vis": "group"},
        )
        orphans = bind.execute(
            sa.text(
                "SELECT id FROM questions "
                "WHERE block_id IS NULL AND is_public = false AND teacher_id = :tid "
                "ORDER BY created_at"
            ),
            {"tid": tid},
        ).fetchall()
        for i, qr in enumerate(orphans):
            bind.execute(_ATTACH, {"bid": mod_id, "so": i, "qid": qr.id})


def downgrade() -> None:
    # Schema-only rollback; the backfilled block_id links are harmless and kept.
    op.drop_column("question_blocks", "cover_key")
    op.drop_column("question_blocks", "is_published")
    op.drop_index("ix_question_blocks_visibility", table_name="question_blocks")
    op.drop_column("question_blocks", "visibility")
