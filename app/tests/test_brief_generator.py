"""Unit tests for brief_generator.py — Phase 6 negotiation-brief generation.

Function names are the source of truth per 06-VALIDATION.md § Per-Task Verification Map.
All test bodies are skeletons filled by Plan 06-03.

Mocking strategy: monkeypatch brief_generator.requests.post with a MagicMock that returns
a canned Anthropic response shape (mirrors test_pending.py::test_send_pending_card_buttons).
"""

import pytest


def test_returns_expected_shape(monkeypatch):
    """VIEW-03: generate_negotiation_brief returns dict with brief_ru/offer_low/offer_high on success."""
    pytest.skip("Filled by Plan 06-03")


def test_never_raises_on_network_error(monkeypatch):
    """VIEW-03: generate_negotiation_brief returns fallback dict on requests.RequestException."""
    pytest.skip("Filled by Plan 06-03")


def test_number_validation():
    """VIEW-03: _validate_no_hallucinated_numbers flags €-amounts not present in input facts."""
    pytest.skip("Filled by Plan 06-03")
