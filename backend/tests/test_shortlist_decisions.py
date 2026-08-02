"""Tests for the post-viewing decision endpoint and data_store helper.

Covers:
  - Each of the 3 decisions produces the correct status transition
  - 404 for missing listing
  - 422 for bogus decision string
  - 409 if listing has not yet been marked viewed (pre-condition check)
  - drop-reason is stored in viewing_history
  - set_viewing_decision is idempotent (calling still-in twice → offer_drafted)
  - mark_viewed behaviour is unchanged (existing test suite still passes)
"""

import pytest


# ---------------------------------------------------------------------------
# Helpers shared across tests
# ---------------------------------------------------------------------------

def _seed_listing(data_store, listing_id: str, status: str) -> None:
    """Insert a minimal listing with the given status via the save_app_data shim."""
    app_data = data_store.load_app_data()
    entry = {"id": listing_id, "price_eur": 150000, "status": status}
    if status in ("approved", "viewing_scheduled", "viewed",
                  "thinking", "offer_drafted", "dropped"):
        app_data["properties"].append(entry)
    elif status == "pending":
        app_data["pending"].append(entry)
    elif status == "rejected":
        app_data["rejected"].append({"id": listing_id, "price_eur": 150000,
                                     "status": "rejected", "rejection_reason": "price"})
    data_store.save_app_data(app_data)


def _get_status(data_store, listing_id: str) -> str:
    """Return the current status of a listing from load_app_data (any bucket)."""
    data = data_store.load_app_data()
    for bucket in ("properties", "pending", "rejected"):
        for e in data.get(bucket, []):
            if e.get("id") == listing_id:
                return e["status"]
    return ""


def _get_viewing_history(data_store, listing_id: str) -> list:
    """Return viewing_history for a listing."""
    data = data_store.load_app_data()
    for bucket in ("properties", "pending", "rejected"):
        for e in data.get(bucket, []):
            if e.get("id") == listing_id:
                return e.get("viewing_history", [])
    return []


# ---------------------------------------------------------------------------
# Endpoint tests (integration via FastAPI TestClient)
# ---------------------------------------------------------------------------

class TestViewingDecisionEndpoint:
    """POST /api/entry/{id}/viewing-decision"""

    def test_still_in_transitions_to_offer_drafted(self, db_session, client, tmp_agent_state):
        import data_store  # noqa: PLC0415

        _seed_listing(data_store, "lst-1", "viewed")
        resp = client.post("/api/entry/lst-1/viewing-decision", json={"decision": "still-in"})
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["ok"] is True
        assert body["new_status"] == "offer_drafted"
        assert _get_status(data_store, "lst-1") == "offer_drafted"

    def test_thinking_transitions_to_thinking(self, db_session, client, tmp_agent_state):
        import data_store  # noqa: PLC0415

        _seed_listing(data_store, "lst-2", "viewed")
        resp = client.post("/api/entry/lst-2/viewing-decision", json={"decision": "thinking"})
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["ok"] is True
        assert body["new_status"] == "thinking"
        assert _get_status(data_store, "lst-2") == "thinking"

    def test_drop_transitions_to_dropped(self, db_session, client, tmp_agent_state):
        import data_store  # noqa: PLC0415

        _seed_listing(data_store, "lst-3", "viewed")
        resp = client.post("/api/entry/lst-3/viewing-decision",
                           json={"decision": "drop"})
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["ok"] is True
        assert body["new_status"] == "dropped"
        assert _get_status(data_store, "lst-3") == "dropped"

    def test_404_for_missing_listing(self, db_session, client, tmp_agent_state):
        resp = client.post("/api/entry/nonexistent-id/viewing-decision",
                           json={"decision": "thinking"})
        assert resp.status_code == 404, resp.text

    def test_422_for_bogus_decision_string(self, db_session, client, tmp_agent_state):
        import data_store  # noqa: PLC0415

        _seed_listing(data_store, "lst-5", "viewed")
        resp = client.post("/api/entry/lst-5/viewing-decision",
                           json={"decision": "not-a-real-decision"})
        assert resp.status_code == 422, resp.text

    def test_409_for_approved_listing(self, db_session, client, tmp_agent_state):
        """Listing approved but not yet viewed → 409 (precondition not met)."""
        import data_store  # noqa: PLC0415

        _seed_listing(data_store, "lst-6", "approved")
        resp = client.post("/api/entry/lst-6/viewing-decision",
                           json={"decision": "thinking"})
        assert resp.status_code == 409, resp.text
        detail = resp.json().get("detail", "")
        assert "viewing decision" in detail.lower() or "viewed" in detail.lower()

    def test_409_for_pending_listing(self, db_session, client, tmp_agent_state):
        """Listing still pending → 409."""
        import data_store  # noqa: PLC0415

        _seed_listing(data_store, "lst-7", "pending")
        resp = client.post("/api/entry/lst-7/viewing-decision",
                           json={"decision": "drop"})
        assert resp.status_code == 409, resp.text

    def test_drop_reason_stored_in_viewing_history(self, db_session, client, tmp_agent_state):
        """When decision=drop and reason provided, drop_reason appears in viewing_history."""
        import data_store  # noqa: PLC0415

        _seed_listing(data_store, "lst-8", "viewed")
        resp = client.post(
            "/api/entry/lst-8/viewing-decision",
            json={"decision": "drop", "reason": "too small for the price"},
        )
        assert resp.status_code == 200, resp.text

        history = _get_viewing_history(data_store, "lst-8")
        decision_events = [h for h in history if h.get("action") == "decision"]
        assert len(decision_events) >= 1
        last = decision_events[-1]
        assert last.get("decision") == "drop"
        assert last.get("drop_reason") == "too small for the price"

    def test_drop_without_reason_stores_no_drop_reason(self, db_session, client, tmp_agent_state):
        """drop without a reason string → no drop_reason key in history event."""
        import data_store  # noqa: PLC0415

        _seed_listing(data_store, "lst-9", "viewed")
        resp = client.post("/api/entry/lst-9/viewing-decision", json={"decision": "drop"})
        assert resp.status_code == 200, resp.text

        history = _get_viewing_history(data_store, "lst-9")
        decision_events = [h for h in history if h.get("action") == "decision"]
        assert len(decision_events) >= 1
        last = decision_events[-1]
        assert "drop_reason" not in last


