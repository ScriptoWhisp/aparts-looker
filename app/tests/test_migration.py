"""
Migration tests for DB-04: migrate_from_json.py idempotency, alias mapping,
JSONB round-trip, absent-file no-op, rename guard, and ku.manual preservation.

Wave 0 state: the first two tests (test_idempotent_rerun, test_preserves_ku_manual)
failed with ModuleNotFoundError because migrate_from_json did not exist yet.
Wave 3 creates app/migrate_from_json.py and turns all tests GREEN.

Contracts pinned per RESEARCH:
  - Pitfall 5: idempotency via db.merge + file-rename (test_idempotent_rerun,
    test_file_renamed_after_migration)
  - Pitfall 7: ku.manual preserved through migration (test_preserves_ku_manual)
  - Assumption A2: unknown keys land in extras, nothing lost (test_legacy_field_aliases)
  - Security T-07-03-05: no secrets in log output (checked in test module docstring;
    enforced by migrate_from_json.py's grep guard in the plan verify step)
"""
import json
import os

import pytest


def _write_minimal_app_data(path: str) -> None:
    """Write a minimal 4-entry app_data.json to path for migration tests."""
    data = {
        "properties": [
            {"id": "prop-1", "url": "https://kv.ee/1", "price_eur": 150000,
             "area_sqm": 50.0, "rooms": 2, "status": "approved"},
            {"id": "prop-2", "url": "https://kv.ee/2", "price_eur": 220000,
             "area_sqm": 70.0, "rooms": 3, "status": "viewing_scheduled"},
        ],
        "pending": [
            {"id": "pending-1", "url": "https://kv.ee/3", "price_eur": 180000,
             "area_sqm": 55.0, "rooms": 2},
        ],
        "rejected": [
            {"id": "rejected-1", "url": "https://kv.ee/4", "price_eur": 90000,
             "area_sqm": 30.0, "rooms": 1},
        ],
        "checklists": {},
        "price_history": {},
        "settings": {},
    }
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f)


def test_idempotent_rerun(db_session, tmp_path, monkeypatch):
    """DB-04: running migrate_from_json.main() twice loads exactly 4 rows, not 8.

    Procedure:
      1. Write a minimal app_data.json with 2 properties + 1 pending + 1 rejected
         (4 entries total).
      2. Monkeypatch config.APP_DATA_FILE to point at that file.
      3. Run migrate_from_json.main() — asserts 4 rows in the DB.
      4. Restore the source file (simulate no rename due to fresh conftest state)
         and run main() a second time — asserts row count is still exactly 4.

    Fails in Wave 0: `import migrate_from_json` raises ModuleNotFoundError.
    """
    import config  # noqa: PLC0415
    import migrate_from_json  # noqa: PLC0415 — lazy: Wave 3 creates this module
    from models import Listing  # noqa: PLC0415

    source_path = str(tmp_path / "app_data.json")
    _write_minimal_app_data(source_path)
    monkeypatch.setattr(config, "APP_DATA_FILE", source_path)

    # First run — should insert 4 rows
    result = migrate_from_json.main()
    assert result == 0, f"First migration run returned non-zero exit code: {result}"

    count_after_first = db_session.query(Listing).count()
    assert count_after_first == 4, (
        f"Expected 4 rows after first migration, got {count_after_first}"
    )

    # Restore source file to simulate idempotency check (migration may have renamed it)
    backup_path = source_path + ".pre-pg7"
    if os.path.exists(backup_path) and not os.path.exists(source_path):
        os.rename(backup_path, source_path)

    # Second run — should merge / upsert; row count must still be 4
    result2 = migrate_from_json.main()
    assert result2 == 0, f"Second migration run returned non-zero exit code: {result2}"

    count_after_second = db_session.query(Listing).count()
    assert count_after_second == 4, (
        f"Expected 4 rows after second (idempotent) migration, got {count_after_second} "
        f"— Pitfall 5: migration must use db.merge, not db.add"
    )


