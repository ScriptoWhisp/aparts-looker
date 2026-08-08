"""Per-listing financial calculator routes (Wave B).

  GET   /api/user-finance-settings              — global finance params (or defaults)
  PUT   /api/user-finance-settings               — upsert global finance params
  PATCH /api/entry/{listing_id}/finance-inputs   — per-listing overrides (JSONB)
  GET   /api/entry/{listing_id}/finance-calculation — full affordability breakdown

Never-raise pattern throughout (except validation errors on PUT/PATCH, which
are genuine client errors and surface as 422/400/404). See finance_calc.py
for the pure calculation function this module wires up to Postgres.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException
from fastapi.requests import Request
from sqlalchemy.exc import SQLAlchemyError

import db
import finance_calc
from models import Listing, UserFinanceSettings

log = logging.getLogger("app")

router = APIRouter()

_FINANCE_ROW_ID = 1

_FINANCE_INPUT_KEYS = (
    "utilities_eur_monthly",
    "remondifond_eur_monthly",
    "first_purchases_eur",
    "override_ask_eur",
)

# key -> (lo, hi | None, allow_null)
_SETTINGS_FIELD_SPECS: dict[str, tuple] = {
    "monthly_income_eur":     (0, None, True),
    "total_savings_eur":      (0, None, True),
    "down_payment_pct":       (0, 100, False),
    "current_euribor_pct":    (0, 20, False),
    "euribor_stress_pct":     (0, 20, False),
    "food_eur_monthly":       (0, None, False),
    "basic_eur_monthly":      (0, None, False),
    "hindamisakt_eur":        (0, None, False),
    "notary_eur":              (0, None, False),
    "keys_eur":                (0, None, False),
    "internet_eur_monthly":    (0, None, False),
    "electricity_eur_monthly": (0, None, False),
}


def _serialize_finance_settings(row: UserFinanceSettings, is_persisted: bool) -> dict:
    return {
        "monthly_income_eur": row.monthly_income_eur,
        "total_savings_eur": row.total_savings_eur,
        "down_payment_pct": row.down_payment_pct,
        "loan_term_years": row.loan_term_years,
        "current_euribor_pct": row.current_euribor_pct,
        "euribor_stress_pct": row.euribor_stress_pct,
        "rate_scenarios_pct": list(row.rate_scenarios_pct or []),
        "food_eur_monthly": row.food_eur_monthly,
        "basic_eur_monthly": row.basic_eur_monthly,
        "hindamisakt_eur": row.hindamisakt_eur,
        "notary_eur": row.notary_eur,
        "keys_eur": row.keys_eur,
        "internet_eur_monthly": row.internet_eur_monthly,
        "electricity_eur_monthly": row.electricity_eur_monthly,
        "is_persisted": is_persisted,
    }


# ---------------------------------------------------------------------------
# GET /api/user-finance-settings
# ---------------------------------------------------------------------------

@router.get("/api/user-finance-settings")
def get_user_finance_settings() -> dict:
    """Return the persisted row, or column defaults (is_persisted=False) if none exists."""
    try:
        with db.SessionLocal() as db_:
            row = db_.get(UserFinanceSettings, _FINANCE_ROW_ID)
            if row is None:
                return _serialize_finance_settings(UserFinanceSettings(), is_persisted=False)
            return _serialize_finance_settings(row, is_persisted=True)
    except SQLAlchemyError:
        log.exception("get_user_finance_settings failed")
        return _serialize_finance_settings(UserFinanceSettings(), is_persisted=False)


# ---------------------------------------------------------------------------
# PUT /api/user-finance-settings
# ---------------------------------------------------------------------------

@router.put("/api/user-finance-settings")
async def put_user_finance_settings(request: Request) -> dict:
    try:
        body = await request.json()
        if not isinstance(body, dict):
            raise HTTPException(status_code=400, detail="Body must be a JSON object")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    try:
        with db.SessionLocal() as db_:
            row = db_.get(UserFinanceSettings, _FINANCE_ROW_ID)
            # Defaults to fall back on for any key omitted from the body — the
            # existing row's value if one exists, else the column default.
            fallback = row if row is not None else UserFinanceSettings()

            errors: list[str] = []
            resolved: dict = {}

            for key, (lo, hi, allow_null) in _SETTINGS_FIELD_SPECS.items():
                if key not in body:
                    resolved[key] = getattr(fallback, key)
                    continue
                value = body[key]
                if value is None:
                    if not allow_null:
                        errors.append(f"{key} must not be null")
                        continue
                    resolved[key] = None
                    continue
                try:
                    coerced = float(value)
                except (TypeError, ValueError):
                    errors.append(f"{key} must be a number")
                    continue
                if lo is not None and coerced < lo:
                    errors.append(f"{key} must be >= {lo}")
                    continue
                if hi is not None and coerced > hi:
                    errors.append(f"{key} must be <= {hi}")
                    continue
                resolved[key] = coerced

            # loan_term_years — integer, 1-40
            if "loan_term_years" in body:
                try:
                    term = int(body["loan_term_years"])
                except (TypeError, ValueError):
                    errors.append("loan_term_years must be an integer")
                    term = None
                if term is not None and not (1 <= term <= 40):
                    errors.append("loan_term_years must be between 1 and 40")
                elif term is not None:
                    resolved["loan_term_years"] = term
            else:
                resolved["loan_term_years"] = fallback.loan_term_years

            # rate_scenarios_pct — array of exactly 3 floats, each 0-20
            if "rate_scenarios_pct" in body:
                raw = body["rate_scenarios_pct"]
                if not isinstance(raw, list) or len(raw) != 3:
                    errors.append("rate_scenarios_pct must be an array of exactly 3 numbers")
                else:
                    try:
                        coerced_rates = [float(v) for v in raw]
                    except (TypeError, ValueError):
                        errors.append("rate_scenarios_pct values must be numbers")
                        coerced_rates = None
                    if coerced_rates is not None:
                        if any(v < 0 or v > 20 for v in coerced_rates):
                            errors.append("rate_scenarios_pct values must be between 0 and 20")
                        else:
                            resolved["rate_scenarios_pct"] = coerced_rates
            else:
                resolved["rate_scenarios_pct"] = list(fallback.rate_scenarios_pct or [])

            if errors:
                raise HTTPException(status_code=422, detail=errors)

            if row is None:
                row = UserFinanceSettings(id=_FINANCE_ROW_ID)
                db_.add(row)

            for key, value in resolved.items():
                setattr(row, key, value)

            db_.commit()
            db_.refresh(row)
            return _serialize_finance_settings(row, is_persisted=True)
    except HTTPException:
        raise
    except SQLAlchemyError:
        log.exception("put_user_finance_settings failed")
        raise HTTPException(status_code=500, detail="DB error")


# ---------------------------------------------------------------------------
# PATCH /api/entry/{listing_id}/finance-inputs
# ---------------------------------------------------------------------------

@router.patch("/api/entry/{listing_id}/finance-inputs")
async def patch_finance_inputs(listing_id: str, request: Request) -> dict:
    try:
        body = await request.json()
        if not isinstance(body, dict):
            raise HTTPException(status_code=400, detail="Body must be a JSON object")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    updates: dict = {}
    for key in _FINANCE_INPUT_KEYS:
        if key not in body:
            continue
        value = body[key]
        if value is None:
            updates[key] = None
            continue
        try:
            updates[key] = float(value)
        except (TypeError, ValueError):
            raise HTTPException(status_code=422, detail=f"{key} must be a number or null")

    try:
        with db.SessionLocal() as db_:
            row = db_.get(Listing, listing_id)
            if row is None:
                raise HTTPException(status_code=404, detail="Listing not found")
            current = dict(row.finance_inputs or {})
            current.update(updates)
            row.finance_inputs = current  # JSONB reassignment (Pitfall 1) — never mutate in place
            db_.commit()
        return {k: current.get(k) for k in _FINANCE_INPUT_KEYS}
    except HTTPException:
        raise
    except SQLAlchemyError:
        log.exception("patch_finance_inputs failed for %s", listing_id)
        return {"ok": False, "error": "DB error"}


# ---------------------------------------------------------------------------
# GET /api/entry/{listing_id}/finance-calculation
# ---------------------------------------------------------------------------

@router.get("/api/entry/{listing_id}/finance-calculation")
def get_finance_calculation(listing_id: str) -> dict:
    try:
        with db.SessionLocal() as db_:
            listing_row = db_.get(Listing, listing_id)
            if listing_row is None:
                raise HTTPException(status_code=404, detail="Listing not found")
            ask_eur = listing_row.price_eur
            inputs = dict(listing_row.finance_inputs or {})

            settings_row = db_.get(UserFinanceSettings, _FINANCE_ROW_ID)
            settings = _serialize_finance_settings(
                settings_row if settings_row is not None else UserFinanceSettings(),
                is_persisted=settings_row is not None,
            )

        return finance_calc.compute_finance(ask_eur, settings, inputs)
    except HTTPException:
        raise
    except SQLAlchemyError:
        log.exception("get_finance_calculation failed for %s", listing_id)
        return {
            "status": "incomplete",
            "missing": ["error"],
            "one_time": None,
            "buffer_after_down": None,
            "loan_amount": None,
            "loan_term_years": None,
            "scenarios": [],
            "monthly_worst_case": None,
            "affordability": None,
        }
