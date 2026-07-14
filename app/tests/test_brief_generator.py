"""Unit tests for brief_generator.py — Phase 6 negotiation-brief generation.

Function names are the source of truth per 06-VALIDATION.md § Per-Task Verification Map.
Mocking strategy: monkeypatch brief_generator.requests.post with a MagicMock that returns
a canned Anthropic response shape (mirrors test_pending.py::test_send_pending_card_buttons).
"""

import pytest
import requests as req_module


def test_returns_expected_shape(monkeypatch):
    """VIEW-03: generate_negotiation_brief returns dict with brief_ru/offer_low/offer_high on success."""
    from unittest.mock import MagicMock
    import brief_generator
    import config

    # Ensure ANTHROPIC_API_KEY guard passes (monkeypatch the module-level config attribute)
    monkeypatch.setattr(config, "ANTHROPIC_API_KEY", "test-key-abc")
    # Also patch the module reference that brief_generator reads at call time
    monkeypatch.setattr(brief_generator.config, "ANTHROPIC_API_KEY", "test-key-abc")

    # Build a canned Anthropic response shape mirroring test_pending.py:70-100 pattern
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.raise_for_status = MagicMock(return_value=None)
    mock_response.json.return_value = {
        "content": [
            {
                "type": "text",
                "text": '{"brief_ru": "Тест", "suggested_offer_low_eur": 150000, "suggested_offer_high_eur": 160000}',
            }
        ],
        "stop_reason": "end_turn",
    }

    monkeypatch.setattr(brief_generator.requests, "post", MagicMock(return_value=mock_response))

    entry = {
        "id": "test-id",
        "price": 175000,
        "pricePerSqm": 2500,
        "area": 70,
        "rooms": 3,
        "score": 78,
        "verdict": "Worth viewing IF цена снизится",
        "district": "Mustamäe",
    }

    result = brief_generator.generate_negotiation_brief(entry, [], 2800, 300)

    assert isinstance(result, dict), f"expected dict, got {type(result)}"
    assert result.get("brief_ru") == "Тест", f"brief_ru mismatch: {result.get('brief_ru')!r}"
    assert result.get("suggested_offer_low_eur") == 150000
    assert result.get("suggested_offer_high_eur") == 160000
    assert "error" not in result, f"unexpected error key: {result.get('error')}"


def test_never_raises_on_network_error(monkeypatch):
    """VIEW-03: generate_negotiation_brief returns fallback dict on requests.RequestException."""
    from unittest.mock import MagicMock
    import brief_generator

    monkeypatch.setattr(
        brief_generator.requests,
        "post",
        MagicMock(side_effect=req_module.RequestException("network down")),
    )

    entry = {"id": "fail-id", "price": 150000}

    # Must NOT raise — returns a fallback dict
    result = brief_generator.generate_negotiation_brief(entry, [], None, None)

    assert isinstance(result, dict), f"expected dict on error, got {type(result)}"
    assert result.get("brief_ru") == "", f"expected empty brief_ru, got {result.get('brief_ru')!r}"
    assert "error" in result, "expected 'error' key in fallback result"


def test_number_validation():
    """VIEW-03: _validate_no_hallucinated_numbers flags €-amounts not present in input facts.

    Validator takes the raw facts-block text as its second argument (not a curated dict),
    so year_built and ISO-date years are covered without having to enumerate every field.
    """
    import brief_generator

    facts = "Цена 175000 EUR, район 2800/m², год постройки 1970, история 2026-07-10"

    # All 4-6 digit numbers in brief also appear in facts → True
    assert brief_generator._validate_no_hallucinated_numbers(
        "Цена 175000 EUR, район 2800/m²", facts,
    ) is True, "expected True when all numbers in facts"

    # year_built regression: 1970 in the brief must NOT trigger needs_review
    # since it's in the facts (cross-AI review MEDIUM finding).
    assert brief_generator._validate_no_hallucinated_numbers(
        "Дом 1970 года постройки, цена 175000 EUR.", facts,
    ) is True, "expected True — year_built in facts must not flag needs_review"

    # 9999 is NOT in facts → False
    assert brief_generator._validate_no_hallucinated_numbers(
        "Цена 9999 EUR", facts,
    ) is False, "expected False when number not in facts"

    # No 4-6 digit numbers in brief → True (vacuously)
    assert brief_generator._validate_no_hallucinated_numbers(
        "Хорошая квартира в Таллине.", facts,
    ) is True, "expected True when no numbers in brief"
