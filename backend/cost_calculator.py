"""
Cost-of-ownership calculator: estimates monthly total for owning a listing.

Combines mortgage, KÜ (association) fee, heating, and baseline utilities into
a single "true monthly" number so listings can be compared on real affordability
rather than just sticker price. Assumptions come from config.COST_* env vars.

Returns None when the input is too incomplete to compute (no price or no area).
Never raises — every branch returns a value or None.
"""

from typing import Optional

import config


def _mortgage_params() -> tuple[float, float, int]:
    """(down_pct, interest_pct, term_years) — from user_finance_settings if set,
    otherwise env defaults. Single source of truth is the Финансы tab; env vars
    only kick in when the row hasn't been created yet."""
    try:
        # Local import — cost_calculator ran fine before user_finance_settings
        # existed, so keep the import lazy to avoid boot-time coupling.
        from data_store import get_user_finance_settings  # type: ignore
        row = get_user_finance_settings()
    except Exception:
        row = None
    if not row:
        return config.COST_DOWN_PCT, config.COST_INTEREST_PCT, config.COST_TERM_YEARS
    down_pct = float(row.get("down_payment_pct") or config.COST_DOWN_PCT)
    term_years = int(row.get("loan_term_years") or config.COST_TERM_YEARS)
    # Effective interest for "expected" all-in price: middle scenario + current euribor,
    # NOT stressed. Stress rate is only used in Финансы verdict (worst-case affordability).
    scenarios = row.get("rate_scenarios_pct") or []
    euribor = float(row.get("current_euribor_pct") or 0)
    if scenarios and len(scenarios) >= 1:
        middle = float(scenarios[len(scenarios) // 2])
        interest_pct = middle + euribor
    else:
        interest_pct = config.COST_INTEREST_PCT
    return down_pct, interest_pct, term_years


def compute_cost_of_ownership(
    price_eur: Optional[int],
    area_sqm: Optional[float],
    year_built: Optional[int] = None,
) -> Optional[dict]:
    """Return a breakdown of monthly cost or None if inputs are insufficient.

    Mortgage params come from user_finance_settings (via _mortgage_params) —
    single source of truth with the Финансы tab. Non-mortgage assumptions
    (KÜ / heating / utilities) still come from config.COST_* env / Cost model.
    """
    if not price_eur or not area_sqm or area_sqm <= 0:
        return None

    down_pct, interest_pct, term_years = _mortgage_params()

    # --- Mortgage (standard amortising loan) ---
    down_payment = price_eur * down_pct / 100.0
    loan = price_eur - down_payment
    monthly_rate = (interest_pct / 100.0) / 12.0
    n = term_years * 12
    if monthly_rate > 0:
        mortgage = loan * monthly_rate / (1 - (1 + monthly_rate) ** (-n))
    else:
        mortgage = loan / n  # 0% edge case

    # --- KÜ (association) fee ---
    # Soviet-era vs modern split at 1990 as a rough proxy for build quality
    # and expected repair-fund needs. Modern buildings tend to have lower
    # KÜ fees per m² because they haven't accumulated capex debt.
    is_old = bool(year_built and year_built < 1990)
    ku_rate = config.COST_KU_RATE_OLD if is_old else config.COST_KU_RATE_NEW
    ku_fee = area_sqm * ku_rate

    # --- Heating ---
    # Central district heating, averaged across the year — winter peaks are
    # ~3× summer troughs, but annual mean per m² is stable enough for planning.
    heating = area_sqm * config.COST_HEATING_RATE

    # --- Utilities baseline (electricity + water) ---
    utilities = float(config.COST_UTILITIES_BASE)

    total = mortgage + ku_fee + heating + utilities
    return {
        "monthly_total_eur": round(total),
        "cost_per_sqm_eur": round(total / area_sqm, 1),
        "breakdown": {
            "mortgage":  round(mortgage),
            "ku_fee":    round(ku_fee),
            "heating":   round(heating),
            "utilities": round(utilities),
        },
        "assumptions": {
            "down_pct":         down_pct,
            "interest_pct":     interest_pct,
            "term_years":       term_years,
            "ku_rate_per_sqm":  ku_rate,
            "heating_per_sqm":  config.COST_HEATING_RATE,
            "utilities_base":   config.COST_UTILITIES_BASE,
        },
    }
