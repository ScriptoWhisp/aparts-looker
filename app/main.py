"""
The whole server: a tiny JSON API backing the dossier frontend, plus the
static frontend itself, plus the background kv.ee-checking job - all one
process, one container.
"""

from __future__ import annotations

import json
import logging
import os
import re
import threading
import time
from datetime import datetime
from typing import Optional

import requests
from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.staticfiles import StaticFiles

import config
import data_store
import gmail_client
import ingest_handler
import ku_lookup
import scheduler
import ai_evaluator
import settings_store
import dataclasses
import brief_generator
from legacy_aliases import LEGACY_ALIASES
import routes_data
import routes_entries
import routes_pending_flow
import routes_admin
from routes_admin import backfill_costs, backfill_commutes  # re-exported for test introspection

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("app")

app = FastAPI(title="Apartment Dossier")


@app.middleware("http")
async def _no_cache_static(request, call_next):
    """Force browsers to always refetch HTML/JS/CSS during dev.

    We iterate on frontend files often; the default ETag-based revalidation
    still lets browsers hold stale copies through soft refreshes, which has
    repeatedly hidden CSS changes. no-store bypasses that entirely. API
    responses already opt out of caching by default; adding the header to
    them is harmless.
    """
    response = await call_next(request)
    path = request.url.path
    if (
        path == "/"
        or path.endswith((".html", ".js", ".css", ".json", ".geojson"))
    ):
        response.headers["Cache-Control"] = "no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response


# HTTPBearer with auto_error=False so a missing Authorization header yields credentials=None
# (which _verify_ingest_token handles as 403) rather than FastAPI's default 403 with a
# differently-worded detail string. Keeps the error schema uniform for all auth failures.
_bearer = HTTPBearer(auto_error=False)


def _verify_ingest_token(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
) -> None:
    """FastAPI dependency — raises 403 if the token does not match INGEST_TOKEN.

    Fail-closed: if INGEST_TOKEN is not configured (empty string), every request
    is rejected with 403 rather than accidentally opening the endpoint.
    NEVER logs the token value or the presented credential (T-01-04).
    """
    if not config.INGEST_TOKEN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Ingest not configured",
        )
    if credentials is None or credentials.credentials != config.INGEST_TOKEN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid token",
        )


@app.on_event("startup")
def on_startup():
    settings_store.load_overrides()  # apply persisted runtime settings before anything reads config.X
    scheduler.start()


app.include_router(routes_data.router)
app.include_router(routes_entries.router)
app.include_router(routes_pending_flow.router)
app.include_router(routes_admin.router)


@app.post("/api/ingest", dependencies=[Depends(_verify_ingest_token)])
async def ingest(request: Request) -> dict:
    """Receive a batch of parsed Listing JSON dicts from the mini PC scraper.

    The async handler reads the body; the sync helper acquires data_store._lock
    for the full filter → evaluate → notify → save sequence (RESEARCH Pitfall 5).
    """
    payload = await request.json()
    if not isinstance(payload, list):
        return JSONResponse({"error": "expected a JSON array of listings"}, status_code=400)
    return ingest_handler.process_ingest_batch(payload)


@app.post("/api/heartbeat", dependencies=[Depends(_verify_ingest_token)])
async def heartbeat(request: Request) -> dict:
    """Receive a heartbeat from the mini PC scraper and store state for alert checks."""
    payload = await request.json()
    if not isinstance(payload, dict):
        return JSONResponse({"error": "expected a JSON object"}, status_code=400)
    return ingest_handler.handle_heartbeat(payload)


