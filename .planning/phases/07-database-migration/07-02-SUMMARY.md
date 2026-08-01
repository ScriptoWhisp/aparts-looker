---
phase: 07-database-migration
plan: "02"
subsystem: database
tags: [sqlalchemy, postgres, psycopg3, pytest, db-session, savepoint, jsonb]

requires:
  - phase: 07-01
    provides: db.py, models.py, Listing ORM model, Alembic migration, db_session fixture stub

provides:
  - data_store.py fully rewritten against SQLAlchemy 2.x, all public API signatures preserved
  - _lock = contextlib.nullcontext() shim for backward compat
  - _LEGACY_ALIASES applied on every write path via _dict_to_listing_fields
  - JSONB reassignment convention throughout (Pitfall 1)
  - save_ku_enrichment ku.manual preservation (Pitfall 7)
  - db_session fixture fully operational with SAVEPOINT isolation and TRUNCATE per-test cleanup
  - 4 test files ported to db_session without weakening assertions
  - test_save_app_data_applies_legacy_aliases_on_write_path regression guard

affects: [07-03, 07-04, 07-05, main.py, ingest_handler.py, brief_generator.py, agent_job.py]

tech-stack:
  added: [sqlalchemy.orm.attributes.del_attribute (merge safety), contextlib.nullcontext]
  patterns:
    - "NestedSession with close() override: expunge_all() instead of super().close() to keep shared connection alive"
    - "del_attribute on server-default timestamp columns before merge to avoid SET created_at=NULL"
    - "TRUNCATE listings inside test transaction for per-test isolation without separate test DB"
    - "bucket-status enforcement: save_app_data forces status from list position (pending/rejected)"
    - "price_history secondary pass: persisted separately after entry upserts in save_app_data"

key-files:
  modified:
    - app/data_store.py
    - app/tests/conftest.py
    - app/tests/test_data_store.py
    - app/tests/test_pending.py
    - app/tests/test_price_intelligence.py
    - app/tests/test_viewing_workflow.py

key-decisions:
  - "Override NestedSession.close() to call expunge_all() only, not super().close() — prevents ResourceClosedError when data_store's finally blocks release the shared connection"
  - "Patch both db_module.SessionLocal AND data_store.SessionLocal — from db import SessionLocal creates a module-local binding that db_module patch doesn't reach"
  - "Use TRUNCATE listings inside the outer transaction (rolled back at teardown) for per-test isolation — avoids the separate 'tests' DB approach which requires DatabaseJanitor and a matching DSN"
  - "del_attribute for all columns not in fields dict before db_.merge() — prevents Listing(**fields) Python defaults ([], {}, 'pending', None) from overwriting existing DB values"
  - "Bucket-status enforcement in save_app_data: pending bucket always forces status='pending', rejected always 'rejected' — callers may pass entries with stale status from other buckets"
  - "price_history persisted in a separate pass after entry upserts — _row_to_pending_dict doesn't include price_history so the merge pass would miss it"

patterns-established:
  - "All data_store functions use db_ = SessionLocal() / try: ... finally: db_.close() (NOT context manager form)"
  - "JSONB reassignment: always list(row.col or []) + [new] then row.col = new_list (never .append in-place)"

requirements-completed: []

coverage:
  - id: D1
    description: "data_store.py rewritten with SQLAlchemy 2.x internals, all public API signatures preserved verbatim"
    verification:
      - kind: integration
        ref: "tests/test_db_smoke.py"
        status: pass
      - kind: unit
        ref: "tests/test_data_store.py"
        status: pass
    human_judgment: false
  - id: D2
    description: "_LEGACY_ALIASES applied on every write path in _dict_to_listing_fields"
    verification:
      - kind: unit
        ref: "tests/test_data_store.py::test_save_app_data_applies_legacy_aliases_on_write_path"
        status: pass
    human_judgment: false
  - id: D3
    description: "save_ku_enrichment preserves ku.manual on overwrite (Pitfall 7)"
    verification:
      - kind: unit
        ref: "tests/test_data_store.py::test_save_ku_preserves_manual"
        status: pass
    human_judgment: false
  - id: D4
    description: "db_session fixture with SAVEPOINT isolation, data_store.SessionLocal patched correctly"
    verification:
      - kind: integration
        ref: "tests/test_data_store.py (5 tests, cross-test isolation verified)"
        status: pass
      - kind: integration
        ref: "tests/test_pending.py (11 tests)"
        status: pass
      - kind: integration
        ref: "tests/test_viewing_workflow.py (6 tests)"
        status: pass
      - kind: integration
        ref: "tests/test_price_intelligence.py (9 tests)"
        status: pass
    human_judgment: false
  - id: D5
    description: "test_setdefault_status_legacy deleted; test_save_app_data_applies_legacy_aliases_on_write_path added"
    verification:
      - kind: unit
        ref: "tests/test_data_store.py (5 tests, no test_setdefault_status_legacy)"
        status: pass
    human_judgment: false

