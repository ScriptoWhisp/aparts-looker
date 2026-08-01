"""
One-shot idempotent migration: app_data.json → Postgres listings table.

Runs at container start after `alembic upgrade head` and before `uvicorn` (wired
in entrypoint.sh by Wave 3). Safe to call on every deploy — two independent guards
ensure no duplicate rows or status-reset on re-run:

  Guard 1 (file-rename): after a successful commit, `os.replace(SOURCE, BACKUP)`
    renames app_data.json to app_data.json.pre-pg7. Subsequent runs find no source
    file and exit 0 immediately (log: "No <path> — nothing to migrate").

  Guard 2 (db.merge upsert): every row is inserted via `db_.merge(Listing(**fields))`
    which upserts by the VARCHAR primary key. If guard 1 ever fails (permissions,
    cross-device rename), guard 2 ensures the second run updates rows in-place rather
    than inserting duplicates.

Rollback insurance: the renamed .pre-pg7 file stays in the Docker volume
(apartment_data → /app/data/) as a human-readable backup for at least one week.
Do NOT delete or move it outside the volume.

Never-raise at the CLI level: SQLAlchemyError → log.exception + sys.exit(1) so
entrypoint.sh's `set -e` catches it and restarts the container (fail-loud). Parse
errors follow the same pattern. Rename failure is non-fatal (guard 2 compensates).

Security: this script never logs DB connection strings or passwords. Log lines
contain listing IDs and counts only.
"""

import json
import logging
import os
import sys
from typing import Optional

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import attributes as _sa_attributes

import config
from db import SessionLocal
from models import Listing

# ---------------------------------------------------------------------------
# Logging — own logger so output is distinguishable in docker compose logs.
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
log = logging.getLogger("migrate_from_json")

# SOURCE and BACKUP are read dynamically in main() via config.APP_DATA_FILE so
# that test monkeypatches to config.APP_DATA_FILE take effect after module import.
# (Module-level capture would bind the value at import time, defeating monkeypatch.)

# Legacy field aliases — same mapping as main.py:197 and data_store._LEGACY_ALIASES.
# Applied on the read path so old dict keys (name/price/area/year/pricePerSqm/notes)
# land in the correct Listing columns (title/price_eur/area_sqm/year_built/
# price_per_sqm/description) instead of spilling to extras JSONB.
_LEGACY_ALIASES: dict[str, str] = {
    "name": "title",
    "price": "price_eur",
    "pricePerSqm": "price_per_sqm",
    "area": "area_sqm",
    "year": "year_built",
    "notes": "description",
}

# Lazily-cached column name set from the ORM model.
_LISTING_COLUMNS: Optional[set] = None


def _get_listing_columns() -> set:
    """Return the set of column names for Listing.__table__ (cached)."""
    global _LISTING_COLUMNS
    if _LISTING_COLUMNS is None:
        _LISTING_COLUMNS = {c.name for c in Listing.__table__.columns}
    return _LISTING_COLUMNS


def _entry_to_row(entry: dict, forced_status: str) -> Listing:
    """Map a legacy app_data.json entry dict to a Listing ORM object.

    Steps:
      1. Apply _LEGACY_ALIASES (non-destructively — keep old key for extras spill).
      2. Split into known columns vs extras JSONB (nothing lost — A2).
      3. Ensure 'id' is present; fill placeholder if missing (data quality guard).
      4. Force status from the caller's bucket (overrides any status in the entry).
      5. Merge extras JSONB for the catch-all catch-all.
      6. Coerce None → [] / {} for JSONB list/dict columns (Postgres NOT NULL).
      7. Drop server-managed timestamp columns if None (prevents NOT NULL violation).

    Pitfall 7 guard: entry["ku"] is copied as-is (full dict including 'manual' subkey).
    Assumption A2 guard: every key not in Listing columns lands in extras.
    """
    # 1. Apply legacy aliases — copy new key without deleting old (old key spills to extras)
    out = dict(entry)
    for old_key, new_key in _LEGACY_ALIASES.items():
        if old_key in out:
            if new_key not in out or not out.get(new_key):
                out[new_key] = out[old_key]
            # NOTE: do NOT del out[old_key] here — we want the alias source to spill
            # into extras so nothing is silently dropped (per RESEARCH Assumption A2).

    # 2. Split into known columns vs extras
    known = _get_listing_columns()
    fields: dict = {}
    extras: dict = {}
    for k, v in out.items():
        if k in known:
            fields[k] = v
        else:
            extras[k] = v

    # 3. Ensure 'id' is set — a missing id is a data bug; give a placeholder so
    #    the migration does not crash and lets the operator notice the bad row.
    if not fields.get("id"):
        fields["id"] = entry.get("id") or "unknown"

    # 4. Force status from the bucket (Pitfall 5: prevents status reset on re-run)
    fields["status"] = forced_status

    # 5. Merge extras — fold any extras already present in the entry dict
    existing_extras = fields.get("extras") or {}
    if isinstance(existing_extras, dict):
        merged_extras: dict = {**existing_extras, **extras}
    else:
        merged_extras = extras
    fields["extras"] = merged_extras

    # 6. Coerce None → [] / {} for JSONB list/dict columns (NOT NULL in Postgres).
    _jsonb_lists = ("viewing_history", "price_history", "strengths", "concerns", "risks")
    _jsonb_dicts = (
        "cost_of_ownership", "checklist", "score_breakdown", "ai_checklist_fills", "extras"
    )
    for col in _jsonb_lists:
        if col in fields and fields[col] is None:
            fields[col] = []
    for col in _jsonb_dicts:
        if col in fields and fields[col] is None:
            fields[col] = {}

    # 7. Drop server-managed timestamps if None — prevents NOT NULL constraint violation
    #    on merge UPDATE path (SQLAlchemy would SET created_at=NULL without this guard).
    for ts_col in ("created_at", "updated_at"):
        if ts_col in fields and fields[ts_col] is None:
            del fields[ts_col]

    obj = Listing(**fields)

    # 8. del_attribute on every column NOT in fields (except id PK).
    #    MappedAsDataclass sets ALL columns to Python defaults in __init__. Without
    #    this step, db_.merge() would issue UPDATE SET created_at=NULL, status='pending',
    #    price_history=[] etc. for columns that weren't in the entry dict — overwriting
    #    DB values on a second migration run. del_attribute removes those attributes from
    #    the transient object's instance state so merge only updates what was explicitly
    #    provided. Same pattern used in data_store.save_app_data (Wave 2 bug fix).
    known = _get_listing_columns()
    for _col in known - {"id"}:
        if _col not in fields:
            try:
                _sa_attributes.del_attribute(obj, _col)
            except Exception:
                pass

    return obj


