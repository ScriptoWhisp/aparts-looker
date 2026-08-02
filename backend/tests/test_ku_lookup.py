"""Unit tests for ku_lookup.py — Phase 6 korteriühistu enrichment via ariregister autocomplete.

Function names are the source of truth per 06-VALIDATION.md § Per-Task Verification Map.
All test bodies filled by Plan 06-04.

Mocking strategy: monkeypatch ku_lookup.requests.get with a MagicMock that returns
canned ariregister autocomplete response payloads (same shape as test_pending.py mocking pattern).
"""

from unittest.mock import MagicMock

import pytest
import requests


def test_returns_korteriuhistu(monkeypatch):
    """ENRICH-01: lookup_ku_for_address returns dict when autocomplete gives legal_form=='23'."""
    import ku_lookup

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.raise_for_status.return_value = None
    mock_resp.json.return_value = {
        "status": "OK",
        "data": [
            {
                "reg_code": 80499321,
                "name": "KÜ Retke tee 22",
                "legal_address": "Retke tee 22, Tallinn",
                "legal_form": "23",
                "url": "https://ariregister.rik.ee/est/company/80499321",
            }
        ],
    }
    monkeypatch.setattr(ku_lookup.requests, "get", lambda *a, **kw: mock_resp)

    result = ku_lookup.lookup_ku_for_address("Retke tee 22")
    assert result is not None
    assert result["reg_code"] == 80499321
    assert result["name"] == "KÜ Retke tee 22"
    assert result["url"].startswith("https://ariregister.rik.ee")


def test_filters_non_korteriuhistu(monkeypatch):
    """ENRICH-01: lookup_ku_for_address returns None when only non-KU results (e.g. legal_form=='6')."""
    import ku_lookup

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.raise_for_status.return_value = None
    mock_resp.json.return_value = {
        "status": "OK",
        "data": [
            {
                "reg_code": 12345678,
                "name": "Garage Assoc",
                "legal_address": "Some street 5, Tallinn",
                "legal_form": "6",
                "url": "https://ariregister.rik.ee/est/company/12345678",
            }
        ],
    }
    monkeypatch.setattr(ku_lookup.requests, "get", lambda *a, **kw: mock_resp)

    result = ku_lookup.lookup_ku_for_address("Some street 5")
    assert result is None, "Garage (legal_form '6') should be filtered out per Pitfall 2"


def test_never_raises_on_network_error(monkeypatch):
    """ENRICH-01: lookup_ku_for_address returns None on requests.RequestException (never-raise)."""
    import ku_lookup

    def _raise(*a, **kw):
        raise requests.RequestException("network down")

    monkeypatch.setattr(ku_lookup.requests, "get", _raise)

    result = ku_lookup.lookup_ku_for_address("Any address")
    assert result is None, "Should return None without raising on RequestException"
