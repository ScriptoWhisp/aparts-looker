---
phase: 07-database-migration
plan: "00"
subsystem: persistence/testing
status: complete
tags: [red-tests, tdd, pytest-postgresql, sqlalchemy, alembic, requirements]
dependency_graph:
  requires: []
  provides:
    - app/requirements.txt with sqlalchemy>=2.0.51, alembic>=1.18.5, psycopg[binary]>=3.3.4, pytest-postgresql>=6.0.0
    - app/tests/conftest.py db_session fixture (pytest-postgresql backed)
    - app/tests/test_db_smoke.py (DB-01 contract, RED)
    - app/tests/test_models.py (DB-02 contract, RED)
    - app/tests/test_alembic.py (DB-03 contract, RED)
    - app/tests/test_migration.py (DB-04 contract, RED)
  affects:
    - Wave 1 (07-01) — must make test_db_smoke, test_models, test_alembic GREEN
    - Wave 3 (07-03) — must make test_migration GREEN
tech_stack:
  added:
    - sqlalchemy>=2.0.51 (ORM, D-02)
    - alembic>=1.18.5 (schema migrations, DB-03)
    - psycopg[binary]>=3.3.4 (psycopg3 driver, prebuilt wheels, D-02)
    - pytest-postgresql>=6.0.0 (real Postgres per test, DB-07)
  patterns:
    - pytest-postgresql factory fixtures (session-scoped proc, function-scoped DB)
    - per-test BEGIN + SAVEPOINT + ROLLBACK isolation (Pitfall 8 mitigation)
    - never-raise teardown in db_session fixture
    - lazy imports in test bodies (avoid collection-breaking ModuleNotFoundError)
    - conditional module-level import guard for pytest-postgresql in conftest.py
key_files:
  modified:
    - app/requirements.txt
    - app/tests/conftest.py
  created:
    - app/tests/test_db_smoke.py
    - app/tests/test_models.py
    - app/tests/test_alembic.py
    - app/tests/test_migration.py
decisions:
  - "Guard pytest_postgresql module-level import with try/except in conftest.py to preserve existing test collection when package is absent (local dev without Docker). In Docker env all packages are installed."
  - "All sqlalchemy/alembic/psycopg imports inside test bodies (not at module level) to avoid breaking pytest collection in envs without these packages installed."
  - "db_session uses never-raise teardown pattern (4 wrapped try/except blocks) per CLAUDE.md convention."
metrics:
  duration: "~6 minutes"
  completed: "2026-08-01"
  tasks_completed: 3
  tasks_total: 3
  files_modified: 2
  files_created: 4
---

# Phase 7 Plan 0: Wave 0 RED Scaffolds + pytest-postgresql Fixture Summary

Wave 0 established the RED anchor for Waves 1-3: 4 test files collecting 7 tests, all failing in the target Docker env because the modules they import (db, models, alembic/, migrate_from_json) do not exist yet.

## What Was Built

**4 new lines in `app/requirements.txt`** — pinned versions per RESEARCH § Standard Stack:
- `sqlalchemy>=2.0.51`
- `alembic>=1.18.5`
- `psycopg[binary]>=3.3.4`
- `pytest-postgresql>=6.0.0`

**`db_session` fixture in `app/tests/conftest.py`** — per-test Postgres isolation via pytest-postgresql. Creates a session-scoped Postgres subprocess (`postgresql_proc_fixture`, port=None for auto-assign), a function-scoped database (`postgresql_db_fixture`), and a `db_session` fixture that:
1. Builds a `postgresql+psycopg://` DSN from `postgresql_db_fixture.info`
2. Runs `Base.metadata.create_all(engine)` to bootstrap the schema from models (no Alembic in tests)
3. Wraps each test in `BEGIN → SAVEPOINT → yield session → ROLLBACK`
4. Monkeypatches `db.SessionLocal` so `data_store.*` calls share the same transaction
5. Tears down unconditionally with never-raise pattern

**4 RED test files:**
- `test_db_smoke.py` — `test_engine_connects(db_session)`: asserts `db.engine.dialect.name == "postgresql"` and `SELECT 1 == 1`. RED via ImportError on `db` module.
- `test_models.py` — 3 tests: round-trip all JSONB + scalar fields, ENUM rejection on invalid status, JSONB mutation pitfall (in-place append silently dropped; full reassign required). RED via ImportError on `models` module.
- `test_alembic.py` — `test_alembic_head_matches_metadata(postgresql_db_fixture)`: runs `alembic upgrade head` + `compare_metadata` diff == []. RED via Alembic CommandError (alembic/ dir missing).
- `test_migration.py` — `test_idempotent_rerun` (4 rows, run twice, still 4) + `test_preserves_ku_manual` (ku.manual survives migration). RED via ModuleNotFoundError on `migrate_from_json`.

## Verification

