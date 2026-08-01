"""
Single source of truth for all persisted listing data, shared by:
- the FastAPI routes (serving the dossier frontend)
- the background agent job (kv.ee checker)

Phase 7 Wave 2: internals rewritten against SQLAlchemy 2.x / Postgres.
Public API signatures are PRESERVED VERBATIM so no caller (main.py,
ingest_handler.py, brief_generator.py, agent_job.py, settings_store.py) needs
to change in this wave.

Persistence model:
  - listings table (Postgres) — every listing in any lifecycle state (D-04).
  - agent_state.json (filesystem) — stays on disk per D-Discretion; small,
    rewritten every scheduler tick, loss costs at most 2 hrs of dedup memory.
  - settings.json (filesystem) — stays on disk per D-Discretion; not in DB scope.

_lock symbol:
  Kept as a `contextlib.nullcontext()` no-op shim. Every `with data_store._lock:`
  block in the rest of the codebase (main.py, brief_generator.py, ingest_handler.py,
  settings_store.py) continues to parse and execute without change. Waves 4/5 will
  remove these wrappers file-by-file; Wave 2 does not touch any caller.

Session pattern:
  data_store opens sessions via `db_ = SessionLocal()` (NOT the context-manager form
  `with SessionLocal() as db_:`) so that the test fixture's monkeypatch of SessionLocal
  can share a single connection across data_store calls within one test. Using the
  context-manager form would close the shared connection on first function exit.

  Every function follows:
    db_ = SessionLocal()
    try:
        ...
        db_.commit()       # NB: in tests, this is the test's savepoint commit — no-op
    except SQLAlchemyError:
        db_.rollback()     # only rolls back the session, not the test's outer transaction
        log.exception(...)
        return <sentinel>
    finally:
        db_.close()

JSONB reassignment convention (critical — do NOT in-place mutate):
  history = list(row.viewing_history or [])
  history.append(event)
  row.viewing_history = history  # reassign; SQLAlchemy does not detect in-place .append()
  db_.commit()

Never-raise contract: every DB-touching function catches SQLAlchemyError, logs via
log.exception (never logs DATABASE_URL / password), and returns the pre-Phase-7
sentinel (False / None / [] / {}).
"""

import contextlib
import json
import logging
import os
from datetime import datetime, timezone
from typing import Optional

import config
from db import SessionLocal
from models import Listing
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import attributes as _sa_attributes

log = logging.getLogger("data_store")

# ---------------------------------------------------------------------------
# _lock: no-op shim (Wave 2 transition artifact).
# Postgres provides per-row atomicity; the RLock is no longer needed.
# Callers still use `with data_store._lock:` syntax — nullcontext makes it
# syntactically valid and a no-op at runtime. Waves 4/5 remove it site-by-site.
# ---------------------------------------------------------------------------
_lock = contextlib.nullcontext()

# ---------------------------------------------------------------------------
# Legacy field aliases — MUST be applied on every write path so callers using
# old dict keys (name/price/area/year/pricePerSqm/notes) correctly map to
# All ingest paths (scraper → /api/ingest → _deserialize_listing) use the
# canonical Listing dataclass field names, so no runtime alias translation
# is needed here.
# ---------------------------------------------------------------------------

# Known column names for filtering unknown keys into extras JSONB.
_LISTING_COLUMNS: Optional[set] = None


def _get_listing_columns() -> set:
    """Lazily cache the column name set from Listing.__table__.columns."""
    global _LISTING_COLUMNS
    if _LISTING_COLUMNS is None:
        _LISTING_COLUMNS = {c.name for c in Listing.__table__.columns}
    return _LISTING_COLUMNS


# ---------------------------------------------------------------------------
# Constants (preserved — callers import these)
# ---------------------------------------------------------------------------

# DEFAULT_PROPERTIES removed in Wave 2 — legacy seed rows land via the Wave 3
# migrate_from_json.py migration OR fresh installs start empty. Any caller that
# imported DEFAULT_PROPERTIES for seeding should use the empty list or the DB.
DEFAULT_APP_DATA = {
    "properties": [],
    "checklists": {},
    "settings": {},
    "pending": [],
    "rejected": [],
    "price_history": {},
}
DEFAULT_AGENT_STATE = {
    "seen_listing_ids": [],
    "pending_drafts": {},
    "last_telegram_update_id": 0,
    "last_processed_uid": 0,
    "last_heartbeat_ts": None,
    "last_heartbeat_listing_count": None,
    "consecutive_zero_count": 0,
    "last_scraper_alert_sent_at": None,
    "telegram_silenced_until": None,
}


