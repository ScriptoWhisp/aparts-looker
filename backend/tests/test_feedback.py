"""Tests for the /api/feedback endpoints (POST, GET list, GET one, GET screenshot,
PATCH, DELETE).

Covers the acceptance list from the feedback-system spec:
  - POST valid feedback (bug type) → 200 with id
  - POST without screenshot → 200 (screenshot optional)
  - POST with 3MB screenshot → 413 (reject oversize)
  - POST invalid type → 422
  - POST empty comment → 422
  - GET list → empty on fresh DB, populated after POST
  - GET filter by status/type
  - GET /{id} → returns fields with has_screenshot
  - GET /{id}/screenshot → PNG bytes, correct Content-Type
  - GET missing id → 404
  - PATCH status → persists
  - PATCH updates updated_at
  - DELETE → removes and subsequent GET returns 404
"""

import json

import pytest

_PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"0" * 100  # tiny fake PNG, well under 2MB


def _post_feedback(client, **overrides):
    data = {
        "type": overrides.get("type", "bug"),
        "comment": overrides.get("comment", "Something is broken on the shortlist tab"),
        "url": overrides.get("url", "http://127.0.0.1:8000/#shortlist"),
        "viewport": overrides.get("viewport", "375x812"),
        "user_agent": overrides.get("user_agent", "Mozilla/5.0 (test)"),
        "console_logs": overrides.get(
            "console_logs",
            json.dumps([{"ts": "2026-08-08T10:00:00Z", "level": "error", "args": ["boom"]}]),
        ),
    }
    files = overrides.get("files", {"screenshot": ("shot.png", _PNG_BYTES, "image/png")})
    if files is None:
        return client.post("/api/feedback", data=data)
    return client.post("/api/feedback", data=data, files=files)


# ---------------------------------------------------------------------------
# POST
# ---------------------------------------------------------------------------

def test_post_valid_bug_feedback_returns_id(db_session, client):
    resp = _post_feedback(client, type="bug")
    assert resp.status_code == 200, f"expected 200 got {resp.status_code}: {resp.text}"
    body = resp.json()
    assert "id" in body and body["id"]
    assert "created_at" in body and body["created_at"]


def test_post_without_screenshot_succeeds(db_session, client):
    resp = _post_feedback(client, files=None)
    assert resp.status_code == 200, f"expected 200 got {resp.status_code}: {resp.text}"


def test_post_oversize_screenshot_rejected(db_session, client):
    big = b"0" * (3 * 1024 * 1024)  # 3 MB
    resp = _post_feedback(client, files={"screenshot": ("big.png", big, "image/png")})
    assert resp.status_code == 413, f"expected 413 got {resp.status_code}: {resp.text}"


def test_post_invalid_type_rejected(db_session, client):
    resp = _post_feedback(client, type="not-a-real-type")
    assert resp.status_code == 422, f"expected 422 got {resp.status_code}: {resp.text}"


def test_post_empty_comment_rejected(db_session, client):
    resp = _post_feedback(client, comment="   ")
    assert resp.status_code == 422, f"expected 422 got {resp.status_code}: {resp.text}"


# ---------------------------------------------------------------------------
# GET list
# ---------------------------------------------------------------------------

def test_list_empty_on_fresh_db(db_session, client):
    resp = client.get("/api/feedback")
    assert resp.status_code == 200
    body = resp.json()
    assert body["feedback"] == []
    assert body["count"] == 0


def test_list_populated_after_post(db_session, client):
    _post_feedback(client, type="bug")
    _post_feedback(client, type="feature")

    resp = client.get("/api/feedback")
    assert resp.status_code == 200
    body = resp.json()
    assert body["count"] == 2
    assert len(body["feedback"]) == 2


