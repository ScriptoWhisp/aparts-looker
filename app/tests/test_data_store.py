"""Tests for Phase 6 data_store extensions: state-transition helpers.

Covers: VIEW-01, VIEW-03, ENRICH-01 persistence layer.
Verification commands per 06-VALIDATION.md § Per-Task Verification Map.

Phase 7 Wave 2 port notes:
- All tests now use `db_session` fixture (SQLAlchemy session, per-test rollback).
- JSON file seeding (_write_app_data) replaced by data_store.save_app_data() shim.
- test_setdefault_status_legacy DELETED: the setdefault pattern was a JSON-file
  migration technique. In the DB world the Listing model has `default="approved"` for
  the status field; default values are applied at INSERT time by the Alembic migration
  / SQLAlchemy default. The Wave 3 migrate_from_json.py covers equivalent behaviour
  for legacy JSON records. The DB model guarantees status is never NULL.
"""

import pytest


def test_set_viewing_scheduled_missing(db_session):
    """VIEW-01: set_viewing_scheduled returns False when listing_id not in DB.

    Corresponds to: pytest app/tests/test_data_store.py::test_set_viewing_scheduled_missing -x
    """
    import data_store  # noqa: PLC0415

    result = data_store.set_viewing_scheduled("does-not-exist", "2026-08-01T15:00:00+00:00")
    assert result is False


def test_reschedule_appends_history(db_session):
    """VIEW-01: rescheduling a viewing appends to viewing_history[] rather than overwriting.

    Corresponds to: pytest app/tests/test_data_store.py::test_reschedule_appends_history -x
    """
    import data_store  # noqa: PLC0415

    data_store.save_app_data({
        "properties": [{"id": "abc", "price_eur": 150000, "status": "approved"}],
        "pending": [],
        "rejected": [],
        "checklists": {},
        "price_history": {},
        "settings": {},
    })

    data_store.set_viewing_scheduled("abc", "2026-08-01T15:00:00+00:00")
    data_store.set_viewing_scheduled("abc", "2026-08-08T12:00:00+00:00")

    data = data_store.load_app_data()
    entry = data["properties"][0]

    assert len(entry["viewing_history"]) == 2
    assert entry["viewing_history"][0]["action"] == "scheduled"
    assert entry["viewing_history"][1]["action"] == "scheduled"
    assert entry["viewing_history"][0]["scheduled_for"] == "2026-08-01T15:00:00+00:00"
    assert entry["viewing_history"][1]["scheduled_for"] == "2026-08-08T12:00:00+00:00"


def test_save_ku_preserves_manual(db_session):
    """ENRICH-01: save_ku_enrichment preserves entry['ku']['manual'] when overwriting auto.

    Corresponds to: pytest app/tests/test_data_store.py::test_save_ku_preserves_manual -x
    (Pitfall 7 in 06-RESEARCH.md — regression guard: do NOT weaken this assertion)
    """
    import data_store  # noqa: PLC0415

    data_store.save_app_data({
        "properties": [{
            "id": "ku-test",
            "price_eur": 175000,
            "status": "approved",
            "ku": {"auto": {}, "manual": "meeting notes from Feb"},
        }],
        "pending": [],
        "rejected": [],
        "checklists": {},
        "price_history": {},
        "settings": {},
    })

    result = data_store.save_ku_enrichment("ku-test", {"reg_code": 12345678, "name": "KU X"})
    assert result is True

    data = data_store.load_app_data()
    entry = data["properties"][0]

    assert entry["ku"]["manual"] == "meeting notes from Feb"
    assert entry["ku"]["auto"]["reg_code"] == 12345678
    assert entry["ku"]["auto"]["name"] == "KU X"
    assert "looked_up_at" in entry["ku"]