# ---------------------------------------------------------------------------
# Filesystem helpers (agent_state.json only — settings.json handled by settings_store)
# ---------------------------------------------------------------------------

def _read_json(path, default):
    if not os.path.exists(path):
        return json.loads(json.dumps(default))  # deep copy
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return json.loads(json.dumps(default))


def _write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)  # atomic on POSIX


# ---------------------------------------------------------------------------
# Internal helpers: ORM row → legacy dict shape
# ---------------------------------------------------------------------------

def _row_to_property_dict(row: Listing) -> dict:
    """Approved-tier row → dict shaped like the legacy properties[] entry.

    Includes legacy aliases (pricePerSqm / price / area / year / name) so the
    existing frontend continues to render without frontend changes.
    """
    return {
        "id": row.id,
        "url": row.url,
        # Legacy name alias — frontend uses 'name'
        "name": row.name or row.title or "",
        "title": row.title or "",
        # Legacy price alias
        "price": row.price_eur,
        "price_eur": row.price_eur,
        # Legacy pricePerSqm alias
        "pricePerSqm": row.price_per_sqm,
        "price_per_sqm": row.price_per_sqm,
        # Legacy area alias
        "area": row.area_sqm,
        "area_sqm": row.area_sqm,
        # Legacy year alias
        "year": row.year_built,
        "year_built": row.year_built,
        # Legacy notes alias (notes column holds the _pending_to_property summary)
        "notes": row.notes or row.description or "",
        "description": row.description or "",
        "rooms": row.rooms,
        "district": row.district,
        "address": row.address,
        "material": row.material,
        "energy_class": row.energy_class,
        "condition": row.condition,
        "floor": row.floor,
        "floor_total": row.floor_total,
        "parking": row.parking,
        "needs_renovation": row.needs_renovation,
        "broker_name": row.broker_name,
        "contact_email": row.contact_email,
        "image_url": row.image_url,
        "image_count": row.image_count,
        "status": row.status,
        "scheduled_at": row.scheduled_at,
        "viewing_history": list(row.viewing_history or []),
        "negotiation_brief": row.negotiation_brief,
        "negotiation_brief_generated_at": row.negotiation_brief_generated_at,
        "ku": row.ku,
        "cost_of_ownership": row.cost_of_ownership or {},
        "lat": row.lat,
        "lng": row.lng,
        "commute_minutes": row.commute_minutes,
        "score": row.score,
        "verdict": row.verdict,
        "draft_subject": row.draft_subject,
        "draft_body": row.draft_body,
        "tg_message_id": row.tg_message_id,
        "tg_chat_id": row.tg_chat_id,
        "removed": row.removed,
        "removed_at": row.removed_at,
        "raw_ok": row.raw_ok,
        "queued_at": row.queued_at,
        "rejected_at": row.rejected_at,
        "rejection_reason": row.rejection_reason,
        "score_breakdown": row.score_breakdown or {},
        "ai_checklist_fills": row.ai_checklist_fills or {},
        "strengths": list(row.strengths or []),
        "concerns": list(row.concerns or []),
        "risks": list(row.risks or []),
    }


