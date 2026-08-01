"""
RED tests for DB-04: migrate_from_json.py is idempotent and preserves ku.manual.

Wave 0 state: `migrate_from_json` module does not exist — both tests fail with
ModuleNotFoundError at the `import migrate_from_json` line inside each test body.
Wave 3 lands app/migrate_from_json.py and makes these tests GREEN.

Contracts pinned (per RESEARCH § Pitfall 5, Pitfall 7):
  1. test_idempotent_rerun — running migration twice results in exactly N rows,
     not 2N (idempotency via db.merge, Pitfall 5).
  2. test_preserves_ku_manual — an entry with ku.manual survives the migration
     and a subsequent ku refresh (Pitfall 7).
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
