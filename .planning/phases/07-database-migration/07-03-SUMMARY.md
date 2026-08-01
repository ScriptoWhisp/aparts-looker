---
phase: 07-database-migration
plan: "03"
subsystem: database
tags: [migration, postgres, sqlalchemy, idempotency, jsonb, entrypoint]

requires:
  - phase: 07-02
    provides: data_store.py SQLAlchemy rewrite, db.py, models.py, db_session fixture

provides:
  - app/migrate_from_json.py — one-shot idempotent JSON→DB loader (~260 lines)
  - app/entrypoint.sh — placeholder replaced with python migrate_from_json.py call
  - app/tests/test_migration.py — 6 tests GREEN (was 2 RED in Wave 0)
  - app/tests/conftest.py — migrate_from_json.SessionLocal patched in db_session fixture

affects: [07-04, 07-05, entrypoint.sh, container startup]

tech-stack:
  added: []
  patterns:
    - "Dynamic config.APP_DATA_FILE resolution in main() (not module-level) for test patchability"
    - "del_attribute on non-provided columns before db_.merge() — prevents NOT NULL violations on second migration run (same as data_store Wave 2 fix)"
    - "conftest db_session patches all three module-local SessionLocal bindings: db.SessionLocal, data_store.SessionLocal, migrate_from_json.SessionLocal"
    - "Two-guard idempotency: file-rename (os.replace → .pre-pg7) + db.merge upsert by PK"

key-files:
  created:
    - app/migrate_from_json.py
  modified:
    - app/entrypoint.sh
    - app/tests/test_migration.py
    - app/tests/conftest.py

key-decisions:
  - "Resolve SOURCE/BACKUP from config.APP_DATA_FILE at call time in main() — module-level binding would capture the value at import time, defeating monkeypatch in tests"
  - "Apply del_attribute on all columns not in fields before db_.merge() — prevents UPDATE SET created_at=NULL on second migration run (MappedAsDataclass sets all columns to Python defaults in __init__)"
  - "Patch migrate_from_json.SessionLocal in conftest.db_session — three module-local bindings exist (db, data_store, migrate_from_json), all must be patched for test session isolation"

patterns-established:
  - "Any new module doing `from db import SessionLocal` must be added to conftest.db_session's patch list"
  - "Migration scripts must read config values dynamically (not at module scope) to remain test-patchable"

requirements-completed:
  - DB-04

coverage:
  - id: MIG-01
    description: "migrate_from_json.main() is idempotent: running twice produces same row count"
    verification:
      - kind: unit
        ref: "tests/test_migration.py::test_idempotent_rerun"
        status: pass
    human_judgment: false
  - id: MIG-02
    description: "ku.manual survives migration intact (Pitfall 7)"
    verification:
      - kind: unit
        ref: "tests/test_migration.py::test_preserves_ku_manual"
        status: pass
    human_judgment: false
  - id: MIG-03
    description: "Legacy field aliases (name/area/year/price/pricePerSqm/notes) map to correct columns"
    verification:
      - kind: unit
        ref: "tests/test_migration.py::test_legacy_field_aliases"
        status: pass
    human_judgment: false
  - id: MIG-04
    description: "JSONB nested fields (cost_of_ownership, viewing_history, negotiation_brief, ku) survive round-trip"
    verification:
      - kind: unit
        ref: "tests/test_migration.py::test_jsonb_nested_fields_survive"
        status: pass
    human_judgment: false
  - id: MIG-05
    description: "Absent app_data.json → exit 0, no DB rows inserted"
    verification:
      - kind: unit
        ref: "tests/test_migration.py::test_absent_app_data_json_exits_zero"
        status: pass
    human_judgment: false
  - id: MIG-06
    description: "app_data.json renamed to .pre-pg7 after successful migration"
    verification:
      - kind: unit
        ref: "tests/test_migration.py::test_file_renamed_after_migration"
        status: pass
    human_judgment: false
  - id: MIG-07
    description: "Container boots correctly: alembic → migrate → uvicorn order preserved"
    verification:
      - kind: integration
        ref: "docker compose logs app | grep -A5 'Migrating legacy'"
        status: pass
    human_judgment: false

duration: ~15min
completed: 2026-08-01
status: complete
---

# Phase 7 Plan 03: One-shot idempotent JSON migration + entrypoint wiring Summary

**migrate_from_json.py created with two-guard idempotency, entrypoint.sh wired, 6 Wave 0→GREEN tests; del_attribute fix and dynamic config resolution required for test patchability**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-08-01T10:05:12Z
- **Completed:** 2026-08-01
- **Tasks:** 2 plan tasks (+ 2 auto-fixes)
- **Files modified:** 4

## Accomplishments

- `app/migrate_from_json.py` created: one-shot idempotent JSON→DB loader
  - Guard 1: file existence check (SOURCE absent → exit 0, no DB operation)
  - Guard 2: `db_.merge()` upsert by PK (safe even if Guard 1 missed)
  - `_entry_to_row()`: applies `_LEGACY_ALIASES`, spills unknown keys to `extras` JSONB (A2), copies `ku` as-is preserving `ku.manual` (Pitfall 7), coerces JSONB None→[]/{}
  - `del_attribute` on all non-provided columns before merge (prevents NOT NULL on UPDATE)
  - Logs listing IDs and counts only — no connection strings or passwords
  - Exit 1 on SQLAlchemyError so entrypoint.sh `set -e` restarts container (fail-loud)
  - `os.replace(SOURCE, BACKUP)` after commit — POSIX-atomic rename to `.pre-pg7`
