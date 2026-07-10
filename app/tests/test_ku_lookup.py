"""Unit tests for ku_lookup.py — Phase 6 korteriühistu enrichment via ariregister autocomplete.

Function names are the source of truth per 06-VALIDATION.md § Per-Task Verification Map.
All test bodies are skeletons filled by Plan 06-04.

Mocking strategy: monkeypatch ku_lookup.requests.get with a MagicMock that returns
canned ariregister autocomplete response payloads (same shape as test_pending.py mocking pattern).
"""

import pytest


def test_returns_korteriuhistu(monkeypatch):
    """ENRICH-01: lookup_ku_for_address returns dict when autocomplete gives legal_form=='23'."""
    pytest.skip("Filled by Plan 06-04")


def test_filters_non_korteriuhistu(monkeypatch):
    """ENRICH-01: lookup_ku_for_address returns None when only non-KU results (e.g. legal_form=='6')."""
    pytest.skip("Filled by Plan 06-04")


def test_never_raises_on_network_error(monkeypatch):
    """ENRICH-01: lookup_ku_for_address returns None on requests.RequestException (never-raise)."""
    pytest.skip("Filled by Plan 06-04")