def _row_to_pending_dict(row: Listing) -> dict:
    """Pending row → dict shaped like the legacy pending[] entry."""
    return {
        "id": row.id,
        "url": row.url,
        "title": row.title or "",
        "name": row.name or row.title or "",
        "price_eur": row.price_eur,
        "price": row.price_eur,
        "price_per_sqm": row.price_per_sqm,
        "pricePerSqm": row.price_per_sqm,
        "area_sqm": row.area_sqm,
        "area": row.area_sqm,
        "rooms": row.rooms,
        "year_built": row.year_built,
        "year": row.year_built,
        "material": row.material,
        "energy_class": row.energy_class,
        "district": row.district,
        "address": row.address,
        "description": row.description or "",
        "notes": row.notes or "",
        "broker_name": row.broker_name,
        "contact_email": row.contact_email,
        "image_url": row.image_url,
        "image_count": row.image_count,
        "status": row.status,
        "score": row.score,
        "verdict": row.verdict,
        "score_breakdown": row.score_breakdown or {},
        "ai_checklist_fills": row.ai_checklist_fills or {},
        "strengths": list(row.strengths or []),
        "concerns": list(row.concerns or []),
        "risks": list(row.risks or []),
        "cost_of_ownership": row.cost_of_ownership or {},
        "viewing_history": list(row.viewing_history or []),
        "draft_subject": row.draft_subject,
        "draft_body": row.draft_body,
        "queued_at": row.queued_at,
        "tg_message_id": row.tg_message_id,
        "tg_chat_id": row.tg_chat_id,
        "lat": row.lat,
        "lng": row.lng,
        "commute_minutes": row.commute_minutes,
        "raw_ok": row.raw_ok,
        "removed": row.removed,
        "removed_at": row.removed_at,
        "price_drop_requeue_note": (row.extras or {}).get("price_drop_requeue_note"),
    }


def _row_to_rejected_dict(row: Listing) -> dict:
    """Rejected row → dict shaped like the legacy rejected[] entry."""
    d = _row_to_pending_dict(row)
    d["rejection_reason"] = row.rejection_reason
    d["rejected_at"] = row.rejected_at
    return d


def _dict_to_listing_fields(entry: dict) -> dict:
    """Map a Listing-shaped dict to columns + extras JSONB.

    Unknown keys with no matching column are collected into extras JSONB so
    ad-hoc metadata is never silently dropped.

    JSONB list/dict fields are coerced from None to [] / {} to satisfy the
    NOT-NULL Postgres constraints.
    """
    # 1. Shallow copy to avoid mutating the caller's dict
    out = dict(entry)

    # 2. Split into known columns vs extras
    known = _get_listing_columns()
    fields: dict = {}
    extras: dict = {}
    for k, v in out.items():
        if k in known:
            fields[k] = v
        else:
            extras[k] = v

    # 3. Merge extras from the entry's existing extras + new unknowns
    existing_extras = fields.get("extras") or {}
    if isinstance(existing_extras, dict):
        merged_extras = {**existing_extras, **extras}
    else:
        merged_extras = extras
    fields["extras"] = merged_extras

    # 4. Coerce empty strings to None for numeric columns. Scraped dicts can
    #    carry "" for missing numerics (e.g. year_built=""), which Postgres
    #    INTEGER/FLOAT rejects with "invalid input syntax for type integer: ''".
    _numeric_cols = (
        "price_eur", "price_per_sqm", "rooms", "year_built",
        "floor", "floor_total", "image_count", "commute_minutes",
        "score", "tg_message_id", "tg_chat_id",
        "area_sqm", "lat", "lng",
    )
    for col in _numeric_cols:
        if col in fields and fields[col] == "":
            fields[col] = None

    # 5. Coerce None → [] / {} for JSONB list/dict columns (Postgres NOT NULL).
    #    Only coerce if the key is PRESENT in the entry dict (explicitly set to None).
    #    If the key is ABSENT, do NOT add it — so db_.merge() leaves the existing
    #    DB value untouched (merge only updates attributes present in the transient
    #    object's state). This prevents save_app_data() from overwriting price_history
    #    / viewing_history etc. when the caller's entry dict was built from
    #    _row_to_pending_dict() which doesn't include those columns in its output.
    _jsonb_lists = ("viewing_history", "price_history", "strengths", "concerns", "risks")
    _jsonb_dicts = ("cost_of_ownership", "checklist", "score_breakdown", "ai_checklist_fills")
    for col in _jsonb_lists:
        if col in fields and fields[col] is None:
            fields[col] = []
    for col in _jsonb_dicts:
        if col in fields and fields[col] is None:
            fields[col] = {}

    # 6. Drop server-managed timestamp columns when their value is None.
    #    Listing has server_default=func.now() on created_at and updated_at.
    #    If we pass Listing(created_at=None, ...) to db_.merge(), the MERGE UPDATE
    #    path will try to SET created_at = NULL, violating the NOT NULL constraint.
    #    Dropping the key lets SQLAlchemy fall back to the server default on INSERT
    #    and leaves the existing value untouched on UPDATE (merge only updates
    #    attributes that are present in the mapped object's __dict__).
    for ts_col in ("created_at", "updated_at"):
        if ts_col in fields and fields[ts_col] is None:
            del fields[ts_col]

    return fields


