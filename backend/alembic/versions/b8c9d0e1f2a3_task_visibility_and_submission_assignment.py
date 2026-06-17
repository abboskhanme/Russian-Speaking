"""Add Question.is_public (open vs assigned task) and Submission.assignment_id.

Open tasks (is_public=True) stay in the public pool for everyone; assigned tasks
(is_public=False) are reachable only via an active assignment. Submissions made
against an assignment record assignment_id so the group/class leaderboard can be
scored from internal (assigned) tasks only.

Existing questions are backfilled to is_public=True (preserve current behaviour:
every published question was open). Existing submissions keep assignment_id NULL.

Revision ID: b8c9d0e1f2a3
Revises: a7b8c9d0e1f2
Create Date: 2026-06-17
"""

from typing import Union

import sqlalchemy as sa

from alembic import op

revision: str = "b8c9d0e1f2a3"
down_revision: Union[str, None] = "a7b8c9d0e1f2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "questions",
        sa.Column("is_public", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.create_index("ix_questions_is_public", "questions", ["is_public"])
    # Existing questions were all open — preserve that.
    op.execute("UPDATE questions SET is_public = true")

    op.add_column(
        "submissions",
        sa.Column("assignment_id", sa.Uuid(), nullable=True),
    )
    op.create_index("ix_submissions_assignment_id", "submissions", ["assignment_id"])
    op.create_foreign_key(
        "fk_submissions_assignment_id",
        "submissions",
        "assignments",
        ["assignment_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_submissions_assignment_id", "submissions", type_="foreignkey")
    op.drop_index("ix_submissions_assignment_id", table_name="submissions")
    op.drop_column("submissions", "assignment_id")
    op.drop_index("ix_questions_is_public", table_name="questions")
    op.drop_column("questions", "is_public")
