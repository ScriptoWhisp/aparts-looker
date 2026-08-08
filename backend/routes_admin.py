"""Admin and scheduler endpoints: settings, check-now, delete, reevaluate, debug,
backfill-costs, backfill-commutes, telegram status/silence.

These are operational endpoints used from the dashboard and admin tooling.
None require special authentication beyond Caddy Basic Auth on the reverse proxy.
"""

from __future__ import annotations

import dataclasses
import logging
import threading
from datetime import datetime, timezone as _tz, timedelta
from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.requests import Request
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy import func as sa_func

import ai_evaluator
import config
import data_store
import db
import ingest_handler
import settings_store
import scheduler
from models import Listing

log = logging.getLogger("app")

router = APIRouter()


# ---------------------------------------------------------------------------
# Helpers (used only within this module)
# ---------------------------------------------------------------------------

def _find_entry(app_data: dict, listing_id: str) -> Optional[dict]:
    for list_name in ("properties", "pending"):
        for e in app_data.get(list_name, []):
            if e.get("id") == listing_id:
                return e
    return None


def _diagnose_listing(entry: dict, normalized: dict) -> dict:
    """Return a human-readable diagnostic hint for why this listing may not evaluate well."""
    url = normalized.get("url") or ""
    price = normalized.get("price_eur") or 0
    area = normalized.get("area_sqm") or 0
    rooms = normalized.get("rooms") or 0
    year = normalized.get("year_built") or ""
    description = normalized.get("description") or ""

    if not url and price == 0 and area == 0 and rooms == 0:
        return {
            "severity": "error",
            "code": "placeholder",
            "title": "Placeholder entry — no real listing data",
            "detail": (
                "This entry has no URL and every numeric field is zero. It was likely seeded "
                "from Gmail alerts before the kv.ee scraper existed. Re-evaluate cannot help. "
                "Delete this entry and run Scrape now to fetch real data from kv.ee."
            ),
        }
    if not url and (price or area or rooms):
        return {
            "severity": "warn",
            "code": "no_url",
            "title": "No URL stored — cannot re-scrape",
            "detail": (
                "Some data is present, but the source URL is missing so we cannot refresh it "
                "from kv.ee. Re-evaluate will use only what is stored."
            ),
        }
    if url and price == 0 and area == 0:
        return {
            "severity": "warn",
            "code": "scrape_failed",
            "title": "Scraper failed to extract data",
            "detail": (
                "URL is present but numeric fields are empty. The parser likely hit an unusual "
                "listing layout. Try Scrape now to re-fetch."
            ),
        }
    missing = []
    if not year: missing.append("year_built")
    if not normalized.get("condition"): missing.append("condition")
    if normalized.get("floor") is None: missing.append("floor")
    if not description: missing.append("description")
    if missing:
        return {
            "severity": "info",
            "code": "partial",
            "title": "Some fields missing — AI can still score",
            "detail": "Missing: " + ", ".join(missing) + ". Claude will factor this into concerns.",
        }
    return {
        "severity": "ok",
        "code": "complete",
        "title": "Data looks complete",
        "detail": "All key fields are populated. Re-evaluate should return a meaningful score.",
    }


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------

@router.get("/api/settings")
def get_settings() -> dict:
    """Return the settings schema (field list) + unique group names.

    Response shape:
      { "fields": [{key, type, group, label, hint, min, max, value}, ...],
        "groups": ["cost", "telegram", "ai", "dashboard", "reno"] }

    The frontend renders one form category per group, iterating fields
    whose `group` matches. Values are embedded in each field entry.
    """
    fields = settings_store.get_schema()
    groups: list[str] = []
    for f in fields:
        g = f.get("group", "")
        if g and g not in groups:
            groups.append(g)
    return {"fields": fields, "groups": groups}


@router.post("/api/settings")
async def post_settings(request: Request) -> dict:
    """Validate + hot-apply + persist a settings update. All-or-nothing: any
    validation failure means no change is applied."""
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Body must be JSON")
    result = settings_store.save(body)
    if result["errors"]:
        return JSONResponse({"ok": False, "errors": result["errors"]}, status_code=422)
    # Return the same shape as GET /api/settings so the client can drop-in
    # replace its cached settings without a follow-up refetch.
    fields = settings_store.get_schema()
    groups: list[str] = []
    for f in fields:
        g = f.get("group", "")
        if g and g not in groups:
            groups.append(g)
    return {
        "ok": True,
        "applied": result["applied"],
        "costs_recomputed": result["costs_recomputed"],
        "fields": fields,
        "groups": groups,
    }


# ---------------------------------------------------------------------------
# Scheduler
# ---------------------------------------------------------------------------