# ---------------------------------------------------------------------------
# Compatibility shims: load_app_data / save_app_data
# ---------------------------------------------------------------------------

def load_app_data() -> dict:
    """Compatibility shim — reconstructs the legacy whole-dict shape from Postgres.

    Returns:
        {
          "properties": [...],  # rows with status in (approved, viewing_scheduled, viewed)
          "pending":    [...],  # rows with status == "pending"
          "rejected":   [...],  # rows with status == "rejected"
          "checklists": {...},  # {listing_id: row.checklist}
          "price_history": {}, # {listing_id: row.price_history}
          "settings":   {},    # always empty — settings.json is source of truth (D-Discretion)
        }

    Wave 5 will rewrite hot callers to use row-scoped queries. Wave 2 keeps
    the shim for correctness across every caller that has not yet been migrated.
    """
    db_ = SessionLocal()
    try:
        rows = db_.query(Listing).all()
        properties = [_row_to_property_dict(r) for r in rows
                      if r.status in ("approved", "viewing_scheduled", "viewed")]
        pending = [_row_to_pending_dict(r) for r in rows if r.status == "pending"]
        rejected = [_row_to_rejected_dict(r) for r in rows if r.status == "rejected"]
        checklists = {r.id: r.checklist for r in rows if r.checklist}
        price_history = {r.id: list(r.price_history) for r in rows if r.price_history}
        return {
            "properties": properties,
            "pending": pending,
            "rejected": rejected,
            "checklists": checklists,
            "price_history": price_history,
            "settings": {},  # settings live in settings.json — outside DB scope
        }
    except SQLAlchemyError:
        log.exception("load_app_data failed")
        return {"properties": [], "pending": [], "rejected": [], "checklists": {},
                "price_history": {}, "settings": {}}
    finally:
        db_.close()


def save_app_data(data: dict) -> None:
    """Compatibility shim — upserts every entry from the dict into Postgres.

    Iterates data['properties'] + data['pending'] + data['rejected'] and calls
    db_.merge(Listing(**fields)) per entry. The merge (upsert by PK) is safe
    to call multiple times with the same id.

    Wave 5 rewrites the hot callers (backfill-costs, backfill-commutes, ingest
    batch loop) to use row-scoped writes so this shim is not the bottleneck.
    """
    # Tag each entry with its list origin so status is always set correctly.
    # Callers that build entry dicts manually may omit "status" (pre-Wave-2 pattern).
    # Without an explicit status, the Postgres INSERT would fall back to "pending"
    # (the column default), silently misclassifying entries that came from
    # properties[] or rejected[].
    #
    # Status precedence: explicit "status" key in the dict > implied by list origin.
    _bucket_status = {
        "properties": None,   # use dict's own "status" if present (could be viewing_scheduled/viewed)
        "pending": "pending",
        "rejected": "rejected",
    }
    entries: list[dict] = []
    for bucket_name, forced_status in _bucket_status.items():
        for e in data.get(bucket_name) or []:
            e_with_status = dict(e)
            if forced_status is not None:
                # For pending/rejected buckets: always force the canonical status.
                # Entries migrated from rejected[] via _handle_price_drop may carry
                # "status": "rejected" in their dict — override it so the DB row
                # correctly reflects its new bucket position.
                e_with_status["status"] = forced_status
            else:
                # For properties[]: keep the dict's own status (may be approved,
                # viewing_scheduled, or viewed). Fall back to "approved" if absent.
                e_with_status.setdefault("status", "approved")
            entries.append(e_with_status)

    price_history = data.get("price_history") or {}

    if not entries and not price_history:
        return
    db_ = SessionLocal()
    try:
        for entry in entries:
            fields = _dict_to_listing_fields(entry)
            if not fields.get("id"):
                continue  # skip entries without an id
            obj = Listing(**fields)
            # Remove every column attribute that was NOT explicitly provided in
            # `fields` from the transient object's instance state. This prevents
            # db_.merge() from overwriting existing DB values with Python-side
            # defaults (e.g. price_history=[], viewing_history=[], status="pending",
            # created_at=None). Only columns the caller actually set get updated.
            _all_cols = _get_listing_columns()
            for _col in _all_cols - {"id"}:  # id is the PK — never remove
                if _col not in fields:
                    try:
                        _sa_attributes.del_attribute(obj, _col)
                    except Exception:
                        pass
            db_.merge(obj)
        # Persist price_history for every listing ID present in data["price_history"].
        # This covers two patterns:
        # 1. ID in status lists: entry dict (from _row_to_*_dict) doesn't include
        #    price_history, so the merge above leaves it untouched. We need a separate
        #    pass to apply the caller's mutations.
        # 2. ID NOT in status lists: listing exists in DB, caller only mutated
        #    data["price_history"][listing_id] without re-including the full entry dict.
        for lid, history in price_history.items():
            row = db_.get(Listing, lid)
            if row is None:
                # Listing not in DB yet — create a minimal shell row so price
                # history is not lost. Callers should always provide a full entry
                # dict for new listings; this is a safety net only.
                new_obj = Listing(id=lid, price_history=list(history))
                _all_cols = _get_listing_columns()
                for _col in _all_cols - {"id", "price_history"}:
                    try:
                        _sa_attributes.del_attribute(new_obj, _col)
                    except Exception:
                        pass
                db_.add(new_obj)
            else:
                row.price_history = list(history)
        db_.commit()
    except SQLAlchemyError:
        log.exception("save_app_data failed")
        try:
            db_.rollback()
        except Exception:
            pass
    finally:
        db_.close()


