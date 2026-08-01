"""Wave 5 regression tests: hot callers must use row-scoped SQL, not compat shim.

Tests cover:
  - settings_store._recompute_all_costs: row-scoped query, commit-once, skip overridden
  - main.delete_all_listings: DB delete, agent_state reset
  - main.delete_listing: per-row delete by id
  - main.cost_override: single-row JSONB update, sets overridden=True
  - main.cost_override_reset: recomputes fresh, clears override flag
  - main.backfill_costs: bulk recompute skipping overridden
  - main.backfill_commutes: session/HTTP split, updates commute_minutes

RED phase: tests that will FAIL before implementation (Wave 5 rewrites have not
landed yet). They assert on new behaviour that the old compat-shim code cannot
satisfy (e.g. checking db-row state after endpoint calls via db_session.get()).
"""

import pytest
from unittest.mock import MagicMock, patch


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _seed_listing(db_session, listing_id: str, **kwargs) -> None:
    """Insert a Listing row directly into the test DB."""
    from models import Listing  # noqa: PLC0415

    defaults = dict(
        id=listing_id,
        url=f"https://www.kv.ee/{listing_id}.html",
        title="Test Apartment",
        price_eur=200000,
        area_sqm=60.0,
        year_built=2005,
        status="approved",
        cost_of_ownership={},
    )
    defaults.update(kwargs)
    row = Listing(**defaults)
    db_session.add(row)
    db_session.commit()


# ---------------------------------------------------------------------------
# settings_store._recompute_all_costs
# ---------------------------------------------------------------------------

class TestRecomputeAllCosts:

    def test_recompute_updates_rows_without_override(self, db_session, monkeypatch):
        """_recompute_all_costs must update rows that lack overridden=True."""
        _seed_listing(db_session, "r1", price_eur=200000, area_sqm=60.0, year_built=2005,
                      cost_of_ownership={})
        _seed_listing(db_session, "r2", price_eur=180000, area_sqm=50.0, year_built=1990,
                      cost_of_ownership={})

        # Patch settings_store.SessionLocal to share db_session's connection
        import db as db_module  # noqa: PLC0415
        import settings_store  # noqa: PLC0415

        # cost_calculator must return a non-None dict to count as "updated"
        import cost_calculator  # noqa: PLC0415
        monkeypatch.setattr(
            cost_calculator, "compute_cost_of_ownership",
            lambda p, a, y: {"monthly_total_eur": 1200, "breakdown": {}} if p else None,
        )

        # Patch the SessionLocal inside settings_store to use the test session factory
        if hasattr(settings_store, "SessionLocal"):
            monkeypatch.setattr(settings_store, "SessionLocal", db_module.SessionLocal)

        count = settings_store._recompute_all_costs()
        assert count == 2, f"expected 2 updated rows, got {count}"

    def test_recompute_skips_overridden(self, db_session, monkeypatch):
        """_recompute_all_costs must NOT update rows with cost_of_ownership.overridden=True."""
        _seed_listing(db_session, "o1", cost_of_ownership={"overridden": True, "monthly_total_eur": 999})
        _seed_listing(db_session, "n1", cost_of_ownership={}, price_eur=200000, area_sqm=60.0, year_built=2005)

        import db as db_module  # noqa: PLC0415
        import settings_store  # noqa: PLC0415
        import cost_calculator  # noqa: PLC0415

        monkeypatch.setattr(
            cost_calculator, "compute_cost_of_ownership",
            lambda p, a, y: {"monthly_total_eur": 1100, "breakdown": {}} if p else None,
        )
        if hasattr(settings_store, "SessionLocal"):
            monkeypatch.setattr(settings_store, "SessionLocal", db_module.SessionLocal)

        count = settings_store._recompute_all_costs()
        assert count == 1, f"expected 1 updated (non-overridden), got {count}"

        # Overridden row must be untouched
        from models import Listing  # noqa: PLC0415
        row = db_session.get(Listing, "o1")
        assert row.cost_of_ownership.get("monthly_total_eur") == 999, (
            "Overridden row was mutated — override guard broken"
        )

    def test_recompute_uses_db_not_lock(self, db_session, monkeypatch):
        """_recompute_all_costs must NOT reference data_store._lock after Wave 5."""
        import settings_store  # noqa: PLC0415
        import inspect

        src = inspect.getsource(settings_store._recompute_all_costs)
        assert "data_store._lock" not in src, (
            "_recompute_all_costs still references data_store._lock — remove it"
        )
        assert "SessionLocal" in src or "db_" in src, (
            "_recompute_all_costs must use SessionLocal session, not compat shim"
        )


# ---------------------------------------------------------------------------
# main.delete_all_listings
# ---------------------------------------------------------------------------

