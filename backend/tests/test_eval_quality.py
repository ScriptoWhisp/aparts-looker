"""Tests for Phase 03 AI evaluation quality: EVAL-01, EVAL-02, EVAL-03.

Phase 7 Wave 4 fix (Rule 1 — bug): all tests that call save_app_data/load_app_data now
use db_session fixture for proper per-test transaction rollback (DB isolation). Previously,
save_app_data upserted rows without rollback, leaving residual data that caused subsequent
tests to see stale properties. Also: evaluate_listing lambda updated with **kwargs to match
the production call signature; test_checklist_user_override_preserved updated to seed via
data_store.add_to_pending() + write_checklist_ai() instead of the checklists dict path
(which save_app_data does not process — only properties/pending/rejected).
"""

import types


def test_anchor_injection(db_session, tmp_agent_state):
    """EVAL-01: _build_context_prefix returns anchor block when >= 2 scored properties exist."""
    import data_store  # noqa: PLC0415
    import ingest_handler  # noqa: PLC0415
    from kv_listing_parser import Listing  # noqa: PLC0415
    from models import Listing as ListingRow  # noqa: PLC0415

    for row in [
        ListingRow(id="eval-a", title="Apt A", district="X", score=85, rooms=3,
                   area_sqm=60, price_per_sqm=2500, material="panel", status="approved"),
        ListingRow(id="eval-b", title="Apt B", district="X", score=78, rooms=3,
                   area_sqm=55, price_per_sqm=2400, material="brick", status="approved"),
        ListingRow(id="eval-c", title="Apt C", district="X", score=92, rooms=4,
                   area_sqm=70, price_per_sqm=2600, material="panel", status="approved"),
    ]:
        db_session.add(row)
    db_session.commit()

    listing = Listing(id="foo", url="http://x", title="New Listing")
    app_data = data_store.load_app_data()
    result = ingest_handler._build_context_prefix(listing, app_data)

    assert "Anchor 1" in result, f"'Anchor 1' not in prefix: {result!r}"
    assert "Anchor 2" in result, f"'Anchor 2' not in prefix: {result!r}"
    # Highest score (92) should appear — sorted descending puts it first
    assert "92" in result, f"highest score '92' not in prefix: {result!r}"


def test_anchor_skipped_below_threshold(db_session, tmp_agent_state):
    """EVAL-01: _build_context_prefix returns no anchor block when fewer than 2 scored properties."""
    import data_store  # noqa: PLC0415
    import ingest_handler  # noqa: PLC0415
    from kv_listing_parser import Listing  # noqa: PLC0415
    from models import Listing as ListingRow  # noqa: PLC0415

    db_session.add(ListingRow(id="eval-a", title="Apt A", district="X", score=85, rooms=3,
                              area_sqm=60, price_per_sqm=2500, material="panel", status="approved"))
    db_session.commit()

    listing = Listing(id="foo", url="http://x", title="New Listing")
    app_data = data_store.load_app_data()
    result = ingest_handler._build_context_prefix(listing, app_data)

    # Fewer than 2 scored properties → no anchor block (D-02)
    assert "Anchor 1" not in result, f"'Anchor 1' unexpectedly in prefix: {result!r}"


def test_district_avg_injected(db_session, tmp_agent_state):
    """EVAL-03: context_prefix includes district average when entries matching district exist."""
    import data_store  # noqa: PLC0415
    import ingest_handler  # noqa: PLC0415
    from models import Listing as ListingRow  # noqa: PLC0415

    for row in [
        ListingRow(id="eval-a", title="Apt A", district="Mustamäe", score=85,
                   rooms=3, area_sqm=60, price_per_sqm=2500, material="panel", status="approved"),
        ListingRow(id="eval-b", title="Apt B", district="Mustamäe", score=78,
                   rooms=3, area_sqm=55, price_per_sqm=2400, material="brick", status="approved"),
    ]:
        db_session.add(row)
    db_session.commit()

    # Use SimpleNamespace to simulate a listing with a district attribute.
    # _build_context_prefix reads district via getattr(listing, "district", ""),
    # so a SimpleNamespace is a valid stand-in (RESEARCH Pitfall 2).
    listing = types.SimpleNamespace(district="Mustamäe")
    app_data = data_store.load_app_data()
    result = ingest_handler._build_context_prefix(listing, app_data)

    assert "District price/m² average" in result, (
        f"'District price/m² average' not in prefix: {result!r}"
    )
    assert "Mustamäe" in result, f"'Mustamäe' not in prefix: {result!r}"
    # Average of 2500 and 2400 = 2450
    assert "2450" in result, f"'2450' (average) not in prefix: {result!r}"