- `app/entrypoint.sh` wired: placeholder comment replaced with `python migrate_from_json.py`
  - Order: pg_isready → alembic upgrade head → migrate → exec uvicorn
  - `set -e` intact — any failure restarts container
- `app/tests/test_migration.py` expanded from 2 (RED) to 6 (GREEN) tests
- `app/tests/conftest.py` patched: `migrate_from_json.SessionLocal` added to `db_session` fixture's patch list

## Task Commits

1. **Task 1: migrate_from_json.py** - `6390712` (feat)
2. **Task 2: entrypoint.sh wiring** - `9291118` (feat)
3. **Wave 0 tests GREEN + 4 new + conftest fix** - `90c9822` (test)

## Files Created/Modified

- `app/migrate_from_json.py` - Created: idempotent one-shot JSON→DB loader
- `app/entrypoint.sh` - Modified: Wave 1 placeholder replaced with real invoke
- `app/tests/test_migration.py` - Modified: 6 tests (was 2 RED); docstring updated
- `app/tests/conftest.py` - Modified: migrate_from_json.SessionLocal patch added to db_session

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Module-level SOURCE = config.APP_DATA_FILE captured value at import time**
- **Found during:** Task 1 (test run)
- **Issue:** `SOURCE: str = config.APP_DATA_FILE` at module scope bound the value when the module was first imported. `monkeypatch.setattr(config, "APP_DATA_FILE", ...)` in tests changed `config.APP_DATA_FILE` but not `migrate_from_json.SOURCE`, causing `main()` to read from the real production path.
- **Fix:** Moved SOURCE/BACKUP resolution inside `main()` — `source: str = config.APP_DATA_FILE` — so the value is read at call time, not import time.
- **Files modified:** app/migrate_from_json.py
- **Commit:** 90c9822

**2. [Rule 1 - Bug] db_.merge() on second run issued UPDATE SET created_at=NULL**
- **Found during:** Task 1 (test_idempotent_rerun second run)
- **Issue:** `MappedAsDataclass` sets all columns to Python defaults in `__init__`, including `created_at=None`. On the UPDATE path of `db_.merge()`, SQLAlchemy issued `SET created_at=None` violating the NOT NULL constraint. First run succeeds (INSERT path uses server_default); second run fails (UPDATE path).
- **Fix:** Applied `_sa_attributes.del_attribute(obj, col)` for all columns NOT in `fields` (except `id` PK), identical to Wave 2 fix in `data_store.save_app_data`.
- **Files modified:** app/migrate_from_json.py
- **Commit:** 90c9822

**3. [Rule 2 - Missing critical functionality] conftest.db_session did not patch migrate_from_json.SessionLocal**
- **Found during:** Task 1 (test_idempotent_rerun first run showed 0 rows)
- **Issue:** `migrate_from_json.py` does `from db import SessionLocal` at module load, creating a module-local binding. `conftest.db_session` patched `db.SessionLocal` and `data_store.SessionLocal` but not `migrate_from_json.SessionLocal`. Migration ran against the real production DB (different connection) instead of the test's shared savepoint transaction — so the test query saw 0 rows.
- **Fix:** Added `try: import migrate_from_json; monkeypatch.setattr(..., "SessionLocal", _make_session); except ImportError: pass` to the db_session fixture's patch block.
- **Files modified:** app/tests/conftest.py
- **Commit:** 90c9822

---

**Total deviations:** 3 auto-fixed (1 module-scope capture bug, 1 MappedAsDataclass merge bug, 1 missing fixture patch)
**Impact on plan:** All fixes were correctness requirements for the migration script and test isolation. No scope creep. Plan deliverables unchanged.

## Test Results

| Test File | Tests | Status |
|-----------|-------|--------|
| tests/test_migration.py | 6 | ALL PASS |
| tests/test_data_store.py | 5 | ALL PASS (no regression) |
| tests/test_pending.py | 11 | ALL PASS (no regression) |
| tests/test_viewing_workflow.py | 6 | ALL PASS (no regression) |
| tests/test_price_intelligence.py | 9 | ALL PASS (no regression) |
| tests/test_db_smoke.py | 1 | ALL PASS (no regression) |
| tests/test_alembic.py | 1 | ALL PASS (no regression) |
| tests/test_models.py | 3 | ALL PASS (no regression) |
| **Total** | **42** | **ALL PASS** |

Pre-existing failures in `test_commute.py`, `test_districts.py`, `test_eval_quality.py` are out of scope for Wave 3 (Waves 4/5 scope per plan).

## Container Verification

```
app-1 | Waiting for Postgres at postgres:5432...
app-1 | Postgres ready.
app-1 | Applying Alembic migrations...
app-1 | Migrating legacy JSON if present (idempotent)...
app-1 | No /app/data/app_data.json — nothing to migrate (already ran, or fresh install)
app-1 | Starting uvicorn...
app-1 | INFO: Application startup complete.
```

## Known Stubs

None — all migration paths are fully implemented. The `.pre-pg7` backup file in the volume is an intentional artifact, not a stub.

## Threat Flags

None — no new network endpoints or auth paths introduced. Migration script reads only the Docker volume-mounted file and writes to the already-established Postgres connection.

---
*Phase: 07-database-migration*
*Completed: 2026-08-01*

## Self-Check: PASSED

- app/migrate_from_json.py: FOUND
- app/entrypoint.sh: FOUND (python migrate_from_json.py line present)
- app/tests/test_migration.py: FOUND (6 tests)
- app/tests/conftest.py: FOUND (migrate_from_json.SessionLocal patch present)
- Commit 6390712: FOUND
- Commit 9291118: FOUND
- Commit 90c9822: FOUND