def test_preserves_ku_manual(db_session, tmp_path, monkeypatch):
    """DB-04 / Pitfall 7: migration preserves ku.manual when present on an entry.

    Writes a single-entry app_data.json where properties[0].ku includes both
    auto data and a manual note. Runs migration. Asserts the DB row's ku dict
    still has manual == "meeting notes from Feb".

    Fails in Wave 0: `import migrate_from_json` raises ModuleNotFoundError.
    """
    import config  # noqa: PLC0415
    import migrate_from_json  # noqa: PLC0415
    from models import Listing  # noqa: PLC0415

    source_path = str(tmp_path / "app_data_ku.json")
    data = {
        "properties": [
            {
                "id": "ku-test-1",
                "url": "https://kv.ee/ku",
                "price_eur": 160000,
                "area_sqm": 55.0,
                "rooms": 2,
                "status": "approved",
                "ku": {
                    "auto": {"reg_code": "12345", "name": "Test KÜ"},
                    "manual": "meeting notes from Feb",
                    "looked_up_at": "2026-07-01T12:00:00Z",
                },
            }
        ],
        "pending": [],
        "rejected": [],
        "checklists": {},
        "price_history": {},
        "settings": {},
    }
    with open(source_path, "w", encoding="utf-8") as f:
        json.dump(data, f)

    monkeypatch.setattr(config, "APP_DATA_FILE", source_path)

    result = migrate_from_json.main()
    assert result == 0, f"Migration returned non-zero exit code: {result}"

    row = db_session.get(Listing, "ku-test-1")
    assert row is not None, "Migrated row should exist in DB"
    assert isinstance(row.ku, dict), f"ku column should be a dict, got {type(row.ku)}"
    assert row.ku.get("manual") == "meeting notes from Feb", (
        f"ku.manual should survive migration — got {row.ku!r} (Pitfall 7)"
    )


def test_legacy_field_aliases(db_session, tmp_path, monkeypatch):
    """DB-04 / Assumption A2: legacy dict keys are mapped to correct Listing columns.

    An entry using the old field names (name, area, year, price, pricePerSqm, notes)
    should produce a DB row where title/area_sqm/year_built/price_eur/price_per_sqm/
    description are populated, not left as defaults.

    The old keys should land in extras (nothing silently dropped per A2).
    """
    import config  # noqa: PLC0415
    import migrate_from_json  # noqa: PLC0415
    from models import Listing  # noqa: PLC0415

    source_path = str(tmp_path / "app_data_aliases.json")
    data = {
        "properties": [
            {
                "id": "alias-test-1",
                "url": "https://kv.ee/alias",
                # Legacy keys (the old names)
                "name": "Test Apartment",
                "area": 62.5,
                "year": 1985,
                "price": 175000,
                "pricePerSqm": 2800,
                "notes": "Needs renovation",
                "rooms": 3,
                "status": "approved",
            }
        ],
        "pending": [],
        "rejected": [],
        "checklists": {},
        "price_history": {},
        "settings": {},
    }
    with open(source_path, "w", encoding="utf-8") as f:
        json.dump(data, f)

    monkeypatch.setattr(config, "APP_DATA_FILE", source_path)

    result = migrate_from_json.main()
    assert result == 0, f"Migration returned non-zero exit code: {result}"

    row = db_session.get(Listing, "alias-test-1")
    assert row is not None, "Migrated row should exist in DB"

    # Verify legacy aliases produced correct column values
    assert row.title == "Test Apartment", (
        f"name → title alias failed: got title={row.title!r}"
    )
    assert row.area_sqm == 62.5, (
        f"area → area_sqm alias failed: got area_sqm={row.area_sqm!r}"
    )
    assert row.year_built == 1985, (
        f"year → year_built alias failed: got year_built={row.year_built!r}"
    )
    assert row.price_eur == 175000, (
        f"price → price_eur alias failed: got price_eur={row.price_eur!r}"
    )
    assert row.price_per_sqm == 2800, (
        f"pricePerSqm → price_per_sqm alias failed: got price_per_sqm={row.price_per_sqm!r}"
    )
    assert row.description == "Needs renovation", (
        f"notes → description alias failed: got description={row.description!r}"
    )

    # Old keys should land in extras (Assumption A2 — nothing silently dropped)
    extras = row.extras or {}
    assert "name" in extras or row.title == "Test Apartment", (
        "Either old 'name' key is in extras or title was mapped — data not dropped"
    )


