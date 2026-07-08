"""
Single source of truth for all persisted data, shared by:
- the FastAPI routes (serving the dossier frontend)
- the background agent job (kv.ee checker)

Two files on disk (both under DATA_DIR, mounted as a docker volume):
- app_data.json    -> {properties: [...], checklists: {...}, settings: {...}}
                      This is exactly what the dossier frontend reads/writes.
- agent_state.json -> {seen_listing_ids, pending_drafts, last_telegram_update_id,
                        last_processed_uid}
                      Internal bookkeeping for the agent job only - the frontend
                      never touches this.

A single process-wide lock serializes all reads/writes. At this scale (one
user, a request every few seconds at most) this is simpler and just as
correct as a real database, and there's nothing to install or migrate.
"""

import json
import os
import threading
from typing import Optional

import config

_lock = threading.RLock()

DEFAULT_PROPERTIES = [
    {"id":"astangu-50b-1-13", "name":"Astangu tn 50b/1-13", "district":"Haabersti", "url":"", "price":239000, "area":70.6, "rooms":3, "pricePerSqm":3391, "year":"", "material":"new build", "notes":"Mandatory 1 storage room (from €5,000) + 2 parking spots (from €10,000 each). Emotional favourite, but the most expensive option."},
    {"id":"mustamae-tee-165-55", "name":"Mustamäe tee 165-55", "district":"Mustamäe", "url":"", "price":0, "area":0, "rooms":0, "pricePerSqm":0, "year":"", "material":"panel", "notes":"Under renovation at time of analysis — availability and price need to be re-verified."},
    {"id":"moldre-tee-3", "name":"Möldre tee 3", "district":"Tiskre", "url":"", "price":0, "area":0, "rooms":0, "pricePerSqm":3254, "year":"2020", "material":"new build", "notes":"Parking and storage included in price. Contact via kv.ee form only."},
    {"id":"mustamae-tee-100", "name":"Mustamäe tee 100", "district":"Mustamäe", "url":"", "price":0, "area":0, "rooms":0, "pricePerSqm":2789, "year":"1967", "material":"panel", "notes":"Plumbing and electrical already updated."},
    {"id":"liivalaia-tn-7", "name":"Liivalaia tn 7", "district":"Kesklinn", "url":"", "price":0, "area":0, "rooms":0, "pricePerSqm":2922, "year":"1962", "material":"brick", "notes":"Facade and heating major renovation completed in 2026. Enclosed courtyard with parking."},
    {"id":"virbi-tn-12", "name":"Virbi tn 12", "district":"Lasnamäe", "url":"", "price":199980, "area":55, "rooms":0, "pricePerSqm":3636, "year":"2008", "material":"panel", "notes":"Poor value for money."},
    {"id":"mustamae-tee-167-1", "name":"Mustamäe tee 167 (apt. 1)", "district":"Mustamäe", "url":"", "price":0, "area":0, "rooms":0, "pricePerSqm":2450, "year":"", "material":"panel", "notes":"Strong building fund (KT), needs cosmetic renovation — good DIY candidate (~185k total with ~40k for renovation)."},
    {"id":"mustamae-tee-167-2", "name":"Mustamäe tee 167 (apt. 2)", "district":"Mustamäe", "url":"", "price":0, "area":0, "rooms":0, "pricePerSqm":2450, "year":"", "material":"panel", "notes":"Second listing in the same building."},
    {"id":"k-karberi-tn-50", "name":"K. Kärberi tn 50", "district":"Lasnamäe", "url":"", "price":0, "area":0, "rooms":4, "pricePerSqm":2130, "year":"1987", "material":"panel", "notes":"First floor, lowest price/m². Free parking."},
    {"id":"umera-tn-28b", "name":"Ümera tn 28b", "district":"Lasnamäe", "url":"", "price":204900, "area":59.5, "rooms":0, "pricePerSqm":3444, "year":"2019", "material":"panel", "notes":"Whether parking is included is not entirely clear."},
    {"id":"umera-tn-28a", "name":"Ümera tn 28a", "district":"Lasnamäe", "url":"", "price":0, "area":0, "rooms":0, "pricePerSqm":3399, "year":"2018", "material":"panel", "notes":"FSBO. Parking and storage included in price."},
    {"id":"j-koorti-tn-30", "name":"J. Koorti tn 30", "district":"", "url":"", "price":199967, "area":79.7, "rooms":0, "pricePerSqm":2509, "year":"", "material":"", "notes":"Largest floor area. Legalised floor plan + fireplace. Didn't like the interior design."},
    {"id":"keskuse-tn-14a", "name":"Keskuse tn 14a", "district":"", "url":"", "price":0, "area":0, "rooms":0, "pricePerSqm":2756, "year":"2007", "material":"stone", "notes":"FSBO. Top floor. Parking and storage included in price."},
    {"id":"retke-tee-22", "name":"Retke tee 22", "district":"Mustamäe", "url":"", "price":175000, "area":74.7, "rooms":4, "pricePerSqm":2343, "year":"1970", "material":"panel", "notes":"Top floor, free parking. Smallest down-payment gap. Strong candidate."}
]

DEFAULT_APP_DATA = {
    "properties": DEFAULT_PROPERTIES,
    "checklists": {},
    "settings": {},
    "pending": [],
    "rejected": [],
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
}


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


