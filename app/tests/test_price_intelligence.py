"""Tests for Phase 03 price intelligence: EVAL-04, INTEL-01, INTEL-02, INTEL-03."""

import pytest


@pytest.mark.xfail(reason="Wave 0 stub — not yet implemented", strict=True)
def test_record_price_new(tmp_agent_state):
    """INTEL-01: record_price_in_data appends a new price entry for a listing not yet in price_history."""
    pytest.fail("not implemented")


@pytest.mark.xfail(reason="Wave 0 stub — not yet implemented", strict=True)
def test_record_price_idempotent(tmp_agent_state):
    """INTEL-01: record_price_in_data overwrites (not appends) when called twice for the same date."""
    pytest.fail("not implemented")


@pytest.mark.xfail(reason="Wave 0 stub — not yet implemented", strict=True)
def test_ingest_records_price_for_known(client, tmp_agent_state, mock_send_pending_card, monkeypatch):
    """INTEL-01: ingest batch records price into price_history for a known (already-seen) listing."""
    pytest.fail("not implemented")


@pytest.mark.xfail(reason="Wave 0 stub — not yet implemented", strict=True)
def test_price_drop_reeval_pending(tmp_agent_state, monkeypatch):
    """EVAL-04: a >= 5% price drop on a pending listing triggers re-evaluation and score update."""
    pytest.fail("not implemented")


@pytest.mark.xfail(reason="Wave 0 stub — not yet implemented", strict=True)
def test_price_drop_below_threshold_no_reeval(tmp_agent_state, monkeypatch):
    """EVAL-04: a < 5% price drop does NOT trigger re-evaluation."""
    pytest.fail("not implemented")


@pytest.mark.xfail(reason="Wave 0 stub — not yet implemented", strict=True)
def test_price_rejected_requeued(tmp_agent_state, monkeypatch):
    """EVAL-04: a listing rejected for reason='price' is re-queued to pending on >= 5% price drop (D-17)."""
    pytest.fail("not implemented")


@pytest.mark.xfail(reason="Wave 0 stub — not yet implemented", strict=True)
def test_location_rejected_not_requeued(tmp_agent_state, monkeypatch):
    """EVAL-04: a listing rejected for reason='location' is NOT re-queued on price drop (D-17)."""
    pytest.fail("not implemented")


@pytest.mark.xfail(reason="Wave 0 stub — not yet implemented", strict=True)
def test_removed_listing_marked(tmp_agent_state):
    """INTEL-03: a listing in properties[] with raw_ok=False is marked removed=True with removed_at date."""
    pytest.fail("not implemented")


@pytest.mark.xfail(reason="Wave 0 stub — not yet implemented", strict=True)
def test_removed_listing_marked_pending(tmp_agent_state):
    """INTEL-03: a listing in pending[] with raw_ok=False is marked removed=True with removed_at date."""
    pytest.fail("not implemented")
