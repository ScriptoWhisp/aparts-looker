"""
The whole server: a tiny JSON API backing the dossier frontend, plus the
static frontend itself, plus the background kv.ee-checking job - all one
process, one container.
"""

from __future__ import annotations

import json
import logging
import os
import threading
import time
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
import scheduler

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("app")

app = FastAPI(title="Apartment Dossier")

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
    scheduler.start()


@app.get("/api/data")
def get_data():
    return data_store.load_app_data()


@app.put("/api/data")
async def put_data(request: Request):
    payload = await request.json()
    if not isinstance(payload, dict) or "properties" not in payload:
        return JSONResponse({"error": "expected an object with a 'properties' field"}, status_code=400)
    data_store.save_app_data(payload)
    return {"ok": True}


@app.post("/api/check-now")
def check_now():
    """Manually trigger the scheduler tick instead of waiting for the schedule."""
    threading.Thread(target=scheduler.run_once_now, daemon=True).start()
    return {"ok": True, "message": "Scheduler tick started in background — watch Telegram in a moment."}


@app.get("/api/health")
def health():
    return {"ok": True}


@app.get("/api/pending")
def get_pending():
    return {"pending": data_store.load_pending()}


@app.post("/api/pending/{listing_id}/approve")
def approve_pending(listing_id: str):
    ok = data_store.approve_listing(listing_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Not found in pending queue")
    return {"ok": True}


@app.post("/api/pending/{listing_id}/reject")
async def reject_pending(listing_id: str, request: Request):
    body = await request.json()
    reason = body.get("reason", "other")
    if reason not in {"price", "location", "condition", "other"}:
        reason = "other"
    ok = data_store.reject_listing(listing_id, reason)
    if not ok:
        raise HTTPException(status_code=404, detail="Not found in pending queue")
    return {"ok": True}


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
        with data_store._lock:
            state = data_store.load_agent_state()
            state["pending_drafts"][listing_id] = {
                "to_email": contact_email,
                "subject": subject,
                "body": body,
                "url": entry.get("url", ""),
            }
            data_store.save_agent_state(state)

    return {"ok": ok}


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

    Iterates properties[] + pending[], calls Nominatim for entries with lat/lng None,
    sleeps 1.1s between calls (Nominatim usage policy), then saves updated app_data.
    Returns {"geocoded": N, "skipped": M} for the sync path.
    Never raises — wraps body in try/except per never-raise convention.
    """
    geocoded = 0
    skipped = 0
    try:
        with data_store._lock:
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
                lat, lng = ingest_handler._geocode_with_nominatim(query)
                if lat is not None and lng is not None:
                    commute_mins = ingest_handler._fetch_commute_minutes(lat, lng)
                    entry["lat"] = lat
                    entry["lng"] = lng
                    entry["commute_minutes"] = commute_mins
                    geocoded += 1
                else:
                    skipped += 1
                time.sleep(1.1)  # Nominatim usage policy: max 1 request/second
            data_store.save_app_data(data)
    except Exception:
        log.exception("_run_geocode_backfill failed")
    return {"geocoded": geocoded, "skipped": skipped}


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