# ---------------------------------------------------------------------------
# Agent state (filesystem-backed per D-Discretion — unchanged from pre-Phase-7)
# ---------------------------------------------------------------------------

def load_agent_state() -> dict:
    state = _read_json(config.AGENT_STATE_FILE, DEFAULT_AGENT_STATE)
    for k, v in DEFAULT_AGENT_STATE.items():
        state.setdefault(k, v)
    return state


def save_agent_state(state: dict) -> None:
    _write_json(config.AGENT_STATE_FILE, state)


# ---------------------------------------------------------------------------
# Listing CRUD
# ---------------------------------------------------------------------------

def add_property_if_new(prop: dict) -> bool:
    """INSERT an approved-tier listing if id not already present. Returns True on insert.

    Used by the legacy seed path — in Phase 7+ the agent job writes via add_to_pending.
    """
    listing_id = prop.get("id")
    if not listing_id:
        return False
    db_ = SessionLocal()
    try:
        existing = db_.get(Listing, listing_id)
        if existing is not None:
            return False
        fields = _dict_to_listing_fields(prop)
        fields.setdefault("status", "approved")
        db_.add(Listing(**fields))
        db_.commit()
        return True
    except SQLAlchemyError:
        log.exception("add_property_if_new failed for %s", listing_id)
        try:
            db_.rollback()
        except Exception:
            pass
        return False
    finally:
        db_.close()


def add_to_pending(entry: dict) -> bool:
    """INSERT a pending listing. Returns False if already in pending or approved-tier.

    Dedup rule (D-05): if the id is already present in the DB with a non-rejected
    status, return False (do not create a duplicate row).
    """
    listing_id = entry.get("id")
    if not listing_id:
        return False
    db_ = SessionLocal()
    try:
        existing = db_.get(Listing, listing_id)
        if existing is not None and existing.status != "rejected":
            return False
        if existing is not None and existing.status == "rejected":
            # Allow re-queue of a rejected listing by updating status to pending
            fields = _dict_to_listing_fields(entry)
            fields["status"] = "pending"
            for k, v in fields.items():
                if hasattr(existing, k):
                    setattr(existing, k, v)
            db_.commit()
            return True
        fields = _dict_to_listing_fields(entry)
        fields["status"] = "pending"
        db_.add(Listing(**fields))
        db_.commit()
        return True
    except SQLAlchemyError:
        log.exception("add_to_pending failed for %s", listing_id)
        try:
            db_.rollback()
        except Exception:
            pass
        return False
    finally:
        db_.close()


