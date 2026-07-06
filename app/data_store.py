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

DEFAULT_APP_DATA = {"properties": DEFAULT_PROPERTIES, "checklists": {}, "settings": {}}
DEFAULT_AGENT_STATE = {"seen_listing_ids": [], "pending_drafts": {}, "last_telegram_update_id": 0, "last_processed_uid": 0}


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


def load_agent_state():
    with _lock:
        state = _read_json(config.AGENT_STATE_FILE, DEFAULT_AGENT_STATE)
        for k, v in DEFAULT_AGENT_STATE.items():
            state.setdefault(k, v)
        return state


def save_agent_state(state):
    with _lock:
        _write_json(config.AGENT_STATE_FILE, state)
