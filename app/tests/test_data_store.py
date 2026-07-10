"""Tests for Phase 6 data_store extensions: setdefault migration and state-transition helpers.

Covers: VIEW-01, VIEW-03, ENRICH-01 persistence layer.
Verification commands per 06-VALIDATION.md § Per-Task Verification Map.
"""

import json

import pytest


def _write_app_data(tmp_path: object, data: dict) -> None:
    """Write app_data JSON directly to the tmp file so tests control exact initial state."""
    import config  # noqa: PLC0415
    path = config.APP_DATA_FILE
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f)


def test_setdefault_status_legacy(tmp_agent_state):
    """VIEW-01: legacy properties[] entry without 'status' gets status='approved' on load.

    Corresponds to: pytest app/tests/test_data_store.py::test_setdefault_status_legacy -x
    """
    import data_store  # noqa: PLC0415

    _write_app_data(tmp_agent_state, {
        "properties": [{"id": "legacy-1", "price": 100000}],
        "pending": [],
        "rejected": [],
        "checklists": {},
        "settings": {},
    })

    data = data_store.load_app_data()
    entry = data["properties"][0]

    assert entry["status"] == "approved"
    assert entry["viewing_history"] == []
    assert entry["negotiation_brief"] is None
    assert entry["ku"] is None
    assert entry["scheduled_at"] is None


def test_set_viewing_scheduled_missing(tmp_agent_state):
    """VIEW-01: set_viewing_scheduled returns False when listing_id not in properties[].

    Corresponds to: pytest app/tests/test_data_store.py::test_set_viewing_scheduled_missing -x
    """
    import data_store  # noqa: PLC0415

    result = data_store.set_viewing_scheduled("does-not-exist", "2026-08-01T15:00:00+00:00")
    assert result is False


def test_reschedule_appends_history(tmp_agent_state):
    """VIEW-01: rescheduling a viewing appends to viewing_history[] rather than overwriting.

    Corresponds to: pytest app/tests/test_data_store.py::test_reschedule_appends_history -x
    """
    import data_store  # noqa: PLC0415

    _write_app_data(tmp_agent_state, {
        "properties": [{"id": "abc", "price": 150000}],
        "pending": [],
        "rejected": [],
        "checklists": {},
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


def test_save_ku_preserves_manual(tmp_agent_state):
    """ENRICH-01: save_ku_enrichment preserves entry['ku']['manual'] when overwriting auto.

    Corresponds to: pytest app/tests/test_data_store.py::test_save_ku_preserves_manual -x
    (Pitfall 7 in 06-RESEARCH.md)
    """
    import data_store  # noqa: PLC0415

    _write_app_data(tmp_agent_state, {
        "properties": [{
            "id": "ku-test",
            "price": 175000,
            "ku": {"auto": {}, "manual": "meeting notes from Feb"},
        }],
        "pending": [],
        "rejected": [],
        "checklists": {},
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


def test_mark_viewed_transitions_from_scheduled(tmp_agent_state):
    """VIEW-01: mark_viewed flips 'viewing_scheduled' → 'viewed'; rejects 'approved' → 'viewed'.

    Corresponds to: pytest app/tests/test_data_store.py::test_mark_viewed_transitions_from_scheduled -x
    (D-03: no auto-transition; mark_viewed only valid from viewing_scheduled)
    """
    import data_store  # noqa: PLC0415

    _write_app_data(tmp_agent_state, {
        "properties": [
            {
                "id": "scheduled-entry",
                "price": 175000,
                "status": "viewing_scheduled",
                "scheduled_at": "2026-07-15T15:00:00+00:00",
                "viewing_history": [],
            },
            {
                "id": "approved-entry",
                "price": 150000,
                "status": "approved",
            },
        ],
        "pending": [],
        "rejected": [],
        "checklists": {},
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