@router.post("/api/check-now")
def check_now():
    """Manually trigger the scheduler tick instead of waiting for the schedule."""
    threading.Thread(target=scheduler.run_once_now, daemon=True).start()
    return {"ok": True, "message": "Scheduler tick started in background — watch Telegram in a moment."}


# ---------------------------------------------------------------------------
# Telegram
# ---------------------------------------------------------------------------

@router.get("/api/telegram/status")
def telegram_status() -> dict:
    """Return current Telegram delivery config so the dashboard can render state."""
    state = data_store.load_agent_state()
    until = state.get("telegram_silenced_until")
    silenced = False
    if until:
        try:
            deadline = datetime.fromisoformat(until.replace("Z", "+00:00"))
            silenced = deadline > datetime.now(_tz.utc)
        except Exception:
            silenced = False
    return {
        "silenced": silenced,
        "silenced_until": until if silenced else None,
        "min_score_photo": config.TELEGRAM_MIN_SCORE_PHOTO,
        "min_score_text": config.TELEGRAM_MIN_SCORE_TEXT,
        "bot_configured": bool(config.TELEGRAM_BOT_TOKEN and config.TELEGRAM_CHAT_ID),
    }


@router.post("/api/telegram/silence")
async def telegram_silence(request: Request) -> dict:
    """POST {"hours": N}. N > 0 silences for N hours. N == 0 clears silence.

    Phase 7 Wave 4 (site #6, RESEARCH § Pitfall 2): lock wrapper removed.
    agent_state.json is filesystem-backed (D-Discretion); save_agent_state uses
    atomic os.replace — no session concerns; no HTTP calls in this function.
    """
    try:
        body = await request.json()
        hours = int(body.get("hours", 0))
    except Exception:
        raise HTTPException(status_code=400, detail="Body must be {\"hours\": <int>}")
    if hours < 0 or hours > 24 * 30:
        raise HTTPException(status_code=422, detail="hours must be between 0 and 720")

    state = data_store.load_agent_state()
    if hours == 0:
        state["telegram_silenced_until"] = None
        data_store.save_agent_state(state)
        return {"ok": True, "silenced": False}
    deadline = datetime.now(_tz.utc) + timedelta(hours=hours)
    state["telegram_silenced_until"] = deadline.isoformat()
    data_store.save_agent_state(state)
    return {"ok": True, "silenced": True, "silenced_until": state["telegram_silenced_until"]}


# ---------------------------------------------------------------------------
# Listings — bulk delete, per-listing delete, reevaluate, debug
# ---------------------------------------------------------------------------

@router.delete("/api/listings/all")
def delete_all_listings() -> dict:
    """Wipe every listing (properties, pending, rejected) and reset seen-ID set.

    Row-scoped (Phase 7 Wave 5): single db.query(Listing).delete() instead of
    load whole-dict → clear lists → save whole-dict. Agent state (seen_listing_ids)
    still lives in agent_state.json (filesystem per D-Discretion).

    Intentionally unauthenticated for local single-user use — the whole backend
    already sits behind Caddy Basic Auth in production. Never raises.
    """
    try:
        with db.SessionLocal() as db_:
            # Count by status BEFORE delete so the response accurately reports what was removed
            status_counts = dict(
                db_.query(Listing.status, sa_func.count(Listing.id))
                .group_by(Listing.status)
                .all()
            )
            deleted = db_.query(Listing).delete()
            db_.commit()
        # Agent state (agent_state.json — still filesystem per D-Discretion)
        state = data_store.load_agent_state()
        state["seen_listing_ids"] = []
        data_store.save_agent_state(state)
        approved_count = (
            status_counts.get("approved", 0)
            + status_counts.get("viewing_scheduled", 0)
            + status_counts.get("viewed", 0)
        )
        return {"ok": True, "removed": {
            "properties": approved_count,
            "pending": status_counts.get("pending", 0),
            "rejected": status_counts.get("rejected", 0),
            "checklists": deleted,
            "price_history": deleted,
        }}
    except SQLAlchemyError:
        log.exception("delete_all_listings failed")
        return {"ok": False, "error": "DB error"}


