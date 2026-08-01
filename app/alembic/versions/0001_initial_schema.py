"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-08-01 08:00:00.000000

Baseline migration: creates the `listing_status` Postgres ENUM type and the
`listings` table. All columns match models.Listing exactly.

Downgrade: drops `listings` first (the table references the ENUM type), then
drops the `listing_status` type.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# ENUM values must match LISTING_STATUS_VALUES in models.py exactly.
# create_type=False: we call listing_status_enum.create(checkfirst=True)
# explicitly before create_table so we control the creation order and
# idempotency. Without create_type=False, SQLAlchemy's _on_table_create hook
# fires and emits a second CREATE TYPE, causing DuplicateObject on fresh DBs
# (the explicit .create() already ran in the same transaction).
listing_status_enum = postgresql.ENUM(
    "pending",
    "approved",
    "rejected",
    "viewing_scheduled",
    "viewed",
    name="listing_status",
    create_type=False,
)


def upgrade() -> None:
    # Create the ENUM type before the table that references it.
    # listing_status_enum has create_type=False so we own the CREATE TYPE call;
    # the explicit create(checkfirst=True) ensures idempotency if this revision
    # ever runs on a DB that already has the type (e.g. partial rollback).
    bind = op.get_bind()
    listing_status_enum.create(bind, checkfirst=True)

    op.create_table(
        "listings",
        # ---- Identity ----
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("url", sa.String(length=1024), nullable=False, server_default=""),

        # ---- Human-readable / display ----
        sa.Column("title", sa.String(length=512), nullable=False, server_default=""),
        sa.Column("name", sa.String(length=512), nullable=False, server_default=""),
        sa.Column("district", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("address", sa.String(length=512), nullable=False, server_default=""),
        sa.Column("notes", sa.String(length=4096), nullable=False, server_default=""),

        # ---- Indexable scalars ----
        sa.Column("price_eur", sa.Integer(), nullable=True),
        sa.Column("price_per_sqm", sa.Integer(), nullable=True),
        sa.Column("area_sqm", sa.Float(), nullable=True),
        sa.Column("rooms", sa.Integer(), nullable=True),
        sa.Column("year_built", sa.Integer(), nullable=True),
        sa.Column("material", sa.String(length=32), nullable=False, server_default=""),
        sa.Column("energy_class", sa.String(length=4), nullable=False, server_default=""),
        sa.Column("condition", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("floor", sa.Integer(), nullable=True),
        sa.Column("floor_total", sa.Integer(), nullable=True),
        sa.Column("parking", sa.String(length=24), nullable=False, server_default="unknown"),
        sa.Column("needs_renovation", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("broker_name", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("contact_email", sa.String(length=256), nullable=True),
        sa.Column("image_url", sa.String(length=1024), nullable=False, server_default=""),
        sa.Column("image_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("description", sa.String(length=16384), nullable=False, server_default=""),

        # ---- Geo + commute ----
        sa.Column("lat", sa.Float(), nullable=True),
        sa.Column("lng", sa.Float(), nullable=True),
        sa.Column("commute_minutes", sa.Integer(), nullable=True),

        # ---- Lifecycle ----
        # Use the module-level listing_status_enum (which has create_type=False)
        # so op.create_table references the already-created type without
        # triggering another CREATE TYPE DDL statement.
        sa.Column(
            "status",
            listing_status_enum,
            nullable=False,
            server_default="pending",
        ),
        sa.Column("scheduled_at", sa.String(length=64), nullable=True),
        sa.Column("queued_at", sa.String(length=64), nullable=True),
        sa.Column("rejected_at", sa.String(length=64), nullable=True),
        sa.Column("rejection_reason", sa.String(length=32), nullable=True),
        sa.Column("removed", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("removed_at", sa.String(length=32), nullable=True),

        # ---- AI evaluation ----
        sa.Column("score", sa.Integer(), nullable=True),
        sa.Column("verdict", sa.String(length=4096), nullable=False, server_default=""),
        sa.Column("raw_ok", sa.Boolean(), nullable=False, server_default=sa.text("true")),

        # ---- Telegram card refs ----
        sa.Column("tg_message_id", sa.Integer(), nullable=True),
        sa.Column("tg_chat_id", sa.Integer(), nullable=True),

        # ---- Draft outreach ----
        sa.Column("draft_subject", sa.String(length=512), nullable=False, server_default=""),
        sa.Column("draft_body", sa.String(length=16384), nullable=False, server_default=""),

        # ---- JSONB blobs ----
        sa.Column("cost_of_ownership", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("viewing_history", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("negotiation_brief", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("negotiation_brief_generated_at", sa.String(length=64), nullable=True),
        sa.Column("ku", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("checklist", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("price_history", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("score_breakdown", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("ai_checklist_fills", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("strengths", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("concerns", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("risks", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("extras", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'")),

        # ---- Timestamps ----
        # nullable=False: Mapped[datetime] is non-optional in models.py,
        # so the DB column must also be NOT NULL. server_default ensures every
        # INSERT gets a timestamp without Python involvement.
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),

        sa.PrimaryKeyConstraint("id"),
    )

    # Indexes for frequently-filtered columns.
    op.create_index("ix_listings_district", "listings", ["district"])
    op.create_index("ix_listings_price_eur", "listings", ["price_eur"])
    op.create_index("ix_listings_status", "listings", ["status"])


def downgrade() -> None:
    # Drop indexes first (CASCADE would handle this too, but be explicit).
    op.drop_index("ix_listings_status", table_name="listings")
    op.drop_index("ix_listings_price_eur", table_name="listings")
    op.drop_index("ix_listings_district", table_name="listings")

    # Drop table before the ENUM type (type is referenced by the table).
    op.drop_table("listings")

    # Drop the ENUM type last.
    listing_status_enum.drop(op.get_bind(), checkfirst=True)
