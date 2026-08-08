"""Tests for the checklist-item PATCH endpoint and set_checklist_user_mark helper.

Covers:
  - Setting state on a fresh listing persists
  - Setting note on a fresh listing persists
  - state=null clears the state override but keeps the note
  - note=null clears the note but keeps the state override
  - Multiple keys coexist independently under user_marks
  - 404 for a missing listing
  - 422 for an invalid state value
  - Roundtrip: a second PATCH sees + extends the user_marks left by the first
"""

import pytest


def _seed_listing(data_store, listing_id: str) -> None:
    """Insert a minimal approved listing via the save_app_data shim."""
    app_data = data_store.load_app_data()
    app_data["properties"].append({"id": listing_id, "price_eur": 150000, "status": "approved"})
    data_store.save_app_data(app_data)


def _get_checklist(data_store, listing_id: str) -> dict:
    data = data_store.load_app_data()
    for bucket in ("properties", "pending", "rejected"):
        for e in data.get(bucket, []):
            if e.get("id") == listing_id:
                return data.get("checklists", {}).get(listing_id, {})
    raise AssertionError(f"listing {listing_id} not found in any bucket")


def test_set_state_on_fresh_listing_persists(db_session, client, tmp_agent_state):
    import data_store  # noqa: PLC0415

    _seed_listing(data_store, "abc")

    resp = client.patch(
        "/api/entry/abc/checklist-item",
        json={"key": "s14_01", "state": "flag"},
    )
    assert resp.status_code == 200, f"expected 200 got {resp.status_code}: {resp.text}"
    body = resp.json()
    assert body["ok"] is True
    assert body["user_marks"]["s14_01"]["state"] == "flag"

    checklist = _get_checklist(data_store, "abc")
    assert checklist["user_marks"]["s14_01"]["state"] == "flag"
    assert "marked_at" in checklist["user_marks"]["s14_01"]


def test_set_note_on_fresh_listing_persists(db_session, client, tmp_agent_state):
    import data_store  # noqa: PLC0415

    _seed_listing(data_store, "abc")

    resp = client.patch(
        "/api/entry/abc/checklist-item",
        json={"key": "s14_01", "note": "Asked agent, waiting on reply"},
    )
    assert resp.status_code == 200, f"expected 200 got {resp.status_code}: {resp.text}"
    body = resp.json()
    assert body["user_marks"]["s14_01"]["note"] == "Asked agent, waiting on reply"

    checklist = _get_checklist(data_store, "abc")
    assert checklist["user_marks"]["s14_01"]["note"] == "Asked agent, waiting on reply"


def test_state_null_clears_state_keeps_note(db_session, client, tmp_agent_state):
    import data_store  # noqa: PLC0415

    _seed_listing(data_store, "abc")

    client.patch("/api/entry/abc/checklist-item", json={"key": "s14_01", "state": "flag"})
    client.patch("/api/entry/abc/checklist-item", json={"key": "s14_01", "note": "still checking"})

    resp = client.patch("/api/entry/abc/checklist-item", json={"key": "s14_01", "state": None})
    assert resp.status_code == 200, f"expected 200 got {resp.status_code}: {resp.text}"
    marks = resp.json()["user_marks"]["s14_01"]
    assert "state" not in marks
    assert marks["note"] == "still checking"


def test_note_null_clears_note_keeps_state(db_session, client, tmp_agent_state):
    import data_store  # noqa: PLC0415

    _seed_listing(data_store, "abc")

    client.patch("/api/entry/abc/checklist-item", json={"key": "s14_01", "state": "ok"})
    client.patch("/api/entry/abc/checklist-item", json={"key": "s14_01", "note": "checked in person"})

    resp = client.patch("/api/entry/abc/checklist-item", json={"key": "s14_01", "note": None})
    assert resp.status_code == 200, f"expected 200 got {resp.status_code}: {resp.text}"
    marks = resp.json()["user_marks"]["s14_01"]
    assert marks["state"] == "ok"
    assert "note" not in marks


def test_partial_update_only_state_keeps_existing_note(db_session, client, tmp_agent_state):
    """PATCH with only 'state' in the body must leave an existing note untouched."""
    import data_store  # noqa: PLC0415

    _seed_listing(data_store, "abc")

    client.patch("/api/entry/abc/checklist-item", json={"key": "s14_01", "note": "original note"})
    resp = client.patch("/api/entry/abc/checklist-item", json={"key": "s14_01", "state": "unknown"})
    assert resp.status_code == 200
    marks = resp.json()["user_marks"]["s14_01"]
    assert marks["state"] == "unknown"
    assert marks["note"] == "original note"


def test_multiple_keys_coexist_independently(db_session, client, tmp_agent_state):
    import data_store  # noqa: PLC0415

    _seed_listing(data_store, "abc")

    client.patch("/api/entry/abc/checklist-item", json={"key": "s14_01", "state": "flag"})
    resp = client.patch("/api/entry/abc/checklist-item", json={"key": "s16_01", "state": "ok"})

    assert resp.status_code == 200
    marks = resp.json()["user_marks"]
    assert marks["s14_01"]["state"] == "flag"
    assert marks["s16_01"]["state"] == "ok"


def test_404_on_missing_listing(db_session, client, tmp_agent_state):
    resp = client.patch(
        "/api/entry/does-not-exist/checklist-item",
        json={"key": "s14_01", "state": "ok"},
    )
    assert resp.status_code == 404, f"expected 404 got {resp.status_code}: {resp.text}"


def test_422_on_invalid_state_value(db_session, client, tmp_agent_state):
    import data_store  # noqa: PLC0415

    _seed_listing(data_store, "abc")

    resp = client.patch(
        "/api/entry/abc/checklist-item",
        json={"key": "s14_01", "state": "not-a-real-state"},
    )
    assert resp.status_code == 422, f"expected 422 got {resp.status_code}: {resp.text}"


def test_422_on_missing_key(db_session, client, tmp_agent_state):
    import data_store  # noqa: PLC0415

    _seed_listing(data_store, "abc")

    resp = client.patch("/api/entry/abc/checklist-item", json={"state": "ok"})
    assert resp.status_code == 422, f"expected 422 got {resp.status_code}: {resp.text}"


def test_roundtrip_with_existing_user_marks(db_session, client, tmp_agent_state):
    """A second PATCH must see the first PATCH's marks and extend them (200)."""
    import data_store  # noqa: PLC0415

    _seed_listing(data_store, "abc")

    first = client.patch("/api/entry/abc/checklist-item", json={"key": "s14_01", "state": "flag"})
    assert first.status_code == 200

    second = client.patch("/api/entry/abc/checklist-item", json={"key": "s16_02", "state": "ok"})
    assert second.status_code == 200
    marks = second.json()["user_marks"]
    # Both the first PATCH's key and the second's must be present in the response.
    assert marks["s14_01"]["state"] == "flag"
    assert marks["s16_02"]["state"] == "ok"