def load_app_data():
    with _lock:
        data = _read_json(config.APP_DATA_FILE, DEFAULT_APP_DATA)
        data.setdefault("properties", [])
        data.setdefault("checklists", {})
        data.setdefault("settings", {})
        data.setdefault("pending", [])
        data.setdefault("rejected", [])
        return data


def save_app_data(data):
    with _lock:
        _write_json(config.APP_DATA_FILE, data)


def add_property_if_new(prop: dict) -> bool:
    """Used by the agent job. Returns True if it was actually added."""
    with _lock:
        data = load_app_data()
        if any(p.get("id") == prop.get("id") for p in data["properties"]):
            return False
        data["properties"].append(prop)
        save_app_data(data)
        return True


def add_to_pending(entry: dict) -> bool:
    """Write a pending listing entry. Returns False if already in pending or properties (per D-05)."""
    with _lock:
        data = load_app_data()
        listing_id = entry.get("id")
        if any(e.get("id") == listing_id for e in data["pending"]):
            return False
        if any(p.get("id") == listing_id for p in data["properties"]):
            return False
        data["pending"].append(entry)
        save_app_data(data)
        return True


def load_pending() -> list:
    """Return the current pending queue (thread-safe read under _lock)."""
    with _lock:
        return load_app_data().get("pending", [])


def approve_listing(listing_id: str) -> bool:
    """Move listing from pending[] to properties[]. Returns False if not found (idempotent — D-05, RESEARCH Pitfall 2)."""
    with _lock:
        data = load_app_data()
        pending = data.get("pending", [])
        entry = next((e for e in pending if e.get("id") == listing_id), None)
        if entry is None:
            return False
        data["pending"] = [e for e in pending if e.get("id") != listing_id]
        data["properties"].append(_pending_to_property(entry))
        save_app_data(data)
        return True


def reject_listing(listing_id: str, reason: str) -> bool:
    """Move listing from pending[] to rejected[] with reason. Returns False if not found.

    reason is whitelisted to {"price","location","condition","other"} — anything else
    is clamped to "other" (T-02-CQ-REASON defense in depth per threat model).
    """
    from datetime import datetime, timezone  # local import avoids circular dependency

    if reason not in {"price", "location", "condition", "other"}:
        reason = "other"

    with _lock:
        data = load_app_data()
        pending = data.get("pending", [])
        entry = next((e for e in pending if e.get("id") == listing_id), None)
        if entry is None:
            return False
        data["pending"] = [e for e in pending if e.get("id") != listing_id]
        rejected_entry = dict(entry)
        rejected_entry["rejection_reason"] = reason
        rejected_entry["rejected_at"] = datetime.now(timezone.utc).isoformat()
        data.setdefault("rejected", []).append(rejected_entry)
        save_app_data(data)
        return True


def _pending_to_property(entry: dict) -> dict:
    """Convert a pending listing entry (already a dict) to the dossier property schema.

    Mirrors _listing_to_property in ingest_handler.py but operates on the
    already-serialised pending entry dict rather than a Listing dataclass instance.
    Carries over draft_body, contact_email, draft_subject so POST /api/draft/<id>
    can access them without a second AI call (per D-15).
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

    listing_id = entry.get("id", "")
    prop = {
        "id": listing_id,
        "name": entry.get("title") or ("kv.ee #" + listing_id),
        "district": "",
        "url": entry.get("url", ""),
        "price": entry.get("price_eur") or 0,
        "area": entry.get("area_sqm") or 0,
        "rooms": entry.get("rooms") or 0,
        "pricePerSqm": entry.get("price_per_sqm") or 0,
        "year": str(entry.get("year_built")) if entry.get("year_built") else "",
        "material": entry.get("material") or "",
        "notes": notes,
        # Carry over draft fields for POST /api/draft/<id> (D-15)
        "draft_body": entry.get("draft_body", ""),
        "contact_email": entry.get("contact_email", ""),
        "draft_subject": entry.get("draft_subject", ""),
    }
    return prop


def write_checklist_ai(listing_id: str, checklist: dict) -> None:
    """Write AI-generated checklist to checklists[listing_id]["ai_checklist"].

    Each entry is stored as {result: str, source: "ai"}.
    Existing entries with source=="user" are preserved (D-09).
    Called inside process_ingest_batch which already holds _lock (RLock — re-entrant safe, Pitfall 1).
    """
    with _lock:
        data = load_app_data()
        ai_cl = (
            data
            .setdefault("checklists", {})
            .setdefault(listing_id, {})
            .setdefault("ai_checklist", {})
        )
        for key, result in checklist.items():
            if isinstance(ai_cl.get(key), dict) and ai_cl[key].get("source") == "user":
                continue  # preserve user overrides (D-09)
            ai_cl[key] = {"result": result, "source": "ai"}
        save_app_data(data)


def get_approved_listing(listing_id: str) -> Optional[dict]:
    """Return the properties[] entry with the given id, or None if not found.

    Used by POST /api/draft/<id> to look up contact_email, draft_body, and draft_subject
    that were carried over by _pending_to_property at approval time (D-15).
    """
    with _lock:
        data = load_app_data()
        return next((p for p in data["properties"] if p.get("id") == listing_id), None)


def load_agent_state():
    with _lock:
        state = _read_json(config.AGENT_STATE_FILE, DEFAULT_AGENT_STATE)
        for k, v in DEFAULT_AGENT_STATE.items():
            state.setdefault(k, v)
        return state


def save_agent_state(state):
    with _lock:
        _write_json(config.AGENT_STATE_FILE, state)
