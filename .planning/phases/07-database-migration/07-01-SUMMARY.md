---
phase: 07-database-migration
plan: "01"
subsystem: database
tags: [sqlalchemy, alembic, postgres, docker, orm, migration]
status: complete

dependency_graph:
  requires:
    - 07-00  # Wave 0 RED scaffolds and requirements.txt updates
  provides:
    - db.py engine + SessionLocal + Base + get_db
    - models.Listing ORM class (50 columns)
    - Alembic baseline revision 0001
    - Postgres container in compose + health-gated startup
  affects:
    - app/config.py (POSTGRES_* block appended)
    - app/Dockerfile (postgresql-client + entrypoint CMD)
    - docker-compose.yml (postgres service + depends_on)

tech_stack:
  added:
    - SQLAlchemy 2.x ORM (MappedAsDataclass + DeclarativeBase + Mapped[T] API)
    - Alembic 1.18.5 (baseline migration, env.py with target_metadata)
    - psycopg[binary] (psycopg3 driver, postgresql+psycopg:// DSN scheme)
    - postgres:16-alpine Docker image (private compose network, no public port)
    - postgresql-client apt package (pg_isready for entrypoint health loop)
  patterns:
    - pool_pre_ping=True on engine (survives pg restart on every deploy)
    - expire_on_commit=False on SessionLocal (never-raise attribute access after commit)
    - create_type=False on ENUM + explicit .create(checkfirst=True) before op.create_table
    - import models in alembic/env.py (load-bearing: populates Base.metadata for autogenerate)
    - exec uvicorn in entrypoint.sh (PID 1 receives SIGTERM cleanly)
    - Two-layer Postgres startup guard: compose depends_on service_healthy + entrypoint pg_isready loop

key_files:
  created:
    - app/db.py
    - app/models.py
    - app/alembic.ini
    - app/alembic/env.py
    - app/alembic/script.py.mako
    - app/alembic/versions/0001_initial_schema.py
    - app/entrypoint.sh
  modified:
    - app/config.py (POSTGRES_* block appended)
    - app/Dockerfile (postgresql-client, entrypoint.sh COPY + CMD)
    - docker-compose.yml (postgres service, postgres_data volume, depends_on)
    - app/tests/conftest.py (Docker-mode detection via POSTGRES_USER, postgresql_noproc)
    - app/tests/test_alembic.py (Docker-mode DSN selection)

decisions:
  - "Use MappedAsDataclass + DeclarativeBase (SQLAlchemy 2.x new-style API) for Listing ORM — avoids legacy mapped_class() + Column() pattern; Mapped[T] typing works with mypy"
  - "create_type=False on the module-level postgresql.ENUM object + explicit .create(checkfirst=True) in upgrade() — prevents DuplicateObject when SQLAlchemy _on_table_create fires a second CREATE TYPE"
  - "db_session fixture routes to config.DATABASE_URL in Docker mode (already-migrated schema) rather than spawning a test DB via DatabaseJanitor — avoids pg_ctl/pg_config dependency in slim container"
  - "Two-layer Postgres guard: depends_on service_healthy + entrypoint pg_isready loop — defence in depth per T-07-01-04"
  - "JSONB columns use default_factory=dict/list without MutableDict.as_mutable — reassign-whole-dict convention enforced to avoid false sense of tracking safety"

metrics:
  duration: "~4 hours (context window, Docker debugging rounds)"
  completed: "2026-08-01"
  tasks_completed: 3
  files_created: 7
  files_modified: 5

requirements_addressed:
  - DB-01  # SQLAlchemy engine + SessionLocal
  - DB-02  # Listing ORM model
  - DB-03  # Alembic baseline migration
  - DB-06  # Docker compose Postgres service + entrypoint
---

# Phase 7 Plan 01: Database Scaffold Summary

**One-liner:** SQLAlchemy engine + 50-column Listing ORM + Alembic baseline migration 0001 + postgres:16-alpine compose service with health-gated entrypoint.

## What Was Built

Wave 1 stands up the database plumbing so Waves 2-5 can rewire callers. `data_store.py` and all HTTP routes are untouched — Postgres is added as a parallel resource.

### Task 1 — app/db.py + app/models.py + config.py POSTGRES_* block (commit 5020ea1)

- `app/db.py`: module-level SQLAlchemy engine (`pool_pre_ping=True`, `future=True`), `SessionLocal` (`expire_on_commit=False`), `Base(MappedAsDataclass, DeclarativeBase)`, and `get_db()` FastAPI dependency generator.
- `app/models.py`: `Listing` ORM class with 50 columns — flat scalars for indexable fields, JSONB for nested structures (`cost_of_ownership`, `viewing_history`, `checklist`, `score_breakdown`, `ai_checklist_fills`, `strengths`, `concerns`, `risks`, `extras`, `price_history`, `ku`, `negotiation_brief`), Postgres native ENUM for `status` with the 5 Phase-6-compatible values, `VARCHAR(64)` primary key `id`.
- `app/config.py`: appended `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_HOST`, `POSTGRES_PORT`, and the composed `DATABASE_URL` (with env-override support). Never logged per T-07-01-01.

### Task 2 — Alembic scaffold + baseline revision 0001 (commit b2a33d5)

- `app/alembic.ini`: minimal config, `sqlalchemy.url` blank (env.py overrides at runtime).
- `app/alembic/env.py`: sys.path insertion, `import config as app_config; from db import Base; import models` (`import models` is load-bearing — without it `Base.metadata` is empty and autogenerate produces empty revisions), `target_metadata = Base.metadata`, both offline and online migration runners.
- `app/alembic/versions/0001_initial_schema.py`: hand-written baseline — `revision="0001"`, `down_revision=None`; `upgrade()` creates the `listing_status` ENUM then the `listings` table with all 50 columns + 3 indexes (`ix_listings_district`, `ix_listings_price_eur`, `ix_listings_status`); `downgrade()` reverses in correct order (table before ENUM).

### Task 3 — Docker compose Postgres + entrypoint.sh + Dockerfile (commit 1102779)

- `docker-compose.yml`: added `postgres:16-alpine` service with `pg_isready` healthcheck (interval 5s, timeout 5s, retries 10, start_period 15s), `postgres_data` volume, no public port (private compose network only per T-07-01-02); `app` service now has `depends_on: postgres: condition: service_healthy`; caddy service and `apartment_data` volume preserved unchanged.
- `app/entrypoint.sh`: `set -e` fail-fast; `pg_isready` wait loop → `alembic upgrade head` → placeholder `echo` for Wave 3 JSON migration → `exec uvicorn main:app --host 0.0.0.0 --port 8000`.
- `app/Dockerfile`: added `RUN apt-get install -y postgresql-client` (before pip install for layer caching), `COPY entrypoint.sh /app/entrypoint.sh`, `RUN chmod +x /app/entrypoint.sh`, `CMD ["/app/entrypoint.sh"]`; `WORKDIR /app` preserved.

### Fix commit — Alembic ENUM + nullable timestamps + Docker test fixture (commit 319da58)

- `0001_initial_schema.py`: added `create_type=False` to module-level `listing_status_enum` object; used that object as the `status` column type in `op.create_table()` (not a fresh `sa.Enum()` instance) to prevent the `DuplicateObject: type "listing_status" already exists` error caused by SQLAlchemy's `_on_table_create` hook firing a second `CREATE TYPE`; added `nullable=False` to `created_at`/`updated_at` to match `Mapped[datetime]` (non-optional) in models.py.
- `app/tests/conftest.py`: added `_IN_DOCKER = bool(os.environ.get("POSTGRES_USER"))` detection; Docker mode uses `postgresql_noproc` factory (connects to compose service, no subprocess spawn needed — slim container has no `pg_ctl`/`pg_config`); `db_session` fixture routes to `config.DATABASE_URL` in Docker mode (already-migrated production DB) instead of trying to create/migrate a `tests` DB.
- `app/tests/test_alembic.py`: uses `config.DATABASE_URL` in Docker mode for Alembic test DSN.

## Test Results

All 5 Wave 0 RED targets pass (confirmed in Docker container):

```
tests/test_db_smoke.py::test_engine_connects PASSED
tests/test_models.py::test_listing_roundtrip PASSED
tests/test_models.py::test_status_enum_rejects_invalid PASSED
tests/test_models.py::test_jsonb_mutation_requires_reassign PASSED
tests/test_alembic.py::test_alembic_head_matches_metadata PASSED
5 passed, 1 warning
```

`tests/test_migration.py` stays RED (2 failed: `ModuleNotFoundError: No module named 'migrate_from_json'`) — expected; Wave 3 will flip it.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed DuplicateObject on listing_status ENUM creation**
- **Found during:** Task 2 verification (alembic upgrade head in Docker)
- **Issue:** `postgresql.ENUM(..., name="listing_status")` without `create_type=False` caused SQLAlchemy's `_on_table_create` event hook to fire a second `CREATE TYPE` DDL after the explicit `listing_status_enum.create(checkfirst=True)` already ran. Postgres raised `DuplicateObject: type "listing_status" already exists`.
- **Fix:** Set `create_type=False` on the module-level `listing_status_enum` object and referenced that same object as the `status` column type in `op.create_table()` (instead of a fresh `sa.Enum()` instance). This makes `listing_status_enum.create()` the single, explicit owner of `CREATE TYPE`.
- **Files modified:** `app/alembic/versions/0001_initial_schema.py`
- **Commit:** 319da58

**2. [Rule 1 - Bug] Fixed nullable drift on created_at/updated_at columns**
- **Found during:** Task 2 verification (test_alembic_head_matches_metadata compare_metadata)
- **Issue:** Alembic migration created `created_at`/`updated_at` without `nullable=False`, but `Mapped[datetime]` in `models.py` is non-optional (implies `NOT NULL`). `compare_metadata` detected the drift and returned a non-empty diff, failing the test.
- **Fix:** Added `nullable=False` to both timestamp columns in `0001_initial_schema.py`.
- **Files modified:** `app/alembic/versions/0001_initial_schema.py`
- **Commit:** 319da58

**3. [Rule 3 - Blocking] Adapted pytest-postgresql for Docker container context**
- **Found during:** Task 3 verification (pytest run inside Docker container)
- **Issue:** `postgresql_proc` factory tries to spawn a Postgres subprocess via `pg_ctl`/`pg_config`, which are not available in `python:3.12-slim` (only `postgresql-client` is installed). Tests failed with `ExecutableMissingException: Could not find pg_config executable`. Additionally, a `DuplicateDatabase: database "tests" already exists` error from a leftover debug session blocked subsequent runs.
- **Fix:** Detected Docker compose environment via `_IN_DOCKER = bool(os.environ.get("POSTGRES_USER"))`; in Docker mode, use `postgresql_noproc` factory (connects to already-running compose service) and route `db_session` directly to `config.DATABASE_URL` (already-migrated `aparts_looker` DB, skipping the `tests` DB / `DatabaseJanitor` entirely for session setup).
- **Files modified:** `app/tests/conftest.py`, `app/tests/test_alembic.py`
- **Commit:** 319da58

## Commits

| Hash | Message |
|------|---------|
| 5020ea1 | feat(07-01): add db.py + models.py + POSTGRES_* config block |
| b2a33d5 | feat(07-01): scaffold Alembic + baseline migration 0001_initial_schema |
| 1102779 | feat(07-01): add postgres service, entrypoint.sh, Dockerfile changes |
| 319da58 | fix(07-01): correct alembic ENUM create_type, nullable timestamps, Docker fixture |

## Security

All T-07-01 threats addressed per threat model:

| Threat ID | Status |
|-----------|--------|
| T-07-01-01 | Mitigated — `DATABASE_URL` never logged; db.py module docstring warns explicitly |
| T-07-01-02 | Mitigated — no `ports:` on postgres service; private compose network only |
| T-07-01-03 | Mitigated — `alembic upgrade head` runs on every container start in entrypoint.sh |
| T-07-01-04 | Mitigated — two-layer guard: `depends_on: condition: service_healthy` + `pg_isready` loop |
| T-07-01-SC | Mitigated — pinned `postgres:16-alpine` tag; no additional apt packages on Postgres container |

## Known Stubs

- `entrypoint.sh` line: `echo "Migrating legacy JSON if present (idempotent)..."` — intentional placeholder. Wave 3 will replace this `echo` with `python migrate_from_json.py`. The plan explicitly calls for this two-phase approach.

## Self-Check: PASSED

- app/db.py: FOUND
- app/models.py: FOUND
- app/alembic.ini: FOUND
- app/alembic/env.py: FOUND
- app/alembic/script.py.mako: FOUND
- app/alembic/versions/0001_initial_schema.py: FOUND
- app/entrypoint.sh: FOUND
- Commits 5020ea1, b2a33d5, 1102779, 319da58: all verified in git log