class TestDeleteAllListings:

    def test_delete_all_removes_from_db(self, db_session, client, tmp_agent_state):
        """DELETE /api/listings/all must delete all Listing rows from the DB."""
        _seed_listing(db_session, "d1", status="approved")
        _seed_listing(db_session, "d2", status="pending")
        _seed_listing(db_session, "d3", status="rejected")

        resp = client.delete("/api/listings/all")
        assert resp.status_code == 200, f"unexpected {resp.status_code}: {resp.text}"
        body = resp.json()
        assert body.get("ok") is True

        from models import Listing  # noqa: PLC0415
        remaining = db_session.query(Listing).count()
        assert remaining == 0, f"Expected 0 rows, got {remaining}"

    def test_delete_all_resets_seen_ids(self, db_session, client, tmp_agent_state):
        """DELETE /api/listings/all must reset seen_listing_ids in agent_state.json."""
        import data_store  # noqa: PLC0415

        state = data_store.load_agent_state()
        state["seen_listing_ids"] = ["kv:123", "kv:456"]
        data_store.save_agent_state(state)

        resp = client.delete("/api/listings/all")
        assert resp.status_code == 200

        state_after = data_store.load_agent_state()
        assert state_after.get("seen_listing_ids") == [], (
            f"seen_listing_ids not reset: {state_after.get('seen_listing_ids')}"
        )

    def test_delete_all_returns_ok_json(self, db_session, client, tmp_agent_state):
        """DELETE /api/listings/all must return JSON with ok=True."""
        resp = client.delete("/api/listings/all")
        assert resp.status_code == 200
        body = resp.json()
        assert body.get("ok") is True
        assert "removed" in body


# ---------------------------------------------------------------------------
# main.delete_listing
# ---------------------------------------------------------------------------

class TestDeleteListing:

    def test_delete_existing_listing(self, db_session, client, tmp_agent_state):
        """DELETE /api/listings/{id} must remove the row and return ok=True."""
        _seed_listing(db_session, "del-1", status="approved")

        resp = client.delete("/api/listings/del-1")
        assert resp.status_code == 200
        body = resp.json()
        assert body.get("ok") is True
        assert "removed_from" in body

        from models import Listing  # noqa: PLC0415
        row = db_session.get(Listing, "del-1")
        assert row is None, "Row still exists after delete"

    def test_delete_nonexistent_listing(self, db_session, client, tmp_agent_state):
        """DELETE /api/listings/{id} must return ok=False when listing not found."""
        resp = client.delete("/api/listings/does-not-exist")
        assert resp.status_code == 200
        body = resp.json()
        assert body.get("ok") is False


# ---------------------------------------------------------------------------
# main.cost_override
# ---------------------------------------------------------------------------

class TestCostOverride:

    def test_cost_override_sets_overridden_flag(self, db_session, client, tmp_agent_state):
        """POST /api/entry/{id}/cost-override must set cost_of_ownership.overridden=True in DB."""
        _seed_listing(db_session, "co-1",
                      price_eur=200000, area_sqm=60.0, year_built=2005,
                      cost_of_ownership={"monthly_total_eur": 1200, "breakdown": {"mortgage": 900}})

        resp = client.post(
            "/api/entry/co-1/cost-override",
            json={"mortgage": 850, "ku_fee": 180, "heating": 120, "utilities": 90},
        )
        assert resp.status_code == 200, f"unexpected {resp.status_code}: {resp.text}"
        body = resp.json()
        assert body.get("ok") is True
        coo = body.get("cost_of_ownership", {})
        assert coo.get("overridden") is True, "overridden flag not set in response"

        from models import Listing  # noqa: PLC0415
        row = db_session.get(Listing, "co-1")
        db_session.refresh(row)
        assert row.cost_of_ownership.get("overridden") is True, (
            "overridden flag not persisted to DB row"
        )

    def test_cost_override_preserved_through_recompute(self, db_session, monkeypatch):
        """Rows with overridden=True must survive _recompute_all_costs unchanged."""
        _seed_listing(db_session, "co-2",
                      price_eur=200000, area_sqm=60.0, year_built=2005,
                      cost_of_ownership={"monthly_total_eur": 999, "overridden": True})

        import cost_calculator  # noqa: PLC0415
        import db as db_module  # noqa: PLC0415
        import settings_store  # noqa: PLC0415

        monkeypatch.setattr(
            cost_calculator, "compute_cost_of_ownership",
            lambda p, a, y: {"monthly_total_eur": 1234, "breakdown": {}},
        )
        if hasattr(settings_store, "SessionLocal"):
            monkeypatch.setattr(settings_store, "SessionLocal", db_module.SessionLocal)

        settings_store._recompute_all_costs()

        from models import Listing  # noqa: PLC0415
        row = db_session.get(Listing, "co-2")
        db_session.refresh(row)
        assert row.cost_of_ownership.get("monthly_total_eur") == 999, (
            "Override was clobbered by _recompute_all_costs — override guard broken"
        )

    def test_cost_override_404_on_missing(self, db_session, client, tmp_agent_state):
        """POST /api/entry/{id}/cost-override must return 404 when listing not found."""
        resp = client.post("/api/entry/no-such-id/cost-override", json={"mortgage": 800})
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# main.cost_override_reset
# ---------------------------------------------------------------------------

