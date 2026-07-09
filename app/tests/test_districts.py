"""Tests for Phase 05 Plan 03: GET /api/districts endpoint.

Covers MAP-03 — district heat zone data: response shape, avg price/m² computation,
mixed properties/pending aggregation, null exclusion, never-raise convention.
"""

import json
from pathlib import Path

import pytest

import data_store


# ---------------------------------------------------------------------------
# Helper to seed app_data.json for the redirected path
# ---------------------------------------------------------------------------

def _seed_app_data(tmp_agent_state, properties=None, pending=None):
    """Write app_data.json into the temp directory used by the test fixtures.

    tmp_agent_state is the tmp_path directory; config.APP_DATA_FILE is already
    pointing to <tmp_path>/app_data.json by the time this is called.
    """
    data = {
        "properties": properties if properties is not None else [],
        "pending": pending if pending is not None else [],
        "rejected": [],
    }
    app_data_file = tmp_agent_state / "app_data.json"
    with open(app_data_file, "w", encoding="utf-8") as f:
        json.dump(data, f)


def _entry(district: str, price_per_sqm=None, listing_id: str = "x") -> dict:
    """Build a minimal listing entry with a district and optional price_per_sqm."""
    return {
        "id": listing_id,
        "url": f"https://www.kv.ee/{listing_id}.html",
        "title": "Test Apartment",
        "district": district,
        "price_per_sqm": price_per_sqm,
    }


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_get_districts_empty_data(client, tmp_agent_state):
    """Empty properties[] and pending[] → districts list is empty."""
    _seed_app_data(tmp_agent_state, properties=[], pending=[])
    resp = client.get("/api/districts")
    assert resp.status_code == 200
    assert resp.json() == {"districts": []}


def test_get_districts_response_shape(client, tmp_agent_state):
    """Response has 'districts' key; each item has name (str), avg_price_per_sqm (float|None), count (int)."""
    _seed_app_data(
        tmp_agent_state,
        properties=[
            _entry("Kesklinn", price_per_sqm=3000, listing_id="p1"),
            _entry("Mustamäe", price_per_sqm=2500, listing_id="p2"),
        ],
        pending=[
            _entry("Nõmme", price_per_sqm=2000, listing_id="pe1"),
        ],
    )
    resp = client.get("/api/districts")
    assert resp.status_code == 200
    body = resp.json()
    assert "districts" in body
    districts = body["districts"]
    assert isinstance(districts, list)
    assert len(districts) == 3
    for item in districts:
        assert set(item.keys()) >= {"name", "avg_price_per_sqm", "count"}
        assert isinstance(item["name"], str)
        assert isinstance(item["count"], int)
        assert item["avg_price_per_sqm"] is None or isinstance(item["avg_price_per_sqm"], (int, float))


def test_get_districts_avg_computation(client, tmp_agent_state):
    """Three entries in Kesklinn with prices 3000, 3500, 4000 → avg 3500.0, count 3."""
    _seed_app_data(
        tmp_agent_state,
        properties=[
            _entry("Kesklinn", price_per_sqm=3000, listing_id="a1"),
            _entry("Kesklinn", price_per_sqm=3500, listing_id="a2"),
            _entry("Kesklinn", price_per_sqm=4000, listing_id="a3"),
        ],
    )
    resp = client.get("/api/districts")
    assert resp.status_code == 200
    districts = resp.json()["districts"]
    assert len(districts) == 1
    kesklinn = districts[0]
    assert kesklinn["name"] == "Kesklinn"
    assert kesklinn["count"] == 3
    assert kesklinn["avg_price_per_sqm"] == pytest.approx(3500.0)


def test_get_districts_mixes_properties_and_pending(client, tmp_agent_state):
    """2 properties + 1 pending in Kesklinn → count 3, avg 3000.0."""
    _seed_app_data(
        tmp_agent_state,
        properties=[
            _entry("Kesklinn", price_per_sqm=2000, listing_id="prop1"),
            _entry("Kesklinn", price_per_sqm=4000, listing_id="prop2"),
        ],
        pending=[
            _entry("Kesklinn", price_per_sqm=3000, listing_id="pend1"),
        ],
    )
    resp = client.get("/api/districts")
    assert resp.status_code == 200
    districts = resp.json()["districts"]
    assert len(districts) == 1
    k = districts[0]
    assert k["name"] == "Kesklinn"
    assert k["count"] == 3
    assert k["avg_price_per_sqm"] == pytest.approx(3000.0)


