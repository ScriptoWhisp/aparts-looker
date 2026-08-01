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


@app.get("/api/settings")
def get_settings() -> dict:
    """Return every editable setting with its current value + metadata (label/hint/bounds)."""
    return {"schema": settings_store.get_schema(), "values": settings_store.get_all()}


@app.post("/api/settings")
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
    return {
        "ok": True,
        "applied": result["applied"],
        "costs_recomputed": result["costs_recomputed"],
        "values": settings_store.get_all(),
    }


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


"""Scraping is done by the separate scraper-client process (mini PC in prod, or a
local Docker container in dev). It POSTs listings to /api/ingest here. There is
deliberately no /api/scrape-now on the backend — the button lives on the scraper."""


@app.get("/api/telegram/status")
def telegram_status() -> dict:
    """Return current Telegram delivery config so the dashboard can render state."""
    from datetime import datetime, timezone as _tz
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


@app.post("/api/telegram/silence")
async def telegram_silence(request: Request) -> dict:
    """POST {"hours": N}. N > 0 silences for N hours. N == 0 clears silence.

    Phase 7 Wave 4 (site #6, RESEARCH § Pitfall 2): lock wrapper removed.
    agent_state.json is filesystem-backed (D-Discretion); save_agent_state uses
    atomic os.replace — no session concerns; no HTTP calls in this function.
    """
    from datetime import datetime, timezone as _tz, timedelta
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


"""Legacy stored entries used frontend-style field names (name/price/area/year/pricePerSqm/notes).
The Listing dataclass expects title/price_eur/area_sqm/year_built/price_per_sqm/description.
_normalize_entry maps the legacy names so _deserialize_listing can rebuild a full Listing.
"""
_LEGACY_ALIASES = {
    "name": "title",
    "price": "price_eur",
    "pricePerSqm": "price_per_sqm",
    "area": "area_sqm",
    "year": "year_built",
    "notes": "description",
}


def _normalize_entry_for_listing(entry: dict) -> dict:
    """Return a copy of entry with legacy field names mapped to Listing field names."""
    out = dict(entry)
    for old_key, new_key in _LEGACY_ALIASES.items():
        if old_key in out and (new_key not in out or not out.get(new_key)):
            out[new_key] = out.pop(old_key)
    return out


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


@app.delete("/api/listings/all")
def delete_all_listings() -> dict:
    """Wipe every listing (properties, pending, rejected), all checklists,
    all price history, and the seen-ID set so the next scrape can re-add them.

    Intentionally unauthenticated for local single-user use — the whole backend
    already sits behind Caddy Basic Auth in production. Never raises.
    """
    with data_store._lock:
        app_data = data_store.load_app_data()
        counts = {
            "properties": len(app_data.get("properties", [])),
            "pending": len(app_data.get("pending", [])),
            "rejected": len(app_data.get("rejected", [])),
            "checklists": len(app_data.get("checklists", {})),
            "price_history": len(app_data.get("price_history", {})),
        }
        app_data["properties"] = []
        app_data["pending"] = []
        app_data["rejected"] = []
        app_data["checklists"] = {}
        app_data["price_history"] = {}
        data_store.save_app_data(app_data)

        state = data_store.load_agent_state()
        state["seen_listing_ids"] = []
        data_store.save_agent_state(state)

    return {"ok": True, "removed": counts}


@app.delete("/api/listings/{listing_id}")
def delete_listing(listing_id: str) -> dict:
    """Remove a listing from properties[] or pending[]. Also drops its checklist entry.

    Useful for pruning old placeholder entries that have no real data. Never raises —
    returns {"ok": False, ...} if nothing was found.
    """
    with data_store._lock:
        app_data = data_store.load_app_data()
        removed_from = None
        for list_name in ("properties", "pending", "rejected"):
            entries = app_data.get(list_name, [])
            for i, e in enumerate(entries):
                if e.get("id") == listing_id:
                    entries.pop(i)
                    removed_from = list_name
                    break
            if removed_from:
                break
        if not removed_from:
            return {"ok": False, "error": "Listing not found"}
        # Drop checklist entry too
        app_data.get("checklists", {}).pop(listing_id, None)
        data_store.save_app_data(app_data)
    return {"ok": True, "removed_from": removed_from}


