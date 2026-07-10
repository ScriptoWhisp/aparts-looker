---
phase: "06-viewing-workflow-extras"
plan: "04"
subsystem: "KÜ enrichment — ariregister autocomplete client + approval hook + detail-panel card"
tags: [ku_lookup, enrich_01, ariregister, daemon_thread, detail_panel, never_raise, tests]
dependency_graph:
  requires:
    - 06-01 (data_store.save_ku_enrichment + ku setdefault migration + test scaffolds)
    - 06-03 (brief_generator + daemon-thread pattern, main.py regenerate-brief endpoint shape)
  provides:
    - app/ku_lookup.py (lookup_ku_for_address + _to_street_query)
    - ingest_handler._dispatch_ku_lookup daemon-thread target
    - POST /api/entry/{id}/refresh-ku endpoint
    - approve_pending KÜ dispatch hook
    - detail-panel _buildKuCard + refreshKuClick + saveKuManualNotes
    - .ku-card CSS class in index.html
  affects:
    - app/main.py (approve_pending extended, new refresh-ku endpoint, ku_lookup import)
    - app/ingest_handler.py (threading import, _dispatch_ku_lookup added)
    - app/static/js/detail-panel.js (_buildKuCard + globals + _renderMainPane wiring)
    - app/static/index.html (.ku-card CSS)
    - app/tests/test_ku_lookup.py (3 skips filled)
    - app/tests/test_viewing_workflow.py (test_refresh_ku filled)
tech_stack:
  added: []
  patterns:
    - never-raise external HTTP (lookup_ku_for_address wraps full body in try/except Exception)
    - Pitfall 5 lock pattern: read address under lock, release, HTTP outside, re-acquire to save
    - daemon-thread dispatch for slow I/O (mirrors brief_generator.generate_and_save_brief)
    - D-13 hide-when-empty: KÜ card only rendered when entry.ku.auto.reg_code or entry.ku.manual
    - textContent-only DOM writes (XSS safety per T-06-13)
    - manual notes persistence via existing PUT /api/data path (no new backend endpoint)
key_files:
  created:
    - app/ku_lookup.py
  modified:
    - app/main.py
    - app/ingest_handler.py
    - app/static/js/detail-panel.js
    - app/static/index.html
    - app/tests/test_ku_lookup.py
    - app/tests/test_viewing_workflow.py
decisions:
  - "ku_lookup.py has no data_store dependency — pure I/O; dispatcher in ingest_handler bridges lookup to save"
  - "_dispatch_ku_lookup imported at function-scope (ku_lookup) to avoid circular import at module scope"
  - "approve_pending reads address under _lock then releases before spawning thread (Pitfall 5)"
  - "refresh-ku returns 400 (not silently noop) when listing has no address — informative error for frontend"
  - "saveKuManualNotes uses GET /api/data then PUT /api/data to patch ku.manual; no new backend endpoint"
  - "KÜ card shows when auto.reg_code OR manual has content — never hides user-typed notes (D-13 edge case)"
metrics:
  duration: "~30 minutes"
  completed: "2026-07-10T22:00:00Z"
  tasks_completed: 3
  tasks_total: 3
  files_modified: 6
  files_created: 1
status: complete
---

# Phase 06 Plan 04: ENRICH-01 KÜ Lookup Vertical Slice Summary

**One-liner:** ariregister autocomplete client + approve-hook + refresh-ku endpoint + detail-panel KÜ card with manual notes textarea — ENRICH-01 vertical slice complete

## What Was Built

### Task 1: app/ku_lookup.py — ariregister autocomplete client

New module `app/ku_lookup.py` (~97 lines):

- `lookup_ku_for_address(address: str) -> Optional[dict]`: queries `https://ariregister.rik.ee/est/api/autocomplete`, filters to `legal_form == "23"` (korteriühistu), returns `{reg_code, name, legal_address, url}` or None. Full body wrapped in `try/except Exception` (never-raise).
- `_to_street_query(address: str) -> str`: strips apartment suffix `-\d+` and city fragment after first comma.
- Constants: `AUTOCOMPLETE_URL`, `KORTERIUHISTU_LEGAL_FORM = "23"`, `_USER_AGENT = "ApartsLooker/1.0 daniel.tjulinov@gmail.com"`.

All three address canonicalisation examples from RESEARCH.md verified:
- `"Mustamäe tee 165, Tallinn"` → `"Mustamäe tee 165"`
- `"Retke tee 22-15, 12345 Tallinn"` → `"Retke tee 22"`
- `"Astangu tn 50b/1-13"` → `"Astangu tn 50b/1"`

### Task 2: ingest_handler._dispatch_ku_lookup + main.py wiring

**`ingest_handler._dispatch_ku_lookup(listing_id, address) -> None`**: daemon-thread target that calls `ku_lookup.lookup_ku_for_address`, logs if no match (noop per D-13 hide-when-empty), calls `data_store.save_ku_enrichment` on match. Never raises. `ku_lookup` imported at function scope to avoid circular import.

**`approve_pending` (main.py)**: after `data_store.approve_listing` returns True, reads the approved entry's `address` field under `data_store._lock`, releases the lock, then spawns a daemon thread calling `_dispatch_ku_lookup`. If address is empty, logs info and skips (noop per D-11).

**`POST /api/entry/{listing_id}/refresh-ku`**: new endpoint in main.py. Reads entry address under lock, releases, spawns daemon thread. Returns 200 immediately. Returns 404 on unknown listing, 400 on empty address.