@router.delete("/api/listings/{listing_id}")
def delete_listing(listing_id: str) -> dict:
    """Remove a listing from the DB by its id.

    Row-scoped (Phase 7 Wave 5): db.get(Listing, id) → delete → commit, instead of
    load whole-dict → pop from list → save whole-dict. Never raises — returns
    {"ok": False, ...} if nothing was found.
    """
    try:
        with db.SessionLocal() as db_:
            row = db_.get(Listing, listing_id)
            if row is None:
                return {"ok": False, "error": "Listing not found"}
            removed_from_status = row.status
            db_.delete(row)
            db_.commit()
        # Translate status → legacy list-name for response parity with pre-Phase-7 shape
        if removed_from_status in ("approved", "viewing_scheduled", "viewed"):
            removed_from_bucket = "properties"
        elif removed_from_status == "rejected":
            removed_from_bucket = "rejected"
        else:
            removed_from_bucket = "pending"
        return {"ok": True, "removed_from": removed_from_bucket}
    except SQLAlchemyError:
        log.exception("delete_listing failed for %s", listing_id)
        return {"ok": False, "error": "DB error"}


@router.get("/api/listings/{listing_id}/debug")
def debug_listing(listing_id: str) -> dict:
    """Return the resolved listing data as it would be sent to Claude.

    Shows: raw stored entry, normalized Listing dict, the listing_summary prompt segment
    that goes to Claude, calibration context prefix, and current stored score/verdict.
    """
    data = data_store.load_app_data()
    entry = _find_entry(data, listing_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Listing not found")
    try:
        listing = ingest_handler._deserialize_listing(entry)
        listing_dict = dataclasses.asdict(listing)
    except Exception as exc:
        listing_dict = {"__error__": str(exc)}
    try:
        context_prefix = ingest_handler._build_context_prefix(
            ingest_handler._deserialize_listing(entry), data
        )
    except Exception as exc:
        context_prefix = f"<context build failed: {exc}>"
    listing_summary = (
        f"Title/address: {listing_dict.get('title')}\n"
        f"URL: {listing_dict.get('url')}\n"
        f"Price: {listing_dict.get('price_eur')} EUR ({listing_dict.get('price_per_sqm')} EUR/m2)\n"
        f"Rooms: {listing_dict.get('rooms')}\n"
        f"Area: {listing_dict.get('area_sqm')} m2\n"
        f"Year built: {listing_dict.get('year_built')}\n"
        f"Material: {listing_dict.get('material')}\n"
        f"Condition (stated): {listing_dict.get('condition')}\n"
        f"Floor: {listing_dict.get('floor')}/{listing_dict.get('floor_total')}\n"
        f"Parking: {listing_dict.get('parking')}\n"
        f"Renovation needed (text signals): {listing_dict.get('needs_renovation')}\n"
        f"Description: {(listing_dict.get('description') or '')[:config.AI_DESCRIPTION_MAX_CHARS]}"
    )
    return {
        "listing_id": listing_id,
        "diagnosis": _diagnose_listing(entry, listing_dict),
        "raw_entry": entry,
        "normalized_listing": listing_dict,
        "context_prefix": context_prefix,
        "listing_summary_sent_to_ai": listing_summary,
        "stored_score": entry.get("score"),
        "stored_verdict": entry.get("verdict"),
        "anthropic_key_configured": bool(config.ANTHROPIC_API_KEY),
        "ors_key_configured": bool(config.ORS_API_KEY),
    }


@router.post("/api/listings/{listing_id}/reevaluate")
def reevaluate_listing(listing_id: str) -> dict:
    """Re-run AI evaluation on a listing already stored in properties[] or pending[].

    Requires ANTHROPIC_API_KEY. Never raises — returns error dict on failure.
    """
    if not config.ANTHROPIC_API_KEY:
        return {"ok": False, "error": "ANTHROPIC_API_KEY not configured"}
    app_data = data_store.load_app_data()
    entry = _find_entry(app_data, listing_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Listing not found")
    try:
        listing = ingest_handler._deserialize_listing(entry)
    except Exception:
        log.exception("reevaluate: failed to deserialize %s", listing_id)
        return {"ok": False, "error": "Cannot deserialize listing"}
    try:
        import cost_calculator
        coo = cost_calculator.compute_cost_of_ownership(
            listing.price_eur, listing.area_sqm, listing.year_built,
        )
        context_prefix = ingest_handler._build_context_prefix(listing, app_data)
        evaluation = ai_evaluator.evaluate_listing(
            listing,
            context_prefix,
            commute_minutes=entry.get("commute_minutes"),
            district=entry.get("district") or getattr(listing, "district", ""),
            cost_of_ownership=coo,
        )
    except Exception:
        log.exception("reevaluate: evaluation failed for %s", listing_id)
        return {"ok": False, "error": "Evaluation call failed"}

    entry["score"] = evaluation.get("score", 0)
    entry["verdict"] = evaluation.get("verdict", "")
    entry["score_breakdown"] = evaluation.get("score_breakdown", {})
    entry["risks"] = evaluation.get("risks", [])
    entry["strengths"] = evaluation.get("strengths", [])
    entry["concerns"] = evaluation.get("concerns", [])  # legacy carry-over
    entry["ai_checklist_fills"] = evaluation.get("checklist_fills", {})
    entry["cost_of_ownership"] = coo
    entry["draft_subject"] = evaluation.get("draft_subject") or f"Inquiry about {listing.title}"
    entry["draft_body"] = evaluation.get("draft_body") or ""

    # Refresh commute_minutes if we now have ORS + coords but the entry lacks a value.
    if (
        entry.get("commute_minutes") is None
        and entry.get("lat") is not None
        and entry.get("lng") is not None
        and config.ORS_API_KEY
    ):
        entry["commute_minutes"] = ingest_handler._fetch_commute_minutes(
            entry["lat"], entry["lng"]
        )

    data_store.save_app_data(app_data)

    # AI checklist writes retired — the new schema uses score_breakdown + risks
    # instead of a 7-item pass/fail list. See AI depth rework.
    return {
        "ok": True,
        "score": entry["score"],
        "verdict": entry["verdict"],
    }


# ---------------------------------------------------------------------------
# Backfill operations
# ---------------------------------------------------------------------------

@router.post("/api/backfill-costs")
def backfill_costs() -> dict:
    """Recompute cost_of_ownership for every stored entry with price + area.

    Row-scoped (Phase 7 Wave 5): one session, iterate rows, skip overridden,
    commit once — was previously load whole-dict → per-entry mutate → save whole-dict.
    Cheap (pure Python, no external calls) so we can call it on every settings
    change or model tweak without worrying about rate limits.
    """
    import cost_calculator
    updated = 0
    skipped = 0
    try:
        with db.SessionLocal() as db_:
            rows = db_.query(Listing).all()
            for row in rows:
                coo_existing = row.cost_of_ownership or {}
                if coo_existing.get("overridden"):
                    skipped += 1
                    continue
                coo = cost_calculator.compute_cost_of_ownership(
                    row.price_eur,
                    row.area_sqm,
                    row.year_built,
                )
                if coo is not None:
                    row.cost_of_ownership = coo  # JSONB reassignment (Pitfall 1)
                    updated += 1
                else:
                    skipped += 1
            db_.commit()
    except SQLAlchemyError:
        log.exception("backfill-costs failed")
    return {"ok": True, "updated": updated, "skipped": skipped}


@router.post("/api/backfill-commutes")
def backfill_commutes() -> dict:
    """Recompute commute_minutes for every entry that has lat/lng but no commute.

    Row-scoped with session/HTTP split (Phase 7 Wave 5, per RESEARCH § Pitfall 2):
    1. Open session → snapshot candidate IDs + coords → close session
    2. Make ORS HTTP calls OUTSIDE any session (no pool exhaustion)
    3. Reopen session → write results → commit

    Ingest normally sets commute only for new listings; deduped/legacy entries
    stay stuck at None. This endpoint re-runs ORS for all of them.
    Never raises.
    """
    if not config.ORS_API_KEY:
        return {"ok": False, "error": "ORS_API_KEY not configured"}
    try:
        # Step 1: snapshot IDs + coords under one session, release before HTTP
        with db.SessionLocal() as db_:
            candidates = db_.query(Listing.id, Listing.lat, Listing.lng).filter(
                Listing.lat.isnot(None),
                Listing.lng.isnot(None),
                Listing.commute_minutes.is_(None),
            ).all()
            skipped_no_coords = db_.query(Listing).filter(
                (Listing.lat.is_(None)) | (Listing.lng.is_(None))
            ).count()
            skipped_had_value = db_.query(Listing).filter(
                Listing.commute_minutes.isnot(None)
            ).count()
        # Step 2: HTTP calls OUTSIDE any session
        updates: list[tuple[str, int]] = []
        failed = 0
        for lid, lat, lng in candidates:
            mins = ingest_handler._fetch_commute_minutes(lat, lng)  # HTTP — no session held
            if mins is not None:
                updates.append((lid, mins))
            else:
                failed += 1
        # Step 3: reopen session and commit results
        updated = 0
        with db.SessionLocal() as db_:
            for lid, mins in updates:
                row = db_.get(Listing, lid)
                if row is not None:
                    row.commute_minutes = mins
                    updated += 1
            db_.commit()
        return {
            "ok": True,
            "updated": updated,
            "skipped_no_coords": skipped_no_coords,
            "skipped_had_value": skipped_had_value,
            "failed": failed,
        }
    except SQLAlchemyError:
        log.exception("backfill-commutes failed")
        return {"ok": False, "error": "DB error"}
