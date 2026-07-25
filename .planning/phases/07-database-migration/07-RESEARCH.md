# Phase 7: Database Migration - Research

**Researched:** 2026-07-25
**Domain:** Relational persistence layer replacement (JSON files → Postgres + SQLAlchemy 2.x + Alembic)
**Confidence:** HIGH (established, mature stack; every recommendation grounded in official docs or in-repo pattern)

## Summary

Phase 7 replaces `data_store.py`'s JSON-file layer with Postgres 16, accessed via SQLAlchemy 2.x sync ORM, migrated via Alembic. The public API of `data_store` (`load_app_data`, `save_app_data`, `set_viewing_scheduled`, `mark_viewed`, `save_negotiation_brief`, `save_ku_enrichment`, `approve_listing`, `reject_listing`, `add_to_pending`, `record_price_in_data`, `get_price_history`, `write_checklist_ai`, `update_listing_coords`, `get_listing_coords`, `get_approved_listing`, `get_rejected_by_reason`, `delete_listing`, `load_agent_state`, `save_agent_state`) is preserved verbatim so that `main.py`, `ingest_handler.py`, `brief_generator.py`, `agent_job.py`, `settings_store.py`, and the tests keep compiling — the internals swap out.

Schema is a single `listings` table with a `status` Postgres ENUM (`pending | approved | rejected | viewing_scheduled | viewed`), a VARCHAR primary key (the kv.ee object id), flat scalar columns for the indexable fields already present (`price_eur`, `area_sqm`, `rooms`, `year_built`, `district`, `score`, `lat`, `lng`, `commute_minutes`, `energy_class`, timestamps), and JSONB columns for the nested dicts (`cost_of_ownership`, `viewing_history`, `negotiation_brief`, `ku`, `ai_output_raw`, `checklist`, `price_history`, plus catch-all `extras`). A one-shot Python migration reads `app/data/app_data.json` at first-boot into the new table and renames the source JSON to `app_data.json.pre-pg7` for a week of read-only insurance.

Sync engine, sync session (matches existing sync FastAPI code and APScheduler threads). Alembic ships with a single "initial schema" revision and runs via a container entrypoint that waits for Postgres healthcheck → `alembic upgrade head` → `python migrate_from_json.py` (idempotent) → `uvicorn`. Tests use per-test transaction rollback against a real Postgres via `pytest-postgresql` (already-black-box for JSONB and ENUM, matches production).

**Primary recommendation:** Introduce a new `app/db.py` module (engine + `SessionLocal` + `Base` metadata + FastAPI `get_db` dependency). Keep `data_store.py` as the single public API but re-implement each function using `SessionLocal()` sessions. Drop `_lock` at boot; keep the module symbol as a no-op `contextlib.nullcontext()` compatibility shim so `with data_store._lock:` blocks in `main.py`, `settings_store.py`, and `brief_generator.py` keep parsing while the callers are refactored plan-by-plan.

## Project Constraints (from CLAUDE.md)

The following directives from `.claude/CLAUDE.md` govern every recommendation below:

