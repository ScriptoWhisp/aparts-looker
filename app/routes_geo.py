"""Geographic and spatial endpoints: isochrone, districts, geocode backfill.

These endpoints serve map-related data for the dossier frontend (MAP-03, MAP-04,
MAP-06) and trigger background geocoding jobs.
"""

from __future__ import annotations

import json
import logging
import os
import threading
import time

import requests
from fastapi import APIRouter

import config
import data_store
import ingest_handler

log = logging.getLogger("app")

router = APIRouter()

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_ISOCHRONE_PATH = os.path.join(os.path.dirname(__file__), "static", "isochrone.geojson")
_EMPTY_FEATURE_COLLECTION: dict = {"type": "FeatureCollection", "features": []}


# ---------------------------------------------------------------------------
# Isochrone
# ---------------------------------------------------------------------------

@router.get("/api/isochrone")
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


@router.post("/api/refresh-isochrone")
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


# ---------------------------------------------------------------------------
# Districts
# ---------------------------------------------------------------------------

@router.get("/api/districts")
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


# ---------------------------------------------------------------------------
# Geocode backfill
# ---------------------------------------------------------------------------

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


@router.post("/api/geocode-backfill")
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
