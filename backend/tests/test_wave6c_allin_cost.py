"""Tests for Wave 6C all-in cost: settings schema extension and renovation_items
storage/validation. Backend-only tests; client-side computeAllIn is in cost.js.

Covers:
  WAVE6C-01: _SCHEMA contains all renovation rate keys with correct types/groups
  WAVE6C-02: bool coercion in _coerce()
  WAVE6C-03: settings save with bool value round-trips via config
  WAVE6C-04: _validate_renovation_items() rejects unknown keys
  WAVE6C-05: write_renovation_items persists items to checklist JSONB
  WAVE6C-06: cost-override endpoint accepts renovation_override_work_eur
  WAVE6C-07: AI evaluator _fallback_result includes renovation_items field
"""

import pytest


# ---------------------------------------------------------------------------
# WAVE6C-01: Settings schema contains all renovation rate keys
# ---------------------------------------------------------------------------

def test_schema_contains_all_reno_keys():
    """WAVE6C-01: _SCHEMA must have 9 renovation keys with group='reno'."""
    import settings_store

    expected_reno_keys = {
        "reno_kitchen_full", "reno_bathroom_full", "reno_windows_per_unit",
        "reno_floors_per_sqm", "reno_rewire_per_sqm", "reno_heating",
        "reno_cosmetic_per_sqm", "reno_contingency_pct", "rank_by_all_in",
    }
    schema_keys = {k for k, v in settings_store._SCHEMA.items() if v[2] == "reno"}
    assert schema_keys == expected_reno_keys


def test_schema_reno_types():
    """WAVE6C-01: int-type reno rates have int type; bool rank_by_all_in has bool type."""
    import settings_store

    for key, spec in settings_store._SCHEMA.items():
        if key.startswith("reno_"):
            assert spec[1] is int, f"{key} should have int type"
    assert settings_store._SCHEMA["rank_by_all_in"][1] is bool


# ---------------------------------------------------------------------------
# WAVE6C-02: bool coercion
# ---------------------------------------------------------------------------

def test_coerce_bool_true_values():
    """WAVE6C-02: _coerce(bool, ...) handles truthy strings."""
    import settings_store

    for val in (True, "true", "True", "1", "yes", "on"):
        assert settings_store._coerce(bool, val) is True, f"Expected True for {val!r}"


def test_coerce_bool_false_values():
    """WAVE6C-02: _coerce(bool, ...) handles falsy strings."""
    import settings_store

    for val in (False, "false", "False", "0", "no", "off"):
        assert settings_store._coerce(bool, val) is False, f"Expected False for {val!r}"


# ---------------------------------------------------------------------------
# WAVE6C-03: settings save round-trips bool via config attribute
# ---------------------------------------------------------------------------

def test_bool_setting_save_applies_to_config(monkeypatch):
    """WAVE6C-03: saving rank_by_all_in=True sets config.RANK_BY_ALL_IN=True."""
    import config
    import settings_store

    # Ensure we start from a known state
    monkeypatch.setattr(config, "RANK_BY_ALL_IN", False)

    # Mock _persist so we don't touch the filesystem
    monkeypatch.setattr(settings_store, "_persist", lambda: None)
    # Mock _recompute_all_costs to avoid DB dependency
    monkeypatch.setattr(settings_store, "_recompute_all_costs", lambda: 0)

    result = settings_store.save({"rank_by_all_in": True})
    assert result["errors"] == []
    assert config.RANK_BY_ALL_IN is True


def test_bool_setting_save_false_applies_to_config(monkeypatch):
    """WAVE6C-03: saving rank_by_all_in=False sets config.RANK_BY_ALL_IN=False."""
    import config
    import settings_store

    monkeypatch.setattr(config, "RANK_BY_ALL_IN", True)
    monkeypatch.setattr(settings_store, "_persist", lambda: None)
    monkeypatch.setattr(settings_store, "_recompute_all_costs", lambda: 0)

    result = settings_store.save({"rank_by_all_in": False})
    assert result["errors"] == []
    assert config.RANK_BY_ALL_IN is False


# ---------------------------------------------------------------------------
# WAVE6C-04: _validate_renovation_items rejects unknown keys
# ---------------------------------------------------------------------------

def test_validate_reno_items_filters_unknown_keys():
    """WAVE6C-04: items with unknown keys are dropped."""
    from ai_evaluator import _validate_renovation_items

    items = [
        {"key": "kitchen_full", "applies": True, "confidence": 2, "qty": None, "note": None},
        {"key": "unknown_item", "applies": True, "confidence": 1, "qty": None, "note": None},
        {"key": "cosmetic",     "applies": None, "confidence": 1, "qty": None, "note": "старая краска"},
    ]
    result = _validate_renovation_items(items)
    assert len(result) == 2
    keys = {i["key"] for i in result}
    assert keys == {"kitchen_full", "cosmetic"}


