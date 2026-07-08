"""Tests for Phase 03 price intelligence: EVAL-04, INTEL-01, INTEL-02, INTEL-03."""

import json
import re

import pytest


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def _mock_evaluate(score=85):
    """Return a lambda mimicking evaluate_listing with a fixed score."""
    return lambda l, context_prefix="": {
        "score": score,
        "verdict": "Better now",
        "strengths": [],
        "concerns": [],
        "draft_body": "b",
        "checklist": {
            "price_per_sqm": "pass",
            "rooms_area": "pass",
            "parking": "unknown",
            "renovation_potential": "unknown",
            "floor": "pass",
            "year_material": "pass",
            "mandatory_extras": "unknown",
        },
    }


def _seed_pending_entry(listing_id: str, score: int = 75) -> None:
    """Seed a pending entry directly into data_store (test isolation helper)."""
    import data_store  # noqa: PLC0415

    with data_store._lock:
        data = data_store.load_app_data()
        data["pending"].append({
            "id": listing_id,
            "url": f"https://www.kv.ee/{listing_id}.html",
            "title": "Test Apartment",
            "price_eur": 200000,
            "area_sqm": 60.0,
            "rooms": 3,
            "price_per_sqm": 3333,
            "year_built": 2010,
            "material": "panel",
            "score": score,
            "verdict": "Original verdict",
            "strengths": [],
            "concerns": [],
            "draft_body": "body",
            "contact_email": "agent@test.ee",
            "draft_subject": "Test",
            "queued_at": "2026-07-01T00:00:00+00:00",
        })
        data_store.save_app_data(data)


# ---------------------------------------------------------------------------
# INTEL-01: price history recording
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# EVAL-04: price-drop re-evaluation
# ---------------------------------------------------------------------------

def test_price_drop_reeval_pending(client, tmp_agent_state, mock_send_pending_card, monkeypatch):
    """EVAL-04: a >= 5% price drop on a pending listing triggers re-evaluation and score update."""
    import data_store  # noqa: PLC0415
    import ingest_handler  # noqa: PLC0415

    # Monkeypatch evaluate_listing to return score 85
    monkeypatch.setattr(ingest_handler, "evaluate_listing", _mock_evaluate(score=85))
    # Suppress real Telegram calls from _handle_price_drop
    monkeypatch.setattr(ingest_handler.telegram_client, "send_message", lambda t: None)

    # Seed a pending entry with score 75
    _seed_pending_entry("test-1", score=75)

    # Seed price_history with a previous entry on an earlier date
    with data_store._lock:
        data = data_store.load_app_data()
        data["price_history"]["test-1"] = [{"date": "2026-07-01", "price": 200000}]
        data_store.save_app_data(data)

    # Seed seen_listing_ids with the dedup_key the ingest will compute.
    # extract_object_id("https://www.kv.ee/test-1.html") returns None (not 6+ digits),
    # so the dedup_key falls back to the full URL.
    with data_store._lock:
        state = data_store.load_agent_state()
        state["seen_listing_ids"].append("https://www.kv.ee/test-1.html")
        data_store.save_agent_state(state)

    headers = {"Authorization": "Bearer test-token-abc"}
    payload = [{
        "id": "test-1",
        "url": "https://www.kv.ee/test-1.html",
        "title": "Test Apartment",
        "price_eur": 188000,  # 6% drop from 200000 — >= 5% threshold
        "rooms": 3,
        "area_sqm": 60.0,
        "image_count": 10,
        "raw_ok": True,
    }]

    resp = client.post("/api/ingest", json=payload, headers=headers)
    assert resp.status_code == 200

    data = data_store.load_app_data()
    pending_entry = next((e for e in data["pending"] if e["id"] == "test-1"), None)
    assert pending_entry is not None, "pending entry test-1 not found"
    assert pending_entry["score"] == 85, (
        f"Expected score 85 after re-eval, got {pending_entry['score']}"
    )
    assert len(data["price_history"]["test-1"]) == 2, (
        f"Expected 2 price history entries, got {data['price_history']['test-1']}"
    )
    assert data["price_history"]["test-1"][-1]["price"] == 188000


