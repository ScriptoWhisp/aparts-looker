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


def test_ingest_batch(client, tmp_agent_state, monkeypatch):
    """POST /api/ingest processes a single valid Listing dict (ARCH-03, VALIDATION 1-02-03).

    evaluate_listing is mocked so this test does not make real Anthropic API calls.
    Phase 2: confirms the listing lands in app_data pending[] (not properties[]).
    """
    import json  # noqa: PLC0415
    import ingest_handler  # noqa: PLC0415

    monkeypatch.setattr(
        ingest_handler,
        "evaluate_listing",
        lambda listing, context_prefix="": {
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
    app_data_file = tmp_agent_state / "app_data.json"
    app_data = json.loads(app_data_file.read_text()) if app_data_file.exists() else {}
    pending_ids = [e.get("id") for e in app_data.get("pending", [])]
    assert "test-1" in pending_ids, f"Listing not in pending[]: {pending_ids}"
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
