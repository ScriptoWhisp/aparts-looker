"""Wave 0 test scaffold for Phase 5 geocoding data model.

Tests cover:
- Listing dataclass lat/lng fields
- data_store.update_listing_coords / get_listing_coords helpers
- data_store._pending_to_property coord carry-over
- kv_listing_parser._extract_coords regex probe patterns (three fallback shapes)

Phase 7 Wave 4 fix (Rule 1 — bug): tests that previously wrote to app_data.json
and expected load_app_data() to read from it are updated to use the DB via
db_session fixture (Wave 2 replaced filesystem storage with Postgres).
"""

import pytest


def test_listing_dataclass_has_lat_lng():
    """Listing dataclass must expose lat and lng fields defaulting to None."""
    from kv_listing_parser import Listing  # noqa: PLC0415

    listing = Listing(id="x", url="y")
    assert hasattr(listing, "lat"), "Listing must have a 'lat' attribute"
    assert hasattr(listing, "lng"), "Listing must have an 'lng' attribute"
    assert listing.lat is None
    assert listing.lng is None


def test_load_app_data_migrates_missing_lat_lng(db_session):
    """Existing entries missing lat/lng/commute_minutes default to None on load.

    Phase 7 Wave 4: seeds via data_store.add_to_pending() (DB) instead of
    writing to app_data.json (obsolete after Wave 2 migration).
    """
    import data_store  # noqa: PLC0415

    data_store.add_to_pending({"id": "abc-geo", "title": "T", "status": "pending"})

    data = data_store.load_app_data()
    pending_by_id = {e["id"]: e for e in data["pending"]}
    assert "abc-geo" in pending_by_id, f"abc-geo not found in pending: {list(pending_by_id)}"
    entry = pending_by_id["abc-geo"]
    assert entry.get("lat") is None
    assert entry.get("lng") is None
    assert entry.get("commute_minutes") is None


def test_load_app_data_preserves_existing_coords(db_session):
    """Existing coord values in pending[]/properties[] are preserved unchanged on load.

    Phase 7 Wave 4: seeds via data_store.add_to_pending() (DB) then
    data_store.update_listing_coords() instead of writing to app_data.json.
    """
    import data_store  # noqa: PLC0415

    data_store.add_to_pending({"id": "abc-coords", "title": "T", "status": "pending"})
    data_store.update_listing_coords("abc-coords", 59.4, 24.7, 15)

    data = data_store.load_app_data()
    pending_by_id = {e["id"]: e for e in data["pending"]}
    entry = pending_by_id["abc-coords"]
    assert entry["lat"] == 59.4
    assert entry["lng"] == 24.7
    assert entry["commute_minutes"] == 15


def test_update_listing_coords_pending(db_session):
    """update_listing_coords writes lat/lng/commute_minutes onto a pending entry."""
    import data_store  # noqa: PLC0415

    data_store.add_to_pending({"id": "abc-upd", "title": "T", "status": "pending"})

    result = data_store.update_listing_coords("abc-upd", 59.42, 24.72, 18)
    assert result is True

    data = data_store.load_app_data()
    pending_by_id = {e["id"]: e for e in data["pending"]}
    entry = pending_by_id["abc-upd"]
    assert entry["lat"] == 59.42
    assert entry["lng"] == 24.72
    assert entry["commute_minutes"] == 18


def test_update_listing_coords_properties(db_session):
    """update_listing_coords writes coord fields onto a properties entry."""
    from models import Listing  # noqa: PLC0415
    import data_store  # noqa: PLC0415

    row = Listing(id="prop1-geo", status="approved", title="Apt 1")
    db_session.add(row)
    db_session.commit()

    result = data_store.update_listing_coords("prop1-geo", 59.43, 24.73, 12)
    assert result is True

    data = data_store.load_app_data()
    props_by_id = {e["id"]: e for e in data["properties"]}
    entry = props_by_id["prop1-geo"]
    assert entry["lat"] == 59.43
    assert entry["lng"] == 24.73
    assert entry["commute_minutes"] == 12