def load_pending() -> list:
    """Return the current pending queue as a list of dicts."""
    db_ = SessionLocal()
    try:
        rows = db_.query(Listing).filter(Listing.status == "pending").all()
        return [_row_to_pending_dict(r) for r in rows]
    except SQLAlchemyError:
        log.exception("load_pending failed")
        return []
    finally:
        db_.close()


# ---------------------------------------------------------------------------
# State transitions
# ---------------------------------------------------------------------------

def approve_listing(listing_id: str) -> bool:
    """Flip status pending → approved. Returns False if not found or not pending.

    Preserves draft_body / contact_email / draft_subject (already columns).
    Idempotent: if already approved/viewing_scheduled/viewed, returns False
    (double-tap guard per D-05).
    """
    db_ = SessionLocal()
    try:
        row = db_.get(Listing, listing_id)
        if row is None or row.status != "pending":
            return False
        row.status = "approved"
        db_.commit()
        return True
    except SQLAlchemyError:
        log.exception("approve_listing failed for %s", listing_id)
        try:
            db_.rollback()
        except Exception:
            pass
        return False
    finally:
        db_.close()


def reject_listing(listing_id: str, reason: str) -> bool:
    """Flip status to rejected. Reason is whitelisted; anything else clamps to 'other'.

    Sets rejection_reason and rejected_at UTC ISO. Returns False if not in pending.
    """
    if reason not in {"price", "location", "condition", "other"}:
        reason = "other"
    db_ = SessionLocal()
    try:
        row = db_.get(Listing, listing_id)
        if row is None or row.status != "pending":
            return False
        row.status = "rejected"
        row.rejection_reason = reason
        row.rejected_at = datetime.now(timezone.utc).isoformat()
        db_.commit()
        return True
    except SQLAlchemyError:
        log.exception("reject_listing failed for %s", listing_id)
        try:
            db_.rollback()
        except Exception:
            pass
        return False
    finally:
        db_.close()


def set_viewing_scheduled(listing_id: str, scheduled_at_iso: str) -> bool:
    """Mark an approved listing as viewing_scheduled. Appends to viewing_history.

    Thread-safe (Postgres atomicity). Never-raise (VIEW-01, D-01, D-02, D-04).
    Idempotent — resetting to viewing_scheduled appends a new viewing_history
    entry so Daniel can see reschedules.
    """
    db_ = SessionLocal()
    try:
        row = db_.get(Listing, listing_id)
        if row is None or row.status not in ("approved", "viewing_scheduled", "viewed"):
            return False
        row.status = "viewing_scheduled"
        row.scheduled_at = scheduled_at_iso
        # JSONB reassignment (Pitfall 1 — never .append() in-place)
        history = list(row.viewing_history or [])
        history.append({
            "action": "scheduled",
            "at": datetime.now(timezone.utc).isoformat(),
            "scheduled_for": scheduled_at_iso,
        })
        row.viewing_history = history
        db_.commit()
        return True
    except SQLAlchemyError:
        log.exception("set_viewing_scheduled failed for %s", listing_id)
        try:
            db_.rollback()
        except Exception:
            pass
        return False
    finally:
        db_.close()


def mark_viewed(listing_id: str) -> bool:
    """Flip viewing_scheduled → viewed. Rejects any other transition (D-03).

    Thread-safe. Never-raise (VIEW-01, D-03).
    """
    db_ = SessionLocal()
    try:
        row = db_.get(Listing, listing_id)
        if row is None:
            return False
        if row.status != "viewing_scheduled":
            log.warning(
                "mark_viewed: listing %s has status=%r — expected 'viewing_scheduled'; "
                "transition rejected (D-03 no-auto-transition rule)",
                listing_id,
                row.status,
            )
            return False
        row.status = "viewed"
        # JSONB reassignment (Pitfall 1)
        history = list(row.viewing_history or [])
        history.append({
            "action": "viewed",
            "at": datetime.now(timezone.utc).isoformat(),
        })
        row.viewing_history = history
        db_.commit()
        return True
    except SQLAlchemyError:
        log.exception("mark_viewed failed for %s", listing_id)
        try:
            db_.rollback()
        except Exception:
            pass
        return False
    finally:
        db_.close()