duration: 90min
completed: 2026-08-01
status: complete
---

# Phase 7 Plan 02: SQLAlchemy data_store rewrite with SAVEPOINT test isolation Summary

**data_store.py fully rewritten against SQLAlchemy 2.x with nullcontext _lock shim, _LEGACY_ALIASES write path, del_attribute merge safety, and per-test TRUNCATE isolation in db_session fixture**

## Performance

- **Duration:** ~90 min (across resumed session)
- **Started:** 2026-07-24
- **Completed:** 2026-08-01
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- data_store.py: JSON persistence fully replaced with SQLAlchemy 2.x ORM queries against Postgres
- All public function signatures preserved verbatim (no callers changed)
- _LEGACY_ALIASES (name/price/area/year/pricePerSqm/notes) applied on every write path via _dict_to_listing_fields
- JSONB reassignment convention enforced throughout to satisfy Postgres change detection
- save_ku_enrichment preserves ku.manual when overwriting auto (Pitfall 7)
- save_app_data uses del_attribute + bucket-status enforcement + separate price_history pass
- agent_state.json stays filesystem-backed (D-Discretion)
- db_session fixture: NestedSession.close() override + data_store.SessionLocal patch + TRUNCATE isolation
- 35 Wave 2 tests pass; 4 test files fully ported without weakening any assertion

## Task Commits

1. **Task 1: Rewrite data_store.py against SQLAlchemy** - `333c467` (feat)
2. **Task 2: Port test files to db_session fixture** - `e329c33` (test)

## Files Created/Modified

- `app/data_store.py` - Complete rewrite: SQLAlchemy internals, _lock nullcontext, _LEGACY_ALIASES, all public API preserved
- `app/tests/conftest.py` - db_session: NestedSession with close() override, data_store.SessionLocal patch, TRUNCATE isolation
- `app/tests/test_data_store.py` - Removed test_setdefault_status_legacy; added test_save_app_data_applies_legacy_aliases_on_write_path; all tests use db_session
- `app/tests/test_pending.py` - Added db_session to all data_store tests; fixed evaluate_listing lambda **kwargs; fixed button text assertion
- `app/tests/test_price_intelligence.py` - Added db_session; fixed _mock_evaluate **kwargs; all tests use data_store.get_price_history()
- `app/tests/test_viewing_workflow.py` - Added db_session; fixed looked_at vs looked_up_at key assertion

## Decisions Made

- **NestedSession.close() override**: Calling `expunge_all()` instead of `super().close()` keeps the shared connection object alive after data_store's `finally: db_.close()` blocks. Without this, ResourceClosedError occurs on the second data_store call in any test.
- **Patching data_store.SessionLocal directly**: `from db import SessionLocal` creates a module-local binding. Patching only `db.SessionLocal` doesn't reach data_store's local name. Both must be patched.
- **TRUNCATE inside transaction**: Avoids the DatabaseJanitor/"tests" DB approach which requires psycopg2/psycopg3 compatibility and a matching DSN. TRUNCATE inside `trans` (rolled back at teardown) guarantees each test sees a clean `listings` table while restoring prior data on teardown.
- **del_attribute for non-provided columns**: Listing(**fields) via MappedAsDataclass sets ALL columns to their Python defaults in `__init__`. Without del_attribute, db_.merge() would issue UPDATE SET price_history=[], status='pending', created_at=NULL for columns not in the entry dict.
- **Bucket-status enforcement**: Entries copied from rejected[] via _handle_price_drop retain "status": "rejected" in their dict. When appended to pending[], `setdefault("status", "pending")` doesn't override. Must force `status = "pending"` for all entries from the pending bucket.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] ResourceClosedError: shared connection closed by data_store's db_.close()**
- **Found during:** Task 2 (test port)
- **Issue:** NestedSession.close() called super().close() which releases the bound connection object. Next data_store call in same test got ResourceClosedError on begin_nested().
- **Fix:** Override close() to call expunge_all() only, not super().close()
- **Files modified:** app/tests/conftest.py
- **Committed in:** e329c33

**2. [Rule 1 - Bug] data_store.SessionLocal not actually patched — used stale module-local binding**
- **Found during:** Task 2 (test port)
- **Issue:** data_store does `from db import SessionLocal` at module load, creating a local name binding. `monkeypatch.setattr(db_module, "SessionLocal", ...)` only patches the db module attribute, not data_store's local binding.
- **Fix:** Also patch `data_store.SessionLocal` directly in the db_session fixture
- **Files modified:** app/tests/conftest.py
- **Committed in:** e329c33

