"""Per-listing action routes: schedule-viewing, mark-viewed, regenerate-brief,
refresh-ku, cost-override (POST + DELETE), and checklist PATCH.

All paths are under /api/entry/{listing_id}/... or /api/listings/{listing_id}/checklist.
"""

from __future__ import annotations

import logging
import re
import threading
from datetime import datetime
from typing import Optional

import cost_calculator
from fastapi import APIRouter, HTTPException
from fastapi.requests import Request
from sqlalchemy.exc import SQLAlchemyError

import db
import brief_generator
import data_store
import ingest_handler
from models import Listing, SHORTLIST_VIEWED, SHORTLIST_DROPPED

log = logging.getLogger("app")

router = APIRouter()


def _find_entry_any(app_data: dict, listing_id: str) -> Optional[dict]:
    """Like _find_entry but also searches rejected — used by per-listing edits."""
    for list_name in ("properties", "pending", "rejected"):
        for e in app_data.get(list_name, []):
            if e.get("id") == listing_id:
                return e
    return None


@router.post("/api/entry/{listing_id}/schedule-viewing")
async def schedule_viewing(listing_id: str, request: Request) -> dict:
    """Schedule a viewing for an approved listing.

    Body: {"scheduled_at": "<UTC ISO 8601 string>"}
    The browser must convert datetime-local to UTC ISO via new Date(input.value).toISOString()
    before POST (06-RESEARCH Pitfall 1). Backend validates via datetime.fromisoformat.
    Returns 400 for malformed ISO strings; 404 if listing not found in properties[].
    Spawns a daemon thread to generate the negotiation brief in background (D-06, VIEW-03).
    """
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Body must be a JSON object")
    scheduled_at = body.get("scheduled_at", "")
    try:
        datetime.fromisoformat(scheduled_at.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        raise HTTPException(status_code=400, detail="Invalid scheduled_at ISO string")
    ok = data_store.set_viewing_scheduled(listing_id, scheduled_at)
    if not ok:
        raise HTTPException(status_code=404, detail="Listing not found in properties")
    # Fire-and-forget brief generation (mirrors main.py check-now daemon-thread pattern)
    threading.Thread(
        target=brief_generator.generate_and_save_brief,
        args=(listing_id,),
        daemon=True,
    ).start()
    return {"ok": True, "message": "Scheduled; negotiation brief generating in background"}


@router.post("/api/entry/{listing_id}/mark-viewed")
async def mark_viewed_endpoint(listing_id: str) -> dict:
    """Mark a viewing_scheduled listing as viewed.

    Calls data_store.mark_viewed which guards against invalid transitions per D-03:
    returns False if the listing is not in 'viewing_scheduled' state or is not found.
    Returns 400 in both error cases (consistent with the helper's boolean contract).
    """
    ok = data_store.mark_viewed(listing_id)
    if not ok:
        raise HTTPException(status_code=400, detail="Listing not found or not in viewing_scheduled state")
    return {"ok": True, "message": "Marked as viewed"}


@router.post("/api/entry/{listing_id}/regenerate-brief")
async def regenerate_brief(listing_id: str) -> dict:
    """Trigger on-demand regeneration of the negotiation brief for an existing entry.

    No body required. Verifies the listing exists, then spawns a daemon thread
    to call brief_generator.generate_and_save_brief (D-06 regenerate semantics:
    overwrites entry.negotiation_brief). Returns 200 immediately (fire-and-forget).
    Returns 404 if the listing is not in properties[].

    Phase 7 Wave 4 (site #5, RESEARCH § Pitfall 2): lock wrapper removed.
    get_approved_listing scopes its own session; the daemon receives only the
    listing_id string — no session is passed to the thread.
    """
    entry = data_store.get_approved_listing(listing_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Listing not found in properties")
    # Lazy import so tests can monkeypatch main.threading (avoids circular import at load time)
    import main as _main  # noqa: PLC0415
    _main.threading.Thread(
        target=brief_generator.generate_and_save_brief,
        args=(listing_id,),
        daemon=True,
    ).start()
    return {"ok": True, "message": "Brief regenerating in background"}


@router.post("/api/entry/{listing_id}/refresh-ku")
async def refresh_ku(listing_id: str) -> dict:
    """Trigger on-demand KÜ re-fetch for an existing properties[] entry.

    No body required. Verifies the listing exists and has an address, then spawns a
    daemon thread to call ingest_handler._dispatch_ku_lookup (D-12 Refresh KÜ button).
    Returns 200 immediately (fire-and-forget). Returns 404 if the listing is not in
    properties[]. Returns 400 if the listing has no address field (silent noop with
    informative error so the frontend can surface a helpful message to Daniel).

    Phase 7 Wave 4 (site #4, RESEARCH § Pitfall 2): lock wrapper removed.
    get_approved_listing scopes its own session (opens + closes before this function
    spawns the KÜ daemon). The daemon receives only plain string args — no session passed.
    """
    entry = data_store.get_approved_listing(listing_id)
    address = (entry.get("address", "") or "") if entry is not None else None
    if entry is None:
        raise HTTPException(status_code=404, detail="Listing not found in properties")
    if not address:
        raise HTTPException(status_code=400, detail="Listing has no address to look up")
    # Lazy import so tests can monkeypatch main.threading (avoids circular import at load time)
    import main as _main  # noqa: PLC0415
    _main.threading.Thread(
        target=ingest_handler._dispatch_ku_lookup,
        args=(listing_id, address),
        daemon=True,
    ).start()
    return {"ok": True, "message": "KÜ lookup running in background"}


@router.post("/api/entry/{listing_id}/cost-override")
async def cost_override(listing_id: str, request: Request) -> dict:
    """Apply user-supplied override values to a listing's cost of ownership.

    Body: {"mortgage": 950, "ku_fee": 180, "heating": 120, "utilities": 90}
    All keys optional. Non-numeric/missing → keep the previously computed value.
    Monthly total and €/m² are recomputed from the merged breakdown so the card
    stays consistent. Also stamps entry.cost_of_ownership.overridden=true so the
    UI can flag it.

    Row-scoped (Phase 7 Wave 5): opens one session, mutates the single row,
    commits once — was previously load whole-dict → mutate entry → save whole-dict.
    """
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Body must be a JSON object")

    keys = ("mortgage", "ku_fee", "heating", "utilities")
    try:
        with db.SessionLocal() as db_:
            row = db_.get(Listing, listing_id)
            if row is None:
                raise HTTPException(status_code=404, detail="Listing not found")

            # Ensure there is something to override — recompute a base from current
            # config first if the entry has no cost_of_ownership yet (e.g. legacy row).
            coo = dict(row.cost_of_ownership or {})
            if not coo:
                coo = cost_calculator.compute_cost_of_ownership(
                    row.price_eur, row.area_sqm, row.year_built,
                )
                if coo is None:
                    raise HTTPException(
                        status_code=400,
                        detail="Cannot override cost for a listing without price + area",
                    )
                coo = dict(coo)

            breakdown = dict(coo.get("breakdown") or {})
            for k in keys:
                if k in body and body[k] is not None and body[k] != "":
                    try:
                        breakdown[k] = round(float(body[k]))
                    except (TypeError, ValueError):
                        continue

            total = sum(breakdown.get(k, 0) for k in keys)
            area = row.area_sqm or 0
            new_coo = {
                **coo,
                "breakdown": breakdown,
                "monthly_total_eur": round(total),
                "cost_per_sqm_eur": round(total / area, 1) if area else None,
                "overridden": True,
            }

            # Wave 6C: optional renovation work override (JSONB sub-key)
            # Pass renovation_override_work_eur=N to pin a manual work figure;
            # pass renovation_override_work_eur=null to remove it.
            if "renovation_override_work_eur" in body:
                raw_reno = body["renovation_override_work_eur"]
                if raw_reno is None or raw_reno == "":
                    new_coo.pop("renovation_override_work_eur", None)
                else:
                    try:
                        new_coo["renovation_override_work_eur"] = round(float(raw_reno))
                    except (TypeError, ValueError):
                        pass  # ignore bad value — keep existing or absent

            row.cost_of_ownership = new_coo  # JSONB reassignment (Pitfall 1)
            db_.commit()

        return {"ok": True, "cost_of_ownership": new_coo}
    except HTTPException:
        raise
    except SQLAlchemyError:
        log.exception("cost_override failed for %s", listing_id)
        return {"ok": False, "error": "DB error"}


@router.delete("/api/entry/{listing_id}/cost-override")
def cost_override_reset(listing_id: str) -> dict:
    """Discard overrides and recompute cost_of_ownership from current settings.

    Row-scoped (Phase 7 Wave 5): opens one session, mutates the single row,
    commits once — was previously load whole-dict → mutate entry → save whole-dict.
    """
    try:
        with db.SessionLocal() as db_:
            row = db_.get(Listing, listing_id)
            if row is None:
                raise HTTPException(status_code=404, detail="Listing not found")
            coo = cost_calculator.compute_cost_of_ownership(
                row.price_eur, row.area_sqm, row.year_built,
            )
            row.cost_of_ownership = coo or {}  # JSONB reassignment (Pitfall 1)
            db_.commit()
        return {"ok": True, "cost_of_ownership": coo}
    except HTTPException:
        raise
    except SQLAlchemyError:
        log.exception("cost_override_reset failed for %s", listing_id)
        return {"ok": False, "error": "DB error"}


@router.post("/api/entry/{listing_id}/viewing-decision")
async def viewing_decision(listing_id: str, request: Request) -> dict:
    """Record a post-viewing decision for a listing that has already been marked viewed.

    Body:
      {"decision": "still-in" | "thinking" | "drop", "reason": "..." (optional)}

    Status transitions:
      still-in → offer_drafted
      thinking → thinking
      drop     → dropped  (reason stored on viewing_history[-1].drop_reason if provided)

    Precondition: listing must have status in (viewed, thinking, offer_drafted, dropped).
    Calling this on a listing that has not yet been marked viewed (status is
    pending / approved / viewing_scheduled / rejected) returns 409.

    Returns:
      200 {"ok": true, "new_status": "..."} on success
      404 if listing not found
      409 if listing has not yet been marked viewed
      422 if decision value is not one of the three allowed strings
      500 {"ok": false, "error": "..."} on unexpected DB error (never-raise)
    """
    try:
        body = await request.json()
        if not isinstance(body, dict):
            raise HTTPException(status_code=400, detail="Body must be a JSON object")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    decision = body.get("decision", "")
    reason: Optional[str] = body.get("reason") or None

    _valid_decisions = {"still-in", "thinking", "drop"}
    if decision not in _valid_decisions:
        raise HTTPException(
            status_code=422,
            detail=f"decision must be one of: {sorted(_valid_decisions)}",
        )

    # Check existence and status precondition via a single DB read.
    _permitted_for_decision = SHORTLIST_VIEWED | SHORTLIST_DROPPED
    try:
        with db.SessionLocal() as db_:
            row = db_.get(Listing, listing_id)
            if row is None:
                raise HTTPException(status_code=404, detail="Listing not found")
            if row.status not in _permitted_for_decision:
                raise HTTPException(
                    status_code=409,
                    detail="Cannot record viewing decision before marking viewed",
                )
    except HTTPException:
        raise
    except SQLAlchemyError:
        log.exception("viewing_decision status check failed for %s", listing_id)
        return {"ok": False, "error": "DB error during status check"}

    # Delegate the state transition to the data_store helper (never-raise contract).
    ok = data_store.set_viewing_decision(listing_id, decision, reason)
    if not ok:
        # set_viewing_decision returns False only when the listing is missing or
        # the status precondition fails — both were already verified above, so this
        # branch covers unexpected races (e.g. concurrent delete). Log + 500.
        log.error(
            "viewing_decision: set_viewing_decision returned False unexpectedly for %s (decision=%r)",
            listing_id,
            decision,
        )
        return {"ok": False, "error": "Decision could not be applied"}

    # Map decision string → the resulting status (mirrors data_store logic) so the
    # response body carries new_status without re-reading the row from DB.
    _decision_to_status = {
        "still-in": "offer_drafted",
        "thinking": "thinking",
        "drop": "dropped",
    }
    new_status = _decision_to_status[decision]
    return {"ok": True, "new_status": new_status}


@router.patch("/api/listings/{listing_id}/checklist")
async def patch_checklist(listing_id: str, request: Request) -> dict:
    """Save a single manual checklist item for any listing (approved, pending, or rejected).

    Body: {"key": "<criterion>", "value": "pass" | "fail" | "unknown"}
    Stored under checklists[listing_id].manual_checklist — separate from ai_checklist so AI
    data is never overwritten by user clicks.
    """
    try:
        body = await request.json()
        key = str(body.get("key", "")).strip()
        value = str(body.get("value", "")).strip()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    _ai_keys = {"price_per_sqm", "rooms_area", "parking", "renovation_potential",
                "floor", "year_material", "mandatory_extras"}
    if re.match(r"^s\d{2}_\d{2}_note$", key):
        # Free-text note attached to a ✗ item — only length-bound
        if len(value) > 500:
            raise HTTPException(status_code=422, detail="Note too long (max 500 chars)")
    else:
        allowed_values = {"pass", "fail", "unknown", "ok", "issue"}
        key_valid = key in _ai_keys or bool(re.match(r"^s\d{2}_\d{2}$", key))
        if not key_valid or value not in allowed_values:
            raise HTTPException(status_code=422, detail="Invalid key or value")

    app_data = data_store.load_app_data()
    cl = app_data.setdefault("checklists", {}).setdefault(listing_id, {})
    cl.setdefault("manual_checklist", {})[key] = value
    data_store.save_app_data(app_data)

    return {"ok": True}
