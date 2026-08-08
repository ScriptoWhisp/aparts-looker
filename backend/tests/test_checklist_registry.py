"""Tests for backend/checklist_registry.py (Wave A checklist expansion).

Covers:
  - Registry loads with >= 90 items across exactly 4 sections
  - All keys are globally unique
  - Every ai_fillable item has a non-empty label_ru
  - LEGACY_KEY_MAP covers all 13 pre-Wave-A AI_FILLABLE_CHECKLIST_KEYS
  - set_checklist_user_mark migrates an old-key mark onto the new key on write
  - GET /api/checklist-registry returns a valid, well-formed structure
"""

import checklist_registry as cr


# ── Registry structure ──────────────────────────────────────────────────────

def test_registry_has_at_least_90_items_across_4_sections():
    assert len(cr.CHECKLIST_REGISTRY) >= 90
    sections = {item.section for item in cr.CHECKLIST_REGISTRY}
    assert sections == {"evaluation", "ask_seller", "request_docs", "onsite"}
    assert cr.get_sections() == ["evaluation", "ask_seller", "request_docs", "onsite"]


def test_all_keys_unique():
    keys = [item.key for item in cr.CHECKLIST_REGISTRY]
    assert len(keys) == len(set(keys)), "duplicate keys found in CHECKLIST_REGISTRY"


def test_every_ai_fillable_item_has_nonempty_label_ru():
    fillable = [item for item in cr.CHECKLIST_REGISTRY if item.ai_fillable]
    assert len(fillable) > 0
    for item in fillable:
        assert item.label_ru and item.label_ru.strip(), f"{item.key} has empty label_ru"


def test_every_item_has_nonempty_label_ru():
    for item in cr.CHECKLIST_REGISTRY:
        assert item.label_ru and item.label_ru.strip(), f"{item.key} has empty label_ru"


def test_get_ai_fillable_keys_matches_flagged_items():
    fillable_keys = cr.get_ai_fillable_keys()
    assert isinstance(fillable_keys, frozenset)
    expected = {item.key for item in cr.CHECKLIST_REGISTRY if item.ai_fillable}
    assert fillable_keys == expected


# ── Legacy key map ───────────────────────────────────────────────────────────

# The pre-Wave-A 13-key allow-list (backend/ai_evaluator.py before this change).
_OLD_13_KEYS = frozenset({
    "s09_01", "s09_02",
    "s14_01", "s14_02", "s14_03", "s14_04", "s14_05", "s14_09", "s14_10",
    "s16_01", "s16_02", "s16_03", "s16_04",
})


def test_legacy_key_map_covers_all_13_old_keys():
    assert set(cr.LEGACY_KEY_MAP.keys()) == _OLD_13_KEYS


def test_legacy_key_map_targets_exist_in_registry():
    valid_keys = {item.key for item in cr.CHECKLIST_REGISTRY}
    for old_key, new_key in cr.LEGACY_KEY_MAP.items():
        assert new_key in valid_keys, f"{old_key} -> {new_key} but {new_key} not in registry"


def test_legacy_keys_for_reverse_lookup():
    # sec2_building intentionally receives two old keys (s09_02, s14_03) —
    # see the LEGACY_KEY_MAP comment in checklist_registry.py.
    assert set(cr.legacy_keys_for("sec2_building")) == {"s09_02", "s14_03"}
    assert cr.legacy_keys_for("sec2_address") == ["s14_01"]
    assert cr.legacy_keys_for("no-such-key") == []


# ── /api/checklist-registry endpoint ────────────────────────────────────────

