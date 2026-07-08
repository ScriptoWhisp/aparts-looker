"""Tests for Phase 02 pending queue: QUEUE-01 through QUEUE-07."""

import pytest


def test_ingest_writes_to_pending(client, tmp_agent_state, mock_send_pending_card, monkeypatch):
    """QUEUE-01: ingest batch writes to pending[], not properties[] (VALIDATION 2-01-01)."""
    import re  # noqa: PLC0415

    import data_store  # noqa: PLC0415
    import ingest_handler  # noqa: PLC0415

    monkeypatch.setattr(
        ingest_handler,
        "evaluate_listing",
        lambda listing: {
            "score": 80,
            "verdict": "Good",
            "strengths": [],
            "concerns": [],
            "draft_subject": "Test",
            "draft_body": "body",
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
    assert len(data["pending"]) == 1
    assert data["pending"][0]["id"] == "test-1"
    assert data["pending"][0]["score"] == 80
    assert data["pending"][0]["draft_body"] == "body"
    assert re.match(r"^\d{4}-\d{2}-\d{2}T", data["pending"][0]["queued_at"])
    # properties[] must not contain the new listing (QUEUE-01 invariant)
    assert not any(p.get("id") == "test-1" for p in data["properties"])


def test_data_model_keys(tmp_agent_state):
    """QUEUE-01: DEFAULT_APP_DATA includes pending[] and rejected[] (D-01, VALIDATION 2-01-02)."""
    import data_store  # noqa: PLC0415

    data = data_store.load_app_data()
    assert "pending" in data
    assert "rejected" in data
    assert data["pending"] == []
    assert data["rejected"] == []
    assert "properties" in data
    assert "checklists" in data
    assert "settings" in data


def test_send_pending_card_buttons(monkeypatch):
    """QUEUE-02: send_pending_card sends sendPhoto with a 3-button inline keyboard."""
    from unittest.mock import MagicMock  # noqa: PLC0415

    import telegram_client  # noqa: PLC0415
    from kv_listing_parser import Listing  # noqa: PLC0415

    # Mock requests.post to capture the Telegram API call
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {"result": {"message_id": 42, "chat": {"id": -100}}}
    mock_post = MagicMock(return_value=mock_response)
    monkeypatch.setattr(telegram_client.requests, "post", mock_post)

    # Patch TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID so guard passes
    monkeypatch.setattr(telegram_client, "TELEGRAM_BOT_TOKEN", "test-bot-token")
    monkeypatch.setattr(telegram_client, "TELEGRAM_CHAT_ID", "-100")

    listing = Listing(
        id="1234567",
        url="https://kv.ee/1234567.html",
        title="Test Apartment",
        image_url="https://img/x.jpg",
    )
    result = telegram_client.send_pending_card(listing, {"score": 82, "verdict": "Good"})

    # Verify the call was to sendPhoto (listing has image_url)
    assert mock_post.called
    call_url = mock_post.call_args[0][0]
    assert call_url.endswith("/sendPhoto")

    # Verify the inline keyboard structure
    call_json = mock_post.call_args[1]["json"]
    keyboard = call_json["reply_markup"]["inline_keyboard"]
    assert len(keyboard) == 1  # one row
    row = keyboard[0]
    assert len(row) == 3  # three buttons

    assert row[0]["text"] == "Approve"
    assert row[0]["callback_data"] == "approve:1234567"
    assert row[1]["text"] == "Reject"
    assert row[1]["callback_data"] == "reject:1234567"
    assert row[2]["text"] == "More"
    assert row[2]["url"].startswith("https://")
    assert "1234567" in row[2]["url"]

    # Verify return value (message_id, chat_id)
    assert result == (42, -100)


@pytest.mark.xfail(reason="pending Phase 2 plan 02 implementation", strict=False)
def test_callback_query_parse_approve():
    assert False


@pytest.mark.xfail(reason="pending Phase 2 plan 02 implementation", strict=False)
def test_callback_query_parse_reason():
    assert False


@pytest.mark.xfail(reason="pending Phase 2 plan 03 implementation", strict=False)
def test_get_pending_endpoint():
    assert False


@pytest.mark.xfail(reason="pending Phase 2 plan 03 implementation", strict=False)
def test_approve_moves_listing():
    assert False


@pytest.mark.xfail(reason="pending Phase 2 plan 03 implementation", strict=False)
def test_double_approve():
    assert False


@pytest.mark.xfail(reason="pending Phase 2 plan 03 implementation", strict=False)
def test_reject_with_reason():
    assert False


@pytest.mark.xfail(reason="pending Phase 2 plan 04 implementation", strict=False)
def test_draft_endpoint():
    assert False


@pytest.mark.xfail(reason="pending Phase 2 plan 04 implementation", strict=False)
def test_send_command_after_draft():
    assert False
