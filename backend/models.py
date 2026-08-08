"""
The Listing ORM model — single table for every listing regardless of state.

Column choices per D-03/D-04/D-05 (locked decisions in 07-CONTEXT.md):
  - Flat scalars get their own columns (indexable, queryable via WHERE).
  - Nested dicts get JSONB columns; MutableDict tracking is NOT applied —
    the codebase follows the "assign the whole dict/list back" convention,
    and nested MutableDict tracking is fragile (see RESEARCH § Pitfall 1).
  - `status` is a Postgres native ENUM (D-04); values match Phase 6 exactly.
  - Primary key is VARCHAR (kv.ee id like "3883234") per D-05.

JSONB reassignment convention (critical — do not break):
  history = list(row.viewing_history or [])
  history.append(event)
  row.viewing_history = history  # must reassign, never mutate in-place
  db.commit()

`created_at` and `updated_at` use `server_default=func.now()` and
`onupdate=func.now()` so Postgres timestamps the rows without Python involvement
(avoids timezone drift from test environments).

`MappedAsDataclass` requires `default=` or `default_factory=` on every field;
see RESEARCH § Pitfall 3 for details. All defaults are set to match production
semantics for the migration script.
"""
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, Float, Integer, LargeBinary, String, Text
from sqlalchemy import Enum as SAEnum
from sqlalchemy import func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from db import Base


LISTING_STATUS_VALUES = (
    "pending",
    "approved",
    "rejected",
    "viewing_scheduled",
    "viewed",
    # Post-viewing decision states (added in 0002_add_shortlist_statuses migration)
    "thinking",        # user attended the viewing; still deciding
    "offer_drafted",   # user decided "still in"; draft offer prepared
    "dropped",         # user decided not to proceed (distinct from 'rejected' = Inbox dismiss)
)

# ---------------------------------------------------------------------------
# Shortlist funnel groupings (design brief v2 section 2b).
# These sets are used by frontend filtering and business logic to group
# listings into the three Shortlist sidebar buckets.
# ---------------------------------------------------------------------------

# "To view" — approved and awaiting a viewing appointment
SHORTLIST_TO_VIEW: frozenset[str] = frozenset({"approved", "viewing_scheduled"})

# "Viewed" — attended the viewing; decision still pending (transient) or made
SHORTLIST_VIEWED: frozenset[str] = frozenset({"viewed", "thinking", "offer_drafted"})

# "Dropped" — user decided not to proceed after viewing
# NOTE: "rejected" is NOT included here — it means "never worth looking at"
# from the Inbox stage, which is a distinct earlier decision.
SHORTLIST_DROPPED: frozenset[str] = frozenset({"dropped"})


