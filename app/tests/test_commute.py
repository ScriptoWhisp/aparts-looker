"""
Integration tests for ORS commute and Nominatim geocoding in the ingest pipeline.
All tests in this file are Wave 0 scaffolds for Plan 05-02.

Coverage:
  - test_process_ingest_batch_populates_commute_minutes: listing with coords gets commute_minutes
  - test_process_ingest_batch_no_coords_skips_ors: listing without coords skips ORS call
  - test_process_ingest_batch_empty_ors_key: empty ORS_API_KEY results in commute_minutes=None
  - test_geocode_with_nominatim_success: valid Nominatim response returns (lat, lng) tuple
  - test_geocode_with_nominatim_empty_response: empty Nominatim response returns (None, None)
  - test_geocode_backfill_endpoint: POST /api/geocode-backfill geocodes entries missing coords
"""

import json
from unittest.mock import MagicMock

import pytest

import config
import data_store
import ingest_handler


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def _mock_evaluate_fn():
    """Return a lambda that mimics evaluate_listing with a fixed passing score."""
    return lambda listing, context_prefix="": {
        "score": 80,
        "verdict": "OK",
        "checklist": {
            "price_per_sqm": "pass",
            "rooms_area": "pass",
            "parking": "unknown",
            "renovation_potential": "unknown",
            "floor": "pass",
            "year_material": "pass",
            "mandatory_extras": "unknown",
        },
        "strengths": [],
        "concerns": [],
        "draft_subject": "Inquiry",
        "draft_body": "body",
    }


_LISTING_WITH_COORDS = {
    "id": "test-ors-1",
    "url": "https://www.kv.ee/test-ors-1.html",
    "title": "Test Apartment ORS",
    "price_eur": 200000,
    "rooms": 3,
    "area_sqm": 60.0,
    "image_count": 10,
    "raw_ok": True,
    "lat": 59.42,
    "lng": 24.72,
}

_LISTING_WITHOUT_COORDS = {
    "id": "test-ors-2",
    "url": "https://www.kv.ee/test-ors-2.html",
    "title": "Test Apartment No Coords",
    "price_eur": 180000,
    "rooms": 3,
    "area_sqm": 55.0,
    "image_count": 8,
    "raw_ok": True,
}


# ---------------------------------------------------------------------------
# process_ingest_batch commute_minutes tests
# ---------------------------------------------------------------------------

def test_process_ingest_batch_populates_commute_minutes(tmp_agent_state, mock_telegram, mock_send_pending_card, monkeypatch):
    """Listing with lat/lng gets commute_minutes populated on the pending entry."""
    monkeypatch.setattr(config, "ORS_API_KEY", "test-key")
    monkeypatch.setattr(ingest_handler, "evaluate_listing", _mock_evaluate_fn())

    mock_commute = MagicMock(return_value=15)
    monkeypatch.setattr(ingest_handler, "_fetch_commute_minutes", mock_commute)

    result = ingest_handler.process_ingest_batch([_LISTING_WITH_COORDS])

    assert result["ok"] is True, f"Unexpected result: {result}"

    app_data = data_store.load_app_data()
    pending_entry = next((e for e in app_data.get("pending", []) if e.get("id") == "test-ors-1"), None)
    assert pending_entry is not None, "Listing not found in pending[]"
    assert pending_entry.get("commute_minutes") == 15, (
        f"Expected commute_minutes=15, got {pending_entry.get('commute_minutes')}"
    )


def test_process_ingest_batch_no_coords_skips_ors(tmp_agent_state, mock_telegram, mock_send_pending_card, monkeypatch):
    """Listing without lat/lng skips ORS call and gets commute_minutes=None."""
    monkeypatch.setattr(config, "ORS_API_KEY", "test-key")
    monkeypatch.setattr(ingest_handler, "evaluate_listing", _mock_evaluate_fn())

    mock_commute = MagicMock(return_value=15)
    monkeypatch.setattr(ingest_handler, "_fetch_commute_minutes", mock_commute)

    result = ingest_handler.process_ingest_batch([_LISTING_WITHOUT_COORDS])

    assert result["ok"] is True, f"Unexpected result: {result}"

    # _fetch_commute_minutes must not have been called — no coords
    mock_commute.assert_not_called()

    app_data = data_store.load_app_data()
    pending_entry = next((e for e in app_data.get("pending", []) if e.get("id") == "test-ors-2"), None)
    assert pending_entry is not None, "Listing not found in pending[]"
    assert pending_entry.get("commute_minutes") is None, (
        f"Expected commute_minutes=None when no coords, got {pending_entry.get('commute_minutes')}"
    )


