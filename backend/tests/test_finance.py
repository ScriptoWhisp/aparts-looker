"""Tests for the finance calculator (backend/finance_calc.py) and its endpoints
(backend/routes_finance.py) — Wave B of the finance calculator card.

Covers:
  - annuity_payment edge cases (rate=0, term=1yr, known reference value)
  - compute_finance: complete breakdown, missing income, negative buffer,
    override_ask_eur precedence
  - GET /api/user-finance-settings on a fresh DB → defaults, is_persisted=false
  - PUT then GET → persisted values round-trip, is_persisted=true
  - PUT validation: bad rate_scenarios_pct length, out-of-range down_payment_pct
  - PATCH /api/entry/{id}/finance-inputs → persists into finance_inputs JSONB
  - GET /api/entry/{id}/finance-calculation: missing settings -> incomplete,
    fully configured -> complete with all 6 scenarios
"""

import finance_calc


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _seed_listing(data_store, listing_id: str, price_eur: int, status: str = "approved") -> None:
    """Insert a minimal approved-tier listing via the save_app_data shim."""
    app_data = data_store.load_app_data()
    app_data["properties"].append({"id": listing_id, "price_eur": price_eur, "status": status})
    data_store.save_app_data(app_data)


_FULL_SETTINGS = {
    "monthly_income_eur": 3500,
    "total_savings_eur": 40000,
    "down_payment_pct": 15.0,
    "loan_term_years": 30,
    "current_euribor_pct": 3.5,
    "euribor_stress_pct": 0.3,
    "rate_scenarios_pct": [1.60, 1.70, 1.80],
    "food_eur_monthly": 250,
    "basic_eur_monthly": 300,
    "hindamisakt_eur": 350,
    "notary_eur": 275,
    "keys_eur": 500,
    "internet_eur_monthly": 20,
    "electricity_eur_monthly": 30,
}

_FULL_INPUTS = {
    "utilities_eur_monthly": 150,
    "remondifond_eur_monthly": 60,
    "first_purchases_eur": 2000,
    "override_ask_eur": None,
}


# ---------------------------------------------------------------------------
# annuity_payment
# ---------------------------------------------------------------------------

class TestAnnuityPayment:
    def test_known_reference_value(self):
        # 100,000 EUR @ 5% for 30 years -> ~537 EUR/mo (standard annuity reference).
        payment = finance_calc.annuity_payment(100_000, 5.0, 30)
        assert abs(payment - 536.82) < 1.0

    def test_zero_rate_uses_flat_split(self):
        payment = finance_calc.annuity_payment(120_000, 0, 30)
        assert payment == 120_000 / (30 * 12)

    def test_negative_rate_treated_as_zero(self):
        payment = finance_calc.annuity_payment(120_000, -1, 30)
        assert payment == 120_000 / (30 * 12)

    def test_one_year_term(self):
        payment = finance_calc.annuity_payment(12_000, 5.0, 1)
        # Should be roughly principal/12 plus a small interest premium.
        assert 990 < payment < 1100

    def test_zero_principal_returns_zero(self):
        assert finance_calc.annuity_payment(0, 5.0, 30) == 0.0

    def test_none_principal_returns_zero(self):
        assert finance_calc.annuity_payment(None, 5.0, 30) == 0.0


# ---------------------------------------------------------------------------
# compute_finance
# ---------------------------------------------------------------------------