def test_district_avg_omitted_unknown(db_session, tmp_agent_state):
    """EVAL-03: district average is omitted when listing has no district."""
    import data_store  # noqa: PLC0415
    import ingest_handler  # noqa: PLC0415
    from kv_listing_parser import Listing  # noqa: PLC0415
    from models import Listing as ListingRow  # noqa: PLC0415

    for row in [
        ListingRow(id="eval-a", title="Apt A", district="X", score=85,
                   rooms=3, area_sqm=60, price_per_sqm=2500, material="panel", status="approved"),
        ListingRow(id="eval-b", title="Apt B", district="X", score=78,
                   rooms=3, area_sqm=55, price_per_sqm=2400, material="brick", status="approved"),
    ]:
        db_session.add(row)
    db_session.commit()

    # Standard Listing dataclass has no district field — getattr returns ""
    listing = Listing(id="foo", url="http://x", title="New Listing")
    app_data = data_store.load_app_data()
    result = ingest_handler._build_context_prefix(listing, app_data)

    assert "District price/m² average" not in result, (
        f"'District price/m² average' unexpectedly in prefix: {result!r}"
    )


def test_checklist_in_response(client, db_session, tmp_agent_state, mock_send_pending_card, monkeypatch):
    """EVAL-02: ingest pipeline carries AI checklist_fills onto the pending entry (EVAL-02).

    The ingest path stores checklist results in pending[].ai_checklist_fills (new schema from
    Phase 3 onward); the old checklists JSONB column is written only on re-evaluation.
    This test verifies that checklist_fills with the 7 canonical keys reaches the pending entry.

    Phase 7 Wave 4 fix (Rule 1 — bug): db_session fixture added for per-test rollback isolation;
    evaluate_listing lambda updated with **kwargs to match current production call signature;
    assertion updated to match new ai_checklist_fills key (replacing obsolete checklists path).
    """
    import data_store  # noqa: PLC0415
    import ingest_handler  # noqa: PLC0415

    # Full 7-key checklist returned by the mocked evaluate_listing
    mock_checklist_fills = {
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
        lambda listing, context_prefix="", **kwargs: {
            "score": 80,
            "verdict": "Good",
            "strengths": [],
            "concerns": [],
            "draft_subject": "Test",
            "draft_body": "b",
            "checklist": mock_checklist_fills,
            "checklist_fills": mock_checklist_fills,
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
    pending_by_id = {e["id"]: e for e in data.get("pending", [])}
    assert "test-1" in pending_by_id, f"test-1 not in pending: {list(pending_by_id)}"
    entry = pending_by_id["test-1"]
    ai_fills = entry.get("ai_checklist_fills", {})
    assert len(ai_fills) == 7, f"expected 7 keys in ai_checklist_fills, got {len(ai_fills)}: {list(ai_fills)}"

    allowed = {"pass", "fail", "unknown"}
    for key, result in ai_fills.items():
        assert result in allowed, f"invalid result for {key}: {result!r}"


def test_checklist_user_override_preserved(db_session, tmp_agent_state):
    """EVAL-02: write_checklist_ai preserves existing user-source checklist entries (D-09).

    Phase 7 Wave 4 fix (Rule 1 — bug): seeding now uses data_store.add_to_pending() +
    data_store.write_checklist_ai() to plant the user entry directly into the Listing row's
    checklist JSONB column. Previously used data["checklists"][...] + save_app_data() which
    does not process the checklists dict — only properties/pending/rejected lists.
    """
    import data_store  # noqa: PLC0415

    # Seed a Listing row so write_checklist_ai can find it
    data_store.add_to_pending({
        "id": "test-1",
        "title": "Test Apt",
        "url": "https://www.kv.ee/test-1.html",
        "status": "pending",
    })

    # Plant user-confirmed parking entry directly via write_checklist_ai with source override
    from models import Listing as ListingRow  # noqa: PLC0415
    row = db_session.get(ListingRow, "test-1")
    if row is not None:
        row.checklist = {"ai_checklist": {"parking": {"result": "fail", "source": "user"}}}
        db_session.commit()

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