def save_negotiation_brief(listing_id: str, brief: dict) -> bool:
    """Overwrite negotiation_brief JSONB and record a freshness timestamp (VIEW-03, D-06).

    Thread-safe. Never-raise.
    """
    db_ = SessionLocal()
    try:
        row = db_.get(Listing, listing_id)
        if row is None:
            return False
        row.negotiation_brief = brief
        row.negotiation_brief_generated_at = datetime.now(timezone.utc).isoformat()
        db_.commit()
        return True
    except SQLAlchemyError:
        log.exception("save_negotiation_brief failed for %s", listing_id)
        try:
            db_.rollback()
        except Exception:
            pass
        return False
    finally:
        db_.close()


def save_ku_enrichment(listing_id: str, ku_auto: dict) -> bool:
    """Persist the ariregister lookup result. Preserves existing 'manual' subkey (Pitfall 7).

    Structures row.ku as {'auto': ku_auto, 'manual': <prior or ''>, 'looked_up_at': <utc iso>}
    so that 'Refresh KÜ' overwrites only the auto sub-key and never clobbers Daniel's
    manual notes (ENRICH-01, D-11, D-13). Thread-safe. Never-raise.
    """
    db_ = SessionLocal()
    try:
        row = db_.get(Listing, listing_id)
        if row is None:
            return False
        existing = row.ku or {}
        # JSONB reassignment (Pitfall 1 + Pitfall 7 — preserve manual subkey)
        row.ku = {
            "auto": ku_auto,
            "manual": existing.get("manual", ""),  # preserve user notes
            "looked_up_at": datetime.now(timezone.utc).isoformat(),
        }
        db_.commit()
        return True
    except SQLAlchemyError:
        log.exception("save_ku_enrichment failed for %s", listing_id)
        try:
            db_.rollback()
        except Exception:
            pass
        return False
    finally:
        db_.close()


# ---------------------------------------------------------------------------
# AI checklist
# ---------------------------------------------------------------------------

def write_checklist_ai(listing_id: str, checklist: dict) -> None:
    """Write AI-generated checklist into the ai_checklist subkey of the JSONB checklist column.

    Preserves existing entries whose source == 'user' (D-09). JSONB reassignment
    convention applied — builds a fresh dict and reassigns the checklist column.
    """
    db_ = SessionLocal()
    try:
        row = db_.get(Listing, listing_id)
        if row is None:
            return
        current = row.checklist or {}
        # Build a fresh ai_checklist preserving source=="user" entries
        ai_cl: dict = dict(current.get("ai_checklist", {}))
        for key, result in checklist.items():
            if isinstance(ai_cl.get(key), dict) and ai_cl[key].get("source") == "user":
                continue  # preserve user overrides (D-09)
            ai_cl[key] = {"result": result, "source": "ai"}
        # JSONB reassignment (Pitfall 1)
        new_checklist = dict(current)
        new_checklist["ai_checklist"] = ai_cl
        row.checklist = new_checklist
        db_.commit()
    except SQLAlchemyError:
        log.exception("write_checklist_ai failed for %s", listing_id)
        try:
            db_.rollback()
        except Exception:
            pass
    finally:
        db_.close()


# ---------------------------------------------------------------------------
# Price history
# ---------------------------------------------------------------------------

def record_price_in_data(data: dict, listing_id: str, price_eur: int, date_str: str) -> None:
    """Mutate data['price_history'][listing_id] in the passed dict.

    Signature PRESERVED verbatim — ingest_handler calls this with data = app_data
    inside `with _lock:`. Wave 2 keeps the semantics: mutates the passed dict's
    price_history[listing_id] list (same idempotency + 90-entry cap as pre-Phase-7).
    The mutation is committed to DB when the caller later calls save_app_data(app_data)
    which now upserts every row and re-writes the price_history JSONB column.
    Wave 5 will rewrite _record_and_check_price_drop for per-row efficiency.

    Idempotent for same-day re-runs: if the last entry's date matches date_str, its
    price is overwritten rather than a duplicate appended (D-12).
    History capped at 90 entries — oldest trimmed first (D-13).
    """
    history = data.setdefault("price_history", {}).setdefault(listing_id, [])
    if history and history[-1]["date"] == date_str:
        # Same-day idempotency: overwrite the price, do not append (D-12)
        history[-1]["price"] = price_eur
    else:
        history.append({"date": date_str, "price": price_eur})
    # Cap at 90 entries — trim oldest
    if len(history) > 90:
        del history[:len(history) - 90]


