---
phase: 07-database-migration
plan: "05"
subsystem: database
tags: [sqlalchemy, row-scoped, performance, pitfall-6, pitfall-1, pitfall-2, db-05]
dependency_graph:
  requires: [07-04]
  provides: [wave5-hot-callers-complete, zero-data-store-lock]
  affects: [main, settings_store]
tech_stack:
  patterns:
    - "Row-scoped query + commit-once pattern for bulk recompute (settings_store, backfill endpoints)"
    - "Session/HTTP split three-step pattern for backfill_commutes (RESEARCH Pitfall 2)"
    - "JSONB reassignment convention enforced in all six hot callers (row.field = new_dict)"
    - "data_store._lock nullcontext shim now has zero callers in main.py and settings_store.py"
key_files:
  modified:
    - app/settings_store.py
    - app/main.py
    - app/tests/test_wave5_hot_callers.py
decisions:
  - "Removed data_store._lock wrapper from reevaluate_listing, create_draft_endpoint, patch_checklist in addition to the 6 plan-specified hot callers — all 9 remaining sites had to be cleared to satisfy the zero-lock success criterion"
  - "backfill_commutes uses three-step session/HTTP/commit split per RESEARCH Pitfall 2 — ORS HTTP calls outside any session to avoid connection pool exhaustion"
  - "delete_all_listings counts status before DELETE (not via app_data lists) for accurate response payload; the wipe semantics remain atomic at the DB level"
  - "cost_override builds new_coo as a merged dict then reassigns row.cost_of_ownership = new_coo (JSONB reassignment, never in-place mutation)"
  - "No backup logic added to delete_all_listings per CONTEXT.md D-06"
metrics:
  duration: "7 minutes"
  completed: "2026-08-01"
  tasks_completed: 2
  files_modified: 3
status: complete
---

# Phase 07 Plan 05: Wave 5 Hot Callers — Row-Scoped SQL Summary

Wave 5 converted all hot callers from the load_app_data → mutate → save_app_data compat shim to row-scoped SQLAlchemy queries, eliminating the O(N) upsert loops that caused multi-second latency on settings saves.

**One-liner:** Row-scoped SQL commits replace whole-dict upsert loops in 6 hot callers; settings save latency drops from seconds to <20ms; zero `with data_store._lock:` blocks remain in main.py and settings_store.py.

## What Was Built

### Task 1 — settings_store._recompute_all_costs (Task 1, TDD RED→GREEN)

Rewrote from `load_app_data() → iterate dicts → save_app_data()` (O(N) upserts) to:

1. `with SessionLocal() as db_:` open one session
2. `db_.query(Listing).all()` — iterate all rows
3. Skip rows with `cost_of_ownership.overridden = True` (manual override guard preserved)
4. `row.cost_of_ownership = coo` — JSONB reassignment (Pitfall 1)
5. `db_.commit()` — single commit after all rows processed

Returns integer count of updated rows (signature unchanged).

### Task 2 — main.py six hot endpoints

| Endpoint | Old pattern | New pattern |
|----------|-------------|-------------|
| `delete_all_listings` | load → clear lists → save + agent_state | `db.query(Listing).delete()` + agent_state.json reset |
| `delete_listing` | load → pop from list → save | `db.get(Listing, id)` → `db.delete(row)` → commit |
| `cost_override` | load → find → mutate dict → save | `db.get(Listing, id)` → JSONB reassignment → commit |
| `cost_override_reset` | load → find → recompute → save | `db.get(Listing, id)` → recompute → JSONB reassign → commit |
| `backfill_costs` | lock → load → iterate dicts → save | one session → iterate rows → skip overridden → commit once |
| `backfill_commutes` | lock → load → HTTP inside loop → save | snapshot IDs (session 1) → HTTP outside → commit (session 2) |

Additionally removed lock wrappers from three low-traffic endpoints:
- `reevaluate_listing` — `data_store._lock` was already a nullcontext; removed wrapper, body unchanged
- `create_draft_endpoint` — agent_state.json write, no DB mutation; lock wrapper removed
- `patch_checklist` — checklist JSONB write via compat shim; lock wrapper removed