@app.post("/api/draft/{listing_id}")
def create_draft_endpoint(listing_id: str) -> dict:
    """Create a Gmail draft for an approved listing and queue it into pending_drafts.

    Opt-in only — never called automatically on approval (D-13, T-02-DRAFT-AUTO).
    draft_body / draft_subject / contact_email come from the pre-computed evaluation
    stored on the properties[] entry at approval time (D-15, _pending_to_property).

    Returns:
      {"ok": true}                          — draft created and queued
      {"ok": false, "reason": "no_email"}   — listing has no contact email (RESEARCH Risk 5)
      404                                   — listing_id not found in properties[]
    """
    entry = data_store.get_approved_listing(listing_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Listing not found")

    contact_email = entry.get("contact_email", "")
    if not contact_email:
        return {"ok": False, "reason": "no_email"}

    subject = entry.get("draft_subject") or f"Inquiry about {entry.get('name', listing_id)}"
    body = entry.get("draft_body", "")

    ok = gmail_client.create_draft(contact_email, subject, body)
    if ok:
        state = data_store.load_agent_state()
        state["pending_drafts"][listing_id] = {
            "to_email": contact_email,
            "subject": subject,
            "body": body,
            "url": entry.get("url", ""),
        }
        data_store.save_agent_state(state)

    return {"ok": ok}


@app.patch("/api/listings/{listing_id}/checklist")
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


# ---------------------------------------------------------------------------
# Phase 5: Isochrone + Geocode endpoints (MAP-04, MAP-06)
# ---------------------------------------------------------------------------

_ISOCHRONE_PATH = os.path.join(os.path.dirname(__file__), "static", "isochrone.geojson")
_EMPTY_FEATURE_COLLECTION: dict = {"type": "FeatureCollection", "features": []}


@app.get("/api/isochrone")
def get_isochrone() -> dict:
    """Serve the pre-fetched ORS isochrone GeoJSON stored on disk.

    Returns an empty FeatureCollection if the file is missing or unreadable —
    never returns 404 so the frontend always gets a valid GeoJSON shape (RESEARCH Pitfall 5).
    """
    try:
        with open(_ISOCHRONE_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        log.warning("isochrone.geojson not found — returning empty FeatureCollection")
        return _EMPTY_FEATURE_COLLECTION
    except Exception:
        log.exception("Failed to read isochrone.geojson — returning empty FeatureCollection")
        return _EMPTY_FEATURE_COLLECTION


@app.post("/api/refresh-isochrone")
def refresh_isochrone() -> dict:
    """Fetch a 20-minute driving isochrone from ORS for Veerenni 28 and cache it to disk.

    Returns {"ok": true} on success. Returns {"ok": false, "error": "..."} on failure (200 status,
    never raises). ORS_API_KEY is never logged (T-05-11).
    """
    if not config.ORS_API_KEY:
        return {"ok": False, "error": "ORS_API_KEY not configured"}
    payload = {
        "locations": [[config.BOLT_HQ_LNG, config.BOLT_HQ_LAT]],  # [lon, lat] order per ORS convention; 1200 sec = 20 min per MAP-04
        "range": [1200],
        "range_type": "time",
    }
    headers = {
        "Authorization": f"Bearer {config.ORS_API_KEY}",
        "Content-Type": "application/json",
    }
    try:
        resp = requests.post(
            "https://api.openrouteservice.org/v2/isochrones/driving-car",
            json=payload,
            headers=headers,
            timeout=15,
        )
        resp.raise_for_status()
        geojson = resp.json()
        with open(_ISOCHRONE_PATH, "w", encoding="utf-8") as f:
            json.dump(geojson, f)
        return {"ok": True}
    except Exception:
        log.exception("ORS isochrone refresh failed")
        return {"ok": False, "error": "ORS call failed"}


def _run_geocode_backfill() -> dict:
    """Background function that geocodes all entries missing lat/lng via Nominatim.

    Phase 7 Wave 4 (RESEARCH § Pitfall 2, T-07-04-03):
    Snapshot pattern — load_app_data() opens + closes its own session before the loop;
    Nominatim and ORS HTTP calls run OUTSIDE any DB session; per-entry coordinate writes
    use data_store.update_listing_coords() which scopes its own session.
    The 60+-second geocode loop never holds a DB connection open.

    Returns {"geocoded": N, "skipped": M} for the sync path.
    Never raises — wraps body in try/except per never-raise convention.
    """
    geocoded = 0
    skipped = 0
    try:
        # Snapshot: load_app_data() opens + closes its own session before returning the dict.
        # No DB session is held across the Nominatim/ORS HTTP calls below.
        data = data_store.load_app_data()
        all_entries = data.get("properties", []) + data.get("pending", [])
        for entry in all_entries:
            if entry.get("lat") is not None and entry.get("lng") is not None:
                skipped += 1
                continue
            # Build query from entry name/title; append Tallinn if not present
            query = entry.get("name") or entry.get("title") or ""
            if not query:
                skipped += 1
                continue
            if "tallinn" not in query.lower():
                query = query + ", Tallinn"
            # Nominatim HTTP call — no DB session held (session-scope discipline, Wave 4)
            lat, lng = ingest_handler._geocode_with_nominatim(query)
            if lat is not None and lng is not None:
                # ORS HTTP call — no DB session held
                commute_mins = ingest_handler._fetch_commute_minutes(lat, lng)
                # update_listing_coords scopes its own short-lived session internally
                data_store.update_listing_coords(entry.get("id"), lat, lng, commute_mins)
                geocoded += 1
            else:
                skipped += 1
            time.sleep(1.1)  # Nominatim usage policy: max 1 request/second
    except Exception:
        log.exception("_run_geocode_backfill failed")
    return {"geocoded": geocoded, "skipped": skipped}


@app.get("/api/districts")
def get_districts() -> dict:
    """Return per-district listing counts and average price/m² aggregated from properties + pending.

    Entries with no district field (empty string or None) are silently skipped.
    Entries with price_per_sqm=None are counted but excluded from the average; if all
    entries in a district have no price, avg_price_per_sqm is returned as None.
    Never raises — wraps body in try/except per never-raise convention (MAP-03).
    """
    try:
        data = data_store.load_app_data()
        all_entries = data.get("properties", []) + data.get("pending", [])
        groups: dict[str, list[dict]] = {}
        for entry in all_entries:
            district = entry.get("district", "") or ""
            if not district:
                continue
            groups.setdefault(district, []).append(entry)
        result = []
        for district_name in sorted(groups):
            group = groups[district_name]
            prices = [entry["price_per_sqm"] for entry in group if entry.get("price_per_sqm") is not None]
            avg = round(sum(prices) / len(prices), 0) if prices else None
            result.append({"name": district_name, "avg_price_per_sqm": avg, "count": len(group)})
        return {"districts": result}
    except Exception:
        log.exception("get_districts failed")
        return {"districts": []}


def _find_entry_any(app_data: dict, listing_id: str) -> Optional[dict]:
    """Like _find_entry but also searches rejected — used by per-listing edits."""
    for list_name in ("properties", "pending", "rejected"):
        for e in app_data.get(list_name, []):
            if e.get("id") == listing_id:
                return e
    return None


@app.post("/api/entry/{listing_id}/cost-override")
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
    import cost_calculator
    from sqlalchemy.exc import SQLAlchemyError
    try:
        from db import SessionLocal
        from models import Listing
        with SessionLocal() as db_:
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
            row.cost_of_ownership = new_coo  # JSONB reassignment (Pitfall 1)
            db_.commit()

        return {"ok": True, "cost_of_ownership": new_coo}
    except HTTPException:
        raise
    except SQLAlchemyError:
        log.exception("cost_override failed for %s", listing_id)
        return {"ok": False, "error": "DB error"}


@app.delete("/api/entry/{listing_id}/cost-override")
def cost_override_reset(listing_id: str) -> dict:
    """Discard overrides and recompute cost_of_ownership from current settings.

    Row-scoped (Phase 7 Wave 5): opens one session, mutates the single row,
    commits once — was previously load whole-dict → mutate entry → save whole-dict.
    """
    import cost_calculator
    from sqlalchemy.exc import SQLAlchemyError
    try:
        from db import SessionLocal
        from models import Listing
        with SessionLocal() as db_:
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


@app.post("/api/backfill-costs")
def backfill_costs() -> dict:
    """Recompute cost_of_ownership for every stored entry with price + area.

    Row-scoped (Phase 7 Wave 5): one session, iterate rows, skip overridden,
    commit once — was previously load whole-dict → per-entry mutate → save whole-dict.
    Cheap (pure Python, no external calls) so we can call it on every settings
    change or model tweak without worrying about rate limits.
    """
    import cost_calculator
    from sqlalchemy.exc import SQLAlchemyError
    updated = 0
    skipped = 0
    try:
        from db import SessionLocal
        from models import Listing
        with SessionLocal() as db_:
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


@app.post("/api/backfill-commutes")
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
    from sqlalchemy.exc import SQLAlchemyError
    try:
        from db import SessionLocal
        from models import Listing
        # Step 1: snapshot IDs + coords under one session, release before HTTP
        with SessionLocal() as db_:
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
        with SessionLocal() as db_:
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


@app.post("/api/geocode-backfill")
def geocode_backfill(sync: int = 0) -> dict:
    """Geocode all entries missing lat/lng via Nominatim. Runs in background by default.

    When sync=1 is passed as a query parameter, runs inline and returns geocode counts.
    Background mode (default) returns immediately with a status message.
    """
    if sync:
        result = _run_geocode_backfill()
        return {"ok": True, **result}
    threading.Thread(target=_run_geocode_backfill, daemon=True).start()
    return {"ok": True, "message": "Backfill running in background — see logs"}


# Static frontend last, so it doesn't shadow the /api/* routes above.
app.mount("/", StaticFiles(directory="static", html=True), name="static")
