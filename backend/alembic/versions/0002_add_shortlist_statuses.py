"""add shortlist statuses (thinking, offer_drafted, dropped)

Revision ID: 0002
Revises: 0001
Create Date: 2026-08-02 00:00:00.000000

Extends the `listing_status` Postgres ENUM with 3 new values that model the
post-viewing decision funnel introduced in the Shortlist UX (design brief v2
section 2b):

  thinking       — user attended the viewing and is still deciding
  offer_drafted  — user decided "still in"; draft offer prepared
  dropped        — user decided not to proceed (distinct from 'rejected',
                   which means "never worth looking at" from the Inbox)

Postgres transaction restriction
---------------------------------
`ALTER TYPE ... ADD VALUE` cannot run inside a transaction block.
Alembic wraps every migration in a transaction by default.

The standard workaround is to COMMIT the Alembic-managed transaction before
each ADD VALUE statement, then BEGIN a new transaction so Alembic's teardown
machinery still has an active transaction to close:

  COMMIT;
  ALTER TYPE listing_status ADD VALUE IF NOT EXISTS '...';
  BEGIN;

`IF NOT EXISTS` (Postgres 9.3+) makes each statement idempotent.

Downgrade note
--------------
Postgres does NOT support `ALTER TYPE ... DROP VALUE`.  downgrade() is a
documented no-op: the three values remain in listing_status after downgrade.

To remove them manually:
  1. ALTER TABLE listings ALTER COLUMN status TYPE varchar(32);
  2. DROP TYPE listing_status;
  3. CREATE TYPE listing_status AS ENUM ('pending','approved','rejected',
                                         'viewing_scheduled','viewed');
  4. ALTER TABLE listings ALTER COLUMN status TYPE listing_status
       USING status::listing_status;
This is a destructive operator action; it is intentionally left here as docs.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# New enum values to append to listing_status, in declaration order.
_NEW_VALUES = ("thinking", "offer_drafted", "dropped")


def upgrade() -> None:
    """Extend listing_status ENUM with thinking / offer_drafted / dropped.

    Each ADD VALUE is preceded by a COMMIT so the statement runs outside any
    transaction block (Postgres requirement), followed by a BEGIN to restore
    the transactional context Alembic expects.
    """
    bind = op.get_bind()
    for value in _NEW_VALUES:
        # End Alembic's transaction, run the non-transactional DDL, reopen.
        bind.execute(sa.text("COMMIT"))
        bind.execute(sa.text(f"ALTER TYPE listing_status ADD VALUE IF NOT EXISTS '{value}'"))
        bind.execute(sa.text("BEGIN"))


def downgrade() -> None:
    """No-op — Postgres does not support DROP VALUE from an enum type.

    The three values (thinking, offer_drafted, dropped) remain in the
    listing_status enum after a downgrade. See module docstring for the
    manual removal procedure.
    """
    pass
