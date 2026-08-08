"""add user_finance_settings + listings.finance_inputs

Revision ID: 0004
Revises: 0003
Create Date: 2026-08-09 00:00:00.000000

Wave B of the per-listing financial calculator card:
  - New `user_finance_settings` table — single-user global finance params
    (income, savings, mortgage assumptions). Row id is always 1; NOT inserted
    here — created lazily by the first PUT /api/user-finance-settings so a
    fresh install has no row and GET returns defaults with is_persisted=false.
  - New `finance_inputs` JSONB column on `listings` — per-listing overrides
    (utilities, remondifond, first-purchase budget, override ask price).

Downgrade: drops the finance_inputs column and the user_finance_settings table.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Float (not Numeric) to match the ORM mapping (models.UserFinanceSettings uses
    # sqlalchemy.Float throughout) and the rest of this codebase's column-type
    # convention (see 0001_initial_schema.py area_sqm/lat/lng).
    op.create_table(
        "user_finance_settings",
        sa.Column("id", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("monthly_income_eur", sa.Float(), nullable=True),
        sa.Column("total_savings_eur", sa.Float(), nullable=True),
        sa.Column("down_payment_pct", sa.Float(), nullable=False, server_default="15.00"),
        sa.Column("loan_term_years", sa.Integer(), nullable=False, server_default="30"),
        sa.Column("current_euribor_pct", sa.Float(), nullable=False, server_default="3.500"),
        sa.Column("euribor_stress_pct", sa.Float(), nullable=False, server_default="0.30"),
        sa.Column(
            "rate_scenarios_pct",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[1.60, 1.70, 1.80]'"),
        ),
        sa.Column("food_eur_monthly", sa.Float(), nullable=False, server_default="250"),
        sa.Column("basic_eur_monthly", sa.Float(), nullable=False, server_default="300"),
        sa.Column("hindamisakt_eur", sa.Float(), nullable=False, server_default="350"),
        sa.Column("notary_eur", sa.Float(), nullable=False, server_default="275"),
        sa.Column("keys_eur", sa.Float(), nullable=False, server_default="500"),
        sa.Column("internet_eur_monthly", sa.Float(), nullable=False, server_default="20"),
        sa.Column("electricity_eur_monthly", sa.Float(), nullable=False, server_default="30"),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
    )

    op.add_column(
        "listings",
        sa.Column("finance_inputs", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("listings", "finance_inputs")
    op.drop_table("user_finance_settings")
