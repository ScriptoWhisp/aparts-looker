"""add feedback table

Revision ID: 0003
Revises: 0002
Create Date: 2026-08-08 00:00:00.000000

Creates the `feedback` table backing the in-app bug/feature/ux/perf report
system (floating button + #feedback tab). Columns match models.Feedback
exactly (see module docstring there for the id-generation rationale).

Postgres 16-alpine ships gen_random_uuid() built into core since PG13 —
no pgcrypto/uuid-ossp extension needed.

Downgrade: drops the table (indexes are dropped implicitly with it, but
listed explicitly first for symmetry with 0001's downgrade style).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "feedback",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("type", sa.String(length=16), nullable=False, server_default="bug"),
        sa.Column("comment", sa.Text(), nullable=False, server_default=""),
        sa.Column("url", sa.Text(), nullable=False, server_default=""),
        sa.Column("viewport", sa.String(length=32), nullable=True),
        sa.Column("user_agent", sa.Text(), nullable=True),
        sa.Column(
            "console_logs",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'"),
        ),
        sa.Column("screenshot", sa.LargeBinary(), nullable=True),
        sa.Column("screenshot_mime", sa.String(length=64), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="open"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_index("ix_feedback_created_at", "feedback", ["created_at"])
    op.create_index("ix_feedback_status", "feedback", ["status"])


def downgrade() -> None:
    op.drop_index("ix_feedback_status", table_name="feedback")
    op.drop_index("ix_feedback_created_at", table_name="feedback")
    op.drop_table("feedback")
