"""Tests for Phase 6 data_store extensions: state-transition helpers.

Covers: VIEW-01, VIEW-03, ENRICH-01 persistence layer.
Verification commands per 06-VALIDATION.md § Per-Task Verification Map.

Phase 7 Wave 2 port notes:
- All tests now use `db_session` fixture (SQLAlchemy session, per-test rollback).
- JSON file seeding (_write_app_data) replaced by data_store.save_app_data() shim.
- test_setdefault_status_legacy DELETED: the setdefault pattern was a JSON-file
  migration technique. In the DB world the Listing model has `default="approved"` for
  the status field, applied at INSERT time by SQLAlchemy / Alembic. The DB model
  guarantees status is never NULL.
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