def test_update_listing_coords_not_found(db_session):
    """update_listing_coords returns False when listing_id not found in pending or properties."""
    import data_store  # noqa: PLC0415

    result = data_store.update_listing_coords("missing-geo", 59.42, 24.72, 18)
    assert result is False


def test_get_listing_coords_hit(db_session):
    """get_listing_coords returns the stored coords dict for a known listing_id."""
    import data_store  # noqa: PLC0415

    data_store.add_to_pending({"id": "abc-hit", "title": "T", "status": "pending"})
    data_store.update_listing_coords("abc-hit", 59.42, 24.72, 18)

    result = data_store.get_listing_coords("abc-hit")
    assert result == {"lat": 59.42, "lng": 24.72, "commute_minutes": 18}


def test_get_listing_coords_miss(db_session):
    """get_listing_coords returns all-None dict for an unknown listing_id."""
    import data_store  # noqa: PLC0415

    result = data_store.get_listing_coords("unknown-id-geo")
    assert result == {"lat": None, "lng": None, "commute_minutes": None}


def test_pending_to_property_carries_coords():
    """_pending_to_property carries lat, lng, commute_minutes from pending entry to property dict."""
    import data_store  # noqa: PLC0415

    entry = {
        "id": "abc",
        "url": "https://kv.ee/abc.html",
        "title": "Test Apt",
        "price_eur": 200000,
        "area_sqm": 60.0,
        "rooms": 3,
        "price_per_sqm": 3333,
        "year_built": 2010,
        "material": "panel",
        "score": 80,
        "verdict": "Good",
        "strengths": [],
        "concerns": [],
        "draft_body": "body",
        "contact_email": "agent@test.ee",
        "draft_subject": "Test",
        "lat": 59.4,
        "lng": 24.7,
        "commute_minutes": 15,
    }

    prop = data_store._pending_to_property(entry)
    assert prop["lat"] == 59.4
    assert prop["lng"] == 24.7
    assert prop["commute_minutes"] == 15


def test_coord_regex_json_ld_pattern():
    """_extract_coords extracts lat/lng from JSON-LD structured data format."""
    from kv_listing_parser import _extract_coords  # noqa: PLC0415

    html = """
    <script type="application/ld+json">
    {"@type": "Place", "geo": {"latitude": 59.4203, "longitude": 24.7205}}
    </script>
    """
    lat, lng = _extract_coords(html)
    assert lat == pytest.approx(59.4203, abs=1e-4)
    assert lng == pytest.approx(24.7205, abs=1e-4)


def test_coord_regex_script_var_pattern():
    """_extract_coords extracts lat/lng from compact JavaScript object variable form."""
    from kv_listing_parser import _extract_coords  # noqa: PLC0415

    html = """
    <script>
    var mapData = {"lat":59.4203,"lng":24.7205,"zoom":15};
    </script>
    """
    lat, lng = _extract_coords(html)
    assert lat == pytest.approx(59.4203, abs=1e-4)
    assert lng == pytest.approx(24.7205, abs=1e-4)


def test_coord_regex_data_attribute_pattern():
    """_extract_coords extracts lat/lng from HTML data-lat/data-lng attributes."""
    from kv_listing_parser import _extract_coords  # noqa: PLC0415

    html = """<div id="map" data-lat="59.4203" data-lng="24.7205" class="leaflet-map"></div>"""
    lat, lng = _extract_coords(html)
    assert lat == pytest.approx(59.4203, abs=1e-4)
    assert lng == pytest.approx(24.7205, abs=1e-4)


def test_coord_regex_no_match_returns_none():
    """_extract_coords returns (None, None) when no coord-shaped tokens are found — never raises."""
    from kv_listing_parser import _extract_coords  # noqa: PLC0415

    html = "<html><body><p>No coordinates here, just text and numbers 12345 and 6789.</p></body></html>"
    result = _extract_coords(html)
    assert result == (None, None)