class TestCostOverrideReset:

    def test_cost_override_reset_clears_overridden(self, db_session, client, tmp_agent_state, monkeypatch):
        """DELETE /api/entry/{id}/cost-override must clear the overridden flag."""
        import cost_calculator  # noqa: PLC0415

        monkeypatch.setattr(
            cost_calculator, "compute_cost_of_ownership",
            lambda p, a, y: {"monthly_total_eur": 1100, "breakdown": {}} if p else None,
        )

        _seed_listing(db_session, "cor-1",
                      price_eur=200000, area_sqm=60.0, year_built=2005,
                      cost_of_ownership={"monthly_total_eur": 999, "overridden": True})

        resp = client.delete("/api/entry/cor-1/cost-override")
        assert resp.status_code == 200, f"unexpected {resp.status_code}: {resp.text}"
        body = resp.json()
        assert body.get("ok") is True
        coo = body.get("cost_of_ownership", {})
        # After reset, the override flag must be gone (or False)
        assert not coo.get("overridden"), (
            f"overridden flag still set after reset: {coo}"
        )

    def test_cost_override_reset_404_on_missing(self, db_session, client, tmp_agent_state):
        """DELETE /api/entry/{id}/cost-override must return 404 when listing not found."""
        resp = client.delete("/api/entry/no-such-id/cost-override")
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# main.backfill_costs
# ---------------------------------------------------------------------------

class TestBackfillCosts:

    def test_backfill_costs_updates_rows(self, db_session, client, tmp_agent_state, monkeypatch):
        """POST /api/backfill-costs must update cost_of_ownership for non-overridden rows."""
        import cost_calculator  # noqa: PLC0415

        monkeypatch.setattr(
            cost_calculator, "compute_cost_of_ownership",
            lambda p, a, y: {"monthly_total_eur": 1300, "breakdown": {}} if p else None,
        )

        _seed_listing(db_session, "bc-1", price_eur=200000, area_sqm=60.0, year_built=2005)
        _seed_listing(db_session, "bc-2", price_eur=180000, area_sqm=50.0, year_built=1990)
        _seed_listing(db_session, "bc-3",
                      price_eur=220000, area_sqm=70.0, year_built=2000,
                      cost_of_ownership={"monthly_total_eur": 777, "overridden": True})

        resp = client.post("/api/backfill-costs")
        assert resp.status_code == 200, f"unexpected {resp.status_code}: {resp.text}"
        body = resp.json()
        assert body.get("ok") is True
        assert body.get("updated") == 2, f"expected 2 updated, got {body.get('updated')}"

        from models import Listing  # noqa: PLC0415
        row3 = db_session.get(Listing, "bc-3")
        db_session.refresh(row3)
        assert row3.cost_of_ownership.get("monthly_total_eur") == 777, (
            "Overridden row was mutated by backfill-costs"
        )

    def test_backfill_costs_no_lock_in_main(self):
        """main.backfill_costs must not use data_store._lock after Wave 5."""
        import inspect
        import main  # noqa: PLC0415

        src = inspect.getsource(main.backfill_costs)
        assert "data_store._lock" not in src, (
            "backfill_costs still references data_store._lock"
        )


# ---------------------------------------------------------------------------
# main.backfill_commutes
# ---------------------------------------------------------------------------

class TestBackfillCommutes:

    def test_backfill_commutes_updates_rows(self, db_session, client, tmp_agent_state, monkeypatch):
        """POST /api/backfill-commutes must update commute_minutes for rows with lat/lng."""
        import config as _config  # noqa: PLC0415
        import ingest_handler  # noqa: PLC0415

        monkeypatch.setattr(_config, "ORS_API_KEY", "test-key")
        monkeypatch.setattr(ingest_handler, "_fetch_commute_minutes", lambda lat, lng: 22)

        _seed_listing(db_session, "cm-1", lat=59.43, lng=24.73, commute_minutes=None)
        _seed_listing(db_session, "cm-2", lat=59.44, lng=24.74, commute_minutes=None)
        _seed_listing(db_session, "cm-3", lat=None, lng=None, commute_minutes=None)

        resp = client.post("/api/backfill-commutes")
        assert resp.status_code == 200
        body = resp.json()
        assert body.get("ok") is True
        assert body.get("updated") == 2, f"expected 2 updated, got {body.get('updated')}"
        assert body.get("skipped_no_coords") == 1

        from models import Listing  # noqa: PLC0415
        row1 = db_session.get(Listing, "cm-1")
        db_session.refresh(row1)
        assert row1.commute_minutes == 22

    def test_backfill_commutes_no_lock_in_main(self):
        """main.backfill_commutes must not use data_store._lock after Wave 5."""
        import inspect
        import main  # noqa: PLC0415

        src = inspect.getsource(main.backfill_commutes)
        assert "data_store._lock" not in src, (
            "backfill_commutes still references data_store._lock"
        )

    def test_backfill_commutes_no_ors_key(self, db_session, client, tmp_agent_state, monkeypatch):
        """POST /api/backfill-commutes must return error when ORS_API_KEY not configured."""
        import config as _config  # noqa: PLC0415

        monkeypatch.setattr(_config, "ORS_API_KEY", "")

        resp = client.post("/api/backfill-commutes")
        assert resp.status_code == 200
        body = resp.json()
        assert body.get("ok") is False
