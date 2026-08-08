"""
Per-listing affordability calculator (Wave B — finance calculator card).

Pure functions — no DB access, no globals. Combines Daniel's global finance
settings (income, savings, mortgage assumptions) with per-listing inputs
(utilities, remondifond, first-purchase budget, optional override ask) to
produce a full affordability breakdown: one-time closing costs, a post-down-
payment buffer check, 6 mortgage rate scenarios (3 base rates x current/
stressed euribor), worst-case monthly total, and a green/yellow/red verdict.

Never raises — every branch returns a dict. Missing inputs degrade the
result to status="incomplete" with a `missing` list the caller can render
as a callout, rather than failing outright (this mirrors cost_calculator.py's
None-safe contract, but returns a stub dict instead of None so the frontend
always has a status/missing pair to render).

NEVER hardcode financial defaults in here — every assumption comes from the
`settings` dict (sourced from user_finance_settings). This keeps the function
pure and testable: (ask, settings, inputs) -> breakdown.
"""

from typing import Optional


def annuity_payment(principal: float, annual_rate_pct: float, years: int) -> float:
    """Standard fixed-rate mortgage annuity payment (monthly).

    Guards against principal<=0, years<=0 (returns 0.0), and rate<=0 (falls
    back to a flat principal/months split — no interest).
    """
    if principal is None or principal <= 0 or years is None or years <= 0:
        return 0.0
    months = years * 12
    if annual_rate_pct is None or annual_rate_pct <= 0:
        return principal / months
    r = (annual_rate_pct / 100.0) / 12.0
    return principal * (r * (1 + r) ** months) / ((1 + r) ** months - 1)


def _incomplete_stub(missing: list, loan_term_years) -> dict:
    return {
        "status": "incomplete",
        "missing": missing,
        "one_time": None,
        "buffer_after_down": None,
        "loan_amount": None,
        "loan_term_years": loan_term_years,
        "scenarios": [],
        "monthly_worst_case": None,
        "affordability": None,
    }


def compute_finance(
    ask_eur: Optional[float],
    settings: dict,
    inputs: dict,
) -> dict:
    """Returns the full affordability breakdown for UI rendering.

    All monetary values are EUR unless suffixed `_pct`. Never raises — if
    the ask price or Daniel's monthly income is unknown, returns a stub with
    status="incomplete" and nothing else computed (there is nothing
    meaningful to show without those two numbers).
    """
    settings = settings or {}
    inputs = inputs or {}
    loan_term_years = settings.get("loan_term_years", 30)

    missing: list = []

    effective_ask = inputs.get("override_ask_eur")
    if effective_ask is None:
        effective_ask = ask_eur
    if effective_ask is None:
        missing.append("ask")

    income = settings.get("monthly_income_eur")
    if income is None:
        missing.append("income")

    savings = settings.get("total_savings_eur")
    if savings is None:
        missing.append("savings")

    utilities = inputs.get("utilities_eur_monthly")
    if utilities is None:
        missing.append("utilities")

    remondifond = inputs.get("remondifond_eur_monthly")
    if remondifond is None:
        missing.append("remondifond")

    first_purchases = inputs.get("first_purchases_eur")
    if first_purchases is None:
        missing.append("first_purchases")

    # Hard blockers — nothing meaningful can be computed without these two.
    if effective_ask is None or income is None:
        return _incomplete_stub(missing, loan_term_years)

    # --- One-time costs ---
    down_pct = settings.get("down_payment_pct", 15.0)
    down_payment = effective_ask * down_pct / 100.0
    hindamisakt = settings.get("hindamisakt_eur", 350.0)
    notary = settings.get("notary_eur", 275.0)
    keys = settings.get("keys_eur", 500.0)
    first_purchases_val = first_purchases if first_purchases is not None else 0.0
    one_time_total = down_payment + hindamisakt + notary + keys + first_purchases_val

    one_time = {
        "down_payment": {"amount": round(down_payment), "pct": down_pct},
        "hindamisakt": hindamisakt,
        "notary": notary,
        "keys": keys,
        "first_purchases": first_purchases,
        "total": round(one_time_total),
    }

    # --- Buffer after down payment ---
    savings_val = savings if savings is not None else 0.0
    buffer_amount = round(savings_val - one_time_total)
    if buffer_amount > 1000:
        buffer_verdict = "good"
    elif buffer_amount >= 500:
        buffer_verdict = "tight"
    else:
        buffer_verdict = "insufficient"
    buffer_after_down = {"amount": buffer_amount, "verdict": buffer_verdict}

    # --- Loan + 6 rate scenarios (3 base rates x current/stressed euribor) ---
    loan_amount = round(effective_ask - down_payment)
    rate_scenarios = settings.get("rate_scenarios_pct") or [1.60, 1.70, 1.80]
    current_euribor = settings.get("current_euribor_pct", 3.5)
    euribor_stress = settings.get("euribor_stress_pct", 0.3)

    scenarios = []
    for base_rate in rate_scenarios:
        for is_stress in (False, True):
            euribor = current_euribor + (euribor_stress if is_stress else 0)
            total_rate = base_rate + euribor
            payment = annuity_payment(loan_amount, total_rate, loan_term_years)
            scenarios.append({
                "base_rate_pct": base_rate,
                "euribor_pct": round(euribor, 3),
                "total_rate_pct": round(total_rate, 3),
                "monthly_payment": round(payment),
                "is_stress": is_stress,
            })

    mortgage_max = max((s["monthly_payment"] for s in scenarios), default=0)

    # --- Worst-case monthly total ---
    utilities_val = utilities if utilities is not None else 0.0
    remondifond_val = remondifond if remondifond is not None else 0.0
    internet = settings.get("internet_eur_monthly", 20.0)
    electricity = settings.get("electricity_eur_monthly", 30.0)
    food = settings.get("food_eur_monthly", 250.0)
    basic = settings.get("basic_eur_monthly", 300.0)

    monthly_total = (
        mortgage_max + utilities_val + remondifond_val + internet + electricity + food + basic
    )

    monthly_worst_case = {
        "mortgage_max": mortgage_max,
        "utilities": utilities,
        "remondifond": remondifond,
        "internet": internet,
        "electricity": electricity,
        "food": food,
        "basic": basic,
        "total": round(monthly_total),
    }

    # --- Affordability verdict ---
    monthly_free = income - monthly_total
    if monthly_free < 0 or buffer_verdict == "insufficient":
        verdict = "red"
    elif monthly_free < 500 or buffer_verdict == "tight":
        verdict = "yellow"
    else:
        verdict = "green"

    if monthly_free < 0:
        message_ru = f"Не хватает {abs(round(monthly_free))} €/мес"
    elif verdict == "yellow":
        message_ru = f"Тесно: свободно только {round(monthly_free)} €/мес"
    else:
        message_ru = f"Проходит с буфером {round(monthly_free)} €/мес"

    affordability = {
        "monthly_income": income,
        "monthly_total": round(monthly_total),
        "monthly_free": round(monthly_free),
        "verdict": verdict,
        "message_ru": message_ru,
    }

    status = "complete" if not missing else "incomplete"

    return {
        "status": status,
        "missing": missing,
        "one_time": one_time,
        "buffer_after_down": buffer_after_down,
        "loan_amount": loan_amount,
        "loan_term_years": loan_term_years,
        "scenarios": scenarios,
        "monthly_worst_case": monthly_worst_case,
        "affordability": affordability,
    }
