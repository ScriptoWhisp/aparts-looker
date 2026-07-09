"""
Tests for ORS API integration: _fetch_commute_minutes, POST /api/refresh-isochrone,
GET /api/isochrone. All tests in this file are Wave 0 scaffolds for Plan 05-02.

Coverage:
  - test_fetch_commute_minutes_success: valid 200 response returns rounded minutes
  - test_fetch_commute_minutes_null_duration: null duration in response returns None
  - test_fetch_commute_minutes_empty_api_key: empty ORS_API_KEY short-circuits without HTTP call
  - test_fetch_commute_minutes_http_error: network exception returns None (never-raise)
  - test_refresh_isochrone_endpoint: POST /api/refresh-isochrone writes GeoJSON to disk
  - test_isochrone_get_serves_file: GET /api/isochrone returns file contents
  - test_isochrone_get_missing_file: GET /api/isochrone returns empty FeatureCollection when file absent
"""

import json
import os
from unittest.mock import MagicMock

import pytest

import config
import ingest_handler


# ---------------------------------------------------------------------------
# _fetch_commute_minutes tests
# ---------------------------------------------------------------------------

def test_fetch_commute_minutes_success(monkeypatch):
    """Valid 200 response with duration 720.5 seconds returns 12 minutes (max(1, round(720.5/60)))."""
    mock_response = MagicMock()
    mock_response.json.return_value = {"durations": [[None, 720.5]]}
    mock_response.raise_for_status.return_value = None

    mock_post = MagicMock(return_value=mock_response)
    monkeypatch.setattr(ingest_handler.requests, "post", mock_post)
    monkeypatch.setattr(config, "ORS_API_KEY", "test-key")

    result = ingest_handler._fetch_commute_minutes(59.42, 24.72)

    assert result == 12, f"Expected 12, got {result}"
    mock_post.assert_called_once()


def test_fetch_commute_minutes_null_duration(monkeypatch):
    """Duration value null in ORS response returns None."""
    mock_response = MagicMock()
    mock_response.json.return_value = {"durations": [[None, None]]}
    mock_response.raise_for_status.return_value = None

    mock_post = MagicMock(return_value=mock_response)
    monkeypatch.setattr(ingest_handler.requests, "post", mock_post)
    monkeypatch.setattr(config, "ORS_API_KEY", "test-key")

    result = ingest_handler._fetch_commute_minutes(59.42, 24.72)

    assert result is None, f"Expected None for null duration, got {result}"


def test_fetch_commute_minutes_empty_api_key(monkeypatch):
    """Empty ORS_API_KEY returns None WITHOUT making any HTTP call (soft skip)."""
    mock_post = MagicMock()
    monkeypatch.setattr(ingest_handler.requests, "post", mock_post)
    monkeypatch.setattr(config, "ORS_API_KEY", "")

    result = ingest_handler._fetch_commute_minutes(59.42, 24.72)

    assert result is None, f"Expected None for empty API key, got {result}"
    mock_post.assert_not_called()


def test_fetch_commute_minutes_http_error(monkeypatch):
    """Network exception from requests.post returns None (never-raise convention)."""
    import requests as _requests

    monkeypatch.setattr(ingest_handler.requests, "post", MagicMock(side_effect=_requests.RequestException("timeout")))
    monkeypatch.setattr(config, "ORS_API_KEY", "test-key")

    result = ingest_handler._fetch_commute_minutes(59.42, 24.72)

    assert result is None, f"Expected None on HTTP error, got {result}"


# ---------------------------------------------------------------------------
# POST /api/refresh-isochrone endpoint tests
# ---------------------------------------------------------------------------

_VALID_GEOJSON = {
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "geometry": {
                "type": "Polygon",
                "coordinates": [[[24.6, 59.35], [24.85, 59.35], [24.85, 59.5], [24.6, 59.5], [24.6, 59.35]]],
            },
            "properties": {},
        }
    ],
}


def test_refresh_isochrone_endpoint(client, tmp_agent_state, monkeypatch):
    """POST /api/refresh-isochrone calls ORS, writes GeoJSON to disk, returns {ok: true}."""
    import requests as _requests

    mock_response = MagicMock()
    mock_response.json.return_value = _VALID_GEOJSON
    mock_response.raise_for_status.return_value = None

    monkeypatch.setattr(_requests, "post", MagicMock(return_value=mock_response))
    monkeypatch.setattr(config, "ORS_API_KEY", "test-key")

    resp = client.post("/api/refresh-isochrone")

    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
    assert resp.json() == {"ok": True}, f"Unexpected body: {resp.json()}"

    # Verify GeoJSON was written to disk
    geojson_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "static", "isochrone.geojson")
    assert os.path.exists(geojson_path), f"isochrone.geojson not written at {geojson_path}"
    with open(geojson_path, "r", encoding="utf-8") as f:
        written = json.load(f)
    assert written == _VALID_GEOJSON, f"Unexpected GeoJSON on disk: {written}"


# ---------------------------------------------------------------------------
# GET /api/isochrone endpoint tests
# ---------------------------------------------------------------------------

def test_isochrone_get_serves_file(client, tmp_agent_state):
    """GET /api/isochrone returns a FeatureCollection from the file on disk."""
    # Seed the isochrone.geojson file with a known FeatureCollection
    geojson_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "static", "isochrone.geojson")
    with open(geojson_path, "w", encoding="utf-8") as f:
        json.dump(_VALID_GEOJSON, f)

    resp = client.get("/api/isochrone")

    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
    body = resp.json()
    assert body.get("type") == "FeatureCollection", f"Unexpected type: {body.get('type')}"


def test_isochrone_get_missing_file(client, tmp_agent_state):
    """GET /api/isochrone returns empty FeatureCollection when the file is absent."""
    geojson_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "static", "isochrone.geojson")
    if os.path.exists(geojson_path):
        os.unlink(geojson_path)

    resp = client.get("/api/isochrone")

    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
    body = resp.json()
    assert body == {"type": "FeatureCollection", "features": []}, f"Unexpected fallback body: {body}"