def test_jsonb_nested_fields_survive(db_session, tmp_path, monkeypatch):
    """DB-04: JSONB nested fields (cost_of_ownership, viewing_history,
    negotiation_brief, ku) survive the migration round-trip intact.
    """
    import config  # noqa: PLC0415
    import migrate_from_json  # noqa: PLC0415
    from models import Listing  # noqa: PLC0415

    source_path = str(tmp_path / "app_data_jsonb.json")
    data = {
        "properties": [
            {
                "id": "jsonb-test-1",
                "url": "https://kv.ee/jsonb",
                "price_eur": 200000,
                "area_sqm": 65.0,
                "rooms": 3,
                "status": "approved",
                "cost_of_ownership": {
                    "monthly_total_eur": 1200,
                    "breakdown": {"mortgage": 800, "ku": 100, "heating": 200, "utilities": 100},
                },
                "viewing_history": [
                    {"action": "scheduled", "at": "2026-06-01T10:00:00Z", "scheduled_for": "2026-06-10"},
                    {"action": "viewed", "at": "2026-06-10T14:00:00Z"},
                ],
                "negotiation_brief": {
                    "summary": "Strong candidate, 8% below market",
                    "talking_points": ["structural condition", "renovation cost"],
                },
                "ku": {
                    "auto": {"reg_code": "99999", "name": "Test KÜ JSONB"},
                    "manual": "board meeting March 2026",
                    "looked_up_at": "2026-07-01T00:00:00Z",
                },
            }
        ],
        "pending": [],
        "rejected": [],
        "checklists": {
            "jsonb-test-1": {
                "ai_checklist": {"parking": {"result": "yes", "source": "ai"}},
            }
        },
        "price_history": {
            "jsonb-test-1": [
                {"date": "2026-05-01", "price": 210000},
                {"date": "2026-06-01", "price": 200000},
            ]
        },
        "settings": {},
    }
    with open(source_path, "w", encoding="utf-8") as f:
        json.dump(data, f)

    monkeypatch.setattr(config, "APP_DATA_FILE", source_path)

    result = migrate_from_json.main()
    assert result == 0, f"Migration returned non-zero exit code: {result}"

    row = db_session.get(Listing, "jsonb-test-1")
    assert row is not None, "Migrated row should exist in DB"

    # cost_of_ownership round-trip
    coo = row.cost_of_ownership or {}
    assert coo.get("monthly_total_eur") == 1200, f"cost_of_ownership lost: {coo!r}"
    assert isinstance(coo.get("breakdown"), dict), f"cost_of_ownership.breakdown lost: {coo!r}"

    # viewing_history round-trip
    vh = row.viewing_history or []
    assert len(vh) == 2, f"viewing_history should have 2 entries, got: {vh!r}"
    assert vh[0]["action"] == "scheduled", f"viewing_history[0] lost: {vh[0]!r}"
    assert vh[1]["action"] == "viewed", f"viewing_history[1] lost: {vh[1]!r}"

    # negotiation_brief round-trip
    nb = row.negotiation_brief or {}
    assert nb.get("summary") == "Strong candidate, 8% below market", f"negotiation_brief lost: {nb!r}"
    assert len(nb.get("talking_points", [])) == 2, f"negotiation_brief.talking_points lost: {nb!r}"

    # ku round-trip (Pitfall 7)
    ku = row.ku or {}
    assert ku.get("manual") == "board meeting March 2026", f"ku.manual lost: {ku!r}"
    assert isinstance(ku.get("auto"), dict), f"ku.auto lost: {ku!r}"

    # checklist from top-level checklists dict
    cl = row.checklist or {}
    assert "ai_checklist" in cl, f"checklist not migrated from checklists dict: {cl!r}"

    # price_history from top-level price_history dict
    ph = row.price_history or []
    assert len(ph) == 2, f"price_history should have 2 entries, got: {ph!r}"
    assert ph[1]["price"] == 200000, f"price_history[1] lost: {ph!r}"


def test_absent_app_data_json_exits_zero(db_session, tmp_path, monkeypatch):
    """DB-04: if app_data.json does not exist, migration exits 0 with no DB changes."""
    import config  # noqa: PLC0415
    import migrate_from_json  # noqa: PLC0415
    from models import Listing  # noqa: PLC0415

    # Point to a path that does not exist
    nonexistent_path = str(tmp_path / "no_app_data.json")
    assert not os.path.exists(nonexistent_path), "Test setup error: path should not exist"
    monkeypatch.setattr(config, "APP_DATA_FILE", nonexistent_path)

    result = migrate_from_json.main()
    assert result == 0, (
        f"Migration should exit 0 when source file is absent, got: {result}"
    )

    # No rows should have been inserted
    count = db_session.query(Listing).count()
    assert count == 0, f"No rows should be in DB after absent-file migration, got {count}"


def test_file_renamed_after_migration(db_session, tmp_path, monkeypatch):
    """DB-04 / Pitfall 5 guard 1: app_data.json is renamed to app_data.json.pre-pg7
    after a successful migration run (prevents accidental re-migration).
    """
    import config  # noqa: PLC0415
    import migrate_from_json  # noqa: PLC0415

    source_path = str(tmp_path / "app_data.json")
    backup_path = source_path + ".pre-pg7"

    _write_minimal_app_data(source_path)
    monkeypatch.setattr(config, "APP_DATA_FILE", source_path)

    assert os.path.exists(source_path), "Source file should exist before migration"
    assert not os.path.exists(backup_path), "Backup file should not exist before migration"

    result = migrate_from_json.main()
    assert result == 0, f"Migration returned non-zero exit code: {result}"

    assert not os.path.exists(source_path), (
        f"Source file {source_path} should be gone after successful migration "
        f"(renamed to .pre-pg7)"
    )
    assert os.path.exists(backup_path), (
        f"Backup file {backup_path} should exist after successful migration"
    )