def test_price_drop_below_threshold_no_reeval(client, tmp_agent_state, mock_send_pending_card, monkeypatch):
    """EVAL-04: a < 5% price drop does NOT trigger re-evaluation."""
    import data_store  # noqa: PLC0415
    import ingest_handler  # noqa: PLC0415

    # Use a sentinel score (999) — if evaluate_listing is accidentally called, the
    # pending score would change to 999, making the test fail.
    monkeypatch.setattr(ingest_handler, "evaluate_listing", _mock_evaluate(score=999))
    monkeypatch.setattr(ingest_handler.telegram_client, "send_message", lambda t: None)

    _seed_pending_entry("test-1", score=75)

    with data_store._lock:
        data = data_store.load_app_data()
        data["price_history"]["test-1"] = [{"date": "2026-07-01", "price": 200000}]
        data_store.save_app_data(data)

    # Seed dedup_key as the full URL (extract_object_id returns None for "test-1.html")
    with data_store._lock:
        state = data_store.load_agent_state()
        state["seen_listing_ids"].append("https://www.kv.ee/test-1.html")
        data_store.save_agent_state(state)

    headers = {"Authorization": "Bearer test-token-abc"}
    payload = [{
        "id": "test-1",
        "url": "https://www.kv.ee/test-1.html",
        "title": "Test Apartment",
        "price_eur": 195000,  # 2.5% drop — below 5% threshold
        "rooms": 3,
        "area_sqm": 60.0,
        "image_count": 10,
        "raw_ok": True,
    }]

    resp = client.post("/api/ingest", json=payload, headers=headers)
    assert resp.status_code == 200

    data = data_store.load_app_data()
    pending_entry = next((e for e in data["pending"] if e["id"] == "test-1"), None)
    assert pending_entry is not None, "pending entry test-1 not found"
    # Score must remain the original 75 — evaluate_listing must NOT have been called
    assert pending_entry["score"] == 75, (
        f"Expected score 75 (unchanged), got {pending_entry['score']} — re-eval triggered when it should not have been"
    )
    # Price should still have been recorded
    assert len(data["price_history"]["test-1"]) == 2, (
        f"Expected 2 price history entries, got {data['price_history']['test-1']}"
    )


def test_price_rejected_requeued(client, tmp_agent_state, mock_send_pending_card, monkeypatch):
    """EVAL-04: a listing rejected for reason='price' is re-queued to pending on >= 5% drop (D-17)."""
    import data_store  # noqa: PLC0415
    import ingest_handler  # noqa: PLC0415

    monkeypatch.setattr(ingest_handler, "evaluate_listing", _mock_evaluate(score=85))
    monkeypatch.setattr(ingest_handler.telegram_client, "send_message", lambda t: None)

    # Seed a rejected entry with rejection_reason="price"
    with data_store._lock:
        data = data_store.load_app_data()
        data["rejected"].append({
            "id": "test-1",
            "url": "https://www.kv.ee/test-1.html",
            "title": "Test Apartment",
            "price_eur": 200000,
            "area_sqm": 60.0,
            "rooms": 3,
            "score": 60,
            "verdict": "Too expensive",
            "strengths": [],
            "concerns": [],
            "rejection_reason": "price",
            "rejected_at": "2026-06-01T00:00:00+00:00",
        })
        data["price_history"]["test-1"] = [{"date": "2026-07-01", "price": 200000}]
        data_store.save_app_data(data)

    # Seed dedup_key as the full URL (extract_object_id returns None for "test-1.html")
    with data_store._lock:
        state = data_store.load_agent_state()
        state["seen_listing_ids"].append("https://www.kv.ee/test-1.html")
        data_store.save_agent_state(state)

    headers = {"Authorization": "Bearer test-token-abc"}
    payload = [{
        "id": "test-1",
        "url": "https://www.kv.ee/test-1.html",
        "title": "Test Apartment",
        "price_eur": 185000,  # 7.5% drop from 200000 — >= 5% threshold
        "rooms": 3,
        "area_sqm": 60.0,
        "image_count": 10,
        "raw_ok": True,
    }]

    resp = client.post("/api/ingest", json=payload, headers=headers)
    assert resp.status_code == 200

    data = data_store.load_app_data()
    # Must have been removed from rejected[]
    assert not any(e["id"] == "test-1" for e in data["rejected"]), (
        f"Entry still in rejected[]: {data['rejected']}"
    )
    # Must now be in pending[]
    new_entry = next((e for e in data["pending"] if e["id"] == "test-1"), None)
    assert new_entry is not None, "Entry not moved to pending[]"
    assert "price_drop_requeue_note" in new_entry, (
        f"price_drop_requeue_note missing from pending entry: {new_entry}"
    )