Total `with data_store._lock:` removals in Wave 5: 9 sites in main.py + 1 in settings_store.py = 10.

### New Tests

`app/tests/test_wave5_hot_callers.py` — 18 tests covering:
- `TestRecomputeAllCosts`: updates non-overridden rows, skips overridden, source inspection for lock absence
- `TestDeleteAllListings`: DB rows removed, seen_listing_ids reset, ok response
- `TestDeleteListing`: row removed from DB, 404 on missing
- `TestCostOverride`: overridden=True set in DB, preserved through recompute, 404 on missing
- `TestCostOverrideReset`: overridden flag cleared, 404 on missing
- `TestBackfillCosts`: 2 updated / 1 skipped (overridden), lock source inspection
- `TestBackfillCommutes`: 2 updated (lat/lng present) / 1 skipped (no coords), no-key guard, lock source inspection

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Scope] Removed data_store._lock from 3 additional low-traffic sites**
- **Found during:** Task 2 verification (grep gate requires zero)
- **Issue:** `reevaluate_listing`, `create_draft_endpoint`, `patch_checklist` had `with data_store._lock:` wrappers. These were not in the plan's explicit 6-endpoint list but the success criterion requires `grep -c 'with data_store._lock' main.py` = 0.
- **Fix:** Removed the (no-op nullcontext) wrappers; the function bodies were left structurally unchanged. These are low-traffic endpoints whose inner `data_store.*` calls each manage their own sessions.
- **Files modified:** `app/main.py`
- **Commit:** d8c5e0f

## Commits

| Step | Commit | Description |
|------|--------|-------------|
| TDD RED | 590582c | test(07-05): add failing tests for Wave 5 hot-caller row-scoped SQL |
| TDD GREEN | d8c5e0f | refactor(07-05): convert all hot callers to row-scoped SQL, remove data_store._lock |

## Verification Results

- **Grep gate** (`grep -c 'with data_store._lock' main.py settings_store.py brief_generator.py ingest_handler.py`): **all 0**
- **Full test suite:** `122 passed, 0 failed` (was 104 pre-Wave-5; 18 new tests added)
- **Container health:** `GET /api/health` → `{"ok": true}`
- **Settings save timing:** `POST /api/settings {"cost_interest_pct": 4.5}` → 18ms total (well under 500ms goal)
- **Backfill-costs smoke test:** `{"ok": true, "updated": 0, "skipped": 5}` (skipped because no price/area data in current DB)
- **Backfill-commutes smoke test:** `{"ok": false, "error": "ORS_API_KEY not configured"}` (expected — no ORS key in local env)
- **Delete-all-listings:** wiped 5 rows (3 approved + 2 pending), reset seen_listing_ids
- **cost_override 404:** returns `{"detail": "Listing not found"}` correctly
- **cost_override_reset 404:** returns `{"detail": "Listing not found"}` correctly
- **Container logs:** clean restart, no errors, Alembic migrations OK

## Known Stubs

None. All six hot callers fully converted to row-scoped SQL.

## Threat Flags

None. Wave 5 is a pure performance refactor — no new network endpoints, auth paths, or schema changes introduced. All T-07-05-0x mitigations applied:
- T-07-05-01: Settings save latency fixed by row-scoped commit-once
- T-07-05-02: JSONB reassignment enforced in all callers (`row.cost_of_ownership = new_dict`)
- T-07-05-05: No DATABASE_URL logged — only listing_id / counts in log.exception calls

## Self-Check: PASSED

- `app/tests/test_wave5_hot_callers.py` exists and contains 18 tests
- `app/settings_store.py` modified — `_recompute_all_costs` uses SessionLocal
- `app/main.py` modified — 9 lock sites removed, 6 endpoints row-scoped
- Commit 590582c (RED) confirmed in git log
- Commit d8c5e0f (GREEN) confirmed in git log
- 122 tests pass, 0 failures