### Task 3: Tests + detail-panel KÜ card

**`app/tests/test_ku_lookup.py`** — 3 skips filled (all GREEN):
- `test_returns_korteriuhistu`: mocks `requests.get` to return legal_form="23" response; asserts reg_code, name, url.
- `test_filters_non_korteriuhistu`: mocks to return legal_form="6" (garage); asserts None.
- `test_never_raises_on_network_error`: mocks to raise `requests.RequestException`; asserts None, no exception.

**`app/tests/test_viewing_workflow.py::test_refresh_ku`** — filled (GREEN):
- Seeds entry with `address="Retke tee 22, Tallinn"`, stubs `_dispatch_ku_lookup` synchronously, POSTs refresh-ku, asserts `entry.ku.auto.reg_code == 80499321` and `entry.ku.looked_up_at` is set. Also verifies 404 for nonexistent listing and 400 for listing with empty address.

**Detail-panel KÜ card (detail-panel.js + index.html)**:
- `_buildKuCard(ku, entry)`: renders name, reg_code, legal_address rows via `.textContent`; anchor `.href` set via property assignment; manual notes `<textarea>` with `onblur` handler.
- `refreshKuClick(listingId, btn)`: POSTs to `/api/entry/{id}/refresh-ku`, waits 1500ms, calls `loadData()`.
- `saveKuManualNotes(listingId, notes)`: GET `/api/data` → patch `entry.ku.manual` → PUT `/api/data` (no new endpoint per RESEARCH.md A1).
- Render condition: `entry.ku && entry.ku.auto && entry.ku.auto.reg_code || entry.ku.manual` (D-13 hide-when-empty, but preserves manual notes if typed without auto lookup).
- `.ku-card` CSS in `index.html` mirrors `.coo-card` / `.brief-card`.

## Verification Results

```
pytest app/tests/test_ku_lookup.py -x -q
3 passed in 0.12s

pytest app/tests/test_viewing_workflow.py::test_refresh_ku -x -q
1 passed in 0.32s

pytest app/tests/test_data_store.py::test_save_ku_preserves_manual -x -q
1 passed in 0.01s

python3 -c "from fastapi.testclient import TestClient; ..."
POST /api/entry/nonexistent/refresh-ku → 404  OK
ingest_handler._dispatch_ku_lookup exists  OK
```

## Deviations from Plan

### Auto-fixed Issues

None.

### Scope Adjustments

**1. ku_lookup import at function scope in _dispatch_ku_lookup (plan-directed)**
- Plan 06-04 noted "import ku_lookup" at module scope for ingest_handler. However, ku_lookup imports requests, which is fine, but importing at module scope in ingest_handler.py creates a slightly earlier import cycle risk given the module is loaded before config is fully initialised in some test scenarios. Imported at function scope as a conservative choice — same pattern as data_store import in brief_generator.py.
- Files modified: `app/ingest_handler.py`

**2. refresh-ku returns 400 on missing address (plan-directed enhancement)**
- The plan's action spec said to return 400 on empty address. Implemented with explicit `HTTPException(400, ...)` as informative error rather than silent noop — this surfaces useful information to the frontend UI if Daniel tries to refresh KÜ on a listing that was added without address scraping.

## Deferred Issues

**Pre-existing test failures (out of scope):** Six tests in `test_pending.py`, `test_ingest.py`, `test_price_intelligence.py`, and `test_commute.py` were already failing before any changes in this plan (confirmed by git stash + re-test). Root cause documented in Plan 06-01 SUMMARY: uncommitted Phase 5 work passes `commute_minutes` kwarg to mocked `evaluate_listing`, breaking old mock lambdas. Not introduced by Plan 06-04.

## Known Stubs

None. The KÜ lookup is a live HTTP call to ariregister autocomplete. The detail panel wires real data from `entry.ku.auto`. Manual notes textarea persists via existing PUT /api/data. No placeholder data flows.

## Threat Flags

No new threat flags beyond the registered STRIDE items in PLAN.md:
- T-06-10 (address injection): mitigated — `params={"q": query}` URL-encodes automatically.
- T-06-11 (ariregister ratelimit): accepted — one lookup per approval + one on refresh.
- T-06-12 (address logged): accepted — address is public info.
- T-06-13 (manual notes overwritten): mitigated — `save_ku_enrichment` preserves `entry.ku.manual`; tested by `test_save_ku_preserves_manual`.

## Self-Check: PASSED

Files verified:
- FOUND: app/ku_lookup.py
- FOUND: app/tests/test_ku_lookup.py
- FOUND: app/tests/test_viewing_workflow.py (test_refresh_ku filled)
- FOUND: app/main.py (refresh-ku endpoint, approve hook, ku_lookup import)
- FOUND: app/ingest_handler.py (_dispatch_ku_lookup, threading import)
- FOUND: app/static/js/detail-panel.js (_buildKuCard, refreshKuClick, saveKuManualNotes)
- FOUND: app/static/index.html (.ku-card CSS)
- FOUND: .planning/phases/06-viewing-workflow-extras/06-04-SUMMARY.md

Commits verified:
- 1fdb784: feat(06-04): create ku_lookup.py — ariregister autocomplete client
- 2debbf8: feat(06-04): wire KU lookup into approve_pending + add /api/entry/{id}/refresh-ku
- 45d7919: feat(06-04): fill KU tests + detail-panel KU card + refreshKuClick
