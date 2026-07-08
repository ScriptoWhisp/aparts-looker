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


@pytest.mark.xfail(reason="Wave 0 stub — not yet implemented", strict=True)
def test_checklist_in_response(tmp_agent_state, monkeypatch):
    """EVAL-02: evaluate_listing returns checklist dict with 7 expected keys."""
    pytest.fail("not implemented")


@pytest.mark.xfail(reason="Wave 0 stub — not yet implemented", strict=True)
def test_checklist_user_override_preserved(tmp_agent_state):
    """EVAL-02: write_checklist_ai preserves existing user-source checklist entries (D-09)."""
    pytest.fail("not implemented")