def test_validate_reno_items_none_returns_empty():
    """WAVE6C-04: None input returns empty list, not an exception."""
    from ai_evaluator import _validate_renovation_items

    assert _validate_renovation_items(None) == []


def test_validate_reno_items_truncates_note():
    """WAVE6C-04: note is truncated to 60 chars."""
    from ai_evaluator import _validate_renovation_items

    long_note = "x" * 100
    items = [{"key": "floors", "applies": True, "confidence": 1, "qty": 50.0, "note": long_note}]
    result = _validate_renovation_items(items)
    assert len(result) == 1
    assert len(result[0]["note"]) == 60


def test_validate_reno_items_bad_applies_becomes_null():
    """WAVE6C-04: applies with invalid value (not true/false/null) is treated as null."""
    from ai_evaluator import _validate_renovation_items

    items = [{"key": "heating", "applies": "maybe", "confidence": 2, "qty": None, "note": None}]
    result = _validate_renovation_items(items)
    assert len(result) == 1
    assert result[0]["applies"] is None


# ---------------------------------------------------------------------------
# WAVE6C-05: write_renovation_items persists to checklist JSONB
# ---------------------------------------------------------------------------

def test_write_renovation_items_persists(db_session):
    """WAVE6C-05: write_renovation_items stores items in checklist.renovation_items."""
    import data_store

    data_store.save_app_data({
        "properties": [{"id": "reno-test", "price_eur": 150000, "status": "approved"}],
        "pending": [], "rejected": [], "checklists": {}, "price_history": {}, "settings": {},
    })

    items = [
        {"key": "kitchen_full", "applies": True, "confidence": 3, "qty": None, "note": "старая кухня"},
        {"key": "floors", "applies": True, "confidence": 1, "qty": 55.0, "note": None},
    ]
    data_store.write_renovation_items("reno-test", items)

    app_data = data_store.load_app_data()
    cl = app_data.get("checklists", {}).get("reno-test", {})
    assert "renovation_items" in cl
    assert len(cl["renovation_items"]) == 2
    assert cl["renovation_items"][0]["key"] == "kitchen_full"


def test_write_renovation_items_missing_listing(db_session):
    """WAVE6C-05: write_renovation_items silently returns when listing not found."""
    import data_store

    # Should not raise
    data_store.write_renovation_items("does-not-exist", [{"key": "cosmetic"}])


# ---------------------------------------------------------------------------
# WAVE6C-06: cost-override endpoint accepts renovation_override_work_eur
# ---------------------------------------------------------------------------

def test_cost_override_accepts_reno_override(db_session, client, tmp_agent_state):
    """WAVE6C-06: POST /api/entry/{id}/cost-override accepts renovation_override_work_eur."""
    import data_store

    data_store.save_app_data({
        "properties": [{
            "id": "co-test",
            "price_eur": 200000,
            "area_sqm": 60.0,
            "status": "approved",
        }],
        "pending": [], "rejected": [], "checklists": {}, "price_history": {}, "settings": {},
    })

    resp = client.post(
        "/api/entry/co-test/cost-override",
        json={"renovation_override_work_eur": 25000},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    assert body["cost_of_ownership"]["renovation_override_work_eur"] == 25000


def test_cost_override_clears_reno_override(db_session, client, tmp_agent_state):
    """WAVE6C-06: POST renovation_override_work_eur=null removes the key."""
    import data_store

    data_store.save_app_data({
        "properties": [{
            "id": "co-clear",
            "price_eur": 200000,
            "area_sqm": 60.0,
            "status": "approved",
            "cost_of_ownership": {"renovation_override_work_eur": 30000},
        }],
        "pending": [], "rejected": [], "checklists": {}, "price_history": {}, "settings": {},
    })

    resp = client.post(
        "/api/entry/co-clear/cost-override",
        json={"renovation_override_work_eur": None},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert "renovation_override_work_eur" not in body["cost_of_ownership"]


# ---------------------------------------------------------------------------
# WAVE6C-07: AI evaluator fallback result includes renovation_items
# ---------------------------------------------------------------------------

def test_fallback_result_includes_renovation_items():
    """WAVE6C-07: _fallback_result always has renovation_items key (for frontend safety)."""
    from ai_evaluator import _fallback_result

    result = _fallback_result("Skip because test")
    assert "renovation_items" in result
    assert result["renovation_items"] == []