# ---------------------------------------------------------------------------
# data_store helper tests (direct unit tests bypassing the HTTP layer)
# ---------------------------------------------------------------------------

class TestSetViewingDecision:
    """Direct unit tests for data_store.set_viewing_decision."""

    def test_idempotent_still_in_called_twice(self, db_session, tmp_agent_state):
        """Calling still-in twice keeps status at offer_drafted; second call returns True."""
        import data_store  # noqa: PLC0415

        _seed_listing(data_store, "lst-10", "viewed")
        result1 = data_store.set_viewing_decision("lst-10", "still-in")
        assert result1 is True
        assert _get_status(data_store, "lst-10") == "offer_drafted"

        result2 = data_store.set_viewing_decision("lst-10", "still-in")
        assert result2 is True  # idempotent — offer_drafted is a permitted status
        assert _get_status(data_store, "lst-10") == "offer_drafted"

    def test_returns_false_for_missing_listing(self, db_session, tmp_agent_state):
        import data_store  # noqa: PLC0415

        result = data_store.set_viewing_decision("nonexistent", "thinking")
        assert result is False

    def test_returns_false_for_invalid_decision(self, db_session, tmp_agent_state):
        import data_store  # noqa: PLC0415

        _seed_listing(data_store, "lst-11", "viewed")
        result = data_store.set_viewing_decision("lst-11", "unknown-decision")
        assert result is False
        # Status should be unchanged
        assert _get_status(data_store, "lst-11") == "viewed"

    def test_returns_false_for_viewing_scheduled_status(self, db_session, tmp_agent_state):
        """viewing_scheduled is a pre-viewing status — decision not allowed yet."""
        import data_store  # noqa: PLC0415

        _seed_listing(data_store, "lst-12", "viewing_scheduled")
        result = data_store.set_viewing_decision("lst-12", "thinking")
        assert result is False
        assert _get_status(data_store, "lst-12") == "viewing_scheduled"

    def test_decision_from_thinking_state(self, db_session, tmp_agent_state):
        """A listing already at thinking can still receive a decision (e.g. upgrade to still-in)."""
        import data_store  # noqa: PLC0415

        _seed_listing(data_store, "lst-13", "thinking")
        result = data_store.set_viewing_decision("lst-13", "still-in")
        assert result is True
        assert _get_status(data_store, "lst-13") == "offer_drafted"

    def test_viewing_history_accumulates_events(self, db_session, tmp_agent_state):
        """Multiple decision calls accumulate separate events in viewing_history."""
        import data_store  # noqa: PLC0415

        _seed_listing(data_store, "lst-14", "viewed")

        data_store.set_viewing_decision("lst-14", "thinking")
        data_store.set_viewing_decision("lst-14", "still-in")

        history = _get_viewing_history(data_store, "lst-14")
        decision_events = [h for h in history if h.get("action") == "decision"]
        assert len(decision_events) == 2
        assert decision_events[0]["decision"] == "thinking"
        assert decision_events[1]["decision"] == "still-in"
