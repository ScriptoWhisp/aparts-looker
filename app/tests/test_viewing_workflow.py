"""Integration tests for the Phase 6 viewing-workflow POST endpoints.

Function names are the source of truth per 06-VALIDATION.md § Per-Task Verification Map.
Skeletons in this file are filled by subsequent plans:
  - Plan 06-02: test_schedule_viewing_sets_status, test_invalid_iso_returns_400,
                test_z_suffix_parses, test_mark_viewed_flips_status
  - Plan 06-03: test_regenerate_brief
  - Plan 06-04: test_refresh_ku

Fixtures: 'client' and 'tmp_agent_state' from conftest.py — reused verbatim (do not create parallels).
"""

import pytest


def test_schedule_viewing_sets_status(client, tmp_agent_state, monkeypatch):
    """VIEW-01: POST /api/entry/{id}/schedule-viewing sets status=viewing_scheduled + scheduled_at."""
    pytest.skip("Filled by Plan 06-02")


def test_invalid_iso_returns_400(client, tmp_agent_state):
    """VIEW-01 timezone plumbing: schedule-viewing endpoint rejects malformed ISO with 400."""
    pytest.skip("Filled by Plan 06-02")


def test_z_suffix_parses(client, tmp_agent_state):
    """VIEW-01 timezone plumbing: UTC ISO with 'Z' suffix parses correctly on backend."""
    pytest.skip("Filled by Plan 06-02")


def test_mark_viewed_flips_status(client, tmp_agent_state):
    """VIEW-01: POST /api/entry/{id}/mark-viewed flips status to 'viewed'."""
    pytest.skip("Filled by Plan 06-02")


def test_regenerate_brief(client, tmp_agent_state, monkeypatch):
    """VIEW-03: POST /api/entry/{id}/regenerate-brief triggers generation + updates entry."""
    pytest.skip("Filled by Plan 06-03")


def test_refresh_ku(client, tmp_agent_state, monkeypatch):
    """ENRICH-01: POST /api/entry/{id}/refresh-ku triggers KU lookup + updates entry."""
    pytest.skip("Filled by Plan 06-04")