class TestComputeFinance:
    def test_complete_breakdown_with_all_inputs(self):
        result = finance_calc.compute_finance(220_000, _FULL_SETTINGS, _FULL_INPUTS)
        assert result["status"] == "complete"
        assert result["missing"] == []
        assert result["one_time"]["down_payment"]["amount"] == round(220_000 * 0.15)
        assert result["one_time"]["total"] == round(
            220_000 * 0.15 + 350 + 275 + 500 + 2000
        )
        assert len(result["scenarios"]) == 6
        assert result["affordability"]["verdict"] in ("green", "yellow", "red")

    def test_missing_income_returns_incomplete_stub(self):
        settings = dict(_FULL_SETTINGS)
        settings["monthly_income_eur"] = None
        result = finance_calc.compute_finance(220_000, settings, _FULL_INPUTS)
        assert result["status"] == "incomplete"
        assert "income" in result["missing"]
        assert result["scenarios"] == []
        assert result["affordability"] is None

    def test_missing_ask_returns_incomplete_stub(self):
        result = finance_calc.compute_finance(None, _FULL_SETTINGS, _FULL_INPUTS)
        assert result["status"] == "incomplete"
        assert "ask" in result["missing"]

    def test_missing_savings_still_computes_but_flags_incomplete(self):
        settings = dict(_FULL_SETTINGS)
        settings["total_savings_eur"] = None
        result = finance_calc.compute_finance(220_000, settings, _FULL_INPUTS)
        assert result["status"] == "incomplete"
        assert "savings" in result["missing"]
        assert result["affordability"] is not None  # still computed with savings=0

    def test_negative_buffer_gives_red_verdict(self):
        settings = dict(_FULL_SETTINGS)
        settings["total_savings_eur"] = 100  # far less than one-time total
        result = finance_calc.compute_finance(220_000, settings, _FULL_INPUTS)
        assert result["buffer_after_down"]["verdict"] == "insufficient"
        assert result["affordability"]["verdict"] == "red"

    def test_override_ask_eur_takes_precedence_over_listing_ask(self):
        inputs = dict(_FULL_INPUTS)
        inputs["override_ask_eur"] = 180_000
        result = finance_calc.compute_finance(220_000, _FULL_SETTINGS, inputs)
        assert result["one_time"]["down_payment"]["amount"] == round(180_000 * 0.15)

    def test_high_income_low_cost_gives_green_verdict(self):
        settings = dict(_FULL_SETTINGS)
        settings["monthly_income_eur"] = 8000
        result = finance_calc.compute_finance(150_000, settings, _FULL_INPUTS)
        assert result["affordability"]["verdict"] == "green"

    def test_scenarios_include_stress_and_non_stress_pairs(self):
        result = finance_calc.compute_finance(220_000, _FULL_SETTINGS, _FULL_INPUTS)
        stress_flags = sorted({s["is_stress"] for s in result["scenarios"]})
        assert stress_flags == [False, True]
        # Each of the 3 base rates appears exactly twice (stress + non-stress).
        for base_rate in _FULL_SETTINGS["rate_scenarios_pct"]:
            count = sum(1 for s in result["scenarios"] if s["base_rate_pct"] == base_rate)
            assert count == 2


# ---------------------------------------------------------------------------
# GET/PUT /api/user-finance-settings
# ---------------------------------------------------------------------------

class TestUserFinanceSettingsEndpoint:
    def test_get_on_fresh_db_returns_defaults_not_persisted(self, db_session, client):
        resp = client.get("/api/user-finance-settings")
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["is_persisted"] is False
        assert body["monthly_income_eur"] is None
        assert body["down_payment_pct"] == 15.0
        assert body["rate_scenarios_pct"] == [1.60, 1.70, 1.80]

    def test_put_then_get_round_trips_persisted_values(self, db_session, client):
        payload = {
            "monthly_income_eur": 3500,
            "total_savings_eur": 40000,
            "down_payment_pct": 20,
            "loan_term_years": 25,
            "rate_scenarios_pct": [1.5, 1.6, 1.7],
        }
        put_resp = client.put("/api/user-finance-settings", json=payload)
        assert put_resp.status_code == 200, put_resp.text
        put_body = put_resp.json()
        assert put_body["is_persisted"] is True
        assert put_body["monthly_income_eur"] == 3500
        assert put_body["loan_term_years"] == 25

        get_resp = client.get("/api/user-finance-settings")
        assert get_resp.status_code == 200
        get_body = get_resp.json()
        assert get_body["is_persisted"] is True
        assert get_body["total_savings_eur"] == 40000
        assert get_body["down_payment_pct"] == 20
        assert get_body["rate_scenarios_pct"] == [1.5, 1.6, 1.7]

    def test_put_invalid_rate_scenarios_wrong_length_rejected(self, db_session, client):
        resp = client.put("/api/user-finance-settings", json={"rate_scenarios_pct": [1.5, 1.6]})
        assert resp.status_code == 422, resp.text

    def test_put_invalid_down_payment_pct_out_of_range_rejected(self, db_session, client):
        resp = client.put("/api/user-finance-settings", json={"down_payment_pct": 150})
        assert resp.status_code == 422, resp.text

    def test_put_invalid_loan_term_years_out_of_range_rejected(self, db_session, client):
        resp = client.put("/api/user-finance-settings", json={"loan_term_years": 60})
        assert resp.status_code == 422, resp.text

    def test_put_partial_update_preserves_other_fields(self, db_session, client):
        client.put("/api/user-finance-settings", json={"monthly_income_eur": 3000})
        resp = client.put("/api/user-finance-settings", json={"total_savings_eur": 25000})
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["monthly_income_eur"] == 3000
        assert body["total_savings_eur"] == 25000