def test_registry_endpoint_returns_valid_structure(client):
    resp = client.get("/api/checklist-registry")
    assert resp.status_code == 200
    body = resp.json()

    assert "sections" in body and "legacy_key_map" in body
    assert len(body["sections"]) == 4

    total_items = 0
    seen_keys = set()
    for section in body["sections"]:
        assert section["id"] in {"evaluation", "ask_seller", "request_docs", "onsite"}
        assert section["label_ru"]
        assert isinstance(section["groups"], list) and len(section["groups"]) > 0
        for group in section["groups"]:
            assert group["id"]
            assert group["label_ru"]
            assert isinstance(group["items"], list) and len(group["items"]) > 0
            for item in group["items"]:
                assert item["key"] not in seen_keys, f"duplicate key {item['key']} in response"
                seen_keys.add(item["key"])
                assert item["label_ru"]
                assert item["section"] == section["id"]
                assert item["group"] == group["id"]
                assert isinstance(item["ai_fillable"], bool)
                total_items += 1

    assert total_items >= 90
    assert body["legacy_key_map"] == dict(cr.LEGACY_KEY_MAP)


def test_registry_endpoint_onsite_has_5_subgroups(client):
    resp = client.get("/api/checklist-registry")
    body = resp.json()
    onsite = next(s for s in body["sections"] if s["id"] == "onsite")
    assert onsite["subgrouped"] is True
    assert len(onsite["groups"]) == 5


# ── set_checklist_user_mark: lazy legacy migration ──────────────────────────

def _seed_listing_with_checklist(db_session, listing_id: str, checklist: dict) -> None:
    from models import Listing as ListingRow  # noqa: PLC0415

    db_session.add(ListingRow(id=listing_id, title="Test", url="http://x",
                               status="approved", checklist=checklist))
    db_session.commit()


def _get_user_marks(data_store, listing_id: str) -> dict:
    """load_app_data()'s shim surfaces per-listing checklist JSONB under the
    top-level data["checklists"][listing_id] key (NOT nested on the entry
    dict itself) — mirrors test_checklist_marks.py's _get_checklist helper."""
    data = data_store.load_app_data()
    checklist = data.get("checklists", {}).get(listing_id, {})
    return checklist.get("user_marks", {})


def test_set_checklist_user_mark_migrates_old_key_state_and_note(db_session):
    import data_store  # noqa: PLC0415

    _seed_listing_with_checklist(db_session, "mig-1", {
        "user_marks": {"s14_01": {"state": "flag", "note": "old note", "marked_at": "2026-01-01T00:00:00Z"}},
    })

    ok = data_store.set_checklist_user_mark("mig-1", "sec2_address", state="ok")
    assert ok is True

    marks = _get_user_marks(data_store, "mig-1")

    # Old key is gone; new key carries the freshly-written state + the
    # migrated-forward note (write only touched state, not note).
    assert "s14_01" not in marks
    assert marks["sec2_address"]["state"] == "ok"
    assert marks["sec2_address"]["note"] == "old note"


def test_set_checklist_user_mark_does_not_overwrite_existing_new_key_data(db_session):
    """If the new key already has data, migration must not clobber it."""
    import data_store  # noqa: PLC0415

    _seed_listing_with_checklist(db_session, "mig-2", {
        "user_marks": {
            "s14_01": {"state": "flag", "note": "stale old note"},
            "sec2_address": {"note": "already-current note"},
        },
    })

    ok = data_store.set_checklist_user_mark("mig-2", "sec2_address", state="ok")
    assert ok is True

    marks = _get_user_marks(data_store, "mig-2")

    assert "s14_01" not in marks
    assert marks["sec2_address"]["state"] == "ok"
    # Existing note on the new key wins over the stale migrated one.
    assert marks["sec2_address"]["note"] == "already-current note"


def test_set_checklist_user_mark_writing_unrelated_new_key_is_a_noop_for_legacy(db_session):
    """Writing a key with no legacy predecessors must not touch other keys."""
    import data_store  # noqa: PLC0415

    _seed_listing_with_checklist(db_session, "mig-3", {
        "user_marks": {"s14_01": {"state": "flag"}},
    })

    ok = data_store.set_checklist_user_mark("mig-3", "sec3_reason_for_sale", state="ok")
    assert ok is True

    marks = _get_user_marks(data_store, "mig-3")

    # s14_01 untouched — sec3_reason_for_sale has no legacy predecessor.
    assert marks["s14_01"]["state"] == "flag"
    assert marks["sec3_reason_for_sale"]["state"] == "ok"
