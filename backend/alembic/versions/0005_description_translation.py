"""add listings.description_ru + description_bullets

Revision ID: 0005
Revises: 0004
Create Date: 2026-08-09 00:00:00.000000

Wave C of the shortlist detail description card:
  - New `description_ru` TEXT column — Russian translation of the raw
    kv.ee description, produced by the same evaluate_listing() Claude call
    (no second Anthropic API round-trip).
  - New `description_bullets` JSONB column — 5-10 short AI-extracted
    key-facts bullets (Russian).

Both columns are nullable with no backfill — existing rows stay null until
the AI evaluation pipeline (re)generates them via regenerate-description.

Downgrade: drops both columns.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0005"
down_revision: Union[str, None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "listings",
        sa.Column("description_ru", sa.Text(), nullable=True),
    )
    op.add_column(
        "listings",
        sa.Column(
            "description_bullets",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )


def downgrade() -> None:
    op.drop_column("listings", "description_bullets")
    op.drop_column("listings", "description_ru")