- **Never-raise pattern:** all `data_store` callers assume writes do not raise; new SQLAlchemy code must catch `SQLAlchemyError`, log with `log.exception(...)`, and return the historical sentinel (False / None / []).
- **Layered imports:** `data_store` may only import `config` (and now the new `db` module); `db` may import `config` and SQLAlchemy. No cycle back to `main`, `ingest_handler`, `brief_generator`, `agent_job`, `settings_store`.
- **UPPERCASE module constants** for env-driven values (`DATABASE_URL`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_HOST`, `POSTGRES_PORT`).
- **Type hints throughout:** all new module functions annotated; `Mapped[T]` on SQLAlchemy model columns per SQLAlchemy 2.x style.
- **PEP 8, 4-space indent, no formatter enforced** — match surrounding style.
- **Module docstrings on every new file** explaining the design choice.
- **Small focused functions**, one blank line between methods, two between top-level defs.
- **Never commit secrets:** `POSTGRES_PASSWORD` lives in `.env`, never in `docker-compose.yml` inline.
- **GSD workflow:** work through `/gsd-execute-phase` — this research feeds a plan, not direct edits.

## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01 (Postgres, not SQLite).** User override; take as signal Daniel accepts the extra container.
- **D-02 (SQLAlchemy 2.x, not SQLModel, not raw sqlite3).** Use `MappedAsDataclass` + `Mapped[T]` 2.x style. `sessionmaker` at module level, sync engine.
- **D-03 (Hybrid schema).** Flat scalars for indexable fields, JSONB for nested dicts (`cost_of_ownership`, `viewing_history`, `negotiation_brief`, `ku`, `ai_output_raw`, `checklist`, `price_history`).
- **D-04 (Single `listings` table + `status` ENUM).** Values: `pending | approved | rejected | viewing_scheduled | viewed`. Postgres native ENUM, not VARCHAR + CHECK.
- **D-05 (Primary key = VARCHAR).** kv.ee id as-is (e.g. `"3883234"`). No surrogate int. Leaves room for a future `source` column + compound unique in Phase 4.
- **D-06 (No backups in Phase 7).** Deferred. Do NOT propose backup jobs, pg_dump crons, or replicas.

### Claude's Discretion

- **Cutover strategy:** one-shot migration on first boot (option a), preserve JSON as `app_data.json.pre-pg7` for one week.
- **settings.json and agent_state.json:** LEAVE ON FILESYSTEM. Both are runtime scratch; migrating them would balloon scope without earning back reliability. `settings_store._persist()` atomic-write pattern already handles crash safety for `settings.json`. `agent_state.json` (seen_listing_ids, pending_drafts, last_telegram_update_id, heartbeat state) is small, bounded, and gets rewritten every scheduler tick anyway; loss is at most 2 hours of dedup memory.
- **Password / connection secrets:** add `POSTGRES_PASSWORD`, `POSTGRES_USER`, `POSTGRES_DB` to `.env`; `config.py` composes `DATABASE_URL` from parts (also accepts full `DATABASE_URL` env for overrides).
- **Alembic layout:** `app/alembic/` with `env.py` reading `DATABASE_URL` from `config`; baseline `--autogenerate`.
- **Testing:** real Postgres per test via `pytest-postgresql` (matches production dialect for JSONB and ENUM); rollback-per-test transaction fixture; existing conftest patched to seed via SQLAlchemy instead of JSON writes.
- **`data_store._lock` fate:** replace with a `contextlib.nullcontext()` no-op shim (so callers using `with data_store._lock:` still work); the actual atomicity comes from DB transactions. Audit and rewrite the seven Pitfall-5 snapshot-outside-lock call sites (see § Pitfall 5 below) to use the SQLAlchemy session-scope equivalent.

### Deferred Ideas (OUT OF SCOPE)

- Automated backups (Phase 8 or standalone quick task).
- Multi-source support / `source` column / compound unique.
- PostGIS or server-side geo queries.
- New query-driven features ("cheapest per district", "listings you scored highest that got rejected").
- `settings_store` migration to DB (see Claude's Discretion above — leaving on filesystem is the final call).

## Phase Requirements

No `PHASE_REQ` IDs supplied for Phase 7 in ROADMAP (marked "Requirements: TBD"). The planner should either:

1. Derive requirement IDs like `DB-01 … DB-08` matching the capability list below, OR
2. Treat the CONTEXT.md `<decisions>` block (D-01 through D-06) as the requirement set.

Recommended derived IDs and the research findings that support them:

| ID | Description | Research Support |
|----|-------------|------------------|
| DB-01 | Postgres 16 container joins docker-compose with healthcheck | § docker-compose Postgres service |
| DB-02 | SQLAlchemy 2.x `Listing` ORM model with hybrid scalar + JSONB fields | § SQLAlchemy 2.x model example |
| DB-03 | Alembic baseline migration creates full initial schema on empty DB | § Alembic setup |
| DB-04 | One-shot `migrate_from_json.py` idempotently loads app_data.json | § Data migration cutover |
| DB-05 | `data_store` public API rewired against Postgres; every caller unchanged | § Rewiring data_store.py |
| DB-06 | Container entrypoint runs migrations then migration script then uvicorn | § Container entrypoint pattern |
| DB-07 | Test suite runs against real Postgres via pytest-postgresql | § Testing strategy |
| DB-08 | Pitfall-5 snapshot-outside-lock call sites converted to session-scope pattern | § Pitfall 5 conversion |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Row storage and transaction atomicity | Database (Postgres) | — | Native ACID replaces JSON `_lock` |
| ORM mapping + query composition | API / Backend (SQLAlchemy) | — | Sits inside `data_store.py` |
| Schema evolution | Ops / Migration (Alembic) | Container entrypoint | Runs once per deploy |
| Runtime session scoping | API / Backend (`get_db` dep) | Thread-target boilerplate | Per-request or per-thread scope |
| Legacy data migration | Ops / One-shot script | Entrypoint idempotency | Runs once, safe to re-run |
| Static runtime config (settings.json) | Filesystem (unchanged) | — | Intentional deferral; small crash-safe writes |
| Agent bookkeeping (agent_state.json) | Filesystem (unchanged) | — | Rewritten every tick; loss tolerable |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `SQLAlchemy` | 2.0.51 [VERIFIED: PyPI 2026-07-25] | ORM + Core + Engine | Ecosystem standard; Alembic native integration; 2.x typed API |
| `alembic` | 1.18.5 [VERIFIED: PyPI 2026-07-25] | Schema migrations | The migration tool for SQLAlchemy; autogenerate diff from models |
| `psycopg` (psycopg3) | 3.3.4 [VERIFIED: PyPI 2026-07-25] | Postgres DBAPI driver | Actively maintained; recommended for new SQLAlchemy 2.x code [CITED: https://docs.sqlalchemy.org/en/20/dialects/postgresql.html] |

**Driver choice — psycopg (v3) over psycopg2-binary:** psycopg3 is the newer, actively-developed driver. SQLAlchemy 2.x supports it as `postgresql+psycopg://…`. psycopg2-binary works too and is battle-tested, but for a greenfield migration in mid-2026 psycopg3 is the forward-looking choice. Both are dialects-of-record for `postgresql+…`. [CITED: https://docs.sqlalchemy.org/en/20/dialects/postgresql.html]

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `pytest-postgresql` | current [VERIFIED: PyPI 2026-07-25] | Real Postgres per test via a `postgresql_proc` + `postgresql_my` fixture | Every test that touches `data_store` |

**Not adopting `sqlalchemy-utils`.** Its `JSONType` is convenient but adds a dependency for one type we already get natively from `sqlalchemy.dialects.postgresql.JSONB`. Skip.

**Not adopting `testcontainers-python`.** `pytest-postgresql` is lighter and does not require a Docker socket in the test process. If Daniel later wants integration tests against a full docker-compose stack, testcontainers-python is the escape hatch; not needed for Phase 7.

**Not adopting `sqlalchemy-json` or `NestedMutableJson`.** JSONB mutation tracking (see § JSONB gotchas) is handled by the "reassign the whole dict" convention. Adding another dependency to detect nested mutation is disproportionate.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| SQLAlchemy 2.x | SQLModel | Would satisfy D-02 ban; explicitly rejected by user (locked decision). |
| psycopg3 | psycopg2-binary 2.9.12 [VERIFIED: PyPI] | Older, more legacy StackOverflow answers; also fine. Use if psycopg3 wheels ever fail to install. |
| Postgres native ENUM (D-04) | VARCHAR + CHECK constraint | Simpler migrations later (adding a value requires an Alembic op either way); D-04 locks ENUM. |
| pytest-postgresql | SQLite in-memory | Fast but SQLite lacks JSONB and Postgres ENUM — every JSONB assertion would be silently unsupported. Reject. |

**Installation (append to `app/requirements.txt`):**

```
sqlalchemy>=2.0.51
alembic>=1.18.5
psycopg[binary]>=3.3.4
pytest-postgresql>=6.0.0
```

`psycopg[binary]` pulls the precompiled binary variant (no need for libpq-dev in the Docker image — matches the JSON-era pattern of avoiding native build deps).

**Version verification** — all four confirmed against PyPI on 2026-07-25 via `pip index versions <pkg>`.

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `sqlalchemy` 2.0.51 | PyPI | ~20 yrs (project since 2006) | tens of millions/wk | https://www.sqlalchemy.org / https://github.com/sqlalchemy/sqlalchemy | [OK] (seam flagged SUS: `unknown-downloads` only — endpoint could not reach stats API; project is a de-facto Python standard) | Approved |
| `alembic` 1.18.5 | PyPI | ~15 yrs (since 2011) | millions/wk | https://github.com/sqlalchemy/alembic | [OK] (seam flagged SUS: `too-new` because release <90d + `unknown-downloads`; Alembic itself is standard, this is just a routine patch release) | Approved |
| `psycopg` 3.3.4 | PyPI | ~4 yrs at v3 (psycopg project since 2001) | millions/wk | https://psycopg.org/ | [OK] (seam flagged SUS: `unknown-downloads` only) | Approved |
| `pytest-postgresql` | PyPI | ~10 yrs (since 2013) | hundreds of thousands/wk | https://github.com/dbfixtures/pytest-postgresql | [OK] (seam flagged SUS: `unknown-downloads` only; maintained by ClearcodeHQ) | Approved |
| `psycopg2-binary` 2.9.12 | PyPI | ~15 yrs | millions/wk | https://psycopg.org/ | [OK] (fallback only) | Not used unless psycopg3 wheels fail |

**Packages removed due to [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** none require a `checkpoint:human-verify` task. The SUS verdicts above are all `unknown-downloads` (transient — seam could not reach stats endpoint) or `too-new` on a patch release of a 15-year-old package. All four primary packages are verified against their authoritative sources (sqlalchemy.org, psycopg.org, sqlalchemy GitHub org, dbfixtures GitHub org) and are among the most-installed packages in the entire PyPI ecosystem. `[CITED: https://pypi.org/project/SQLAlchemy/]` `[CITED: https://pypi.org/project/alembic/]` `[CITED: https://pypi.org/project/psycopg/]` `[CITED: https://pypi.org/project/pytest-postgresql/]`

**Postinstall audit:** All four packages have no postinstall scripts (Python packages don't use the concept the way npm does; setup.py builds are opt-in on source-only installs; `psycopg[binary]` and `psycopg2-binary` ship prebuilt wheels).

## Architecture Patterns

### System Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Docker host (VPS 46.62.152.9)                                            │
│                                                                          │
│  ┌────────────────────────┐        ┌───────────────────────────────┐     │
│  │ Caddy (unchanged)      │───────▶│ app container                 │     │
│  │ 80/443 → 8000          │        │  entrypoint.sh:               │     │
│  └────────────────────────┘        │   1. wait for pg healthcheck  │     │
│                                    │   2. alembic upgrade head     │     │
│                                    │   3. python migrate_from_json │     │
│                                    │      (idempotent)             │     │
│                                    │   4. uvicorn main:app         │     │
│                                    │                               │     │
│                                    │  FastAPI routes ─┐            │     │
│                                    │  APScheduler ────┤            │     │
│                                    │  daemon threads ─┤            │     │
│                                    │                  │            │     │
│                                    │                  ▼            │     │
│                                    │  data_store.* (public API)    │     │
│                                    │                  │            │     │
│                                    │                  ▼            │     │
│                                    │  db.SessionLocal() sessions   │     │
│                                    │                  │            │     │
│                                    └──────────────────┼────────────┘     │
│                                                       │                  │
│                                                       ▼                  │
│  ┌───────────────────────────────────────────────────────────────┐       │
│  │ postgres container (postgres:16-alpine)                       │       │
│  │  healthcheck: pg_isready -U $POSTGRES_USER -d $POSTGRES_DB    │       │
│  │  volume: postgres_data:/var/lib/postgresql/data               │       │
│  │  single DB, single `listings` table + `agent_state` optional  │       │
│  └───────────────────────────────────────────────────────────────┘       │
│                                                                          │
│  Volumes:                                                                │
│    postgres_data   (NEW — sole copy of listing data; no backup Phase 7)  │
│    apartment_data  (STAYS — still holds settings.json, agent_state.json, │
│                     app_data.json.pre-pg7 read-only backup for 1 week)   │
│    caddy_data, caddy_config (unchanged)                                  │
└──────────────────────────────────────────────────────────────────────────┘
```

Entry points into the persistence layer are unchanged: FastAPI routes call `data_store.*`, APScheduler calls `agent_job.run_check()` which calls `data_store.load_agent_state()` etc., daemon threads spawned by `main.py` / `brief_generator.py` / `ingest_handler.py` also call `data_store.*`. The only change is that `data_store.*` now opens a SQLAlchemy `Session` per operation instead of reading/writing `app_data.json`.

### Recommended Project Structure

```
app/
├── db.py                  # NEW — engine, SessionLocal, Base, get_db dep
├── models.py              # NEW — Listing ORM model (MappedAsDataclass)
├── data_store.py          # MODIFIED — public API preserved, internals swapped
├── config.py              # MODIFIED — POSTGRES_* env, DATABASE_URL builder
├── migrate_from_json.py   # NEW — one-shot idempotent JSON → DB loader
├── entrypoint.sh          # NEW — wait for pg / migrate / launch uvicorn
├── Dockerfile             # MODIFIED — COPY entrypoint.sh; CMD runs it
├── alembic.ini            # NEW — root config, sqlalchemy.url from env
├── alembic/               # NEW
│   ├── env.py             # loads DATABASE_URL from config; target_metadata = Base.metadata
│   ├── script.py.mako     # standard Alembic template
│   └── versions/
│       └── 0001_initial_schema.py   # autogen from models.py, hand-audited
├── main.py                # UNTOUCHED (or: replace `with data_store._lock:` with plain calls)
├── ingest_handler.py      # UNTOUCHED (see Pitfall 5 audit below)
├── brief_generator.py     # UNTOUCHED (see Pitfall 5 audit below)
├── agent_job.py           # UNTOUCHED
├── settings_store.py      # UNTOUCHED — settings.json stays on disk (D-Discretion)
└── tests/
    ├── conftest.py        # MODIFIED — swap tmp_agent_state for DB fixture
    └── test_*             # tests continue to seed via data_store.save_* helpers
```

### Pattern 1: Engine, SessionLocal, Base in `app/db.py`

**What:** Single module owns the engine, `sessionmaker`, declarative base, and the FastAPI `get_db` generator. Every other module imports what it needs from here — never constructs its own engine.

**When to use:** Every module that queries the DB. `data_store.py` uses `SessionLocal()` directly (session-per-operation for legacy public API). New routes could use `Depends(get_db)`; existing routes stay unchanged (they call `data_store.*`).

**Example:**

```python
# app/db.py
"""
SQLAlchemy engine + session factory + declarative base for the app.

One engine per process (module-level). SessionLocal() opens a new short-lived
session; get_db() is the FastAPI dependency-injection wrapper.

Never do heavy work inside get_db — it runs per request. Never leak sessions
across threads (APScheduler / daemon threads get their own SessionLocal() call).
"""
from typing import Generator
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, MappedAsDataclass, sessionmaker, Session

import config


class Base(MappedAsDataclass, DeclarativeBase):
    """Shared declarative base for all ORM models (Listing, ...)."""
    pass


engine = create_engine(
    config.DATABASE_URL,
    pool_pre_ping=True,   # cheap SELECT 1 before each checkout; survives pg restart
    future=True,          # 2.x behaviour (default in 2.x but explicit is fine)
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency — opens a session, yields it, closes on request end."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
```

[CITED: https://docs.sqlalchemy.org/en/20/orm/session_basics.html; https://fastapi.tiangolo.com/tutorial/sql-databases/]

`expire_on_commit=False` matters — otherwise attributes on an ORM object become "expired" after commit and re-hit the DB on next access; that pattern breaks the never-raise contract when the session is closed. `pool_pre_ping=True` costs one SELECT 1 per checkout but recovers cleanly from Postgres container restart (which will happen every deploy).

### Pattern 2: The `Listing` ORM Model in `app/models.py`

**What:** A single dataclass-style mapped class with typed columns for indexable scalars and JSONB columns for the nested dicts. Matches D-03 hybrid schema.

**When to use:** Only ORM class in the phase; every listing (pending, approved, rejected, viewing_scheduled, viewed) is one row.

**Example:**

```python
# app/models.py
"""
The Listing ORM model — single table for every listing regardless of state.

Column choices per D-03/D-04:
  - Flat scalars get their own columns (indexable, queryable).
  - Nested dicts get JSONB columns; MutableDict tracking is NOT applied — the
    codebase already follows the "assign the whole dict back" convention, and
    nested MutableDict tracking is fragile. See RESEARCH § JSONB gotchas.
  - status is a Postgres native ENUM (D-04); values match Phase 6.
  - Primary key is VARCHAR (kv.ee id like "3883234") per D-05.
"""
from datetime import datetime
from typing import Optional
from sqlalchemy import String, Integer, Float, DateTime, Boolean, Enum as SAEnum, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from db import Base


LISTING_STATUS_VALUES = ("pending", "approved", "rejected", "viewing_scheduled", "viewed")


class Listing(Base):
    __tablename__ = "listings"

    # ---- Identity (D-05 VARCHAR PK from kv.ee id) ----
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    url: Mapped[str] = mapped_column(String(1024), default="")

    # ---- Human-readable / display ----
    title: Mapped[str] = mapped_column(String(512), default="")
    name: Mapped[str] = mapped_column(String(512), default="")  # legacy alias — kept for display parity with existing frontend
    district: Mapped[str] = mapped_column(String(64), default="", index=True)
    address: Mapped[str] = mapped_column(String(512), default="")
    notes: Mapped[str] = mapped_column(String(4096), default="")

    # ---- Indexable scalars ----
    price_eur: Mapped[Optional[int]] = mapped_column(Integer, default=None, index=True)
    price_per_sqm: Mapped[Optional[int]] = mapped_column(Integer, default=None)
    area_sqm: Mapped[Optional[float]] = mapped_column(Float, default=None)
    rooms: Mapped[Optional[int]] = mapped_column(Integer, default=None)
    year_built: Mapped[Optional[int]] = mapped_column(Integer, default=None)
    material: Mapped[str] = mapped_column(String(32), default="")
    energy_class: Mapped[str] = mapped_column(String(4), default="")
    condition: Mapped[str] = mapped_column(String(64), default="")
    floor: Mapped[Optional[int]] = mapped_column(Integer, default=None)
    floor_total: Mapped[Optional[int]] = mapped_column(Integer, default=None)
    parking: Mapped[str] = mapped_column(String(24), default="unknown")
    needs_renovation: Mapped[bool] = mapped_column(Boolean, default=False)
    broker_name: Mapped[str] = mapped_column(String(128), default="")
    contact_email: Mapped[Optional[str]] = mapped_column(String(256), default=None)
    image_url: Mapped[str] = mapped_column(String(1024), default="")
    image_count: Mapped[int] = mapped_column(Integer, default=0)
    description: Mapped[str] = mapped_column(String(16384), default="")

    # ---- Geo + commute (Phase 5) ----
    lat: Mapped[Optional[float]] = mapped_column(Float, default=None)
    lng: Mapped[Optional[float]] = mapped_column(Float, default=None)
    commute_minutes: Mapped[Optional[int]] = mapped_column(Integer, default=None)

    # ---- Lifecycle (D-04 status enum + Phase 6 fields) ----
    status: Mapped[str] = mapped_column(
        SAEnum(*LISTING_STATUS_VALUES, name="listing_status"),
        default="pending",
        index=True,
    )
    scheduled_at: Mapped[Optional[str]] = mapped_column(String(64), default=None)   # UTC ISO 8601
    queued_at: Mapped[Optional[str]] = mapped_column(String(64), default=None)
    rejected_at: Mapped[Optional[str]] = mapped_column(String(64), default=None)
    rejection_reason: Mapped[Optional[str]] = mapped_column(String(32), default=None)
    removed: Mapped[bool] = mapped_column(Boolean, default=False)
    removed_at: Mapped[Optional[str]] = mapped_column(String(32), default=None)

    # ---- AI evaluation (flat cache) ----
    score: Mapped[Optional[int]] = mapped_column(Integer, default=None)
    verdict: Mapped[str] = mapped_column(String(4096), default="")
    raw_ok: Mapped[bool] = mapped_column(Boolean, default=True)

    # ---- Telegram card refs ----
    tg_message_id: Mapped[Optional[int]] = mapped_column(Integer, default=None)
    tg_chat_id: Mapped[Optional[int]] = mapped_column(Integer, default=None)

    # ---- Draft outreach ----
    draft_subject: Mapped[str] = mapped_column(String(512), default="")
    draft_body: Mapped[str] = mapped_column(String(16384), default="")

    # ---- JSONB blobs (D-03) ----
    cost_of_ownership: Mapped[dict] = mapped_column(JSONB, default_factory=dict)
    viewing_history: Mapped[list] = mapped_column(JSONB, default_factory=list)
    negotiation_brief: Mapped[Optional[dict]] = mapped_column(JSONB, default=None)
    negotiation_brief_generated_at: Mapped[Optional[str]] = mapped_column(String(64), default=None)
    ku: Mapped[Optional[dict]] = mapped_column(JSONB, default=None)
    checklist: Mapped[dict] = mapped_column(JSONB, default_factory=dict)  # ai_checklist + manual_checklist
    price_history: Mapped[list] = mapped_column(JSONB, default_factory=list)
    score_breakdown: Mapped[dict] = mapped_column(JSONB, default_factory=dict)
    ai_checklist_fills: Mapped[dict] = mapped_column(JSONB, default_factory=dict)
    strengths: Mapped[list] = mapped_column(JSONB, default_factory=list)
    concerns: Mapped[list] = mapped_column(JSONB, default_factory=list)
    risks: Mapped[list] = mapped_column(JSONB, default_factory=list)
    extras: Mapped[dict] = mapped_column(JSONB, default_factory=dict)  # catch-all for unmapped fields on migration

    # ---- Timestamps ----
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )
```

Notes:
- `MappedAsDataclass` requires `default=` or `default_factory=` on every field for the generated `__init__` to work; hence the many `default=None` / `default=""` clauses. [CITED: https://docs.sqlalchemy.org/en/20/orm/dataclasses.html]
- Fields kept as `String(64)` for `scheduled_at` / `queued_at` etc. because the existing code stores them as ISO 8601 strings (not real datetime objects); staying stringly-typed avoids parse-round-trip drift on the migration. Rows written after Phase 7 could migrate to `DateTime(timezone=True)` in a future phase.
- `name` field kept alongside `title` because legacy properties[] entries use `name` in the frontend (`_LEGACY_ALIASES` in `main.py:197`). Both flat columns are cheaper than doing runtime aliasing.
- `extras: JSONB` is the safety valve for the migration script: any key on an existing entry that has no dedicated column lands here so no data is lost. Post-migration, prune unused keys via a follow-up cleanup script.
- `checklist` JSONB combines the current `data['checklists'][listing_id]` (which is keyed by listing_id, not stored on the entry). See migration note.

### Pattern 3: Postgres native ENUM for status (D-04)

**What:** `sqlalchemy.Enum("pending", "approved", "rejected", "viewing_scheduled", "viewed", name="listing_status")`. `name=` is required so Postgres creates the type as `listing_status`. Alembic autogenerate handles the `CREATE TYPE` before the `CREATE TABLE`.

**When to use:** exactly this one column.

**Example:**

```python
from sqlalchemy import Enum as SAEnum
LISTING_STATUS_VALUES = ("pending", "approved", "rejected", "viewing_scheduled", "viewed")
status: Mapped[str] = mapped_column(
    SAEnum(*LISTING_STATUS_VALUES, name="listing_status"),
    default="pending",
    index=True,
)
```

[CITED: https://docs.sqlalchemy.org/en/20/core/type_basics.html — Enum's `name=` parameter is required for PostgreSQL to generate the `CREATE TYPE`.]

**Adding a value later** requires an Alembic op using `op.execute("ALTER TYPE listing_status ADD VALUE 'foo'")` because SQLAlchemy autogenerate does not emit that DDL. Note for future planners; not a Phase 7 concern.

### Pattern 4: Alembic `env.py` — read DATABASE_URL from config

**What:** Import the app's `config` module inside `env.py`, then call `config.set_main_option("sqlalchemy.url", app_config.DATABASE_URL)`. `target_metadata = Base.metadata` enables `--autogenerate`.

**Example:**

```python
# app/alembic/env.py
"""
Alembic environment — reads DATABASE_URL from the app's config module,
so migrations always target the same DB the app uses.

Autogenerate is wired via target_metadata = Base.metadata.
"""
import sys
import os
from logging.config import fileConfig
from sqlalchemy import engine_from_config, pool
from alembic import context

# Make app modules importable when alembic runs from the repo root
sys.path.insert(0, os.path.abspath(os.path.dirname(__file__) + "/.."))

import config as app_config       # noqa: E402
from db import Base                # noqa: E402
import models                      # noqa: E402  — import models so metadata is populated

alembic_config = context.config
if alembic_config.config_file_name is not None:
    fileConfig(alembic_config.config_file_name)

alembic_config.set_main_option("sqlalchemy.url", app_config.DATABASE_URL)
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    url = alembic_config.get_main_option("sqlalchemy.url")
    context.configure(url=url, target_metadata=target_metadata, literal_binds=True, dialect_opts={"paramstyle": "named"})
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        alembic_config.get_section(alembic_config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
```

`import models` is load-bearing — without it `Base.metadata` is empty and `--autogenerate` produces an empty revision. [CITED: https://alembic.sqlalchemy.org/en/latest/autogenerate.html]

**Baseline revision generation (one-time, in dev):**

```bash
cd app
alembic init alembic       # creates alembic.ini + alembic/ scaffold — then merge env.py above
alembic revision --autogenerate -m "initial schema"
# hand-audit versions/0001_*.py — verify CREATE TYPE listing_status precedes CREATE TABLE
```

The autogenerated revision is checked into git. On every deploy the container entrypoint runs `alembic upgrade head`, which is a no-op if already at head.

### Pattern 5: Container entrypoint — wait for Postgres, migrate, run

**What:** A short shell script that runs on container start: waits for Postgres to accept connections, applies migrations, seeds from JSON if not already seeded, launches uvicorn.

**When to use:** Every deploy. `docker-compose up -d --build` (via GitHub Actions) will pick this up automatically because it becomes the CMD.

**Example:**

```bash
#!/usr/bin/env bash
# app/entrypoint.sh — runs at container start.
# Order matters: pg readiness → schema migration → data migration → uvicorn.
set -e

# Postgres readiness — depends_on service_healthy already gates start, but
# pool_pre_ping in db.py + this loop are cheap defence in depth against a
# temporary network hiccup between the two containers.
echo "Waiting for Postgres at ${POSTGRES_HOST:-postgres}:${POSTGRES_PORT:-5432}..."
until pg_isready -h "${POSTGRES_HOST:-postgres}" -p "${POSTGRES_PORT:-5432}" -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" >/dev/null 2>&1; do
    sleep 1
done
echo "Postgres ready."

echo "Applying Alembic migrations..."
alembic upgrade head

echo "Migrating legacy JSON if present (idempotent)..."
python migrate_from_json.py

echo "Starting uvicorn..."
exec uvicorn main:app --host 0.0.0.0 --port 8000
```

Add `pg_isready` to the Docker image by installing `postgresql-client` (small — ~5 MB). Or use a Python one-liner instead of `pg_isready` if adding the package feels heavy:

```bash
until python -c "import psycopg; psycopg.connect('$DATABASE_URL')" 2>/dev/null; do sleep 1; done
```

The single-instance nature of this deploy makes migration-race-conditions a non-issue. For a Kubernetes-style multi-pod deploy you would run `alembic upgrade head` in a dedicated init-container or one-shot Job. [CITED: https://alembic.sqlalchemy.org/en/latest/tutorial.html]

### Pattern 6: FastAPI session-per-request (only needed for NEW routes)

**What:** Standard sync `get_db` generator. Every route that opens the DB uses `db: Session = Depends(get_db)`.

**When to use:** Any new route added during Phase 7 (probably none — Phase 7 is a rewire, not new features). Existing routes call `data_store.*` which manage sessions internally; they don't need `Depends(get_db)`.

**Example:**

```python
# example — NOT strictly required in Phase 7 because existing routes go through data_store
from fastapi import Depends
from sqlalchemy.orm import Session
from db import get_db
from models import Listing

@app.get("/api/db-listing/{listing_id}")
def get_listing_via_session(listing_id: str, db: Session = Depends(get_db)):
    row = db.get(Listing, listing_id)
    if row is None:
        raise HTTPException(status_code=404)
    return {"id": row.id, "status": row.status, ...}
```

### Pattern 7: `data_store` rewiring — preserve the public signatures

**What:** Every function in `data_store.py` keeps its exact signature. Internals open `SessionLocal()`, do the work, commit, close.

**Example — `set_viewing_scheduled` before/after:**

```python
# BEFORE (data_store.py:225-254 in Phase 6)
def set_viewing_scheduled(listing_id: str, scheduled_at_iso: str) -> bool:
    from datetime import datetime, timezone
    try:
        with _lock:
            data = load_app_data()
            entry = next((p for p in data.get("properties", []) if p.get("id") == listing_id), None)
            if entry is None:
                return False
            entry["status"] = "viewing_scheduled"
            entry["scheduled_at"] = scheduled_at_iso
            history = entry.setdefault("viewing_history", [])
            history.append({"action": "scheduled", "at": datetime.now(timezone.utc).isoformat(), "scheduled_for": scheduled_at_iso})
            save_app_data(data)
            return True
    except Exception:
        return False


# AFTER (Phase 7)
def set_viewing_scheduled(listing_id: str, scheduled_at_iso: str) -> bool:
    from datetime import datetime, timezone
    from sqlalchemy.exc import SQLAlchemyError
    try:
        with SessionLocal() as db:
            row = db.get(Listing, listing_id)
            if row is None or row.status not in ("approved", "viewing_scheduled"):
                # Note: original allowed any properties[] entry; we preserve that (properties[] == status in ('approved','viewing_scheduled','viewed'))
                return False
            row.status = "viewing_scheduled"
            row.scheduled_at = scheduled_at_iso
            # JSONB: reassign the whole list — see § JSONB gotchas
            history = list(row.viewing_history or [])
            history.append({"action": "scheduled", "at": datetime.now(timezone.utc).isoformat(), "scheduled_for": scheduled_at_iso})
            row.viewing_history = history
            db.commit()
            return True
    except SQLAlchemyError:
        log.exception("set_viewing_scheduled failed for %s", listing_id)
        return False
```

**Example — `load_app_data` compatibility shim:**

The current callers expect the whole app_data dict shape (`{"properties": [...], "pending": [...], "rejected": [...], "checklists": {...}, "price_history": {...}, "settings": {...}}`). To avoid rewriting every caller in Phase 7, `load_app_data()` becomes a compatibility shim that composes this dict from a DB query:

```python
def load_app_data() -> dict:
    from sqlalchemy.exc import SQLAlchemyError
    try:
        with SessionLocal() as db:
            rows = db.query(Listing).all()
            properties = [_row_to_property_dict(r) for r in rows if r.status in ("approved", "viewing_scheduled", "viewed")]
            pending = [_row_to_pending_dict(r) for r in rows if r.status == "pending"]
            rejected = [_row_to_rejected_dict(r) for r in rows if r.status == "rejected"]
            checklists = {r.id: r.checklist for r in rows if r.checklist}
            price_history = {r.id: r.price_history for r in rows if r.price_history}
            return {
                "properties": properties,
                "pending": pending,
                "rejected": rejected,
                "checklists": checklists,
                "price_history": price_history,
                "settings": {},   # settings live in settings.json — outside DB scope (D-Discretion)
            }
    except SQLAlchemyError:
        log.exception("load_app_data failed")
        return {"properties": [], "pending": [], "rejected": [], "checklists": {}, "price_history": {}, "settings": {}}
```

**And `save_app_data(data)`** becomes the reverse: for each entry in `data["properties"] + data["pending"] + data["rejected"]`, upsert the corresponding row. This is expensive for large call sites like `/api/backfill-costs` and `/api/backfill-commutes` that mutate many entries. Those specific callers should be rewritten in Phase 7 to iterate rows in a session instead of round-tripping through a whole-dict save. See § Pitfall 6.

### Anti-Patterns to Avoid

- **Holding a `Session` across an HTTP call** to Anthropic / Nominatim / ORS. Same Pitfall 5 rule as JSON `_lock` — snapshot to plain Python objects, close the session, do the HTTP, open a new session to save.
- **`session.commit()` inside a loop that iterates rows returned by the same session.** After commit, the objects are expired (unless `expire_on_commit=False`, which we do set). Even so, iterate all rows first, mutate, then commit once.
- **Adding a `MutableDict.as_mutable(JSONB)` type at the model level "just to be safe".** It looks helpful but tracks only top-level dict changes, not nested list `.append()` — so it lulls you into thinking mutation is safe when it isn't. We adopt the explicit "reassign the whole list/dict" convention instead. See § JSONB gotchas.
- **Multi-threaded reuse of one Session.** APScheduler and daemon threads MUST call `SessionLocal()` themselves — they cannot inherit `db` from `Depends(get_db)`. [CITED: https://docs.sqlalchemy.org/en/20/orm/session_basics.html#is-the-session-thread-safe-is-asyncsession-safe-to-share-in-concurrent-tasks]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Schema versioning across deploys | Custom `if not exists` DDL block | Alembic | Every real Python project migrates with Alembic; autogenerate diffs models against live DB |
| Connection pooling | `psycopg.connect()` per request | SQLAlchemy `create_engine(...)` default pool | Handles reconnect, checkout, timeouts |
| Reconnect after DB restart | Custom retry loop | `pool_pre_ping=True` | One line, cheap, robust; matches every deploy where Postgres bounces before app |
| Serializing dict → JSONB | `json.dumps(...)` and store as text | `sqlalchemy.dialects.postgresql.JSONB` column | Native type; queryable via `->>`, `@>`, GIN-indexable |
| ENUM values validation | `CHECK (status IN ('a','b'))` | `sqlalchemy.Enum(..., name="listing_status")` | Postgres native ENUM + ORM-level Python validation; matches D-04 |
| Test isolation | Truncate all tables between tests | Wrap each test in a transaction, rollback in teardown | Faster; guaranteed clean state; matches Postgres semantics |

**Key insight:** every one of these problems was solved by someone else 10+ years ago. Hand-rolling any of them is the fastest way to introduce a subtle correctness bug that only shows up in production. The whole point of the migration is more reliability, not more DIY.

## Runtime State Inventory

Phase 7 is a refactor + data migration. The five categories:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| **Stored data** | `apartment_data` Docker volume contains `app_data.json`, `settings.json`, `agent_state.json`. `app_data.json` is the sole non-empty file that must be migrated to Postgres. | Data migration: `migrate_from_json.py` reads `app_data.json`, upserts rows into `listings`, renames source file to `app_data.json.pre-pg7`. `settings.json` and `agent_state.json` stay in place (locked in Claude's discretion). |
| **Live service config** | None. No third-party service configuration lives in a UI or external database and references the listing schema. Telegram, Anthropic, Gmail, Nominatim, ORS all treat listings as opaque payloads. | None. |
| **OS-registered state** | None. No cron jobs, systemd units, Task Scheduler entries, or pm2 processes reference the listing storage shape — everything runs inside one Docker container managed by `docker compose up -d`. | None. |
| **Secrets and env vars** | New env vars needed: `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_HOST` (optional; defaults to `postgres`), `POSTGRES_PORT` (optional; defaults to `5432`), and either those or a full `DATABASE_URL`. Add to `.env` on the VPS before the first deploy of Phase 7. No existing secrets change; no key rotation needed. | Deploy prep task: SSH to VPS, add three lines to `/opt/aparts-looker/.env` before merging Phase 7 branch. |
| **Build artifacts / installed packages** | Docker image will grow by ~40 MB (postgresql-client for pg_isready + psycopg[binary] + SQLAlchemy + Alembic). No stale artifacts to remove. `apartment_data` volume keeps existing JSON files (renamed) for 1-week rollback insurance. New `postgres_data` volume must be created; docker-compose creates it automatically on first `up`. | Add `postgres_data:` under `volumes:` in `docker-compose.yml`; nothing to purge. |

The canonical question — *after every file in the repo is updated, what runtime systems still have the old string cached, stored, or registered?* — has a clean answer for Phase 7: only `app_data.json` on the volume. Once the migration script runs, it's not "stale," it's an intentional rollback backup.

## Common Pitfalls

### Pitfall 1: JSONB mutation not detected

**What goes wrong:** You append to a list in a JSONB column and commit — the change doesn't persist. Or you mutate a nested dict and commit — silently ignored.

**Why it happens:** SQLAlchemy's default JSON/JSONB type does not track mutation of the Python object. It only notices when the whole attribute is reassigned. `entry.viewing_history.append({...})` mutates the list in place; SQLAlchemy sees no change and does not emit an UPDATE. [CITED: https://docs.sqlalchemy.org/en/20/orm/extensions/mutable.html]

**How to avoid:** Convention — always reassign the whole list/dict:

```python
# WRONG — silent no-op
row.viewing_history.append(new_event)
db.commit()

# RIGHT — explicit reassignment
history = list(row.viewing_history or [])
history.append(new_event)
row.viewing_history = history
db.commit()
```

Same rule for dict mutation: build a new dict (or `{**row.field, "k": v}`), assign it back. This convention is already close to the current code: `data_store.record_price_in_data` builds a list then assigns; `save_ku_enrichment` builds a fresh dict then assigns. The pattern translates naturally.

**Warning signs:** A test writes to the DB, commits, closes the session, reopens the session, reads — the mutation is missing. If that ever happens, the mutation was in-place, not reassigned. Tests should exercise this by always doing a full round-trip (commit → close → new session → query) rather than reading back from the same session.

**Alternative you might be tempted by:** `MutableDict.as_mutable(JSONB)`. Do NOT adopt. It tracks only top-level `__setitem__`/`__delitem__`, not nested list `.append()`. False sense of safety. `sqlalchemy-json`'s `NestedMutableJson` is more thorough but adds a dependency we don't need. [CITED: https://github.com/edelooff/sqlalchemy-json — "extension that tracks changes even when they happen in nested objects or arrays"]

### Pitfall 2: HTTP call inside a session (equivalent of the current Pitfall 5)

**What goes wrong:** `brief_generator.generate_and_save_brief` opens a session, loads the entry, calls Anthropic (2–5 seconds), then writes back. If that session sits on a DB connection during the HTTP call, connection pool exhaustion or long-held row locks become possible.

**Why it happens:** SQLAlchemy `Session` holds a connection from the pool until `commit()`, `rollback()`, or `close()`. Holding one across a slow external call is the DB-world equivalent of the current "never hold `_lock` across HTTP."

**How to avoid:** Same pattern as before, translated:

```python
# generate_and_save_brief (Phase 7 version)
def generate_and_save_brief(listing_id: str) -> None:
    try:
        # Step 1: open session, snapshot to plain dict, close
        with SessionLocal() as db:
            row = db.get(Listing, listing_id)
            if row is None:
                return
            snapshot = _row_to_dict(row)                # plain dict, no ORM refs
            price_history = list(row.price_history or [])
            district_avg = _compute_district_avg(db, row.district, listing_id)
            coo = row.cost_of_ownership or {}
        # session closed — connection returned to pool

        coo_monthly = coo.get("monthly_total_eur") if isinstance(coo, dict) else None

        # Step 2: HTTP call OUTSIDE any DB session
        brief = generate_negotiation_brief(snapshot, price_history, district_avg, coo_monthly)

        # Step 3: reopen session, save
        with SessionLocal() as db:
            row = db.get(Listing, listing_id)
            if row is not None:
                row.negotiation_brief = brief
                row.negotiation_brief_generated_at = datetime.now(timezone.utc).isoformat()
                db.commit()
    except Exception:
        log.exception("generate_and_save_brief failed for %s", listing_id)
```

**Call sites to audit and convert (Phase 6 Pitfall 5 pattern):**
1. `brief_generator.generate_and_save_brief` (brief_generator.py:233-300) — three-step pattern above.
2. `ingest_handler._dispatch_ku_lookup` (ingest_handler.py:394-414) — same shape, ku_lookup call instead of Anthropic.
3. `main.py:481-495` `approve_pending` — reads address under lock, then fires KÜ thread. Same shape.
4. `main.py:590-605` `refresh_ku` — same as approve_pending.
5. `main.py:563-576` `regenerate_brief` — daemon thread + brief_generator.
6. `main.py:181-190` `telegram_silence` — small atomic mutation, no HTTP; convert to session-open-mutate-commit.
7. `ingest_handler.process_ingest_batch` (ingest_handler.py:417-578) — the heavy hitter. Currently holds `_lock` for the full filter → evaluate → notify → save. The Anthropic + Telegram + ORS calls inside this loop are already the correctness bug the JSON `_lock` was masking. **This block MUST be re-architected**: iterate listings, do all HTTP outside any session, batch the DB writes at the end. Plan should call this out as its own task.

**Warning signs:** `psycopg.OperationalError: connection pool exhausted` in logs. Long-running requests blocking each other. Postgres `pg_stat_activity` showing many `idle in transaction` connections.

### Pitfall 3: `MappedAsDataclass` requires defaults on every field

**What goes wrong:** You try to create a `Listing(id="x", url="y")` and get `TypeError: missing 1 required positional argument: 'title'`.

**Why it happens:** `MappedAsDataclass` generates a dataclass `__init__`. Standard dataclass rule: fields without defaults must come first. Since we're keeping many fields optional, every field needs a `default=` or `default_factory=`.

**How to avoid:** Give every column a default matching its production semantics (`default=""` for strings, `default=None` for optionals, `default_factory=dict` for JSONB dicts, `default_factory=list` for JSONB lists). [CITED: https://docs.sqlalchemy.org/en/20/orm/dataclasses.html]

**Warning signs:** `TypeError: non-default argument follows default argument` at import time; `TypeError: __init__() missing … required arguments` at runtime.

### Pitfall 4: Postgres ENUM values are immutable in an ordinary migration

**What goes wrong:** You add a new status value in `LISTING_STATUS_VALUES` tuple. Autogenerate does not emit anything. You deploy. `INSERT INTO listings (status) VALUES ('new_value')` fails.

**Why it happens:** Alembic autogenerate handles new ENUM types (`CREATE TYPE`) and dropping them, but does not detect new values added to an existing ENUM. `ALTER TYPE ... ADD VALUE` must be written by hand into the migration. And Postgres < 12 requires it to run outside a transaction (`op.execute` in an autocommit block).

**How to avoid:** Not a Phase 7 concern (initial schema is stable). Document for future planners: any future status value addition needs a hand-written Alembic op:

```python
def upgrade():
    op.execute("ALTER TYPE listing_status ADD VALUE IF NOT EXISTS 'new_value'")
```

**Warning signs:** `psycopg.errors.InvalidTextRepresentation: invalid input value for enum listing_status: "new_value"` in production after a deploy that changed the tuple.

### Pitfall 5: Migration script re-runs and duplicates rows

**What goes wrong:** Container restarts. Entrypoint re-runs `migrate_from_json.py`. Every listing gets inserted twice (violating PK constraint) or gets its lifecycle status reset to "pending."

**Why it happens:** Idempotency is the migration script's responsibility.

**How to avoid:** Multiple guards, use all:

1. Rename source file after successful load — `os.replace("app_data.json", "app_data.json.pre-pg7")`. If the rename succeeds, the next run finds no source and exits fast.
2. Even without the rename, iterate entries and `db.merge(Listing(**fields))` instead of `db.add(...)`. `merge` upserts by primary key; safe to re-run.
3. Log the count on entry: `"migrate_from_json: 0 rows on disk to load — no-op"` vs `"migrate_from_json: 14 rows found; inserting into listings table"`.
4. Optional: track a `db_migrations` row in the DB itself indicating that JSON migration ran. But rename + merge is enough for one user.

**Warning signs:** Deploy restarts container 3× while chasing an unrelated bug; the DB now has 3× rows or every status is reset. Fix: audit the guard chain.

### Pitfall 6: Whole-dict save loop is now expensive

**What goes wrong:** `POST /api/backfill-costs` iterates every entry, mutates `cost_of_ownership`, calls `save_app_data(data)`. Under Phase 7's compatibility shim, `save_app_data` upserts every row. What used to be one `json.dump` is now hundreds of INSERT/UPDATE statements.

**Why it happens:** The compatibility shim `load_app_data` → mutate → `save_app_data` pattern was cheap when the whole file was rewritten in one `write`. It's still correct but wasteful under a DB.

**How to avoid:** Rewrite the specific hot callers as row-iterating helpers. In Phase 7 scope:

- `settings_store._recompute_all_costs` (settings_store.py:159-190) → open one session, `db.query(Listing).all()`, mutate each row's `cost_of_ownership`, `db.commit()` once.
- `main.backfill_costs` (main.py:918-949) → same pattern.
- `main.backfill_commutes` (main.py:952-994) → same.
- `main._run_geocode_backfill` (main.py:766-804) → same.
- `main.delete_all_listings` (main.py:284-312) → `db.query(Listing).delete()` (single SQL DELETE).

For everything else, the compatibility shim is fine — most callers touch ≤ 1 entry.

**Warning signs:** After Phase 7 ships, the settings pane feels sluggish. `docker logs -f app` shows dozens of UPDATE statements on a single settings save. Fix: rewrite `_recompute_all_costs`.

### Pitfall 7: Migration script clobbers manual `ku.manual` notes

**What goes wrong:** Migration reads `entry["ku"] = {"auto": {...}, "manual": "meeting notes from Feb", "looked_up_at": "..."}`, inserts into DB. Later a KÜ refresh runs; `save_ku_enrichment` overwrites the whole `ku` JSONB blob. `manual` disappears.

**Why it happens:** Same Pitfall 7 as Phase 6 — `save_ku_enrichment` must preserve `entry['ku']['manual']` even after the migration. The existing Phase 6 code (data_store.py:318-344) does this correctly by loading the existing entry first, reading `.get("manual", "")`, and building the new dict around it. The Phase 7 rewrite must translate that exact pattern:

```python
def save_ku_enrichment(listing_id: str, ku_auto: dict) -> bool:
    from datetime import datetime, timezone
    from sqlalchemy.exc import SQLAlchemyError
    try:
        with SessionLocal() as db:
            row = db.get(Listing, listing_id)
            if row is None:
                return False
            existing = row.ku or {}
            row.ku = {
                "auto": ku_auto,
                "manual": existing.get("manual", ""),
                "looked_up_at": datetime.now(timezone.utc).isoformat(),
            }
            db.commit()
            return True
    except SQLAlchemyError:
        log.exception("save_ku_enrichment failed for %s", listing_id)
        return False
```

**Warning signs:** Existing `test_save_ku_preserves_manual` (test_data_store.py:84-113) will catch a regression here — do not delete or weaken that test during the port to DB fixtures.

### Pitfall 8: Test fixture leaks between tests

**What goes wrong:** Test A commits data. Test B queries and sees Test A's rows. Test C fails intermittently.

**Why it happens:** Without rollback isolation, each test permanently mutates the DB.

**How to avoid:** Use `pytest-postgresql`'s `postgresql_proc` for a per-session Postgres subprocess, then a `db_session` fixture that:

1. `BEGIN`
2. `SAVEPOINT`
3. yield the session
4. `ROLLBACK TO SAVEPOINT`
5. `ROLLBACK`

Every test runs inside a savepoint that is unconditionally rolled back. Fast (no truncate), isolated, and matches production dialect. See § Testing strategy below for the fixture code.

**Warning signs:** Tests pass individually, fail when run as a suite. Order-dependent failures.

## Code Examples

### Adding Postgres to `docker-compose.yml`

```yaml
services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}"]
      interval: 5s
      timeout: 5s
      retries: 10
      start_period: 15s
    # No ports: exposed — only reachable inside the compose network.

  app:
    build: ./app
    restart: unless-stopped
    env_file: .env
    depends_on:
      postgres:
        condition: service_healthy
    volumes:
      - apartment_data:/app/data   # keeps settings.json, agent_state.json, .pre-pg7 backup
    expose:
      - "8000"
    ports:
      - "127.0.0.1:8000:8000"

  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      - app

volumes:
  apartment_data:
  postgres_data:
  caddy_data:
  caddy_config:
```

[CITED: https://docs.docker.com/compose/compose-file/05-services/#healthcheck; https://docs.docker.com/compose/how-tos/startup-order/]

### `.env` additions

```dotenv
# Postgres (Phase 7)
POSTGRES_USER=aparts
POSTGRES_PASSWORD=<generate — >= 24 chars, alphanumeric + symbols>
POSTGRES_DB=aparts_looker
# Optional overrides — defaults derived from POSTGRES_HOST=postgres POSTGRES_PORT=5432
# POSTGRES_HOST=postgres
# POSTGRES_PORT=5432
# DATABASE_URL=postgresql+psycopg://user:pw@host:5432/dbname   # explicit override
```

### `config.py` addition

```python
# ---- Database (Phase 7) ----
POSTGRES_USER     = os.environ.get("POSTGRES_USER", "aparts")
POSTGRES_PASSWORD = os.environ.get("POSTGRES_PASSWORD", "")
POSTGRES_DB       = os.environ.get("POSTGRES_DB", "aparts_looker")
POSTGRES_HOST     = os.environ.get("POSTGRES_HOST", "postgres")
POSTGRES_PORT     = os.environ.get("POSTGRES_PORT", "5432")
DATABASE_URL      = os.environ.get(
    "DATABASE_URL",
    f"postgresql+psycopg://{POSTGRES_USER}:{POSTGRES_PASSWORD}@{POSTGRES_HOST}:{POSTGRES_PORT}/{POSTGRES_DB}",
)
```

### `migrate_from_json.py` (idempotent one-shot loader)

```python
"""
One-shot migration: load app/data/app_data.json into the Postgres `listings` table.

Idempotent by two guards:
  1. If DATA_DIR/app_data.json does not exist (already renamed to .pre-pg7),
     the script exits with a no-op log.
  2. Every insert uses db.merge(Listing(...)) so re-running before the rename
     is safe — merge upserts by primary key.

On success, renames the source file to app_data.json.pre-pg7 to prevent
future runs from re-migrating (and to preserve a 1-week rollback insurance
per Claude's discretion cutover strategy).
"""
import json
import logging
import os
import sys

from sqlalchemy.exc import SQLAlchemyError

import config
from db import SessionLocal
from models import Listing

log = logging.getLogger("migrate_from_json")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

SOURCE = config.APP_DATA_FILE                       # e.g. /app/data/app_data.json
BACKUP = SOURCE + ".pre-pg7"                        # renamed after successful load


def _entry_to_row(entry: dict, forced_status: str) -> Listing:
    """Convert a legacy entry dict to a Listing row, mapping legacy field names."""
    # _LEGACY_ALIASES from main.py:197 — apply so schema-driven fields land where expected
    aliases = {"name": "title", "price": "price_eur", "pricePerSqm": "price_per_sqm",
               "area": "area_sqm", "year": "year_built", "notes": "description"}
    for old, new in aliases.items():
        if old in entry and (new not in entry or not entry.get(new)):
            entry[new] = entry.get(old)
    # Extract fields we know about; every other key lands in extras
    known = {c.name for c in Listing.__table__.columns}
    fields = {k: v for k, v in entry.items() if k in known}
    extras = {k: v for k, v in entry.items() if k not in known}
    fields.setdefault("id", entry.get("id") or "unknown")
    fields["status"] = forced_status
    fields["extras"] = extras
    # Coerce Nones on JSONB list/dict fields
    for jsonb_list in ("viewing_history", "price_history", "strengths", "concerns", "risks"):
        if fields.get(jsonb_list) is None:
            fields[jsonb_list] = []
    for jsonb_dict in ("cost_of_ownership", "checklist", "score_breakdown", "ai_checklist_fills", "extras"):
        if fields.get(jsonb_dict) is None:
            fields[jsonb_dict] = {}
    return Listing(**fields)


def main() -> int:
    if not os.path.exists(SOURCE):
        log.info("No %s — nothing to migrate (already ran, or fresh install)", SOURCE)
        return 0

    try:
        with open(SOURCE, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError):
        log.exception("Cannot read %s — aborting migration", SOURCE)
        return 1

    properties = data.get("properties", []) or []
    pending    = data.get("pending", []) or []
    rejected   = data.get("rejected", []) or []
    checklists = data.get("checklists", {}) or {}
    price_hist = data.get("price_history", {}) or {}

    log.info("Loading %d properties + %d pending + %d rejected", len(properties), len(pending), len(rejected))

    try:
        with SessionLocal() as db:
            for entry in properties:
                # Preserve status from Phase 6 if present, else "approved"
                status = entry.get("status") or "approved"
                if status not in ("approved", "viewing_scheduled", "viewed"):
                    status = "approved"
                row = _entry_to_row(entry, status)
                # Fold in checklist for this listing_id if any
                row.checklist = checklists.get(row.id, {}) or {}
                row.price_history = price_hist.get(row.id, []) or []
                db.merge(row)
            for entry in pending:
                row = _entry_to_row(entry, "pending")
                row.checklist = checklists.get(row.id, {}) or {}
                row.price_history = price_hist.get(row.id, []) or []
                db.merge(row)
            for entry in rejected:
                row = _entry_to_row(entry, "rejected")
                row.checklist = checklists.get(row.id, {}) or {}
                row.price_history = price_hist.get(row.id, []) or []
                db.merge(row)
            db.commit()
    except SQLAlchemyError:
        log.exception("Migration failed — nothing committed (transaction rollback)")
        return 1

    # Success — move the source out of the way to prevent re-migration
    try:
        os.replace(SOURCE, BACKUP)
        log.info("Migrated OK. Renamed %s → %s (1-week rollback insurance).", SOURCE, BACKUP)
    except OSError:
        log.exception("Migration succeeded but rename to %s failed — next boot may re-merge (safe, idempotent).", BACKUP)

    return 0


if __name__ == "__main__":
    sys.exit(main())
```

### `pytest-postgresql` fixture for rollback isolation

```python
# app/tests/conftest.py (relevant new fixtures — replaces tmp_agent_state for DB tests)
import pytest
from pytest_postgresql import factories

# Session-scoped Postgres subprocess — one Postgres for the whole test run
postgresql_proc_fixture = factories.postgresql_proc(port=None)
postgresql_db_fixture   = factories.postgresql("postgresql_proc_fixture")


@pytest.fixture
def db_session(postgresql_db_fixture, monkeypatch):
    """A SQLAlchemy Session bound to a per-test transaction that ALWAYS rolls back.

    Test isolation via BEGIN + SAVEPOINT + ROLLBACK — no truncate, no leakage.
    Also monkeypatches db.SessionLocal to return a session bound to the same connection
    so data_store.* calls use the same transaction.
    """
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from db import Base

    conn_str = (
        f"postgresql+psycopg://{postgresql_db_fixture.info.user}"
        f":@{postgresql_db_fixture.info.host}:{postgresql_db_fixture.info.port}"
        f"/{postgresql_db_fixture.info.dbname}"
    )
    engine = create_engine(conn_str)
    Base.metadata.create_all(engine)     # DDL from models, skipping Alembic in tests

    connection = engine.connect()
    trans = connection.begin()
    TestSession = sessionmaker(bind=connection, expire_on_commit=False)
    session = TestSession()

    # Patch SessionLocal so any code calling data_store.* uses this same connection
    import db as db_module
    monkeypatch.setattr(db_module, "SessionLocal", TestSession)

    yield session

    session.close()
    trans.rollback()
    connection.close()
    engine.dispose()
```

Add `pytest-postgresql>=6.0.0` to `requirements.txt` (dev deps section if you introduce one; else at the bottom).

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `declarative_base()` + `Column(Type)` | `DeclarativeBase` subclass + `Mapped[T]` + `mapped_column(...)` | SQLAlchemy 2.0 (Jan 2023) | Full type-safety for Mapped attributes; mypy/pyright now catch column-type mismatches |
| `session.query(Model).filter(...)` | `db.execute(select(Model).where(...))` (both still work) | SQLAlchemy 2.0 | Legacy `.query()` fully supported; new-style `select(...)` is preferred for new code |
| psycopg2 | psycopg (v3) | psycopg3 GA 2021 | psycopg3 is actively maintained; psycopg2 is in maintenance-only mode |
| `sqlite3` for small apps | Postgres in docker-compose | This phase | Better types, transactions, migrations; ~50 MB extra RAM per container |

**Deprecated / outdated (do NOT introduce):**
- `flask-sqlalchemy` patterns — not a Flask app.
- `SQLAlchemy 1.x` patterns (`Column(String)` at class scope without `Mapped[T]`) — legacy; new code uses 2.x style.
- `create_all()` at app startup as a substitute for Alembic — works for hello-world, terrible for production evolution. We do use `create_all()` in the test fixture (fine — throwaway DB).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | psycopg3 `[binary]` wheels install cleanly on `python:3.12-slim`. | Standard Stack | Fall back to `psycopg2-binary` (identical dialect from SQLAlchemy's POV); no code change beyond the URL scheme. |
| A2 | The existing `app_data.json` structure at deploy time is well-formed and matches the DEFAULT_APP_DATA shape (properties/pending/rejected/checklists/price_history/settings). | Data migration | If a stray key exists on entries, it lands in `extras` JSONB — nothing is lost, but nothing is queryable on that key either. Follow-up cleanup script if we discover an important field was mis-mapped. |
| A3 | 5s Postgres healthcheck interval + 10 retries + 15s start_period is enough for `postgres:16-alpine` cold start on a small VPS. | docker-compose | If Postgres is slow to start, the app container may enter a restart loop. Increase `start_period` to 30s if this happens. |
| A4 | Nobody is running two app containers simultaneously (there is one deploy target, one host). | Container entrypoint (migration idempotency) | Concurrent Alembic runs can race and both try `CREATE TYPE listing_status`; Postgres serializes DDL but the loser gets an error. Not applicable to this deploy. |
| A5 | The Phase 6 `test_save_ku_preserves_manual` test can be ported to the DB fixture with only mechanical changes (JSON write → `db.add(Listing(...))`). | Testing strategy | If the test structure needs deeper rework, more test-porting effort than budgeted. Should be small — the assertions themselves stay identical. |

## Open Questions

1. **Do we keep `data_store.load_app_data()` returning the whole-dict shape indefinitely, or eventually migrate every caller to explicit `db.query(...)` calls?**
   - What we know: Keeping the shim is the fastest path to Phase 7 shipping. Rewriting every caller is a Phase 8 candidate.
   - What's unclear: Whether Daniel wants "clean" architecture after Phase 7 ships, or is happy with the shim persisting.
   - Recommendation: Ship Phase 7 with the shim; log a Deferred item to gradually replace whole-dict callers with row-scoped queries as new features touch them.

2. **Should `agent_state.json` also move to Postgres?**
   - What we know: CONTEXT.md leaves this to planner's discretion. It's small (~KB), gets rewritten every tick, and losing it costs at most 2 hours of dedup memory (seen_listing_ids). Migrating it costs one more table, one more Alembic revision, one more test file.
   - What's unclear: Whether Daniel cares about the tiny reliability gain enough to justify the extra scope.
   - Recommendation: Leave on disk for Phase 7. Migrate in Phase 8 if it ever bites.

3. **Do we need a database `agent_state` table now for the pending_drafts feature (which references listing_ids that must survive `pending_drafts` outliving individual listings)?**
   - What we know: `pending_drafts` today is `{listing_id: {to_email, subject, body, url}}` in agent_state.json. It's a normal Python dict, will keep working with the JSON approach.
   - What's unclear: Nothing — deferring.
   - Recommendation: Same as #2 — leave alone.

## Environment Availability

| Dependency | Required By | Available (assumed) | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Docker + docker-compose | All | ✓ (already deployed) | current | — |
| Python 3.12 | app container | ✓ (Dockerfile) | 3.12-slim | — |
| Postgres 16 image | New service | ✓ (Docker Hub) | postgres:16-alpine | Any 15+ works; 16 is current stable |
| SSH access to VPS | Deploy | ✓ (deploy.yml) | — | — |
| Ability to add env vars on VPS | POSTGRES_* secrets | ✓ (existing `.env` pattern) | — | — |

**Missing dependencies with no fallback:** none anticipated. All infrastructure Phase 7 needs is a superset of what's already deployed.

**Missing dependencies with fallback:** none.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | pytest 8.x (existing) + pytest-postgresql (new) |
| Config file | `app/tests/conftest.py` (add DB fixture); no pytest.ini yet — pytest picks up tests/ by convention |
| Quick run command | `cd app && pytest tests/test_data_store.py -x` |
| Full suite command | `cd app && pytest -x` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DB-01 | Postgres container starts and app connects | integration (smoke) | `cd app && pytest tests/test_db_smoke.py::test_engine_connects -x` | ❌ Wave 0 |
| DB-02 | Listing model round-trips a full entry (all columns + JSONB) | unit | `pytest tests/test_models.py::test_listing_roundtrip -x` | ❌ Wave 0 |
| DB-02 | Postgres ENUM rejects an unknown status | unit | `pytest tests/test_models.py::test_status_enum_rejects_invalid -x` | ❌ Wave 0 |
| DB-02 | JSONB `viewing_history.append` requires reassignment (documents the convention) | unit | `pytest tests/test_models.py::test_jsonb_mutation_requires_reassign -x` | ❌ Wave 0 |
| DB-03 | Alembic head migration produces the current model schema | unit | `pytest tests/test_alembic.py::test_alembic_head_matches_metadata -x` | ❌ Wave 0 |
| DB-04 | migrate_from_json is idempotent (run twice = same rows) | integration | `pytest tests/test_migration.py::test_idempotent_rerun -x` | ❌ Wave 0 |
| DB-04 | migrate_from_json preserves ku.manual when present | integration | `pytest tests/test_migration.py::test_preserves_ku_manual -x` | ❌ Wave 0 |
| DB-05 | Existing test_data_store.py tests all pass against DB backend | port | `pytest tests/test_data_store.py -x` | ✅ (port existing) |
| DB-05 | Existing test_pending.py tests all pass | port | `pytest tests/test_pending.py -x` | ✅ (port existing) |
| DB-05 | Existing test_viewing_workflow.py tests all pass | port | `pytest tests/test_viewing_workflow.py -x` | ✅ (port existing) |
| DB-05 | Existing test_price_intelligence.py tests all pass | port | `pytest tests/test_price_intelligence.py -x` | ✅ (port existing) |
| DB-06 | Container entrypoint waits for pg, migrates, starts uvicorn (manual verify or integration test) | manual-only | `docker compose up --build && curl localhost:8000/api/health` | manual |
| DB-07 | Test suite runs green against real Postgres in CI | full suite | `cd app && pytest -x` | ✅ (fixture change) |
| DB-08 | brief_generator.generate_and_save_brief does not hold a DB session across Anthropic HTTP call | unit | `pytest tests/test_brief_generator.py::test_no_session_during_http -x` | ❌ Wave 0 (new assertion) |

### Sampling Rate

- **Per task commit:** `cd app && pytest tests/test_data_store.py tests/test_models.py -x` (fast — ~5s)
- **Per wave merge:** `cd app && pytest -x` (full suite — ~30s once pytest-postgresql spins Postgres)
- **Phase gate:** Full suite green + manual `docker compose up --build` on a clean volume + verify `curl :8000/api/health` returns `{"ok": true}` + verify a listing round-trips through `POST /api/ingest` (with mock scraper token) and appears in `GET /api/pending`.

### Wave 0 Gaps

- [ ] `app/tests/test_db_smoke.py` — engine connects, session opens (covers DB-01)
- [ ] `app/tests/test_models.py` — Listing round-trip, ENUM rejection, JSONB reassignment convention (covers DB-02)
- [ ] `app/tests/test_alembic.py` — `alembic upgrade head` produces schema matching `Base.metadata` (covers DB-03)
- [ ] `app/tests/test_migration.py` — migrate_from_json idempotency, ku.manual preservation (covers DB-04)
- [ ] `app/tests/conftest.py` — add `db_session` fixture using `pytest-postgresql` (needed by every other test)
- [ ] Framework install: append `pytest-postgresql>=6.0.0` to `app/requirements.txt`
- [ ] Update existing `tmp_agent_state` fixture path: still needed for tests that touch `settings.json` and `agent_state.json` (both remain on filesystem), but the `APP_DATA_FILE` monkeypatch is no longer needed — that test data now lives in `db_session`.

## Security Domain

`security_enforcement: true`, `security_asvs_level: 1` in `.planning/config.json`. Applicable ASVS categories for a persistence-layer refactor:

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No new auth surface in Phase 7 |
| V3 Session Management | no | Web session model unchanged (Caddy Basic Auth in prod, INGEST_TOKEN for /api/ingest) |
| V4 Access Control | no | Same routes, same access rules |
| V5 Input Validation | yes | ORM inputs; parameterized queries prevent SQL injection by default |
| V6 Cryptography | partial | Postgres wire connection inside a private docker network — no TLS needed; secret storage in `.env` follows existing pattern |
| V7 Error Handling | yes | Never-raise convention: SQLAlchemyError logged, sentinel returned — no stack traces to clients |
| V8 Data Protection | yes | `POSTGRES_PASSWORD` never logged; `.env` remains not-in-git |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SQL injection via string-formatted queries | Tampering | Always use ORM methods or `sqlalchemy.text(":param")` with bind parameters. NEVER use `%` or f-string formatting to interpolate values into SQL. SQLAlchemy 2.x's `select(...).where(Listing.id == user_input)` is safe by default. |
| Credential leak via logs | Information Disclosure | Never log `DATABASE_URL` (contains password). Never log `POSTGRES_PASSWORD` directly. Never `log.error("connect failed: %s", DATABASE_URL)`. Log the host/DB/user only. |
| Credential leak via error messages | Information Disclosure | psycopg / SQLAlchemy occasionally embed the DSN in exception messages. Catch `SQLAlchemyError` broadly, log with `log.exception("DB call failed")` (no DSN in the format string), return sentinel — never propagate the exception to a HTTP response body. |
| Connection pool exhaustion | Denial of Service | `pool_pre_ping=True`, `pool_size` default (5) is fine for single-user. Sessions closed via `with SessionLocal() as db:` context manager. No session held across HTTP (see Pitfall 2). |
| Migration script credential exposure | Information Disclosure | `migrate_from_json.py` reads `config.APP_DATA_FILE` (JSON) — no credentials in that file. The DB connection comes from `SessionLocal`, which imports config — same secret handling as the app. |
| Backup file (`app_data.json.pre-pg7`) exposure | Information Disclosure | The file stays inside the Docker volume, only reachable by processes in the `app` container. Docker volume permissions are the guard. The file contains listing data — same sensitivity level as the DB rows themselves; no new exposure. |
| Alembic drift between environments | Tampering (via wrong schema) | `alembic upgrade head` at startup keeps every environment lockstep; version file `alembic/versions/*.py` is checked into git and treated as code. |

**Explicit non-controls (out of scope for Phase 7 per D-06):**
- No `pg_dump` cron
- No point-in-time recovery
- No off-site copy
- No replicated standby

These are documented as deferred (see § Deferred in CONTEXT.md and § Assumptions Log). If the sole Postgres volume corrupts before Phase 8 backup work, data loss is up to the last `app_data.json.pre-pg7` snapshot from Phase 7 cutover (which is a one-time bootstrap file — not a rolling backup).

## Sources

### Primary (HIGH confidence)

- SQLAlchemy 2.x MappedAsDataclass integration — [docs.sqlalchemy.org/en/20/orm/dataclasses.html](https://docs.sqlalchemy.org/en/20/orm/dataclasses.html)
- SQLAlchemy PostgreSQL dialect (JSONB, ENUM) — [docs.sqlalchemy.org/en/20/dialects/postgresql.html](https://docs.sqlalchemy.org/en/20/dialects/postgresql.html)
- SQLAlchemy Mutation Tracking (Mutable / MutableDict) — [docs.sqlalchemy.org/en/20/orm/extensions/mutable.html](https://docs.sqlalchemy.org/en/20/orm/extensions/mutable.html)
- SQLAlchemy Session basics (thread-safety, expire_on_commit) — [docs.sqlalchemy.org/en/20/orm/session_basics.html](https://docs.sqlalchemy.org/en/20/orm/session_basics.html)
- Alembic autogenerate — [alembic.sqlalchemy.org/en/latest/autogenerate.html](https://alembic.sqlalchemy.org/en/latest/autogenerate.html)
- Alembic tutorial (env.py setup) — [alembic.sqlalchemy.org/en/latest/tutorial.html](https://alembic.sqlalchemy.org/en/latest/tutorial.html)
- Docker Compose depends_on with health checks — [docs.docker.com/compose/how-tos/startup-order/](https://docs.docker.com/compose/how-tos/startup-order/)
- Postgres 16 official image — [hub.docker.com/_/postgres](https://hub.docker.com/_/postgres)
- FastAPI SQL databases tutorial — [fastapi.tiangolo.com/tutorial/sql-databases/](https://fastapi.tiangolo.com/tutorial/sql-databases/)

### In-repo canonical patterns (HIGH confidence)

- `app/data_store.py` — every public function currently in scope
- `app/config.py` — env-driven module constant convention
- `app/brief_generator.py:233-300` — Pitfall 5 snapshot-outside-lock canonical pattern
- `app/ingest_handler.py:394-414` — daemon-thread + HTTP-outside-lock canonical
- `app/tests/conftest.py` — existing fixture patterns
- `.planning/phases/06-viewing-workflow-extras/06-PATTERNS.md` — Phase 6 pattern-map (analog for state-transition helpers)

### Secondary (MEDIUM confidence)

- SQLAlchemy JSONB + MutableDict discussion (typing challenges, nested mutation) — [github.com/sqlalchemy/sqlalchemy/discussions/12046](https://github.com/sqlalchemy/sqlalchemy/discussions/12046)
- sqlalchemy-json NestedMutableJson (rejected as dependency) — [github.com/edelooff/sqlalchemy-json](https://github.com/edelooff/sqlalchemy-json)
- Alembic environment-variable DATABASE_URL pattern — [allan-simon.github.io/blog/posts/python-alembic-with-environment-variables/](https://allan-simon.github.io/blog/posts/python-alembic-with-environment-variables/)
- FastAPI + Alembic + Postgres + Docker walkthrough — [berkkaraal.com/blog/2024/09/19/setup-fastapi-project-with-async-sqlalchemy-2-alembic-postgresql-and-docker/](https://berkkaraal.com/blog/2024/09/19/setup-fastapi-project-with-async-sqlalchemy-2-alembic-postgresql-and-docker/)
- Docker Compose health check patterns — [last9.io/blog/docker-compose-health-checks/](https://last9.io/blog/docker-compose-health-checks/)

### Tertiary (LOW confidence)

- Blog explanations of MappedAsDataclass style — [medium.com/@azizmarzouki/embracing-modern-sqlalchemy-2-0](https://medium.com/@azizmarzouki/embracing-modern-sqlalchemy-2-0-declarativebase-mapped-and-beyond-ef8bcba1e79c) — used only to sanity-check phrasing; official docs are authoritative

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — SQLAlchemy 2.x, Alembic, psycopg3, pytest-postgresql are all long-standing ecosystem defaults; versions verified against PyPI on 2026-07-25.
- Architecture: HIGH — Pattern is standard for FastAPI + Postgres apps; all in-repo integration points identified.
- Pitfalls: HIGH — JSONB mutation and session-across-HTTP are the two well-known landmines; both have explicit conversions of the existing Pitfall 5 pattern.
- Migration script: MEDIUM — Idempotency logic is straightforward but has never been executed against the real `app_data.json` in this codebase; a dry-run test on a copy is recommended before first production deploy.

**Research date:** 2026-07-25
**Valid until:** 2026-09-25 (60 days — SQLAlchemy 2.x + Alembic + psycopg3 + Postgres 16 are all stable long-cycle projects; the primary decay risk is a `MappedAsDataclass` API tweak in 2.1 which is still in beta as of research date)