@app.get("/api/listings/{listing_id}/debug")
def debug_listing(listing_id: str) -> dict:
    """Return the resolved listing data as it would be sent to Claude.

    Shows: raw stored entry, normalized Listing dict, the listing_summary prompt segment
    that goes to Claude, calibration context prefix, and current stored score/verdict.
    """
    data = data_store.load_app_data()
    entry = _find_entry(data, listing_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Listing not found")
    normalized = _normalize_entry_for_listing(entry)
    try:
        listing = ingest_handler._deserialize_listing(normalized)
        listing_dict = dataclasses.asdict(listing)
    except Exception as exc:
        listing_dict = {"__error__": str(exc)}
    try:
        context_prefix = ingest_handler._build_context_prefix(
            ingest_handler._deserialize_listing(normalized), data
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
        f"Description: {(listing_dict.get('description') or '')[:1500]}"
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


@app.post("/api/listings/{listing_id}/reevaluate")
def reevaluate_listing(listing_id: str) -> dict:
    """Re-run AI evaluation on a listing already stored in properties[] or pending[].

    Normalizes legacy field names (name→title, price→price_eur, area→area_sqm, etc.)
    before rebuilding the Listing so entries seeded before the current schema still work.
    Requires ANTHROPIC_API_KEY. Never raises — returns error dict on failure.
    """
    if not config.ANTHROPIC_API_KEY:
        return {"ok": False, "error": "ANTHROPIC_API_KEY not configured"}
    with data_store._lock:
        app_data = data_store.load_app_data()
        entry = _find_entry(app_data, listing_id)
        if entry is None:
            raise HTTPException(status_code=404, detail="Listing not found")
        normalized = _normalize_entry_for_listing(entry)
        try:
            listing = ingest_handler._deserialize_listing(normalized)
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
    # Fire-and-forget KÜ lookup (D-12: fires once on pending → approved transition)
    # Phase 7 Wave 4 (site #3, RESEARCH § Pitfall 2): lock wrapper removed.
    # get_approved_listing scopes its own session and returns a plain dict snapshot;
    # the daemon thread is spawned with plain string args — no session is passed to it.
    entry = data_store.get_approved_listing(listing_id)
    address = (entry.get("address", "") or "") if entry is not None else ""
    if address:
        threading.Thread(
            target=ingest_handler._dispatch_ku_lookup,
            args=(listing_id, address),
            daemon=True,
        ).start()
    else:
        log.info("approve_pending: no address on %s — skipping KÜ lookup", listing_id)
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


@app.post("/api/entry/{listing_id}/schedule-viewing")
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


@app.post("/api/entry/{listing_id}/mark-viewed")
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


@app.post("/api/entry/{listing_id}/regenerate-brief")
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
    threading.Thread(
        target=brief_generator.generate_and_save_brief,
        args=(listing_id,),
        daemon=True,
    ).start()
    return {"ok": True, "message": "Brief regenerating in background"}


@app.post("/api/entry/{listing_id}/refresh-ku")
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
    threading.Thread(
        target=ingest_handler._dispatch_ku_lookup,
        args=(listing_id, address),
        daemon=True,
    ).start()
    return {"ok": True, "message": "KÜ lookup running in background"}


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

    with data_store._lock:
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
    """
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Body must be a JSON object")

    keys = ("mortgage", "ku_fee", "heating", "utilities")
    with data_store._lock:
        app_data = data_store.load_app_data()
        entry = _find_entry_any(app_data, listing_id)
        if entry is None:
            raise HTTPException(status_code=404, detail="Listing not found")

        # Ensure there is something to override — recompute a base from current
        # config first if the entry has no cost_of_ownership yet (e.g. legacy row).
        coo = entry.get("cost_of_ownership")
        if not coo:
            import cost_calculator
            coo = cost_calculator.compute_cost_of_ownership(
                entry.get("price_eur"), entry.get("area_sqm"), entry.get("year_built"),
            )
            if coo is None:
                raise HTTPException(
                    status_code=400,
                    detail="Cannot override cost for a listing without price + area",
                )

        breakdown = dict(coo.get("breakdown") or {})
        for k in keys:
            if k in body and body[k] is not None and body[k] != "":
                try:
                    breakdown[k] = round(float(body[k]))
                except (TypeError, ValueError):
                    continue

        total = sum(breakdown.get(k, 0) for k in keys)
        coo["breakdown"] = breakdown
        coo["monthly_total_eur"] = round(total)
        area = entry.get("area_sqm") or 0
        coo["cost_per_sqm_eur"] = round(total / area, 1) if area else None
        coo["overridden"] = True
        entry["cost_of_ownership"] = coo
        data_store.save_app_data(app_data)

    return {"ok": True, "cost_of_ownership": coo}


@app.delete("/api/entry/{listing_id}/cost-override")
def cost_override_reset(listing_id: str) -> dict:
    """Discard overrides and recompute cost_of_ownership from current settings."""
    import cost_calculator
    with data_store._lock:
        app_data = data_store.load_app_data()
        entry = _find_entry_any(app_data, listing_id)
        if entry is None:
            raise HTTPException(status_code=404, detail="Listing not found")
        coo = cost_calculator.compute_cost_of_ownership(
            entry.get("price_eur"), entry.get("area_sqm"), entry.get("year_built"),
        )
        entry["cost_of_ownership"] = coo
        data_store.save_app_data(app_data)
    return {"ok": True, "cost_of_ownership": coo}


@app.post("/api/backfill-costs")
def backfill_costs() -> dict:
    """Recompute cost_of_ownership for every stored entry with price + area.

    Cheap (pure Python, no external calls) so we can call it on every settings
    change or model tweak without worrying about rate limits.
    """
    import cost_calculator
    updated = 0
    skipped = 0
    try:
        with data_store._lock:
            app_data = data_store.load_app_data()
            for list_name in ("properties", "pending", "rejected"):
                for entry in app_data.get(list_name, []):
                    if (entry.get("cost_of_ownership") or {}).get("overridden"):
                        skipped += 1
                        continue
                    coo = cost_calculator.compute_cost_of_ownership(
                        entry.get("price_eur"),
                        entry.get("area_sqm"),
                        entry.get("year_built"),
                    )
                    if coo is not None:
                        entry["cost_of_ownership"] = coo
                        updated += 1
                    else:
                        skipped += 1
            data_store.save_app_data(app_data)
    except Exception:
        log.exception("backfill-costs failed")
    return {"ok": True, "updated": updated, "skipped": skipped}


@app.post("/api/backfill-commutes")
def backfill_commutes() -> dict:
    """Recompute commute_minutes for every entry that has lat/lng but no commute.

    Ingest normally sets commute only for new listings; deduped/legacy entries
    stay stuck at None. This endpoint re-runs ORS for all of them.
    Never raises.
    """
    if not config.ORS_API_KEY:
        return {"ok": False, "error": "ORS_API_KEY not configured"}
    updated = 0
    skipped_no_coords = 0
    skipped_had_value = 0
    failed = 0
    try:
        with data_store._lock:
            app_data = data_store.load_app_data()
            for list_name in ("properties", "pending", "rejected"):
                for entry in app_data.get(list_name, []):
                    lat = entry.get("lat")
                    lng = entry.get("lng")
                    if lat is None or lng is None:
                        skipped_no_coords += 1
                        continue
                    if entry.get("commute_minutes") is not None:
                        skipped_had_value += 1
                        continue
                    mins = ingest_handler._fetch_commute_minutes(lat, lng)
                    if mins is not None:
                        entry["commute_minutes"] = mins
                        updated += 1
                    else:
                        failed += 1
            data_store.save_app_data(app_data)
    except Exception:
        log.exception("backfill-commutes failed mid-flight")
    return {
        "ok": True,
        "updated": updated,
        "skipped_no_coords": skipped_no_coords,
        "skipped_had_value": skipped_had_value,
        "failed": failed,
    }


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
