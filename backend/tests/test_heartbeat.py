"""
Unit and integration tests for POST /api/heartbeat and scheduler-tick alert checks.

Coverage (ARCH-04):
  - Heartbeat POST stores fields in agent_state
  - consecutive_zero_count increments when listing_count == 0
  - consecutive_zero_count resets when listing_count > 0
  - check_consecutive_zeros fires Telegram alert when count >= 2 (Task 2)
  - check_heartbeat_timeout fires Telegram alert when last_heartbeat_ts is stale (Task 2)
  - No alert fires when last_heartbeat_ts is None — no-baseline guard (Task 2)
  - Both alerts respect 24-hour cooldown (Task 2)
"""

import json

import pytest
from datetime import datetime, timedelta, timezone


# ---------------------------------------------------------------------------
# Heartbeat storage tests (immediately green after plan 01-02)
# ---------------------------------------------------------------------------

def test_heartbeat_stored(client, tmp_agent_state):
    """POST /api/heartbeat stores timestamp and listing_count in agent_state (ARCH-04, VALIDATION 1-03-01)."""
    resp = client.post(
        "/api/heartbeat",
        json={"timestamp": "2026-07-08T10:00:00+00:00", "listing_count": 5, "source": "kv.ee"},
        headers={"Authorization": "Bearer test-token-abc"},
    )
    assert resp.status_code == 200

    import data_store  # noqa: PLC0415

    state = data_store.load_agent_state()
    assert state["last_heartbeat_ts"] == "2026-07-08T10:00:00+00:00"
    assert state["last_heartbeat_listing_count"] == 5
    assert state["consecutive_zero_count"] == 0


def test_zero_count_increments(client, tmp_agent_state):
    """Two POST /api/heartbeat calls with listing_count=0 increment consecutive_zero_count to 2."""
    headers = {"Authorization": "Bearer test-token-abc"}
    client.post("/api/heartbeat", json={"timestamp": "2026-07-08T10:00:00+00:00", "listing_count": 0}, headers=headers)
    client.post("/api/heartbeat", json={"timestamp": "2026-07-08T12:00:00+00:00", "listing_count": 0}, headers=headers)

    import data_store  # noqa: PLC0415

    state = data_store.load_agent_state()
    assert state["consecutive_zero_count"] == 2


def test_zero_count_resets(client, tmp_agent_state):
    """A non-zero heartbeat after a zero heartbeat resets consecutive_zero_count to 0."""
    headers = {"Authorization": "Bearer test-token-abc"}
    client.post("/api/heartbeat", json={"timestamp": "2026-07-08T10:00:00+00:00", "listing_count": 0}, headers=headers)
    client.post("/api/heartbeat", json={"timestamp": "2026-07-08T12:00:00+00:00", "listing_count": 42}, headers=headers)

    import data_store  # noqa: PLC0415

    state = data_store.load_agent_state()
    assert state["consecutive_zero_count"] == 0


# ---------------------------------------------------------------------------
# Alert check tests (require Task 2's check functions — skip until wired)
# ---------------------------------------------------------------------------

def test_zero_listing_alert(tmp_agent_state, mock_telegram, monkeypatch):
    """check_consecutive_zeros fires a Telegram alert when consecutive_zero_count >= 2 (ARCH-04)."""
    import data_store  # noqa: PLC0415
    import agent_job  # noqa: PLC0415

    # Seed state with 2 consecutive zeros and a recent heartbeat.
    state_file = str(tmp_agent_state / "agent_state.json")
    now_iso = datetime.now(timezone.utc).isoformat()
    state = data_store.load_agent_state()
    state["consecutive_zero_count"] = 2
    state["last_heartbeat_ts"] = now_iso
    state["last_scraper_alert_sent_at"] = None
    data_store.save_agent_state(state)

    # Reload and call the check function directly.
    state = data_store.load_agent_state()
    agent_job.check_consecutive_zeros(state)

    # Confirm a Telegram message was sent containing "0 listings".
    assert mock_telegram.send_message.called, "expected send_message to be called"
    call_text = mock_telegram.send_message.call_args[0][0]
    assert "0 listings" in call_text, f"expected '0 listings' in message: {call_text!r}"


def test_offline_alert(tmp_agent_state, mock_telegram, monkeypatch):
    """check_heartbeat_timeout fires a Telegram alert when last_heartbeat_ts is stale (ARCH-04, D-10)."""
    import data_store  # noqa: PLC0415
    import agent_job  # noqa: PLC0415

    # Seed state with a heartbeat 100 hours ago (far beyond any threshold).
    stale_ts = (datetime.now(timezone.utc) - timedelta(hours=100)).isoformat()
    state = data_store.load_agent_state()
    state["last_heartbeat_ts"] = stale_ts
    state["last_scraper_alert_sent_at"] = None
    data_store.save_agent_state(state)

    state = data_store.load_agent_state()
    agent_job.check_heartbeat_timeout(state)

    assert mock_telegram.send_message.called, "expected send_message to be called"
    call_text = mock_telegram.send_message.call_args[0][0]
    assert "offline" in call_text.lower(), f"expected 'offline' in message: {call_text!r}"


def test_no_alert_when_no_baseline(tmp_agent_state, mock_telegram):
    """check_heartbeat_timeout must NOT fire when last_heartbeat_ts is None (RESEARCH Pitfall 4)."""
    import data_store  # noqa: PLC0415
    import agent_job  # noqa: PLC0415

    # Default state has last_heartbeat_ts = None.
    state = data_store.load_agent_state()
    assert state["last_heartbeat_ts"] is None

    agent_job.check_heartbeat_timeout(state)

    assert not mock_telegram.send_message.called, (
        "send_message must not be called when no heartbeat baseline exists"
    )


def test_alert_cooldown(tmp_agent_state, mock_telegram, monkeypatch):
    """Both alert checks must respect the 24-hour cooldown (RESEARCH Open Question 2).

    Seeds last_scraper_alert_sent_at to 5 hours ago, then triggers alert conditions.
    Expects send_message NOT to be called.
    """
    import data_store  # noqa: PLC0415
    import agent_job  # noqa: PLC0415

    fresh_alert_ts = (datetime.now(timezone.utc) - timedelta(hours=5)).isoformat()
    stale_heartbeat_ts = (datetime.now(timezone.utc) - timedelta(hours=100)).isoformat()

    state = data_store.load_agent_state()
    state["last_scraper_alert_sent_at"] = fresh_alert_ts
    state["last_heartbeat_ts"] = stale_heartbeat_ts
    state["consecutive_zero_count"] = 5
    data_store.save_agent_state(state)

    state = data_store.load_agent_state()
    agent_job.check_heartbeat_timeout(state)
    agent_job.check_consecutive_zeros(state)

    assert not mock_telegram.send_message.called, (
        "send_message must not be called within 24h of the previous alert"
    )