# ---------------------------------------------------------------------------
# PATCH /api/entry/{id}/finance-inputs
# ---------------------------------------------------------------------------

class TestFinanceInputsPatch:
    def test_patch_persists_into_finance_inputs_jsonb(self, db_session, client, tmp_agent_state):
        import data_store  # noqa: PLC0415

        _seed_listing(data_store, "fin-1", 220_000)
        resp = client.patch(
            "/api/entry/fin-1/finance-inputs",
            json={"utilities_eur_monthly": 150, "remondifond_eur_monthly": 60},
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["utilities_eur_monthly"] == 150
        assert body["remondifond_eur_monthly"] == 60
        assert body["first_purchases_eur"] is None

        # Re-read the row directly to confirm the JSONB reassignment persisted.
        from db import SessionLocal  # noqa: PLC0415
        from models import Listing  # noqa: PLC0415
        with SessionLocal() as db_:
            row = db_.get(Listing, "fin-1")
            assert row.finance_inputs["utilities_eur_monthly"] == 150

    def test_patch_missing_listing_returns_404(self, db_session, client, tmp_agent_state):
        resp = client.patch("/api/entry/does-not-exist/finance-inputs", json={"utilities_eur_monthly": 100})
        assert resp.status_code == 404

    def test_patch_partial_update_preserves_other_keys(self, db_session, client, tmp_agent_state):
        import data_store  # noqa: PLC0415

        _seed_listing(data_store, "fin-2", 200_000)
        client.patch("/api/entry/fin-2/finance-inputs", json={"utilities_eur_monthly": 150})
        resp = client.patch("/api/entry/fin-2/finance-inputs", json={"remondifond_eur_monthly": 60})
        assert resp.status_code == 200
        body = resp.json()
        assert body["utilities_eur_monthly"] == 150
        assert body["remondifond_eur_monthly"] == 60


# ---------------------------------------------------------------------------
# GET /api/entry/{id}/finance-calculation
# ---------------------------------------------------------------------------

class TestFinanceCalculationEndpoint:
    def test_missing_settings_returns_incomplete_with_missing_list(self, db_session, client, tmp_agent_state):
        import data_store  # noqa: PLC0415

        _seed_listing(data_store, "fin-3", 220_000)
        resp = client.get("/api/entry/fin-3/finance-calculation")
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["status"] == "incomplete"
        assert "income" in body["missing"]

    def test_full_breakdown_with_everything_configured(self, db_session, client, tmp_agent_state):
        import data_store  # noqa: PLC0415

        client.put("/api/user-finance-settings", json=_FULL_SETTINGS)
        _seed_listing(data_store, "fin-4", 220_000)
        client.patch(
            "/api/entry/fin-4/finance-inputs",
            json={
                "utilities_eur_monthly": 150,
                "remondifond_eur_monthly": 60,
                "first_purchases_eur": 2000,
            },
        )
        resp = client.get("/api/entry/fin-4/finance-calculation")
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["status"] == "complete"
        assert len(body["scenarios"]) == 6
        assert body["affordability"]["verdict"] in ("green", "yellow", "red")

    def test_missing_listing_returns_404(self, db_session, client, tmp_agent_state):
        resp = client.get("/api/entry/does-not-exist/finance-calculation")
        assert resp.status_code == 404