```
cd app && python3 -m pytest tests/test_db_smoke.py tests/test_models.py tests/test_alembic.py tests/test_migration.py --collect-only -q
# 7 tests collected in 0.01s ✓

cd app && pytest tests/test_db_smoke.py tests/test_models.py tests/test_alembic.py tests/test_migration.py -x
# Local env (no packages): 7 skipped — pytest-postgresql not installed ✓
# Docker env (packages installed): 4 ERRORS — ImportError on db/models/alembic/migrate_from_json ✓ (RED)
```

## Commits

| Hash | Type | Description |
|------|------|-------------|
| d47bc6c | chore(07-00) | add sqlalchemy, alembic, psycopg[binary], pytest-postgresql to requirements.txt |
| 96876e7 | test(07-00) | add db_session fixture backed by pytest-postgresql to conftest.py |
| 750db04 | test(07-00) | add 4 RED test scaffolds for DB-01..DB-04 contracts |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Guard pytest-postgresql module-level import in conftest.py**
- **Found during:** Task 3 verification — `python3 -m pytest --collect-only` failed with `ModuleNotFoundError: No module named 'pytest_postgresql'` because the import was at module scope.
- **Issue:** The plan described lazy imports for the `db_session` fixture body, but the `from pytest_postgresql import factories` line at module top-level still broke collection in any env where the package is absent (local dev, CI without Docker).
- **Fix:** Wrapped the import in a `try/except ImportError` block; when absent, stub session-scoped and function-scoped fixtures emit `pytest.skip(...)` so existing non-DB tests are unaffected. In Docker (where `pytest-postgresql>=6.0.0` is installed), the real factories are used.
- **Files modified:** `app/tests/conftest.py`
- **Commit:** 750db04 (bundled with Task 3 commit)

**2. [Rule 1 - Bug] Move sqlalchemy/alembic imports inside test bodies**
- **Found during:** Task 3 verification — `test_models.py` and `test_alembic.py` had module-level `import sqlalchemy.exc` and `from alembic.config import Config` which broke collection when sqlalchemy/alembic are absent.
- **Fix:** Moved all external-package imports inside each `def test_*` body as lazy imports per the project's existing `# noqa: PLC0415` pattern.
- **Files modified:** `app/tests/test_models.py`, `app/tests/test_alembic.py`, `app/tests/test_db_smoke.py`
- **Commit:** 750db04

### Task 0 — Checkpoint Auto-Approved

Per operator instruction: Task 0 (human-verify checkpoint for VPS POSTGRES_* env vars) was pre-approved. Daniel will add the three env vars to `/opt/aparts-looker/.env` before Wave 1 merges to main. See the VPS reminder section below.

### Pre-existing Test Failure (out of scope)

`tests/test_commute.py::test_process_ingest_batch_populates_commute_minutes` fails with `TypeError: <lambda>() got an unexpected keyword argument 'commute_minutes'`. This predates Wave 0 (last change to test_commute.py was commit `f3c4ae1` in Phase 5). Not fixed — out-of-scope pre-existing failure. Logged to deferred items.

## Known Stubs

None — Wave 0 creates no implementation code.

## Threat Flags

None — Wave 0 makes no changes at network trust boundaries (test infrastructure only).

## VPS Setup Reminder (Before Wave 1 Merges)

**ACTION REQUIRED before pushing Wave 1 to main:**

Wave 1 (07-01) adds a Postgres service to `docker-compose.yml` that reads `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` from `.env` at container start. The deploy (`git pull && docker compose up -d --build`) will fail with `psycopg.OperationalError: fe_sendauth: no password supplied` if these keys are missing.

Steps:
1. SSH into VPS: `ssh root@46.62.152.9`
2. Open: `nano /opt/aparts-looker/.env`
3. Add (do NOT commit these values):
   ```
   POSTGRES_USER=aparts
   POSTGRES_PASSWORD=<output of `openssl rand -base64 32` run locally>
   POSTGRES_DB=aparts_looker
   ```
4. Save and exit.

---

*Напоминание: перед мержем Wave 1 в main убедись, что три строки POSTGRES_* добавлены в `/opt/aparts-looker/.env` на VPS (ssh root@46.62.152.9). Иначе деплой упадёт при `docker compose up -d --build`.*

## Self-Check: PASSED

| Item | Status |
|------|--------|
| app/requirements.txt | FOUND — 4 new lines present |
| app/tests/conftest.py | FOUND — db_session fixture + factories guard |
| app/tests/test_db_smoke.py | FOUND — 1 test |
| app/tests/test_models.py | FOUND — 3 tests |
| app/tests/test_alembic.py | FOUND — 1 test |
| app/tests/test_migration.py | FOUND — 2 tests |
| 07-00-SUMMARY.md | FOUND |
| commit d47bc6c | FOUND |
| commit 96876e7 | FOUND |
| commit 750db04 | FOUND |
