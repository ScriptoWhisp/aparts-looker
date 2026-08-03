"""Tests for Phase 02 pending queue: QUEUE-01 through QUEUE-07.

Phase 7 Wave 2 port notes:
- Tests that touch data_store now request db_session for DB isolation.
- Tests using `client` (which depends on tmp_agent_state) also add db_session
  so the DB backing store is active alongside the agent_state.json temp redirect.
- `with data_store._lock:` blocks still parse and execute (no-op nullcontext).
- `_seed_pending` now uses data_store.save_app_data via the DB shim instead of
  writing JSON directly, so the DB fixture intercepts the writes correctly.
- test_send_pending_card_buttons: Wave 6B — asserts notifier-only layout
  (Open Inbox + kv.ee; no Approve/Reject callback_data buttons).
- test_callback_query_* tests removed (Wave 6B — no callback processing).
"""

import pytest


def test_ingest_writes_to_pending(db_session, client, tmp_agent_state, mock_send_pending_card, monkeypatch):
    """QUEUE-01: ingest batch writes to pending[], not properties[] (VALIDATION 2-01-01)."""
    import re  # noqa: PLC0415

    import data_store  # noqa: PLC0415
    import ingest_handler  # noqa: PLC0415

    monkeypatch.setattr(
        ingest_handler,
        "evaluate_listing",
        lambda listing, context_prefix="", **_kwargs: {
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


def test_data_model_keys(db_session):
    """QUEUE-01: load_app_data includes pending[], rejected[], properties[], checklists[], settings[].

    (D-01, VALIDATION 2-01-02) — DB backend returns correct top-level keys.
    """
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
    """QUEUE-02 (Wave 6B): send_pending_card is notifier-only — no Approve/Reject buttons.

    Photo tier must send sendPhoto with:
    - row[0]: {"text": "Open Inbox", "url": <inbox_url>}   — tap-through to web triage
    - row[1]: {"text": "kv.ee", "url": <listing_url>}      — direct listing link

    No callback_data keys anywhere in the keyboard (triage happens in the web app).
    """
    from unittest.mock import MagicMock  # noqa: PLC0415

    import config as cfg  # noqa: PLC0415
    import telegram_client  # noqa: PLC0415
    from kv_listing_parser import Listing  # noqa: PLC0415

    # Mock requests.post to capture the Telegram API call
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {"result": {"message_id": 42, "chat": {"id": -100}}}
    mock_post = MagicMock(return_value=mock_response)
    monkeypatch.setattr(telegram_client.requests, "post", mock_post)

    # Patch token/chat-id guards so the send path is exercised
    monkeypatch.setattr(telegram_client, "TELEGRAM_BOT_TOKEN", "test-bot-token")
    monkeypatch.setattr(telegram_client, "TELEGRAM_CHAT_ID", "-100")

    # Provide a WEB_BASE_URL so the Inbox deep-link is included
    monkeypatch.setattr(cfg, "WEB_BASE_URL", "https://aparts.example.com")

    listing = Listing(
        id="1234567",
        url="https://kv.ee/1234567.html",
        title="Test Apartment",
        image_url="https://img/x.jpg",
    )
    result = telegram_client.send_pending_card(listing, {"score": 82, "verdict": "Good"})

    # Call was to sendPhoto (listing has image_url, score >= photo threshold)
    assert mock_post.called
    call_url = mock_post.call_args[0][0]
    assert call_url.endswith("/sendPhoto")

    # Keyboard: one row, exactly 2 buttons — "Open Inbox" + "kv.ee"
    call_json = mock_post.call_args[1]["json"]
    keyboard = call_json["reply_markup"]["inline_keyboard"]
    assert len(keyboard) == 1  # one row
    row = keyboard[0]
    assert len(row) == 2  # two buttons: Open Inbox + kv.ee

    # First button: deep-link into Inbox
    assert row[0]["text"] == "Open Inbox"
    assert row[0]["url"].endswith("/#inbox")
    assert "callback_data" not in row[0]  # no server-side action

    # Second button: listing link
    assert row[1]["text"] == "kv.ee"
    assert "1234567" in row[1]["url"]
    assert "callback_data" not in row[1]

    # Return value unchanged
    assert result == (42, -100)


def test_send_pending_card_no_web_base_url(monkeypatch):
    """QUEUE-02b (Wave 6B): when WEB_BASE_URL is unset, card sends without Open Inbox button.

    The keyboard should still have the kv.ee link only.
    """
    from unittest.mock import MagicMock  # noqa: PLC0415

    import config as cfg  # noqa: PLC0415
    import telegram_client  # noqa: PLC0415
    from kv_listing_parser import Listing  # noqa: PLC0415

    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {"result": {"message_id": 1, "chat": {"id": -100}}}
    mock_post = MagicMock(return_value=mock_response)
    monkeypatch.setattr(telegram_client.requests, "post", mock_post)
    monkeypatch.setattr(telegram_client, "TELEGRAM_BOT_TOKEN", "test-bot-token")
    monkeypatch.setattr(telegram_client, "TELEGRAM_CHAT_ID", "-100")
    monkeypatch.setattr(cfg, "WEB_BASE_URL", "")  # no base URL

    listing = Listing(
        id="9999999",
        url="https://kv.ee/9999999.html",
        title="No-URL Listing",
        image_url="https://img/y.jpg",
    )
    telegram_client.send_pending_card(listing, {"score": 82, "verdict": "OK"})

    call_json = mock_post.call_args[1]["json"]
    row = call_json["reply_markup"]["inline_keyboard"][0]
    # Only kv.ee button — no Open Inbox when URL not configured
    assert len(row) == 1
    assert row[0]["text"] == "kv.ee"


def test_stale_callback_answered(monkeypatch):
    """QUEUE-02c (Wave 6B): stale approve/reject callbacks are answered gracefully.

    handle_stale_callback() must call answerCallbackQuery with a user-friendly
    message.  No data_store mutation must occur.
    """
    from unittest.mock import MagicMock  # noqa: PLC0415

    import telegram_client  # noqa: PLC0415

    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {}
    mock_post = MagicMock(return_value=mock_response)
    monkeypatch.setattr(telegram_client.requests, "post", mock_post)
    monkeypatch.setattr(telegram_client, "TELEGRAM_BOT_TOKEN", "test-bot-token")
    monkeypatch.setattr(telegram_client, "TELEGRAM_CHAT_ID", "-100")

    stale_cq = {"id": "old-cq-99", "data": "approve:1234567",
                "message": {"chat": {"id": -100}, "message_id": 5}}
    telegram_client.handle_stale_callback(stale_cq)

    assert mock_post.called
    call_url = mock_post.call_args[0][0]
    assert call_url.endswith("/answerCallbackQuery")
    body = mock_post.call_args[1]["json"]
    assert body["callback_query_id"] == "old-cq-99"
    assert "dashboard" in body["text"].lower() or "inbox" in body["text"].lower()


def _seed_pending(listing_id: str) -> None:
    """Seed a pending entry into data_store via the DB shim (test isolation helper).

    Note: `with data_store._lock:` is a no-op nullcontext in Wave 2 — kept for
    syntactic compatibility with any callers that use the pattern.
    """
    import data_store  # noqa: PLC0415

    with data_store._lock:
        data = data_store.load_app_data()
        data["pending"].append({
            "id": listing_id,
            "url": f"https://kv.ee/{listing_id}.html",
            "title": "Test Listing",
            "price_eur": 200000,
            "area_sqm": 60.0,
            "rooms": 3,
            "price_per_sqm": 3333,
            "year_built": 2010,
            "material": "panel",
            "score": 80,
            "verdict": "Good",
            "strengths": [],
            "concerns": [],
            "draft_body": "body",
            "contact_email": "agent@test.ee",
            "draft_subject": "Test",
            "queued_at": "2026-07-08T00:00:00+00:00",
        })
        data_store.save_app_data(data)


def test_get_pending_endpoint(db_session, client, tmp_agent_state):
    """QUEUE-03: GET /api/pending returns pending[] from data_store."""
    import data_store  # noqa: PLC0415

    _seed_pending("1234567")

    resp = client.get("/api/pending")
    assert resp.status_code == 200
    body = resp.json()
    assert "pending" in body
    assert len(body["pending"]) == 1
    assert body["pending"][0]["id"] == "1234567"


def test_approve_moves_listing(db_session, client, tmp_agent_state):
    """QUEUE-04: POST /api/pending/<id>/approve moves entry to properties[] and returns ok."""
    import data_store  # noqa: PLC0415

    _seed_pending("1234567")

    resp = client.post("/api/pending/1234567/approve")
    assert resp.status_code == 200
    assert resp.json()["ok"] is True

    data = data_store.load_app_data()
    assert not any(e["id"] == "1234567" for e in data["pending"])
    assert any(p["id"] == "1234567" for p in data["properties"])


def test_double_approve(db_session, client, tmp_agent_state):
    """QUEUE-04: POST approve twice — first returns 200, second returns 404 (double-tap guard)."""
    _seed_pending("1234567")

    resp1 = client.post("/api/pending/1234567/approve")
    assert resp1.status_code == 200

    resp2 = client.post("/api/pending/1234567/approve")
    assert resp2.status_code == 404


def test_reject_with_reason(db_session, client, tmp_agent_state):
    """QUEUE-05: POST /api/pending/<id>/reject with reason moves to rejected[] with metadata.

    Also verifies server-side whitelist clamp: garbage reason stored as 'other'.
    """
    import data_store  # noqa: PLC0415

    # Primary assertion: known reason stored correctly
    _seed_pending("1234567")
    resp = client.post("/api/pending/1234567/reject", json={"reason": "price"})
    assert resp.status_code == 200
    assert resp.json()["ok"] is True

    data = data_store.load_app_data()
    assert not any(e["id"] == "1234567" for e in data["pending"])
    rejected = [e for e in data["rejected"] if e["id"] == "1234567"]
    assert len(rejected) == 1
    assert rejected[0]["rejection_reason"] == "price"
    assert "rejected_at" in rejected[0]

    # Secondary assertion: server-side whitelist clamp (garbage → "other")
    _seed_pending("9999999")
    resp2 = client.post("/api/pending/9999999/reject", json={"reason": "garbage"})
    assert resp2.status_code == 200

    data2 = data_store.load_app_data()
    rejected2 = [e for e in data2["rejected"] if e["id"] == "9999999"]
    assert len(rejected2) == 1
    assert rejected2[0]["rejection_reason"] == "other"


def test_draft_endpoint(db_session, client, tmp_agent_state, mock_gmail):
    """QUEUE-06: POST /api/draft/<id> creates Gmail draft and queues into pending_drafts.

    Three sub-assertions:
    1. Happy path: listing with contact_email → ok=True, gmail called, pending_drafts populated.
    2. No-email fallback: listing with empty contact_email → ok=False, reason="no_email".
    3. Not found: unknown id → 404.
    """
    import data_store  # noqa: PLC0415

    # --- 1. Happy path: seed a property with contact_email and draft fields ---
    with data_store._lock:
        data = data_store.load_app_data()
        data["properties"].append({
            "id": "1234567",
            "title": "Test",
            "url": "https://kv.ee/1234567.html",
            "price_eur": 200000,
            "contact_email": "agent@test.ee",
            "draft_subject": "Test",
            "draft_body": "body",
            "status": "approved",
        })
        data_store.save_app_data(data)

    resp = client.post("/api/draft/1234567")
    assert resp.status_code == 200
    assert resp.json()["ok"] is True

    # Verify gmail_client.create_draft was called with correct args
    mock_gmail.assert_called_once_with("agent@test.ee", "Test", "body")

    # Verify pending_drafts was populated
    state = data_store.load_agent_state()
    assert "1234567" in state["pending_drafts"]
    assert state["pending_drafts"]["1234567"]["to_email"] == "agent@test.ee"
    assert state["pending_drafts"]["1234567"]["subject"] == "Test"
    assert state["pending_drafts"]["1234567"]["body"] == "body"

    # --- 2. No-email fallback: seed a property with empty contact_email ---
    with data_store._lock:
        data2 = data_store.load_app_data()
        data2["properties"].append({
            "id": "9999",
            "title": "No Email Listing",
            "url": "https://kv.ee/9999.html",
            "price_eur": 100000,
            "contact_email": "",
            "draft_subject": "No email",
            "draft_body": "body",
            "status": "approved",
        })
        data_store.save_app_data(data2)

    resp2 = client.post("/api/draft/9999")
    assert resp2.status_code == 200
    assert resp2.json() == {"ok": False, "reason": "no_email"}

    # --- 3. Not found: unknown listing id → 404 ---
    resp3 = client.post("/api/draft/notthere")
    assert resp3.status_code == 404


def test_send_command_after_draft(tmp_agent_state, monkeypatch):
    """QUEUE-07: process_send_commands consumes pending_drafts and sends via SMTP.

    Seeds agent_state with a queued draft, monkeypatches Telegram + Gmail,
    calls process_send_commands, and asserts send_email was called and the
    draft entry was removed (pending_drafts consumed after successful send).

    Note: this test only touches agent_state.json (filesystem), not the DB,
    so db_session is not required.
    """
    from unittest.mock import MagicMock  # noqa: PLC0415

    import agent_job  # noqa: PLC0415
    import data_store  # noqa: PLC0415
    import gmail_client  # noqa: PLC0415
    import telegram_client  # noqa: PLC0415

    # Seed pending_drafts with a queued draft (agent_state.json — filesystem)
    with data_store._lock:
        state = data_store.load_agent_state()
        state["pending_drafts"]["1234567"] = {
            "to_email": "agent@test.ee",
            "subject": "Test",
            "body": "body",
            "url": "https://kv.ee/1234567.html",
        }
        data_store.save_agent_state(state)

    # Load state (as run_check does) to pass to process_send_commands
    state = data_store.load_agent_state()

    # Monkeypatch telegram_client.get_new_updates to return a /send 1234567 command
    mock_get_updates = MagicMock(return_value=([{"update_id": 1, "message": {"text": "/send 1234567"}}], 1))
    monkeypatch.setattr(telegram_client, "get_new_updates", mock_get_updates)
    monkeypatch.setattr(agent_job, "get_new_updates", mock_get_updates)

    # Monkeypatch gmail_client.send_email to return True
    mock_send_email = MagicMock(return_value=True)
    monkeypatch.setattr(gmail_client, "send_email", mock_send_email)
    monkeypatch.setattr(agent_job, "send_email", mock_send_email)

    # Monkeypatch telegram_client.send_message to suppress output
    mock_send_msg = MagicMock(return_value=None)
    monkeypatch.setattr(telegram_client, "send_message", mock_send_msg)
    monkeypatch.setattr(agent_job, "send_message", mock_send_msg)

    # Monkeypatch extract_send_commands to return our listing id
    mock_extract = MagicMock(return_value=["1234567"])
    monkeypatch.setattr(telegram_client, "extract_send_commands", mock_extract)
    monkeypatch.setattr(agent_job, "extract_send_commands", mock_extract)

    agent_job.process_send_commands(state)

    # Verify send_email was called with the correct args
    mock_send_email.assert_called_once_with("agent@test.ee", "Test", "body")

    # Verify the draft was consumed from pending_drafts
    assert "1234567" not in state["pending_drafts"]