class Listing(Base):
    """ORM model for a single kv.ee apartment listing in any lifecycle state."""

    __tablename__ = "listings"

    # ---- Identity (D-05 VARCHAR PK from kv.ee id) ----
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    url: Mapped[str] = mapped_column(String(1024), default="")

    # ---- Human-readable / display ----
    title: Mapped[str] = mapped_column(String(512), default="")
    # `name` mirrors `title` for the frontend which currently reads either key
    # depending on the component. Cheaper to store twice than to alias at
    # every read site; drop the second column when the UI is unified.
    name: Mapped[str] = mapped_column(String(512), default="")
    district: Mapped[str] = mapped_column(String(64), default="", index=True)
    address: Mapped[str] = mapped_column(String(512), default="")
    notes: Mapped[str] = mapped_column(String(4096), default="")

    # ---- Indexable scalars ----
    price_eur: Mapped[Optional[int]] = mapped_column(Integer, default=None, index=True)
    price_per_sqm: Mapped[Optional[int]] = mapped_column(Integer, default=None)
    area_sqm: Mapped[Optional[float]] = mapped_column(Float, default=None)
    rooms: Mapped[Optional[int]] = mapped_column(Integer, default=None)
    year_built: Mapped[Optional[int]] = mapped_column(Integer, default=None)
    material: Mapped[str] = mapped_column(String(32), default="")
    energy_class: Mapped[str] = mapped_column(String(4), default="")
    condition: Mapped[str] = mapped_column(String(64), default="")
    floor: Mapped[Optional[int]] = mapped_column(Integer, default=None)
    floor_total: Mapped[Optional[int]] = mapped_column(Integer, default=None)
    parking: Mapped[str] = mapped_column(String(24), default="unknown")
    needs_renovation: Mapped[bool] = mapped_column(Boolean, default=False)
    broker_name: Mapped[str] = mapped_column(String(128), default="")
    contact_email: Mapped[Optional[str]] = mapped_column(String(256), default=None)
    image_url: Mapped[str] = mapped_column(String(1024), default="")
    image_count: Mapped[int] = mapped_column(Integer, default=0)
    description: Mapped[str] = mapped_column(String(16384), default="")

    # ---- Geo + commute (Phase 5) ----
    lat: Mapped[Optional[float]] = mapped_column(Float, default=None)
    lng: Mapped[Optional[float]] = mapped_column(Float, default=None)
    commute_minutes: Mapped[Optional[int]] = mapped_column(Integer, default=None)

    # ---- Lifecycle (D-04 status enum + Phase 6 fields) ----
    status: Mapped[str] = mapped_column(
        SAEnum(*LISTING_STATUS_VALUES, name="listing_status"),
        default="pending",
        index=True,
    )
    # Stored as ISO 8601 strings (not DateTime objects) because existing code
    # already uses stringly-typed timestamps; avoiding parse/round-trip drift
    # on migration. A future phase can promote these to DateTime(timezone=True).
    scheduled_at: Mapped[Optional[str]] = mapped_column(String(64), default=None)
    queued_at: Mapped[Optional[str]] = mapped_column(String(64), default=None)
    rejected_at: Mapped[Optional[str]] = mapped_column(String(64), default=None)
    rejection_reason: Mapped[Optional[str]] = mapped_column(String(32), default=None)
    removed: Mapped[bool] = mapped_column(Boolean, default=False)
    removed_at: Mapped[Optional[str]] = mapped_column(String(32), default=None)

    # ---- AI evaluation (flat cache) ----
    score: Mapped[Optional[int]] = mapped_column(Integer, default=None)
    verdict: Mapped[str] = mapped_column(String(4096), default="")
    raw_ok: Mapped[bool] = mapped_column(Boolean, default=True)

    # ---- Telegram card refs ----
    tg_message_id: Mapped[Optional[int]] = mapped_column(Integer, default=None)
    tg_chat_id: Mapped[Optional[int]] = mapped_column(Integer, default=None)

    # ---- Draft outreach ----
    draft_subject: Mapped[str] = mapped_column(String(512), default="")
    draft_body: Mapped[str] = mapped_column(String(16384), default="")

    # ---- JSONB blobs (D-03 hybrid schema) ----
    # Cost model: {monthly_total_eur, breakdown: {mortgage, ku, heating, utilities}}
    cost_of_ownership: Mapped[dict] = mapped_column(JSONB, default_factory=dict)
    # Viewing lifecycle events: [{action, at, scheduled_for, ...}, ...]
    viewing_history: Mapped[list] = mapped_column(JSONB, default_factory=list)
    # Negotiation brief generated by Claude: {summary, talking_points, ...}
    negotiation_brief: Mapped[Optional[dict]] = mapped_column(JSONB, default=None)
    negotiation_brief_generated_at: Mapped[Optional[str]] = mapped_column(String(64), default=None)
    # KÜ (homeowners association) enrichment: {auto: {...}, manual: "", looked_up_at: ""}
    ku: Mapped[Optional[dict]] = mapped_column(JSONB, default=None)
    # AI + manual checklists combined: {ai_checklist: {...}, manual_checklist: {...}}
    checklist: Mapped[dict] = mapped_column(JSONB, default_factory=dict)
    # Price change log: [{price, date, delta_pct}, ...]
    price_history: Mapped[list] = mapped_column(JSONB, default_factory=list)
    # Per-criterion AI score breakdown
    score_breakdown: Mapped[dict] = mapped_column(JSONB, default_factory=dict)
    # AI-filled checklist responses
    ai_checklist_fills: Mapped[dict] = mapped_column(JSONB, default_factory=dict)
    # Bullet lists from AI evaluation
    strengths: Mapped[list] = mapped_column(JSONB, default_factory=list)
    concerns: Mapped[list] = mapped_column(JSONB, default_factory=list)
    risks: Mapped[list] = mapped_column(JSONB, default_factory=list)
    # Catch-all for any fields in legacy app_data.json entries that have no
    # dedicated column — nothing is lost on migration; prune in a follow-up.
    extras: Mapped[dict] = mapped_column(JSONB, default_factory=dict)

    # Per-listing finance calculator inputs (Wave B — finance calculator card):
    # {utilities_eur_monthly, remondifond_eur_monthly, first_purchases_eur,
    #  override_ask_eur}. Reassign the whole dict on write (Pitfall 1).
    finance_inputs: Mapped[Optional[dict]] = mapped_column(JSONB, default=None)

    # ---- Timestamps ----
    # server_default / onupdate so Postgres writes the timestamp, not Python —
    # avoids TZ drift in test environments.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        default=None,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        default=None,
    )