def test_mark_viewed_transitions_from_scheduled(db_session):
    """VIEW-01: mark_viewed flips 'viewing_scheduled' → 'viewed'; rejects 'approved' → 'viewed'.

    Corresponds to: pytest app/tests/test_data_store.py::test_mark_viewed_transitions_from_scheduled -x
    (D-03: no auto-transition; mark_viewed only valid from viewing_scheduled)
    """
    import data_store  # noqa: PLC0415

    data_store.save_app_data({
        "properties": [
            {
                "id": "scheduled-entry",
                "price_eur": 175000,
                "status": "viewing_scheduled",
                "scheduled_at": "2026-07-15T15:00:00+00:00",
                "viewing_history": [],
            },
            {
                "id": "approved-entry",
                "price_eur": 150000,
                "status": "approved",
            },
        ],
        "pending": [],
        "rejected": [],
        "checklists": {},
        "price_history": {},
        "settings": {},
    })

    # Happy path: viewing_scheduled → viewed
    result = data_store.mark_viewed("scheduled-entry")
    assert result is True

    data = data_store.load_app_data()
    entry = next(p for p in data["properties"] if p["id"] == "scheduled-entry")
    assert entry["status"] == "viewed"
    assert len(entry["viewing_history"]) == 1
    assert entry["viewing_history"][0]["action"] == "viewed"

    # Guard: approved → viewed is an invalid transition; must return False (D-03)
    result_invalid = data_store.mark_viewed("approved-entry")
    assert result_invalid is False

    data2 = data_store.load_app_data()
    approved = next(p for p in data2["properties"] if p["id"] == "approved-entry")
    assert approved["status"] == "approved"  # status unchanged


def test_save_app_data_applies_legacy_aliases_on_write_path(db_session):
    """DB-05 regression guard: _dict_to_listing_fields applies _LEGACY_ALIASES on write path.

    Seeds a legacy-shaped dict (name/price/pricePerSqm/area/year/notes) via
    save_app_data, then queries the DB row directly to assert the correct
    canonical column values (title/price_eur/price_per_sqm/area_sqm/year_built/description).

    Also asserts that legacy keys did NOT spill into extras JSONB.

    Failure means _dict_to_listing_fields does NOT apply _LEGACY_ALIASES — go fix
    data_store.py Task 1.
    """
    import data_store  # noqa: PLC0415
    from models import Listing  # noqa: PLC0415

    legacy = {
        "properties": [{
            "id": "legacy-1",
            "name": "Vana korter Mustamäel",        # legacy alias for title
            "price": 210000,                          # legacy alias for price_eur
            "pricePerSqm": 3500,                      # legacy alias for price_per_sqm
            "area": 60.0,                             # legacy alias for area_sqm
            "year": 1975,                             # legacy alias for year_built
            "notes": "Kolm tuba, remonditud köök",   # legacy alias for description
            "status": "approved",
        }],
        "pending": [],
        "rejected": [],
        "checklists": {},
        "price_history": {},
        "settings": {},
    }
    data_store.save_app_data(legacy)

    # Query the DB row directly via the test session
    row = db_session.get(Listing, "legacy-1")
    assert row is not None, "Row 'legacy-1' not found in DB after save_app_data"

    # Canonical column values must be populated from legacy aliases
    assert row.title == "Vana korter Mustamäel", (
        f"title should be 'Vana korter Mustamäel', got {row.title!r}"
    )
    assert row.price_eur == 210000, (
        f"price_eur should be 210000, got {row.price_eur!r}"
    )
    assert row.price_per_sqm == 3500, (
        f"price_per_sqm should be 3500, got {row.price_per_sqm!r}"
    )
    assert row.area_sqm == 60.0, (
        f"area_sqm should be 60.0, got {row.area_sqm!r}"
    )
    assert row.year_built == 1975, (
        f"year_built should be 1975, got {row.year_built!r}"
    )
    # notes alias maps to description per _LEGACY_ALIASES
    assert row.description == "Kolm tuba, remonditud köök", (
        f"description should be 'Kolm tuba, remonditud köök', got {row.description!r}"
    )

    # No legacy keys must have leaked into extras JSONB
    extras = row.extras or {}
    assert "name" not in extras, f"'name' leaked into extras: {extras}"
    assert "price" not in extras, f"'price' leaked into extras: {extras}"
    assert "pricePerSqm" not in extras, f"'pricePerSqm' leaked into extras: {extras}"
    assert "area" not in extras, f"'area' leaked into extras: {extras}"
    assert "year" not in extras, f"'year' leaked into extras: {extras}"
    assert "notes" not in extras, f"'notes' leaked into extras: {extras}"
