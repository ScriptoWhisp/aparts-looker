"""Tests for Phase 03 AI evaluation quality: EVAL-01, EVAL-02, EVAL-03."""

import pytest


@pytest.mark.xfail(reason="Wave 0 stub — not yet implemented", strict=True)
def test_anchor_injection(tmp_agent_state, monkeypatch):
    """EVAL-01: evaluate_listing receives context_prefix containing anchor block when >= 2 scored properties exist."""
    pytest.fail("not implemented")


@pytest.mark.xfail(reason="Wave 0 stub — not yet implemented", strict=True)
def test_anchor_skipped_below_threshold(tmp_agent_state, monkeypatch):
    """EVAL-01: evaluate_listing receives empty context_prefix when fewer than 2 scored properties exist."""
    pytest.fail("not implemented")


@pytest.mark.xfail(reason="Wave 0 stub — not yet implemented", strict=True)
def test_district_avg_injected(tmp_agent_state, monkeypatch):
    """EVAL-03: context_prefix includes district average line when entries matching listing district exist."""
    pytest.fail("not implemented")


@pytest.mark.xfail(reason="Wave 0 stub — not yet implemented", strict=True)
def test_district_avg_omitted_unknown(tmp_agent_state, monkeypatch):
    """EVAL-03: district average line is omitted when listing has no district or no matching entries."""
    pytest.fail("not implemented")


def test_checklist_in_response(client, tmp_agent_state, mock_send_pending_card, monkeypatch):
    """EVAL-02: ingest pipeline writes AI checklist with all 7 canonical keys and source==ai to app_data."""
    import data_store  # noqa: PLC0415
    import ingest_handler  # noqa: PLC0415

    # Full 7-key checklist returned by the mocked evaluate_listing
    mock_checklist = {
        "price_per_sqm": "pass",
        "rooms_area": "pass",
        "parking": "unknown",
        "renovation_potential": "unknown",
        "floor": "pass",
        "year_material": "pass",
        "mandatory_extras": "unknown",
    }

    monkeypatch.setattr(
        ingest_handler,
        "evaluate_listing",
        lambda listing, context_prefix="": {
            "score": 80,
            "verdict": "Good",
            "strengths": [],
            "concerns": [],
            "draft_subject": "Test",
            "draft_body": "b",
            "checklist": mock_checklist,
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

    data = data_store.load_app_data()
    assert "test-1" in data["checklists"], "checklists key missing for test-1"
    ai_checklist = data["checklists"]["test-1"].get("ai_checklist", {})
    assert len(ai_checklist) == 7, f"expected 7 keys, got {len(ai_checklist)}: {list(ai_checklist)}"

    allowed = {"pass", "fail", "unknown"}
    for key, entry in ai_checklist.items():
        assert isinstance(entry, dict), f"entry for {key} is not a dict: {entry!r}"
        assert "result" in entry, f"entry for {key} missing 'result'"
        assert entry["result"] in allowed, f"invalid result for {key}: {entry['result']!r}"
        assert entry.get("source") == "ai", f"expected source=='ai' for {key}, got {entry.get('source')!r}"


def test_checklist_user_override_preserved(tmp_agent_state):
    """EVAL-02: write_checklist_ai preserves existing user-source checklist entries (D-09)."""
    import data_store  # noqa: PLC0415

    # Seed a user-confirmed entry for parking
    with data_store._lock:
        data = data_store.load_app_data()
        data["checklists"]["test-1"] = {
            "ai_checklist": {"parking": {"result": "fail", "source": "user"}}
        }
        data_store.save_app_data(data)

    # Now AI re-evaluates and returns parking=pass along with the other 6 keys
    data_store.write_checklist_ai("test-1", {
        "parking": "pass",
        "floor": "pass",
        "price_per_sqm": "unknown",
        "rooms_area": "pass",
        "renovation_potential": "unknown",
        "year_material": "pass",
        "mandatory_extras": "unknown",
    })

    data = data_store.load_app_data()
    ai_checklist = data["checklists"]["test-1"]["ai_checklist"]

    # User entry for parking must be preserved unchanged
    assert ai_checklist["parking"] == {"result": "fail", "source": "user"}, (
        f"user parking entry was overwritten: {ai_checklist['parking']!r}"
    )
    # floor entry should have been written by AI
    assert ai_checklist["floor"] == {"result": "pass", "source": "ai"}, (
        f"floor entry incorrect: {ai_checklist['floor']!r}"
    )
