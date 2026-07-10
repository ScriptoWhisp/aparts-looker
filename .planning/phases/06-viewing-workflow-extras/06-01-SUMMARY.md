---
phase: "06-viewing-workflow-extras"
plan: "01"
subsystem: "persistence + test foundation"
tags: [data_store, viewing_workflow, tdd, wave_0, pytest, setdefault_migration]
dependency_graph:
  requires: []
  provides:
    - data_store.set_viewing_scheduled
    - data_store.mark_viewed
    - data_store.save_negotiation_brief
    - data_store.save_ku_enrichment
    - setdefault migration for status/scheduled_at/viewing_history/negotiation_brief/ku
    - test scaffolds for viewing_workflow/brief_generator/ku_lookup
  affects:
    - app/data_store.py
    - app/tests/test_data_store.py
    - app/tests/test_viewing_workflow.py
    - app/tests/test_brief_generator.py
    - app/tests/test_ku_lookup.py
tech_stack:
  added: []
  patterns:
    - setdefault-on-load zero-downtime migration (existing convention, extended)
    - never-raise state-transition helpers with RLock
    - Wave 0 pytest skeleton files with pytest.skip("Filled by Plan 06-0X")
key_files:
  modified:
    - app/data_store.py
  created:
    - app/tests/test_data_store.py
    - app/tests/test_viewing_workflow.py
    - app/tests/test_brief_generator.py
    - app/tests/test_ku_lookup.py
decisions:
  - "mark_viewed guards against non-viewing_scheduled transitions (D-03 no-auto-transition rule) — returns False with a log warning when called on an 'approved' entry"
  - "save_negotiation_brief also writes negotiation_brief_generated_at timestamp (D-06 freshness requirement)"
  - "save_ku_enrichment writes looked_up_at timestamp inside entry.ku dict (D-13 section header timestamp)"
  - "Pre-existing test failures in test_pending/test_ingest/test_price_intelligence/test_commute are out-of-scope (caused by uncommitted Phase 5 work in ingest_handler.py); documented as deferred"
metrics:
  duration: "~20 minutes"
  completed: "2026-07-10T17:27:35Z"
  tasks_completed: 3
  tasks_total: 3
  files_modified: 1
  files_created: 4
status: complete
---

# Phase 06 Plan 01: Wave 0 Persistence + Test Foundation Summary

**One-liner:** setdefault migration for 5 Phase 6 fields + 4 state-transition helpers in data_store.py + Wave 0 pytest scaffold (5 passing data-model tests + 12 skeleton stubs)

## What Was Built

### Task 1: setdefault migration in load_app_data()

Extended the existing per-entry migration loop in `data_store.load_app_data()` with five new `setdefault` calls. All five fields are additive — legacy `app_data.json` files load unchanged after deploy:

| Field | Default | Requirement |
|-------|---------|-------------|
| `status` | `"approved"` | VIEW-01, D-01 |
| `scheduled_at` | `None` | VIEW-01, D-02 |
| `viewing_history` | `[]` | VIEW-01, D-04 |
| `negotiation_brief` | `None` | VIEW-03, D-06 |
| `ku` | `None` | ENRICH-01, D-11 |

Added a docstring to `load_app_data()` citing the additive migration pattern and the D-XX references.

### Task 2: Four state-transition helpers

Four new module-level functions added to `data_store.py` after `reject_listing`:

- **`set_viewing_scheduled(listing_id, scheduled_at_iso) -> bool`**: Acquires `_lock`, finds entry in `properties[]`, sets `status="viewing_scheduled"` and `scheduled_at`, appends `{action: "scheduled", at: <utc now>, scheduled_for: ...}` to `viewing_history`. Returns False on miss.

- **`mark_viewed(listing_id) -> bool`**: Guard clause rejects transition if `entry.status != "viewing_scheduled"` (D-03 no-auto-transition rule — logs warning, returns False). On valid entry, sets `status="viewed"`, appends `{action: "viewed", at: <utc now>}` to history.

- **`save_negotiation_brief(listing_id, brief) -> bool`**: Overwrites `entry.negotiation_brief` and sets `entry.negotiation_brief_generated_at` to current UTC ISO for freshness display (D-06).

