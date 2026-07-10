"""Integration tests for the Phase 6 viewing-workflow POST endpoints.

Function names are the source of truth per 06-VALIDATION.md § Per-Task Verification Map.
Skeletons in this file are filled by subsequent plans:
  - Plan 06-02: test_schedule_viewing_sets_status, test_invalid_iso_returns_400,
                test_z_suffix_parses, test_mark_viewed_flips_status
  - Plan 06-03: test_regenerate_brief
  - Plan 06-04: test_refresh_ku

Fixtures: 'client' and 'tmp_agent_state' from conftest.py — reused verbatim (do not create parallels).
"""

import pytest


def test_schedule_viewing_sets_status(client, tmp_agent_state, monkeypatch):
    """VIEW-01: POST /api/entry/{id}/schedule-viewing sets status=viewing_scheduled + scheduled_at."""
    import data_store  # noqa: PLC0415

    # Seed a properties[] entry with status defaulting to "approved"
    app_data = data_store.load_app_data()
    app_data["properties"].append({"id": "abc", "price": 100000})
    data_store.save_app_data(app_data)

    resp = client.post(
        "/api/entry/abc/schedule-viewing",
        json={"scheduled_at": "2026-08-15T15:00:00+00:00"},
    )
    assert resp.status_code == 200, f"expected 200 got {resp.status_code}: {resp.text}"
    body = resp.json()
    assert body.get("ok") is True

    # Verify state was mutated
    data = data_store.load_app_data()
    entry = next((p for p in data["properties"] if p.get("id") == "abc"), None)
    assert entry is not None
    assert entry["status"] == "viewing_scheduled"
    assert entry["scheduled_at"] == "2026-08-15T15:00:00+00:00"


def test_invalid_iso_returns_400(client, tmp_agent_state):
    """VIEW-01 timezone plumbing: schedule-viewing endpoint rejects malformed ISO with 400."""
    import data_store  # noqa: PLC0415

    # Seed a properties[] entry
    app_data = data_store.load_app_data()
    app_data["properties"].append({"id": "abc", "price": 100000})
    data_store.save_app_data(app_data)

    resp = client.post(
        "/api/entry/abc/schedule-viewing",
        json={"scheduled_at": "not-an-iso-string"},
    )
    assert resp.status_code == 400, f"expected 400 got {resp.status_code}: {resp.text}"

    # Entry status must remain "approved" (unchanged)
    data = data_store.load_app_data()
    entry = next((p for p in data["properties"] if p.get("id") == "abc"), None)
    assert entry is not None
    # setdefault gives "approved" as the default — status must not have changed
    assert entry.get("status", "approved") == "approved"


def test_z_suffix_parses(client, tmp_agent_state):
    """VIEW-01 timezone plumbing: UTC ISO with 'Z' suffix parses correctly on backend."""
    import data_store  # noqa: PLC0415

    # Seed a properties[] entry
    app_data = data_store.load_app_data()
    app_data["properties"].append({"id": "abc", "price": 100000})
    data_store.save_app_data(app_data)

    resp = client.post(
        "/api/entry/abc/schedule-viewing",
        json={"scheduled_at": "2026-08-15T15:00:00Z"},
    )
    assert resp.status_code == 200, f"expected 200 got {resp.status_code}: {resp.text}"

    # scheduled_at is stored verbatim (backend validates but doesn't rewrite)
    data = data_store.load_app_data()
    entry = next((p for p in data["properties"] if p.get("id") == "abc"), None)
    assert entry is not None
    assert entry["scheduled_at"] == "2026-08-15T15:00:00Z"


def test_mark_viewed_flips_status(client, tmp_agent_state):
    """VIEW-01: POST /api/entry/{id}/mark-viewed flips status to 'viewed'."""
    import data_store  # noqa: PLC0415

    # Seed a viewing_scheduled entry with a past scheduled_at
    app_data = data_store.load_app_data()
    app_data["properties"].append({
        "id": "abc",
        "price": 100000,
        "status": "viewing_scheduled",
        "scheduled_at": "2026-01-01T00:00:00+00:00",
    })
    data_store.save_app_data(app_data)

    resp = client.post("/api/entry/abc/mark-viewed")
    assert resp.status_code == 200, f"expected 200 got {resp.status_code}: {resp.text}"
    body = resp.json()
    assert body.get("ok") is True

    data = data_store.load_app_data()
    entry = next((p for p in data["properties"] if p.get("id") == "abc"), None)
    assert entry is not None
    assert entry["status"] == "viewed"

    # viewing_history must contain a "viewed" action (D-04 append-only log)
    history = entry.get("viewing_history", [])
    assert any(h.get("action") == "viewed" for h in history)

    # Invalid transition: status="approved" → mark-viewed should return 400
    app_data2 = data_store.load_app_data()
    app_data2["properties"].append({
        "id": "def",
        "price": 100000,
        "status": "approved",
    })
    data_store.save_app_data(app_data2)

    resp2 = client.post("/api/entry/def/mark-viewed")
    assert resp2.status_code == 400, f"expected 400 got {resp2.status_code}: {resp2.text}"


def test_regenerate_brief(client, tmp_agent_state, monkeypatch):
    """VIEW-03: POST /api/entry/{id}/regenerate-brief triggers generation + updates entry."""
    import data_store  # noqa: PLC0415
    import brief_generator  # noqa: PLC0415

    # Seed a properties[] entry with status=viewing_scheduled
    app_data = data_store.load_app_data()
    app_data["properties"].append({
        "id": "abc",
        "price": 175000,
        "status": "viewing_scheduled",
        "scheduled_at": "2026-08-01T14:00:00Z",
    })
    data_store.save_app_data(app_data)

    # Monkeypatch threading.Thread so the target runs synchronously in the test
    # (avoids race conditions — the daemon thread would race the assertions).
    import threading as threading_mod  # noqa: PLC0415
    import main as main_mod  # noqa: PLC0415

    brief_payload = {
        "brief_ru": "тест",
        "suggested_offer_low_eur": 100,
        "suggested_offer_high_eur": 200,
    }

    class _SyncThread:
        """Fake Thread that runs target synchronously on .start()."""
        def __init__(self, target, args=(), daemon=False):
            self._target = target
            self._args = args

        def start(self):
            self._target(*self._args)

    def _stub_generate(listing_id: str) -> None:
        data_store.save_negotiation_brief(listing_id, brief_payload)

    monkeypatch.setattr(main_mod, "threading", type("T", (), {"Thread": _SyncThread})())
    monkeypatch.setattr(brief_generator, "generate_and_save_brief", _stub_generate)

    # POST regenerate-brief → 200
    resp = client.post("/api/entry/abc/regenerate-brief")
    assert resp.status_code == 200, f"expected 200 got {resp.status_code}: {resp.text}"
    body = resp.json()
    assert body.get("ok") is True

    # Verify brief was saved (synchronous stub ran immediately)
    data = data_store.load_app_data()
    entry = next((p for p in data["properties"] if p.get("id") == "abc"), None)
    assert entry is not None
    assert entry.get("negotiation_brief") is not None
    assert entry["negotiation_brief"].get("brief_ru") == "тест"

    # Also verify 404 for nonexistent listing
    resp2 = client.post("/api/entry/nonexistent/regenerate-brief")
    assert resp2.status_code == 404, f"expected 404 got {resp2.status_code}: {resp2.text}"


def test_refresh_ku(client, tmp_agent_state, monkeypatch):
    """ENRICH-01: POST /api/entry/{id}/refresh-ku triggers KU lookup + updates entry."""
    pytest.skip("Filled by Plan 06-04")