def get_price_history(listing_id: str) -> list:
    """Return the price history list for a listing, or [] if unknown.

    Thread-safe DB reader. Returns [] on any miss or error (never-raise).
    """
    db_ = SessionLocal()
    try:
        row = db_.get(Listing, listing_id)
        if row is None:
            return []
        return list(row.price_history or [])
    except SQLAlchemyError:
        log.exception("get_price_history failed for %s", listing_id)
        return []
    finally:
        db_.close()


# ---------------------------------------------------------------------------
# Queries
# ---------------------------------------------------------------------------

def get_rejected_by_reason(reason: str) -> list:
    """Return rejected-status rows whose rejection_reason matches reason.

    Thread-safe DB reader. Returns [] on any miss or error (never-raise).
    Used by _handle_price_drop to look up price-rejected listings for re-queue.
    """
    db_ = SessionLocal()
    try:
        rows = (
            db_.query(Listing)
            .filter(Listing.status == "rejected", Listing.rejection_reason == reason)
            .all()
        )
        return [_row_to_rejected_dict(r) for r in rows]
    except SQLAlchemyError:
        log.exception("get_rejected_by_reason failed for reason=%s", reason)
        return []
    finally:
        db_.close()


def get_approved_listing(listing_id: str) -> Optional[dict]:
    """Return the approved-tier row as a dict, or None if not found.

    'Approved-tier' means status in (approved, viewing_scheduled, viewed).
    Used by POST /api/draft/<id> to look up contact_email, draft_body, draft_subject.
    """
    db_ = SessionLocal()
    try:
        row = db_.get(Listing, listing_id)
        if row is None or row.status not in ("approved", "viewing_scheduled", "viewed"):
            return None
        return _row_to_property_dict(row)
    except SQLAlchemyError:
        log.exception("get_approved_listing failed for %s", listing_id)
        return None
    finally:
        db_.close()


# ---------------------------------------------------------------------------
# Coordinate helpers
# ---------------------------------------------------------------------------

def update_listing_coords(listing_id: str, lat: float, lng: float,
                          commute_minutes: Optional[int]) -> bool:
    """Update lat/lng/commute_minutes on a listing row (any status).

    Returns True if found and updated, False otherwise. Thread-safe. Never-raise.
    Searches all statuses (properties + pending).
    """
    db_ = SessionLocal()
    try:
        row = db_.get(Listing, listing_id)
        if row is None:
            return False
        row.lat = lat
        row.lng = lng
        row.commute_minutes = commute_minutes
        db_.commit()
        return True
    except SQLAlchemyError:
        log.exception("update_listing_coords failed for %s", listing_id)
        try:
            db_.rollback()
        except Exception:
            pass
        return False
    finally:
        db_.close()


def get_listing_coords(listing_id: str) -> dict:
    """Return coord dict for a listing_id (any status).

    Returns all-None dict on miss or error. Thread-safe.
    """
    db_ = SessionLocal()
    try:
        row = db_.get(Listing, listing_id)
        if row is not None:
            return {
                "lat": row.lat,
                "lng": row.lng,
                "commute_minutes": row.commute_minutes,
            }
    except SQLAlchemyError:
        log.exception("get_listing_coords failed for %s", listing_id)
    finally:
        db_.close()
    return {"lat": None, "lng": None, "commute_minutes": None}


# ---------------------------------------------------------------------------
# Internal helpers preserved for backward-compat
# ---------------------------------------------------------------------------

def _pending_to_property(entry: dict) -> dict:
    """Convert a pending listing entry dict to the dossier property schema.

    KEPT for backward-compat — agent_job.py imports it. Simply passes through
    with an updated notes string. Wave 4 will consider removing.
    """
    verdict = entry.get("verdict", "")
    strengths = entry.get("strengths", [])
    concerns = entry.get("concerns", [])
    score = entry.get("score", 0)
    notes = f"[Agent, score {score}/100] {verdict}"
    if strengths:
        notes += " Strengths: " + "; ".join(strengths) + "."
    if concerns:
        notes += " Concerns: " + "; ".join(concerns) + "."

    prop = dict(entry)
    prop["notes"] = notes
    return prop