- **`save_ku_enrichment(listing_id, ku_auto) -> bool`**: Reads `existing.get("manual", "")` before overwriting, writes `{auto: ku_auto, manual: <prior>, looked_up_at: <utc iso>}` (Pitfall 7 + D-13).

All four: acquire `_lock`, load → find → mutate → save pattern, `try/except Exception: return False` (never-raise).

### Task 3: Wave 0 test scaffold

**`app/tests/test_data_store.py`** (5 fully-implemented, all GREEN):
- `test_setdefault_status_legacy` — writes legacy JSON, loads, asserts all 5 new fields have defaults
- `test_set_viewing_scheduled_missing` — asserts False on unknown listing_id
- `test_reschedule_appends_history` — calls twice, asserts `len(viewing_history) == 2`
- `test_save_ku_preserves_manual` — asserts `manual` field survives a `save_ku_enrichment` call
- `test_mark_viewed_transitions_from_scheduled` — asserts success from `viewing_scheduled`, False from `approved`

**Skeleton files** (all collect cleanly, bodies are `pytest.skip("Filled by Plan 06-0X")`):
- `app/tests/test_viewing_workflow.py` — 6 functions (Plans 06-02 to 06-04)
- `app/tests/test_brief_generator.py` — 3 functions (Plan 06-03)
- `app/tests/test_ku_lookup.py` — 3 functions (Plan 06-04)

## Verification Results

```
pytest app/tests/test_data_store.py -x -q
5 passed in 0.02s

pytest app/tests -q --collect-only
91 tests collected in 0.12s  (no ImportError, no collection errors)
```

## Deviations from Plan

### Auto-fixed Issues

None.

### Scope Adjustments

**1. mark_viewed guard clause included (plan-directed)**
- The PLAN.md Task 2(b) explicitly required returning False if status is not "viewing_scheduled". The RESEARCH.md code draft omitted this guard. Applied per PLAN.md as it's a required constraint (D-03).
- Files modified: `app/data_store.py`

**2. save_negotiation_brief adds negotiation_brief_generated_at (plan-directed)**
- PLAN.md Task 2(c) required this sibling field. RESEARCH.md draft omitted it. Applied per PLAN.md.
- Files modified: `app/data_store.py`

**3. save_ku_enrichment adds looked_up_at inside ku dict (plan-directed)**
- PLAN.md Task 2(d) required this field. Applied per PLAN.md (D-13).
- Files modified: `app/data_store.py`

## Deferred Issues

**Pre-existing test failures (out of scope):** Six tests in `test_pending.py`, `test_ingest.py`, `test_price_intelligence.py`, and `test_commute.py` were already failing before any changes in this plan. Root cause: uncommitted Phase 5 work in `app/ingest_handler.py` passes a `commute_minutes` keyword argument to `evaluate_listing`, which breaks mocks in existing tests. These files were not touched by Plan 06-01. They should be addressed when the Phase 5 uncommitted work is committed/completed.

## Known Stubs

None — this plan produces only persistence helpers and test scaffolds. No UI stubs, no placeholder data flows.

## Threat Flags

No new network endpoints, auth paths, or trust boundaries introduced. setdefault migration is read-only additive (T-06-01 disposition: accept). Four new helpers acquire `_lock` and do no external I/O (T-06-02 disposition: mitigated by design — no HTTP held under lock).

## Self-Check: PASSED

Files verified:
- FOUND: app/data_store.py
- FOUND: app/tests/test_data_store.py
- FOUND: app/tests/test_viewing_workflow.py
- FOUND: app/tests/test_brief_generator.py
- FOUND: app/tests/test_ku_lookup.py
- FOUND: .planning/phases/06-viewing-workflow-extras/06-01-SUMMARY.md

Commits verified:
- 270cda0: feat(06-01): add Phase 6 setdefault migration in load_app_data()
- 4bbc6b1: feat(06-01): add set_viewing_scheduled / mark_viewed / save_negotiation_brief / save_ku_enrichment
- 39775ab: test(06-01): Wave 0 test scaffold — data_store tests + 3 skeleton test files