def test_list_filter_by_status(db_session, client):
    created = _post_feedback(client, type="bug").json()
    fid = created["id"]
    client.patch(f"/api/feedback/{fid}", json={"status": "fixed"})
    _post_feedback(client, type="feature")  # stays 'open'

    resp = client.get("/api/feedback", params={"status": "fixed"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["count"] == 1
    assert body["feedback"][0]["id"] == fid


def test_list_filter_by_type(db_session, client):
    _post_feedback(client, type="bug")
    _post_feedback(client, type="ux")

    resp = client.get("/api/feedback", params={"type": "ux"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["count"] == 1
    assert body["feedback"][0]["type"] == "ux"


# ---------------------------------------------------------------------------
# GET one / screenshot / 404
# ---------------------------------------------------------------------------

def test_get_one_returns_has_screenshot_flag(db_session, client):
    created = _post_feedback(client).json()
    fid = created["id"]

    resp = client.get(f"/api/feedback/{fid}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["id"] == fid
    assert body["has_screenshot"] is True
    assert body["type"] == "bug"
    assert body["status"] == "open"


def test_get_one_without_screenshot_has_screenshot_false(db_session, client):
    created = _post_feedback(client, files=None).json()
    fid = created["id"]

    resp = client.get(f"/api/feedback/{fid}")
    assert resp.status_code == 200
    assert resp.json()["has_screenshot"] is False


def test_get_screenshot_returns_png_bytes(db_session, client):
    created = _post_feedback(client).json()
    fid = created["id"]

    resp = client.get(f"/api/feedback/{fid}/screenshot")
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("image/png")
    assert resp.content == _PNG_BYTES


def test_get_screenshot_404_when_none_stored(db_session, client):
    created = _post_feedback(client, files=None).json()
    fid = created["id"]

    resp = client.get(f"/api/feedback/{fid}/screenshot")
    assert resp.status_code == 404


def test_get_missing_id_returns_404(db_session, client):
    resp = client.get("/api/feedback/00000000-0000-0000-0000-000000000000")
    assert resp.status_code == 404


def test_get_malformed_id_returns_404(db_session, client):
    resp = client.get("/api/feedback/not-a-uuid")
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# PATCH
# ---------------------------------------------------------------------------

def test_patch_status_persists(db_session, client):
    created = _post_feedback(client).json()
    fid = created["id"]

    resp = client.patch(f"/api/feedback/{fid}", json={"status": "in_progress"})
    assert resp.status_code == 200, f"expected 200 got {resp.status_code}: {resp.text}"
    assert resp.json()["status"] == "in_progress"

    refetch = client.get(f"/api/feedback/{fid}")
    assert refetch.json()["status"] == "in_progress"


def test_patch_updates_updated_at(db_session, client):
    created = _post_feedback(client).json()
    fid = created["id"]
    original = client.get(f"/api/feedback/{fid}").json()["updated_at"]

    resp = client.patch(f"/api/feedback/{fid}", json={"comment": "Updated comment text"})
    assert resp.status_code == 200
    assert resp.json()["updated_at"] != original
    assert resp.json()["comment"] == "Updated comment text"


def test_patch_invalid_status_rejected(db_session, client):
    created = _post_feedback(client).json()
    fid = created["id"]
    resp = client.patch(f"/api/feedback/{fid}", json={"status": "not-a-status"})
    assert resp.status_code == 422


def test_patch_missing_id_returns_404(db_session, client):
    resp = client.patch(
        "/api/feedback/00000000-0000-0000-0000-000000000000",
        json={"status": "fixed"},
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# DELETE
# ---------------------------------------------------------------------------

def test_delete_removes_and_subsequent_get_404s(db_session, client):
    created = _post_feedback(client).json()
    fid = created["id"]

    resp = client.delete(f"/api/feedback/{fid}")
    assert resp.status_code == 200
    assert resp.json()["ok"] is True

    refetch = client.get(f"/api/feedback/{fid}")
    assert refetch.status_code == 404


def test_delete_missing_id_returns_404(db_session, client):
    resp = client.delete("/api/feedback/00000000-0000-0000-0000-000000000000")
    assert resp.status_code == 404
