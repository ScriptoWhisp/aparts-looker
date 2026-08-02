"""
Integration tests for POST /api/ingest and related ARCH-02/ARCH-03 behaviors.

Coverage:
  - ARCH-02: token authentication (missing, wrong, valid)
  - ARCH-03: ingest_handler has no playwright / kv_alert_reader / kv_scraper imports
  - ARCH-03: batch of one Listing dict is processed end-to-end (evaluate_listing mocked)
"""

import ast


def test_missing_auth(client):
    """POST /api/ingest with no Authorization header returns 403 (ARCH-02, VALIDATION 1-02-01)."""
    resp = client.post("/api/ingest", json=[])
    assert resp.status_code == 403


def test_wrong_token(client):
    """POST /api/ingest with wrong Bearer token returns 403 (ARCH-02, VALIDATION 1-02-02)."""
    resp = client.post("/api/ingest", json=[], headers={"Authorization": "Bearer wrong-token"})
    assert resp.status_code == 403


def test_ingest_batch(client, db_session, tmp_agent_state, monkeypatch):
    """POST /api/ingest processes a single valid Listing dict (ARCH-03, VALIDATION 1-02-03).

    evaluate_listing is mocked so this test does not make real Anthropic API calls.
    Phase 2: confirms the listing lands in pending[] (not properties[]).

    Phase 7 Wave 4 fix (Rule 1 — bug): mock lambda updated to accept **kwargs matching
    the production call signature (commute_minutes, district, cost_of_ownership). The
    assertion now reads from the DB via data_store.load_pending() since app_data.json
    is no longer the source of truth after Wave 2 (DB migration).
    """
    import data_store as ds  # noqa: PLC0415
    import ingest_handler  # noqa: PLC0415

    monkeypatch.setattr(
        ingest_handler,
        "evaluate_listing",
        lambda listing, context_prefix="", **kwargs: {
            "score": 80,
            "verdict": "Good listing",
            "strengths": ["Good price"],
            "concerns": [],
            "draft_body": "Dear agent,",
            "should_draft_email": False,
        },
    )

    listing_payload = [
        {
            "id": "test-1",
            "url": "https://www.kv.ee/test-1.html",
            "title": "Test Apartment",
            "price_eur": 200000,
            "rooms": 3,
            "area_sqm": 60.0,
            "image_count": 10,
            "raw_ok": True,
        }
    ]

    resp = client.post(
        "/api/ingest",
        json=listing_payload,
        headers={"Authorization": "Bearer test-token-abc"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body.get("ok") is True

    # Phase 2 (QUEUE-01): listing lands in pending[], NOT in properties[].
    # Phase 7 Wave 4: read from DB via data_store.load_pending() (no longer a JSON file).
    pending = ds.load_pending()
    pending_ids = [e.get("id") for e in pending]
    assert "test-1" in pending_ids, f"Listing not in pending[]: {pending_ids}"
    app_data = ds.load_app_data()
    assert "test-1" not in [e.get("id") for e in app_data.get("properties", [])]


def test_no_playwright_import():
    """ingest_handler.py must not import playwright, kv_alert_reader, or kv_scraper (ARCH-03).

    Uses static AST analysis so this passes even if playwright is not installed.
    """
    import os  # noqa: PLC0415

    # Resolve path relative to this test file's location.
    ingest_path = os.path.join(os.path.dirname(__file__), "..", "ingest_handler.py")
    ingest_path = os.path.abspath(ingest_path)

    source = open(ingest_path).read()
    tree = ast.parse(source)

    imported_modules = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                imported_modules.add(alias.name)
        elif isinstance(node, ast.ImportFrom):
            if node.module:
                imported_modules.add(node.module)

    forbidden = {"playwright", "kv_alert_reader", "kv_scraper"}
    violations = forbidden & imported_modules
    assert not violations, (
        f"ingest_handler.py must not import: {', '.join(sorted(violations))}. "
        "VPS-side scraping was removed in Phase 1 (D-08 / ARCH-03)."
    )