def test_get_districts_multiple_districts(client, tmp_agent_state):
    """Entries across 3 districts → 3 rows with correct name/count/avg for each."""
    _seed_app_data(
        tmp_agent_state,
        properties=[
            _entry("Kesklinn", price_per_sqm=4000, listing_id="k1"),
            _entry("Kesklinn", price_per_sqm=6000, listing_id="k2"),
            _entry("Mustamäe", price_per_sqm=2000, listing_id="m1"),
            _entry("Mustamäe", price_per_sqm=3000, listing_id="m2"),
        ],
        pending=[
            _entry("Pirita", price_per_sqm=5000, listing_id="pi1"),
        ],
    )
    resp = client.get("/api/districts")
    assert resp.status_code == 200
    districts = resp.json()["districts"]
    assert len(districts) == 3
    by_name = {d["name"]: d for d in districts}
    assert set(by_name.keys()) == {"Kesklinn", "Mustamäe", "Pirita"}
    assert by_name["Kesklinn"]["count"] == 2
    assert by_name["Kesklinn"]["avg_price_per_sqm"] == pytest.approx(5000.0)
    assert by_name["Mustamäe"]["count"] == 2
    assert by_name["Mustamäe"]["avg_price_per_sqm"] == pytest.approx(2500.0)
    assert by_name["Pirita"]["count"] == 1
    assert by_name["Pirita"]["avg_price_per_sqm"] == pytest.approx(5000.0)


def test_get_districts_excludes_null_price_per_sqm_from_avg(client, tmp_agent_state):
    """Entry with price_per_sqm=None is counted but excluded from the average."""
    _seed_app_data(
        tmp_agent_state,
        properties=[
            _entry("Kesklinn", price_per_sqm=3000, listing_id="k1"),
            _entry("Kesklinn", price_per_sqm=None, listing_id="k2"),
        ],
    )
    resp = client.get("/api/districts")
    assert resp.status_code == 200
    districts = resp.json()["districts"]
    assert len(districts) == 1
    k = districts[0]
    assert k["name"] == "Kesklinn"
    assert k["count"] == 2
    assert k["avg_price_per_sqm"] == pytest.approx(3000.0)


def test_get_districts_all_null_avg_is_none(client, tmp_agent_state):
    """All entries in a district have price_per_sqm=None → avg is None, count is still correct."""
    _seed_app_data(
        tmp_agent_state,
        properties=[
            _entry("Kesklinn", price_per_sqm=None, listing_id="k1"),
            _entry("Kesklinn", price_per_sqm=None, listing_id="k2"),
        ],
    )
    resp = client.get("/api/districts")
    assert resp.status_code == 200
    districts = resp.json()["districts"]
    assert len(districts) == 1
    k = districts[0]
    assert k["name"] == "Kesklinn"
    assert k["count"] == 2
    assert k["avg_price_per_sqm"] is None


def test_get_districts_missing_district_field_ignored(client, tmp_agent_state):
    """Entry without a district field is ignored; only entries with a district appear."""
    _seed_app_data(
        tmp_agent_state,
        properties=[
            {"id": "no-district", "url": "https://www.kv.ee/no-d.html", "price_per_sqm": 3000},
            _entry("Kesklinn", price_per_sqm=3000, listing_id="k1"),
        ],
    )
    resp = client.get("/api/districts")
    assert resp.status_code == 200
    districts = resp.json()["districts"]
    assert len(districts) == 1
    assert districts[0]["name"] == "Kesklinn"


def test_get_districts_never_raises_on_corrupt_data(client, tmp_agent_state, monkeypatch):
    """Endpoint returns {districts: []} and 200 when data_store.load_app_data raises (never-raise convention)."""
    monkeypatch.setattr(data_store, "load_app_data", lambda: (_ for _ in ()).throw(Exception("boom")))
    resp = client.get("/api/districts")
    assert resp.status_code == 200
    assert resp.json() == {"districts": []}