def test_process_ingest_batch_empty_ors_key(tmp_agent_state, mock_telegram, mock_send_pending_card, monkeypatch):
    """Empty ORS_API_KEY results in commute_minutes=None on the pending entry (soft skip)."""
    monkeypatch.setattr(config, "ORS_API_KEY", "")
    monkeypatch.setattr(ingest_handler, "evaluate_listing", _mock_evaluate_fn())

    result = ingest_handler.process_ingest_batch([_LISTING_WITH_COORDS])

    assert result["ok"] is True, f"Unexpected result: {result}"

    app_data = data_store.load_app_data()
    pending_entry = next((e for e in app_data.get("pending", []) if e.get("id") == "test-ors-1"), None)
    assert pending_entry is not None, "Listing not found in pending[]"
    assert pending_entry.get("commute_minutes") is None, (
        f"Expected commute_minutes=None with empty ORS key, got {pending_entry.get('commute_minutes')}"
    )


# ---------------------------------------------------------------------------
# _geocode_with_nominatim tests
# ---------------------------------------------------------------------------

def test_geocode_with_nominatim_success(monkeypatch):
    """Valid Nominatim response returns (lat, lng) as floats."""
    mock_response = MagicMock()
    mock_response.json.return_value = [
        {"lat": "59.4280671", "lon": "24.7471453", "display_name": "Liivalaia 7, Tallinn"}
    ]
    mock_response.raise_for_status.return_value = None

    mock_get = MagicMock(return_value=mock_response)
    monkeypatch.setattr(ingest_handler.requests, "get", mock_get)

    lat, lng = ingest_handler._geocode_with_nominatim("Liivalaia 7, Tallinn")

    assert lat == 59.4280671, f"Expected lat=59.4280671, got {lat}"
    assert lng == 24.7471453, f"Expected lng=24.7471453, got {lng}"
    mock_get.assert_called_once()


def test_geocode_with_nominatim_empty_response(monkeypatch):
    """Empty Nominatim response (no results) returns (None, None)."""
    mock_response = MagicMock()
    mock_response.json.return_value = []
    mock_response.raise_for_status.return_value = None

    mock_get = MagicMock(return_value=mock_response)
    monkeypatch.setattr(ingest_handler.requests, "get", mock_get)

    lat, lng = ingest_handler._geocode_with_nominatim("Nowhere Street 999, Tallinn")

    assert lat is None, f"Expected None for empty response, got {lat}"
    assert lng is None, f"Expected None for empty response, got {lng}"


# ---------------------------------------------------------------------------
# POST /api/geocode-backfill endpoint tests
# ---------------------------------------------------------------------------

def test_geocode_backfill_endpoint(client, tmp_agent_state, monkeypatch):
    """POST /api/geocode-backfill?sync=1 geocodes entries missing coords and skips those with coords."""
    monkeypatch.setattr(config, "ORS_API_KEY", "test-key")

    # Monkeypatch time.sleep to avoid 1.1s delay in tests
    monkeypatch.setattr(ingest_handler.time, "sleep", lambda _: None)

    # Monkeypatch Nominatim geocoder to return fixed coords
    mock_geocode = MagicMock(return_value=(59.42, 24.72))
    monkeypatch.setattr(ingest_handler, "_geocode_with_nominatim", mock_geocode)

    # Monkeypatch commute minutes
    mock_commute = MagicMock(return_value=15)
    monkeypatch.setattr(ingest_handler, "_fetch_commute_minutes", mock_commute)

    # Seed app_data with two pending entries:
    # - entry A: has coords already (should be skipped)
    # - entry B: no coords (should be geocoded)
    with data_store._lock:
        data = data_store.load_app_data()
        data["pending"] = [
            {
                "id": "backfill-has-coords",
                "title": "Already Has Coords",
                "url": "https://www.kv.ee/backfill-has-coords.html",
                "price_eur": 200000,
                "lat": 59.4200,
                "lng": 24.7100,
                "commute_minutes": 10,
            },
            {
                "id": "backfill-no-coords",
                "title": "Liivalaia 7, Tallinn",
                "url": "https://www.kv.ee/backfill-no-coords.html",
                "price_eur": 180000,
                "lat": None,
                "lng": None,
                "commute_minutes": None,
            },
        ]
        data_store.save_app_data(data)

    resp = client.post("/api/geocode-backfill?sync=1")

    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
    body = resp.json()
    assert body.get("ok") is True, f"Expected ok=True, got {body}"
    assert body.get("geocoded") == 1, f"Expected geocoded=1, got {body.get('geocoded')}"
    assert body.get("skipped") == 1, f"Expected skipped=1, got {body.get('skipped')}"

    # Verify app_data now has coords on the previously-empty entry
    updated_data = data_store.load_app_data()
    updated_entry = next(
        (e for e in updated_data.get("pending", []) if e.get("id") == "backfill-no-coords"),
        None,
    )
    assert updated_entry is not None, "backfill-no-coords not found in pending[]"
    assert updated_entry.get("lat") == 59.42, (
        f"Expected lat=59.42 after geocode, got {updated_entry.get('lat')}"
    )
