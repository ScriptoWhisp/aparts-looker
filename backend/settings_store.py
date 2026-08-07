"""
Runtime-editable settings for the backend.

env vars provide initial defaults at boot (via config.py). This module
overlays overrides from data/settings.json on top, and hot-applies changes
so downstream modules that read `config.X` see the new value immediately
without a restart.

Rule of thumb: settings live here if the USER might want to tune them
during normal operation. Set-once infra (tokens, URLs) stays in env.
"""

import json
import logging
import os
from typing import Any

import config

log = logging.getLogger("settings_store")

_SETTINGS_FILE = os.path.join(os.path.dirname(config.APP_DATA_FILE), "settings.json")

# Schema: user_key -> (config_attribute, python_type, group, label, hint, min, max)
_SCHEMA = {
    # ---- Cost of ownership ----
    "cost_down_pct":       ("COST_DOWN_PCT",       float, "cost", "Down payment %",       "Typical 15-25%",           0, 100),
    "cost_interest_pct":   ("COST_INTEREST_PCT",   float, "cost", "Interest rate %",      "Annual (Euribor + margin)", 0, 20),
    "cost_term_years":     ("COST_TERM_YEARS",     int,   "cost", "Loan term (years)",    "Typical 20-30",             1, 50),
    "cost_ku_rate_old":    ("COST_KU_RATE_OLD",    float, "cost", "KÜ €/m² (pre-1990)",   "Older buildings, higher fee", 0, 10),
    "cost_ku_rate_new":    ("COST_KU_RATE_NEW",    float, "cost", "KÜ €/m² (1990+)",      "Newer buildings, lower fee",  0, 10),
    "cost_heating_rate":   ("COST_HEATING_RATE",   float, "cost", "Heating €/m² (year avg)","Central district heating",   0, 5),
    "cost_utilities_base": ("COST_UTILITIES_BASE", float, "cost", "Utilities baseline €/mo","Electricity + water flat",    0, 500),

    # NOTE: max_price_eur / min_rooms / min_images used to live here. They
    # moved fully to the scraper (single source of truth) — see the scraper's
    # UI at http://<mini-pc>:8002 or scraper-client/.env. Keeping them here
    # in parallel would drift and cause false-alarm warnings. Backend now
    # trusts whatever the scraper sends.

    # ---- Telegram delivery ----
    "telegram_min_score_photo":    ("TELEGRAM_MIN_SCORE_PHOTO",    int, "telegram", "Photo card threshold",    "Score >= this: full photo card (no buttons)",              0, 100),
    "telegram_min_score_text":     ("TELEGRAM_MIN_SCORE_TEXT",     int, "telegram", "Digest threshold",        "Score >= this (but < photo): rolled into digest message",  0, 100),
    "telegram_photo_cards_per_run":("TELEGRAM_PHOTO_CARDS_PER_RUN", int, "telegram", "Max photo cards/run",    "Overflow above threshold rolls into digest message",        1, 20),
    "draft_score_threshold":       ("DRAFT_SCORE_THRESHOLD",       int, "telegram", "Auto-draft threshold",    "Score >= this: eligible for Gmail draft",                  0, 100),

    # ---- AI evaluator ----
    "ai_max_tokens":            ("AI_MAX_TOKENS",            int, "ai", "Claude max tokens",       "Output cap — raise if verdicts get truncated on long ads", 500, 20000),
    "ai_description_max_chars": ("AI_DESCRIPTION_MAX_CHARS", int, "ai", "Description char cap",    "How much of the listing text to hand to Claude",           200, 20000),
    "anthropic_model":          ("ANTHROPIC_MODEL",          str, "ai", "Claude model ID",         "e.g. claude-haiku-4-5-20251001 (Haiku) or claude-sonnet-4-6 (Sonnet)", 5, 100),

    # ---- Dashboard ----
    "web_base_url":             ("WEB_BASE_URL",             str, "dashboard", "Dashboard base URL", "e.g. aparts.example.com — used by Telegram cards' Dashboard button", 0, 200),

    # ---- Renovation rates (Wave 6C all-in cost) ----
    # The AI never writes euro figures — it only classifies which items apply.
    # These rates are used by client-side maths (computeAllIn) to price the work.
    "reno_kitchen_full":     ("RENO_KITCHEN_FULL",     int,  "reno", "Kitchen (full)",     "Full kitchen gut-and-replace",       0, 100000),
    "reno_bathroom_full":    ("RENO_BATHROOM_FULL",    int,  "reno", "Bathroom (full)",    "Full bathroom gut-and-replace",       0, 50000),
    "reno_windows_per_unit": ("RENO_WINDOWS_PER_UNIT", int,  "reno", "Windows (€/unit)",   "Per window unit, inc. installation",  0, 5000),
    "reno_floors_per_sqm":   ("RENO_FLOORS_PER_SQM",   int,  "reno", "Floors (€/m²)",      "Parquet / LVT inc. screed",           0, 1000),
    "reno_rewire_per_sqm":   ("RENO_REWIRE_PER_SQM",   int,  "reno", "Rewire (€/m²)",      "Full electrical rewire inc. panel",   0, 500),
    "reno_heating":          ("RENO_HEATING",          int,  "reno", "Heating replacement","Boiler or radiator set replacement",  0, 20000),
    "reno_cosmetic_per_sqm": ("RENO_COSMETIC_PER_SQM", int,  "reno", "Cosmetic (€/m²)",    "Paint, trim, light fixtures",         0, 200),
    "reno_contingency_pct":  ("RENO_CONTINGENCY_PCT",  int,  "reno", "Contingency %",      "Applied on top of subtotal (0–50)",   0, 50),
    "rank_by_all_in":        ("RANK_BY_ALL_IN",        bool, "reno", "Rank shortlist by all-in", "Sort sidebar by cheapest all-in instead of score", None, None),
}


