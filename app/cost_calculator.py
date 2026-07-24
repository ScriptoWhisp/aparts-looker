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


def compute_cost_of_ownership(
    price_eur: Optional[int],
    area_sqm: Optional[float],
    year_built: Optional[int] = None,
) -> Optional[dict]:
    """Return a breakdown of monthly cost or None if inputs are insufficient.

    Uses config.COST_* defaults for the assumptions. Callers can add mandatory
    extras (parking, storage) on top of the returned monthly_total_eur.
    """
    if not price_eur or not area_sqm or area_sqm <= 0:
        return None

    # --- Mortgage (standard amortising loan) ---
    down_payment = price_eur * config.COST_DOWN_PCT / 100.0
    loan = price_eur - down_payment
    monthly_rate = (config.COST_INTEREST_PCT / 100.0) / 12.0
    n = config.COST_TERM_YEARS * 12
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
            "down_pct":         config.COST_DOWN_PCT,
            "interest_pct":     config.COST_INTEREST_PCT,
            "term_years":       config.COST_TERM_YEARS,
            "ku_rate_per_sqm":  ku_rate,
            "heating_per_sqm":  config.COST_HEATING_RATE,
            "utilities_base":   config.COST_UTILITIES_BASE,
        },
    }
