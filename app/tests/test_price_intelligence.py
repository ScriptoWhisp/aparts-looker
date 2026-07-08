"""Tests for Phase 03 price intelligence: EVAL-04, INTEL-01, INTEL-02, INTEL-03."""

import json

import pytest


def test_record_price_new(tmp_agent_state):
    """INTEL-01: record_price_in_data appends a new price entry for a listing not yet in price_history."""
    import data_store  # noqa: PLC0415

    with data_store._lock:
        data = data_store.load_app_data()
        data_store.record_price_in_data(data, "test-1", 200000, "2026-07-01")
        data_store.save_app_data(data)

    history = data_store.get_price_history("test-1")
    assert history == [{"date": "2026-07-01", "price": 200000}]


def test_record_price_idempotent(tmp_agent_state):
    """INTEL-01: record_price_in_data overwrites (not appends) when called twice for the same date."""
    import data_store  # noqa: PLC0415

    with data_store._lock:
        data = data_store.load_app_data()
        data_store.record_price_in_data(data, "test-1", 200000, "2026-07-01")
        data_store.record_price_in_data(data, "test-1", 195000, "2026-07-01")
        data_store.save_app_data(data)

    history = data_store.get_price_history("test-1")
    assert len(history) == 1, f"Expected 1 entry, got {len(history)}: {history}"
    assert history[0]["price"] == 195000, f"Expected 195000, got {history[0]['price']}"


def test_ingest_records_price_for_known(client, tmp_agent_state, mock_send_pending_card, monkeypatch):
    """INTEL-01: ingest batch records price into price_history for a known (already-seen) listing."""
    import ingest_handler  # noqa: PLC0415

    # Monkeypatch evaluate_listing to avoid real API call (accepts context_prefix="" per plan)
    monkeypatch.setattr(
        ingest_handler,
        "evaluate_listing",
        lambda listing, context_prefix="": {
            "score": 80,
            "verdict": "Good",
            "strengths": [],
            "concerns": [],
            "draft_subject": "Inquiry",
            "draft_body": "body",
            "checklist": {
                "price_per_sqm": "unknown",
                "rooms_area": "unknown",
                "parking": "unknown",
                "renovation_potential": "unknown",
                "floor": "unknown",
                "year_material": "unknown",
                "mandatory_extras": "unknown",
            },
        },
    )

    payload = [{
        "id": "test-1",
        "url": "https://www.kv.ee/test-1.html",
        "title": "Test",
        "price_eur": 200000,
        "rooms": 3,
        "area_sqm": 60.0,
        "image_count": 10,
        "raw_ok": True,
    }]
    headers = {"Authorization": "Bearer test-token-abc"}

    # First POST — adds the listing as new
    resp1 = client.post("/api/ingest", json=payload, headers=headers)
    assert resp1.status_code == 200

    # Second POST — listing is now in seen_listing_ids (dedup hit), price must still be recorded
    resp2 = client.post("/api/ingest", json=payload, headers=headers)
    assert resp2.status_code == 200

    # Read the app_data file directly to verify price_history was written
    app_data_file = tmp_agent_state / "app_data.json"
    app_data = json.loads(app_data_file.read_text())
    assert "test-1" in app_data.get("price_history", {}), (
        f"price_history missing 'test-1'. Keys: {list(app_data.get('price_history', {}).keys())}"
    )
    assert len(app_data["price_history"]["test-1"]) >= 1, (
        f"Expected at least 1 price entry, got: {app_data['price_history']['test-1']}"
    )


@pytest.mark.xfail(reason="Wave 0 stub — not yet implemented", strict=True)
def test_price_drop_reeval_pending(tmp_agent_state, monkeypatch):
    """EVAL-04: a >= 5% price drop on a pending listing triggers re-evaluation and score update."""
    pytest.fail("not implemented")


@pytest.mark.xfail(reason="Wave 0 stub — not yet implemented", strict=True)
def test_price_drop_below_threshold_no_reeval(tmp_agent_state, monkeypatch):
    """EVAL-04: a < 5% price drop does NOT trigger re-evaluation."""
    pytest.fail("not implemented")


@pytest.mark.xfail(reason="Wave 0 stub — not yet implemented", strict=True)
def test_price_rejected_requeued(tmp_agent_state, monkeypatch):
    """EVAL-04: a listing rejected for reason='price' is re-queued to pending on >= 5% price drop (D-17)."""
    pytest.fail("not implemented")


@pytest.mark.xfail(reason="Wave 0 stub — not yet implemented", strict=True)
def test_location_rejected_not_requeued(tmp_agent_state, monkeypatch):
    """EVAL-04: a listing rejected for reason='location' is NOT re-queued on price drop (D-17)."""
    pytest.fail("not implemented")


@pytest.mark.xfail(reason="Wave 0 stub — not yet implemented", strict=True)
def test_removed_listing_marked(tmp_agent_state):
    """INTEL-03: a listing in properties[] with raw_ok=False is marked removed=True with removed_at date."""
    pytest.fail("not implemented")


@pytest.mark.xfail(reason="Wave 0 stub — not yet implemented", strict=True)
def test_removed_listing_marked_pending(tmp_agent_state):
    """INTEL-03: a listing in pending[] with raw_ok=False is marked removed=True with removed_at date."""
    pytest.fail("not implemented")