def _coerce(kind: type, value) -> object:
    """Coerce a raw value to the target type, including bool."""
    if kind is bool:
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            return value.lower() in ("1", "true", "yes", "on")
        return bool(value)
    return kind(value)


def get_all() -> dict:
    """Return the current in-memory value for every settings key."""
    return {key: getattr(config, spec[0]) for key, spec in _SCHEMA.items()}


def get_schema() -> list:
    """Return the schema as a list of dicts for the frontend to render forms."""
    return [
        {
            "key": key,
            "type": spec[1].__name__,
            "group": spec[2],
            "label": spec[3],
            "hint": spec[4],
            "min": spec[5],
            "max": spec[6],
            "value": getattr(config, spec[0]),
        }
        for key, spec in _SCHEMA.items()
    ]



def load_overrides() -> None:
    """Read settings.json and apply overrides to config.X attributes.

    Called once at backend startup. Missing file or malformed JSON is silently
    ignored so a bad edit can't break boot.
    """
    if not os.path.exists(_SETTINGS_FILE):
        return
    try:
        with open(_SETTINGS_FILE, "r", encoding="utf-8") as f:
            disk = json.load(f)
    except Exception:
        log.exception("Failed to read %s — using env defaults", _SETTINGS_FILE)
        return
    for key, spec in _SCHEMA.items():
        if key not in disk:
            continue
        config_attr, kind, *_ = spec
        try:
            coerced = _coerce(kind, disk[key])
            setattr(config, config_attr, coerced)
        except (ValueError, TypeError):
            log.warning("Skipping bad value in settings.json: %s=%r", key, disk[key])


def save(updates: dict) -> dict:
    """Validate incoming updates, hot-apply to `config`, persist to disk.

    Side-effect: if any cost_* setting changed, recompute cost_of_ownership
    for every stored entry immediately. Pure Python calculation — no AI call,
    no rate-limit exposure — so it's cheap and instant.

    Returns {'applied': {...}, 'errors': [...], 'costs_recomputed': N | None}.
    Non-empty errors mean nothing was applied.
    """
    applied = {}
    errors = []

    for key, value in (updates or {}).items():
        spec = _SCHEMA.get(key)
        if not spec:
            errors.append(f"unknown setting: {key}")
            continue
        config_attr, kind, _group, _label, _hint, lo, hi = spec
        try:
            coerced = _coerce(kind, value)
        except (ValueError, TypeError):
            errors.append(f"bad value for {key}: {value!r}")
            continue
        # Numeric bounds only apply to numeric types. For str, lo/hi are the
        # min/max character counts (0/N by convention) so we still get a
        # non-empty guard without pretending strings are numbers.
        # bool has no bounds (lo/hi are None) — skip range check.
        if kind is bool:
            pass  # no bounds for bool fields
        elif kind is str:
            if not (lo <= len(coerced) <= hi):
                errors.append(f"{key} length must be in [{lo}, {hi}], got {len(coerced)}")
                continue
        else:
            if not (lo <= coerced <= hi):
                errors.append(f"{key} must be in [{lo}, {hi}], got {coerced}")
                continue
        applied[key] = coerced

    if errors:
        return {"applied": {}, "errors": errors, "costs_recomputed": None}

    # All valid — apply and persist.
    for key, coerced in applied.items():
        config_attr = _SCHEMA[key][0]
        setattr(config, config_attr, coerced)

    _persist()
    log.info("Settings updated: %s", applied)

    # Auto-recompute cost_of_ownership on every entry if any cost knob moved.
    # No AI involved — the calculator is pure math over price/area/year.
    costs_recomputed = None
    if any(k.startswith("cost_") for k in applied):
        costs_recomputed = _recompute_all_costs()

    return {"applied": applied, "errors": [], "costs_recomputed": costs_recomputed}


def _recompute_all_costs() -> int:
    """Rebuild cost_of_ownership on every stored Listing row using the current config.

    Row-scoped (Phase 7 Wave 5, per RESEARCH § Pitfall 6): one session, iterate rows,
    commit once — was previously load_app_data → per-entry mutate → save_app_data,
    which triggered O(N) upserts per settings change.

    Returns the number of rows whose cost was updated (skips rows missing price or
    area, and skips rows with cost_of_ownership.overridden=True).
    Pure calculation — never touches the AI, never hits ORS.
    """
    from sqlalchemy.exc import SQLAlchemyError
    try:
        import cost_calculator
        from db import SessionLocal
        from models import Listing
        updated = 0
        with SessionLocal() as db_:
            rows = db_.query(Listing).all()
            for row in rows:
                # Respect per-listing manual overrides (D-Discretion) — user intent
                # trumps a global settings recompute.
                coo_existing = row.cost_of_ownership or {}
                if coo_existing.get("overridden"):
                    continue
                coo = cost_calculator.compute_cost_of_ownership(
                    row.price_eur,
                    row.area_sqm,
                    row.year_built,
                )
                if coo is not None:
                    row.cost_of_ownership = coo  # JSONB reassignment (Pitfall 1)
                    updated += 1
            db_.commit()
        log.info("Cost recompute after settings change: %d entries updated", updated)
        return updated
    except SQLAlchemyError:
        log.exception("Cost auto-recompute failed")
        return 0


def _persist() -> None:
    try:
        os.makedirs(os.path.dirname(_SETTINGS_FILE), exist_ok=True)
        tmp = _SETTINGS_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(get_all(), f, indent=2, sort_keys=True)
        os.replace(tmp, _SETTINGS_FILE)
    except Exception:
        log.exception("Failed to persist settings")