def main() -> int:
    """Run the migration. Returns 0 on success (or no-op), 1 on hard failure.

    Exit codes are consumed by entrypoint.sh's `set -e`:
      0 — success or already migrated; container boot continues.
      1 — DB error or JSON parse failure; container exits and Docker restarts it.

    SOURCE and BACKUP are resolved from config.APP_DATA_FILE at call time (not
    at module import time) so test monkeypatches to config.APP_DATA_FILE are
    visible here regardless of when this module was first imported.
    """
    # Resolve source/backup paths from config at call time (test-patchable).
    source: str = config.APP_DATA_FILE
    backup: str = source + ".pre-pg7"

    # Guard 1 — file existence check (fast-exit on subsequent runs)
    if not os.path.exists(source):
        log.info("No %s — nothing to migrate (already ran, or fresh install)", source)
        return 0

    # Read and parse the legacy JSON file
    try:
        with open(source, "r", encoding="utf-8") as f:
            data: dict = json.load(f)
    except (json.JSONDecodeError, OSError) as exc:
        # Log but do NOT rename — source may still be recoverable after the fix.
        log.exception("migrate_from_json: failed to read/parse %s: %s", source, exc)
        return 1

    # Extract the five buckets; default to empty so a partial file is handled gracefully.
    properties: list = data.get("properties") or []
    pending: list = data.get("pending") or []
    rejected: list = data.get("rejected") or []
    checklists: dict = data.get("checklists") or {}
    price_hist: dict = data.get("price_history") or {}

    total = len(properties) + len(pending) + len(rejected)
    log.info(
        "migrate_from_json: %d rows found "
        "(properties=%d, pending=%d, rejected=%d); inserting into listings table",
        total, len(properties), len(pending), len(rejected),
    )

    db_ = SessionLocal()
    try:
        # --- properties[] — status from dict if valid, else "approved" ---
        _valid_property_statuses = {"approved", "viewing_scheduled", "viewed"}
        for entry in properties:
            raw_status = entry.get("status", "")
            entry_status = raw_status if raw_status in _valid_property_statuses else "approved"
            row = _entry_to_row(entry, entry_status)
            # Hot-fill checklist + price_history from top-level dicts (D-03 hybrid schema)
            row.checklist = checklists.get(row.id) or {}
            row.price_history = price_hist.get(row.id) or []
            # Guard 2 — merge upserts by PK; safe before OR after the rename
            db_.merge(row)

        # --- pending[] — force status="pending" ---
        for entry in pending:
            row = _entry_to_row(entry, "pending")
            row.checklist = checklists.get(row.id) or {}
            row.price_history = price_hist.get(row.id) or []
            db_.merge(row)

        # --- rejected[] — force status="rejected" ---
        for entry in rejected:
            row = _entry_to_row(entry, "rejected")
            row.checklist = checklists.get(row.id) or {}
            row.price_history = price_hist.get(row.id) or []
            db_.merge(row)

        db_.commit()

    except SQLAlchemyError:
        # Fail-loud: log + exit 1 so entrypoint.sh's `set -e` restarts the container.
        log.exception(
            "migrate_from_json: DB error during migration — rolling back. "
            "Source file NOT renamed (still at %s). Container will restart.",
            source,
        )
        return 1
    finally:
        db_.close()

    log.info("migrate_from_json: committed %d rows to listings table", total)

    # Guard 1 finale — rename source to .pre-pg7 (POSIX-atomic via os.replace).
    # On success, subsequent runs find no source and exit 0 immediately.
    # On failure (permissions, cross-device): log + return 0 anyway — guard 2
    # (db.merge) means re-running is still safe.
    try:
        os.replace(source, backup)
        log.info("Migrated OK. Renamed %s → %s", source, backup)
    except OSError:
        log.exception(
            "migrate_from_json: rename %s → %s failed — "
            "migration data is in DB but source file was not renamed. "
            "Re-running is safe (db.merge upserts by PK).",
            source, backup,
        )
        # Non-fatal — return 0 so the container continues to boot.

    return 0


if __name__ == "__main__":
    sys.exit(main())
