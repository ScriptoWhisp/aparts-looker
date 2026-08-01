"""Integration tests for the Phase 6 viewing-workflow POST endpoints.

Phase 7 Wave 2 port notes:
- Tests that touch data_store now request db_session for DB isolation.
- JSON seeding via `app_data["properties"].append(...)` + `save_app_data(...)` now
  routes through the DB shim — no JSON file is written; the DB fixture intercepts.
- `with data_store._lock:` inside `_pending_to_property` is a no-op nullcontext
  in Wave 2; callers that use the pattern keep working syntactically.
- Entries seeded via legacy `price`/`area` keys now need the canonical `price_eur`/
  `area_sqm` keys (or the shim alias) so the DB upsert populates the right columns.

Function names are the source of truth per 06-VALIDATION.md § Per-Task Verification Map.
"""

import pytest


def test_schedule_viewing_sets_status(db_session, client, tmp_agent_state, monkeypatch):
    """VIEW-01: POST /api/entry/{id}/schedule-viewing sets status=viewing_scheduled + scheduled_at."""
    import data_store  # noqa: PLC0415

    # Seed a properties[] entry with status defaulting to "approved"
    app_data = data_store.load_app_data()
    app_data["properties"].append({"id": "abc", "price_eur": 100000, "status": "approved"})
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


def test_invalid_iso_returns_400(db_session, client, tmp_agent_state):
    """VIEW-01 timezone plumbing: schedule-viewing endpoint rejects malformed ISO with 400."""
    import data_store  # noqa: PLC0415

    # Seed a properties[] entry
    app_data = data_store.load_app_data()
    app_data["properties"].append({"id": "abc", "price_eur": 100000, "status": "approved"})
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
    assert entry.get("status", "approved") == "approved"


def test_z_suffix_parses(db_session, client, tmp_agent_state):
    """VIEW-01 timezone plumbing: UTC ISO with 'Z' suffix parses correctly on backend."""
    import data_store  # noqa: PLC0415

    # Seed a properties[] entry
    app_data = data_store.load_app_data()
    app_data["properties"].append({"id": "abc", "price_eur": 100000, "status": "approved"})
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


def test_mark_viewed_flips_status(db_session, client, tmp_agent_state):
    """VIEW-01: POST /api/entry/{id}/mark-viewed flips status to 'viewed'."""
    import data_store  # noqa: PLC0415

    # Seed a viewing_scheduled entry with a past scheduled_at
    app_data = data_store.load_app_data()
    app_data["properties"].append({
        "id": "abc",
        "price_eur": 100000,
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
        "price_eur": 100000,
        "status": "approved",
    })
    data_store.save_app_data(app_data2)

    resp2 = client.post("/api/entry/def/mark-viewed")
    assert resp2.status_code == 400, f"expected 400 got {resp2.status_code}: {resp2.text}"


def test_regenerate_brief(db_session, client, tmp_agent_state, monkeypatch):
    """VIEW-03: POST /api/entry/{id}/regenerate-brief triggers generation + updates entry."""
    import data_store  # noqa: PLC0415
    import brief_generator  # noqa: PLC0415

    # Seed a properties[] entry with status=viewing_scheduled
    app_data = data_store.load_app_data()
    app_data["properties"].append({
        "id": "abc",
        "price_eur": 175000,
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


def test_refresh_ku(db_session, client, tmp_agent_state, monkeypatch):
    """ENRICH-01: POST /api/entry/{id}/refresh-ku triggers KU lookup + updates entry."""
    import data_store  # noqa: PLC0415
    import ingest_handler  # noqa: PLC0415
    import main as main_mod  # noqa: PLC0415

    # Seed a properties[] entry with address so refresh-ku can dispatch
    app_data = data_store.load_app_data()
    app_data["properties"].append({
        "id": "abc",
        "price_eur": 175000,
        "address": "Retke tee 22, Tallinn",
        "status": "approved",
    })
    data_store.save_app_data(app_data)

    ku_result = {
        "reg_code": 80499321,
        "name": "KÜ Test",
        "legal_address": "Retke tee 22, Tallinn",
        "url": "https://ariregister.rik.ee/est/company/80499321",
    }

    # Monkeypatch threading.Thread to run the target synchronously in-process
    # (avoids race conditions between daemon thread and assertions).
    class _SyncThread:
        """Fake Thread that runs target synchronously on .start()."""
        def __init__(self, target, args=(), daemon=False, **kw):
            self._target = target
            self._args = args

        def start(self):
            self._target(*self._args)

    # Stub _dispatch_ku_lookup to call save_ku_enrichment synchronously
    def _stub_dispatch(listing_id: str, address: str) -> None:
        data_store.save_ku_enrichment(listing_id, ku_result)

    monkeypatch.setattr(main_mod, "threading", type("T", (), {"Thread": _SyncThread})())
    monkeypatch.setattr(ingest_handler, "_dispatch_ku_lookup", _stub_dispatch)

    # POST refresh-ku → 200
    resp = client.post("/api/entry/abc/refresh-ku")
    assert resp.status_code == 200, f"expected 200 got {resp.status_code}: {resp.text}"
    body = resp.json()
    assert body.get("ok") is True

    # Verify KÜ enrichment was saved (synchronous stub ran immediately)
    data = data_store.load_app_data()
    entry = next((p for p in data["properties"] if p.get("id") == "abc"), None)
    assert entry is not None
    assert entry.get("ku") is not None, "ku field should be set after refresh"
    assert entry["ku"]["auto"]["reg_code"] == 80499321
    assert entry["ku"].get("looked_at") is not None or entry["ku"].get("looked_up_at") is not None

    # 404 for nonexistent listing
    resp2 = client.post("/api/entry/nonexistent/refresh-ku")
    assert resp2.status_code == 404, f"expected 404 got {resp2.status_code}: {resp2.text}"

    # 400 for listing without an address
    app_data2 = data_store.load_app_data()
    app_data2["properties"].append({"id": "noaddr", "price_eur": 100000, "address": "", "status": "approved"})
    data_store.save_app_data(app_data2)
    resp3 = client.post("/api/entry/noaddr/refresh-ku")
    assert resp3.status_code == 400, f"expected 400 got {resp3.status_code}: {resp3.text}"
