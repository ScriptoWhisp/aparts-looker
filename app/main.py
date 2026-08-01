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
import routes_ingest
import routes_geo
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


@app.on_event("startup")
def on_startup():
    settings_store.load_overrides()  # apply persisted runtime settings before anything reads config.X
    scheduler.start()


app.include_router(routes_data.router)
app.include_router(routes_entries.router)
app.include_router(routes_pending_flow.router)
app.include_router(routes_admin.router)
app.include_router(routes_ingest.router)
app.include_router(routes_geo.router)


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



# Static frontend last, so it doesn't shadow the /api/* routes above.
app.mount("/", StaticFiles(directory="static", html=True), name="static")