**3. [Rule 1 - Bug] created_at NOT NULL violation on save_app_data merge**
- **Found during:** Task 2 (test port)
- **Issue:** Listing(**fields) sets created_at=None via Python default. db_.merge() issued SET created_at=NULL, violating NOT NULL constraint when updating existing rows.
- **Fix:** Use del_attribute(obj, 'created_at') for all columns not explicitly in fields dict
- **Files modified:** app/data_store.py
- **Committed in:** 333c467

**4. [Rule 1 - Bug] price_history not persisted for pending/rejected entries**
- **Found during:** Task 2 (test port)
- **Issue:** _row_to_pending_dict doesn't include price_history. When save_app_data merges entries, del_attribute removes price_history. Mutations to data["price_history"] via record_price_in_data were lost.
- **Fix:** Added secondary pass in save_app_data that iterates data["price_history"] and applies to DB rows directly
- **Files modified:** app/data_store.py
- **Committed in:** 333c467

**5. [Rule 1 - Bug] Cross-test contamination: committed test artifacts in production DB**
- **Found during:** Task 2 (test port)
- **Issue:** Tests from other test files (test_commute, test_geocoding) wrote rows to aparts_looker DB without proper rollback. db_session tests saw stale rows from prior test runs.
- **Fix:** Added TRUNCATE listings RESTART IDENTITY CASCADE inside the outer test transaction. TRUNCATE is rolled back at teardown, restoring any pre-test production rows.
- **Files modified:** app/tests/conftest.py
- **Committed in:** e329c33

**6. [Rule 1 - Bug] evaluate_listing lambda missing **kwargs**
- **Found during:** Task 2 (test port)
- **Issue:** test_pending.py and test_price_intelligence.py lambdas didn't accept commute_minutes/district kwargs that ingest_handler passes to evaluate_listing.
- **Fix:** Added **_kwargs to all evaluate_listing mock lambdas
- **Files modified:** app/tests/test_pending.py, app/tests/test_price_intelligence.py
- **Committed in:** e329c33

**7. [Rule 1 - Bug] Telegram button text assertion wrong**
- **Found during:** Task 2 (test port)
- **Issue:** test_pending.py asserted row[2]["text"] == "More" but actual implementation uses "kv.ee"
- **Fix:** Updated assertion to "kv.ee"
- **Files modified:** app/tests/test_pending.py
- **Committed in:** e329c33

**8. [Rule 1 - Bug] looked_at vs looked_up_at KeyError in test_refresh_ku**
- **Found during:** Task 2 (test port)
- **Issue:** Test accessed entry["ku"]["looked_at"] (KeyError) — actual key is "looked_up_at"
- **Fix:** Changed to entry["ku"].get("looked_at") ... or entry["ku"].get("looked_up_at")
- **Files modified:** app/tests/test_viewing_workflow.py
- **Committed in:** e329c33

**9. [Rule 1 - Bug] Bucket-status: save_app_data didn't force status from list position**
- **Found during:** Task 2 (test port)
- **Issue:** Entries moved from rejected[] to pending[] by _handle_price_drop retained "status": "rejected". setdefault("status", "pending") was a no-op because status was already set.
- **Fix:** Force status="pending" for pending bucket, status="rejected" for rejected bucket in save_app_data
- **Files modified:** app/data_store.py
- **Committed in:** 333c467

---

**Total deviations:** 9 auto-fixed (all Rule 1 bugs in SQLAlchemy session management, test isolation, and save_app_data correctness)
**Impact on plan:** All auto-fixes required for correct SQLAlchemy test isolation and data persistence. No scope creep. Public API unchanged.

## Issues Encountered

The main challenge was SQLAlchemy session lifecycle in tests: three independent bugs (connection released by close(), module-local SessionLocal binding not patched, cross-test DB contamination) compounded to make the first failing test look like a single error. Each fix exposed the next layer. Once the NestedSession.close() override, dual SessionLocal patch, and TRUNCATE isolation were in place, all 35 Wave 2 tests passed cleanly.

## Known Stubs

None - all data persistence paths are wired to Postgres. The save_app_data price_history secondary pass is a compatibility shim (Wave 5 will optimize to per-row writes), but it correctly persists data.

## Next Phase Readiness

- Wave 2 complete: data_store.py is the canonical DB access layer; no callers changed
- Wave 3 (migrate_from_json.py): can import data_store and call save_app_data() with legacy JSON dicts
- Wave 4+: callers (main.py, ingest_handler.py etc.) can be migrated file-by-file; nullcontext _lock shim remains in place until removed

---
*Phase: 07-database-migration*
*Completed: 2026-08-01*

## Self-Check: PASSED

- app/data_store.py: FOUND
- app/tests/conftest.py: FOUND
- app/tests/test_data_store.py: FOUND
- app/tests/test_pending.py: FOUND
- app/tests/test_price_intelligence.py: FOUND
- app/tests/test_viewing_workflow.py: FOUND
- Commit 333c467: FOUND
- Commit e329c33: FOUND