def test_location_rejected_not_requeued(client, tmp_agent_state, mock_send_pending_card, monkeypatch):
    """EVAL-04: a listing rejected for reason='location' is NOT re-queued on price drop (D-17)."""
    import data_store  # noqa: PLC0415
    import ingest_handler  # noqa: PLC0415

    monkeypatch.setattr(ingest_handler, "evaluate_listing", _mock_evaluate(score=85))
    monkeypatch.setattr(ingest_handler.telegram_client, "send_message", lambda t: None)

    # Seed a rejected entry with rejection_reason="location"
    with data_store._lock:
        data = data_store.load_app_data()
        data["rejected"].append({
            "id": "test-1",
            "url": "https://www.kv.ee/test-1.html",
            "title": "Test Apartment",
            "price_eur": 200000,
            "area_sqm": 60.0,
            "rooms": 3,
            "score": 55,
            "verdict": "Wrong location",
            "strengths": [],
            "concerns": [],
            "rejection_reason": "location",
            "rejected_at": "2026-06-01T00:00:00+00:00",
        })
        data["price_history"]["test-1"] = [{"date": "2026-07-01", "price": 200000}]
        data_store.save_app_data(data)

    # Seed dedup_key as the full URL (extract_object_id returns None for "test-1.html")
    with data_store._lock:
        state = data_store.load_agent_state()
        state["seen_listing_ids"].append("https://www.kv.ee/test-1.html")
        data_store.save_agent_state(state)

    headers = {"Authorization": "Bearer test-token-abc"}
    payload = [{
        "id": "test-1",
        "url": "https://www.kv.ee/test-1.html",
        "title": "Test Apartment",
        "price_eur": 180000,  # 10% drop — >= 5% threshold, but location rejection is untouched
        "rooms": 3,
        "area_sqm": 60.0,
        "image_count": 10,
        "raw_ok": True,
    }]

    resp = client.post("/api/ingest", json=payload, headers=headers)
    assert resp.status_code == 200

    data = data_store.load_app_data()
    # Must still be in rejected[] — location rejections are never re-queued
    assert any(e["id"] == "test-1" for e in data["rejected"]), (
        "Entry incorrectly removed from rejected[]"
    )
    # Must NOT be in pending[]
    assert not any(e["id"] == "test-1" for e in data["pending"]), (
        "Entry incorrectly added to pending[]"
    )


# ---------------------------------------------------------------------------
# INTEL-03: removed listing marking
# ---------------------------------------------------------------------------

def test_removed_listing_marked(client, tmp_agent_state, mock_send_pending_card, monkeypatch):
    """INTEL-03: a listing in properties[] with raw_ok=False is marked removed=True with removed_at date."""
    import data_store  # noqa: PLC0415
    import ingest_handler  # noqa: PLC0415

    monkeypatch.setattr(ingest_handler, "evaluate_listing", _mock_evaluate())
    monkeypatch.setattr(ingest_handler.telegram_client, "send_message", lambda t: None)

    # Seed a property entry (already-approved listing)
    with data_store._lock:
        data = data_store.load_app_data()
        data["properties"].append({
            "id": "test-1",
            "name": "Test Apartment",
            "url": "https://www.kv.ee/test-1.html",
            "price": 200000,
            "area": 60,
            "rooms": 3,
            "pricePerSqm": 3333,
            "district": "",
            "material": "panel",
            "year": "2010",
            "notes": "Some notes",
        })
        data_store.save_app_data(data)

    headers = {"Authorization": "Bearer test-token-abc"}
    # POST with raw_ok=False to signal the listing was removed from kv.ee
    payload = [{
        "id": "test-1",
        "url": "https://www.kv.ee/test-1.html",
        "title": "Test Apartment",
        "price_eur": 200000,
        "rooms": 3,
        "area_sqm": 60.0,
        "image_count": 0,
        "raw_ok": False,
    }]

    resp = client.post("/api/ingest", json=payload, headers=headers)
    assert resp.status_code == 200

    data = data_store.load_app_data()
    prop = next((e for e in data["properties"] if e["id"] == "test-1"), None)
    assert prop is not None, "properties entry test-1 not found"
    assert prop.get("removed") is True, f"expected removed=True, got {prop.get('removed')!r}"
    removed_at = prop.get("removed_at", "")
    assert re.match(r"^\d{4}-\d{2}-\d{2}$", removed_at), (
        f"removed_at not a YYYY-MM-DD date string: {removed_at!r}"
    )


def test_removed_listing_marked_pending(client, tmp_agent_state, mock_send_pending_card, monkeypatch):
    """INTEL-03: a listing in pending[] with raw_ok=False is marked removed=True with removed_at date."""
    import data_store  # noqa: PLC0415
    import ingest_handler  # noqa: PLC0415

    monkeypatch.setattr(ingest_handler, "evaluate_listing", _mock_evaluate())
    monkeypatch.setattr(ingest_handler.telegram_client, "send_message", lambda t: None)

    # Seed a pending entry
    _seed_pending_entry("test-1", score=80)

    headers = {"Authorization": "Bearer test-token-abc"}
    payload = [{
        "id": "test-1",
        "url": "https://www.kv.ee/test-1.html",
        "title": "Test Apartment",
        "price_eur": 200000,
        "rooms": 3,
        "area_sqm": 60.0,
        "image_count": 0,
        "raw_ok": False,
    }]

    resp = client.post("/api/ingest", json=payload, headers=headers)
    assert resp.status_code == 200

    data = data_store.load_app_data()
    pending_entry = next((e for e in data["pending"] if e["id"] == "test-1"), None)
    assert pending_entry is not None, "pending entry test-1 not found"
    assert pending_entry.get("removed") is True, (
        f"expected removed=True, got {pending_entry.get('removed')!r}"
    )
    removed_at = pending_entry.get("removed_at", "")
    assert re.match(r"^\d{4}-\d{2}-\d{2}$", removed_at), (
        f"removed_at not a YYYY-MM-DD date string: {removed_at!r}"
    )
