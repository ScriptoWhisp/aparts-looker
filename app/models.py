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
from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, Float, Integer, String
from sqlalchemy import Enum as SAEnum
from sqlalchemy import func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from db import Base


LISTING_STATUS_VALUES = ("pending", "approved", "rejected", "viewing_scheduled", "viewed")


class Listing(Base):
    """ORM model for a single kv.ee apartment listing in any lifecycle state."""

    __tablename__ = "listings"

    # ---- Identity (D-05 VARCHAR PK from kv.ee id) ----
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    url: Mapped[str] = mapped_column(String(1024), default="")

    # ---- Human-readable / display ----
    title: Mapped[str] = mapped_column(String(512), default="")
    # `name` is a legacy alias of `title` kept for display parity with the
    # existing frontend (see legacy_aliases.py). Both flat columns
    # are cheaper than doing runtime aliasing.
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