# ---------------------------------------------------------------------------
# Feedback — in-app bug/feature/ux/perf reports (floating button + Feedback tab).
# ---------------------------------------------------------------------------

FEEDBACK_TYPES: frozenset[str] = frozenset({"bug", "feature", "ux", "perf"})
FEEDBACK_STATUSES: frozenset[str] = frozenset({"open", "in_progress", "fixed", "wontfix"})


class Feedback(Base):
    """ORM model for a single in-app feedback/bug report.

    `id` is generated Python-side (uuid.uuid4) via default_factory so every
    ORM-constructed instance always carries a value (sidesteps the
    default=None + server_default ambiguity used for created_at/updated_at
    on Listing). The migration also sets server_default=gen_random_uuid() so
    direct SQL inserts (outside the ORM) still get a value for free.

    `type` / `status` are plain VARCHAR (not a Postgres ENUM like
    listing_status) — validated at the application layer in routes_feedback.py
    against FEEDBACK_TYPES / FEEDBACK_STATUSES so new statuses don't require
    an ALTER TYPE migration.
    """

    __tablename__ = "feedback"

    id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), primary_key=True, default_factory=uuid.uuid4,
    )
    type: Mapped[str] = mapped_column(String(16), default="bug")
    comment: Mapped[str] = mapped_column(Text, default="")
    url: Mapped[str] = mapped_column(Text, default="")
    viewport: Mapped[Optional[str]] = mapped_column(String(32), default=None)
    user_agent: Mapped[Optional[str]] = mapped_column(Text, default=None)
    # Last 50 console.* entries: [{ts, level, args: [str, ...]}, ...]
    console_logs: Mapped[list] = mapped_column(JSONB, default_factory=list)
    screenshot: Mapped[Optional[bytes]] = mapped_column(LargeBinary, default=None)
    screenshot_mime: Mapped[Optional[str]] = mapped_column(String(64), default=None)
    status: Mapped[str] = mapped_column(String(16), default="open", index=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        default=None,
        index=True,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        default=None,
    )


# ---------------------------------------------------------------------------
# User finance settings — single-row (id=1) table for Daniel's global finance
# parameters (income, savings, mortgage assumptions). Backs the per-listing
# affordability calculator (finance_calc.compute_finance). See that module's
# docstring for the calculation itself.
#
# The row is created lazily by the first PUT /api/user-finance-settings — a
# fresh DB has no row at all, and GET returns these column defaults with
# is_persisted=False so the frontend can show a "not configured yet" state.
# ---------------------------------------------------------------------------

def _default_rate_scenarios() -> list:
    return [1.60, 1.70, 1.80]


class UserFinanceSettings(Base):
    """Single-user global finance parameters (id is always 1)."""

    __tablename__ = "user_finance_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)

    monthly_income_eur: Mapped[Optional[float]] = mapped_column(Float, default=None)
    total_savings_eur: Mapped[Optional[float]] = mapped_column(Float, default=None)
    # Estonia typical down payment 10-20%.
    down_payment_pct: Mapped[float] = mapped_column(Float, default=15.00)
    loan_term_years: Mapped[int] = mapped_column(Integer, default=30)
    current_euribor_pct: Mapped[float] = mapped_column(Float, default=3.500)
    euribor_stress_pct: Mapped[float] = mapped_column(Float, default=0.30)
    # 3 base mortgage-margin rates the calculator combines with current +
    # stressed euribor to produce 6 total scenarios.
    rate_scenarios_pct: Mapped[list] = mapped_column(JSONB, default_factory=_default_rate_scenarios)
    food_eur_monthly: Mapped[float] = mapped_column(Float, default=250.0)
    basic_eur_monthly: Mapped[float] = mapped_column(Float, default=300.0)
    # One-time closing costs.
    hindamisakt_eur: Mapped[float] = mapped_column(Float, default=350.0)
    notary_eur: Mapped[float] = mapped_column(Float, default=275.0)
    keys_eur: Mapped[float] = mapped_column(Float, default=500.0)
    internet_eur_monthly: Mapped[float] = mapped_column(Float, default=20.0)
    electricity_eur_monthly: Mapped[float] = mapped_column(Float, default=30.0)

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        default=None,
    )
