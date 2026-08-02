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

    # ---- Search / ingest filters (SAFETY-NET only) ----
    # Primary filtering happens on the scraper — it injects these as query
    # params into the kv.ee search URL (price_max / rooms_min / nr_of_photos_from)
    # so we don't fetch listings we're just going to reject. Backend enforcement
    # here is defense-in-depth in case the scraper's URL misfires. Set matching
    # values on the scraper's UI at http://<mini-pc>:8002 for anything > 0.
    "max_price_eur":       ("MAX_PRICE_EUR",       int,   "filter", "Max price EUR (safety net)", "Primary filter is on the scraper — this is a backstop", 0, 10_000_000),
    "min_rooms":           ("MIN_ROOMS",           int,   "filter", "Min rooms (safety net)",     "Primary filter is on the scraper — this is a backstop", 0, 20),
    "min_images":          ("MIN_IMAGES",          int,   "filter", "Min images (safety net)",    "Primary filter is on the scraper — this is a backstop", 0, 50),

    # ---- Telegram delivery ----
    "telegram_min_score_photo": ("TELEGRAM_MIN_SCORE_PHOTO", int, "telegram", "Photo card threshold", "Score ≥ this: full photo card", 0, 100),
    "telegram_min_score_text":  ("TELEGRAM_MIN_SCORE_TEXT",  int, "telegram", "Text card threshold",  "Score ≥ this: compact text",     0, 100),
    "draft_score_threshold":    ("DRAFT_SCORE_THRESHOLD",    int, "telegram", "Auto-draft threshold", "Score ≥ this: eligible for Gmail draft", 0, 100),

    # ---- AI evaluator ----
    "ai_max_tokens":            ("AI_MAX_TOKENS",            int, "ai", "Claude max tokens",       "Output cap — raise if verdicts get truncated on long ads", 500, 20000),
    "ai_description_max_chars": ("AI_DESCRIPTION_MAX_CHARS", int, "ai", "Description char cap",    "How much of the listing text to hand to Claude",           200, 20000),
    "anthropic_model":          ("ANTHROPIC_MODEL",          str, "ai", "Claude model ID",         "e.g. claude-haiku-4-5-20251001 (Haiku) or claude-sonnet-4-6 (Sonnet)", 5, 100),

    # ---- Dashboard ----
    "web_base_url":             ("WEB_BASE_URL",             str, "dashboard", "Dashboard base URL", "e.g. aparts.example.com — used by Telegram cards' Dashboard button", 0, 200),
}


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
            coerced = kind(disk[key])
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
            coerced = kind(value)
        except (ValueError, TypeError):
            errors.append(f"bad value for {key}: {value!r}")
            continue
        # Numeric bounds only apply to numeric types. For str, lo/hi are the
        # min/max character counts (0/N by convention) so we still get a
        # non-empty guard without pretending strings are numbers.
        if kind is str:
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
