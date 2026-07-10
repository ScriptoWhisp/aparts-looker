---
phase: "06-viewing-workflow-extras"
plan: "02"
subsystem: "API endpoints + frontend viewing workflow"
tags: [fastapi, viewing_workflow, frontend, integration_tests, VIEW-01, VIEW-02]
dependency_graph:
  requires:
    - data_store.set_viewing_scheduled (06-01)
    - data_store.mark_viewed (06-01)
    - setdefault migration for status/scheduled_at/viewing_history (06-01)
  provides:
    - POST /api/entry/{id}/schedule-viewing
    - POST /api/entry/{id}/mark-viewed
    - scheduleViewingClick(listingId) JS global
    - markViewedClick(listingId) JS global
    - Schedule viewing button (status=approved detail panel)
    - Mark viewed button (status=viewing_scheduled detail panel, time-gated)
    - 4 GREEN integration tests in test_viewing_workflow.py
  affects:
    - app/main.py
    - app/static/js/detail-panel.js
    - app/static/index.html
    - app/tests/test_viewing_workflow.py
tech_stack:
  added: []
  patterns:
    - reject_pending endpoint shape cloned for both new endpoints
    - datetime.fromisoformat(.replace("Z", "+00:00")) for timezone-safe ISO parsing
    - new Date(input.value).toISOString() browser-side UTC conversion (Pitfall 1 fix)
    - native <input type="datetime-local"> with JS-computed default (today 17:00 local)
    - time-gated button disabled state with tooltip (D-09)
key_files:
  modified:
    - app/main.py
    - app/static/js/detail-panel.js
    - app/static/index.html
    - app/tests/test_viewing_workflow.py
decisions:
  - "Both endpoints use data_store helpers from Plan 06-01 — no lock/mutation logic in handlers"
  - "mark-viewed endpoint returns 400 (not 404) for both 'not found' and 'wrong status' cases, consistent with helper boolean contract"
  - "datetime-local input defaulted to today 17:00 in JS (not hardcoded HTML) so it reflects the date at panel-open time"
  - "Schedule button toggles picker visibility inline rather than a modal — less disruptive"
  - "Viewing workflow buttons placed in detail-panel.js (not index.html) since that file owns the detail panel render"
  - "Plan 06-03 comment marker left in schedule-viewing handler for brief_generator wiring"
metrics:
  duration: "~25 minutes"
  completed: "2026-07-10T17:55:00Z"
  tasks_completed: 3
  tasks_total: 3
  files_modified: 4
  files_created: 0
status: complete
---

# Phase 06 Plan 02: API Endpoints + Frontend Viewing Workflow Summary

**One-liner:** Two FastAPI POST endpoints for schedule-viewing (ISO validation, 400/404 guards) and mark-viewed (D-03 status guard) plus native datetime-local picker buttons in detail-panel.js, all wired with 4 GREEN integration tests

## What Was Built

### Task 1: Two new FastAPI POST endpoints in main.py

Added `from datetime import datetime` import and two new endpoints after `reject_pending`:

**`POST /api/entry/{listing_id}/schedule-viewing`**
- Parses JSON body, validates `scheduled_at` via `datetime.fromisoformat(s.replace("Z", "+00:00"))`
- Returns 400 on malformed ISO string; 404 if listing not in `properties[]`
- Calls `data_store.set_viewing_scheduled(listing_id, scheduled_at)` from Plan 06-01
- Returns `{"ok": True, "message": "Scheduled"}`
- Comment marker: `# Plan 06-03 will wire brief_generator here`

**`POST /api/entry/{listing_id}/mark-viewed`**
- No body required
- Calls `data_store.mark_viewed(listing_id)` from Plan 06-01
- Returns 400 if helper returns False (covers both "not found" and "wrong status" per D-03)
- Returns `{"ok": True, "message": "Marked as viewed"}`

Both follow the canonical `reject_pending` shape from `06-PATTERNS.md`.

### Task 2: Viewing workflow buttons in detail-panel.js + CSS in index.html

**`app/static/js/detail-panel.js`** — New block after the pending action buttons:

- `status === "approved"`: renders "Schedule viewing" button that toggles an inline datetime-local picker; default value computed as `today at 17:00 local` via `new Date(); d.setHours(17,0,0,0); input.value = d.toISOString().slice(0,16)` (D-10)
- `status === "viewing_scheduled"`: renders "Mark viewed" button; disabled + 0.5 opacity with tooltip `"Available from {date}"` when `now < new Date(entry.scheduled_at)` (D-09)
- `status === "viewed"`: renders static `"Viewed on {date}"` label from `viewing_history` (no new checklist plumbing — existing FULL_CHECKLIST handles post-viewing per D-08)

**Global JS functions** added after IIFE closing:

- `window.scheduleViewingClick(listingId)` — reads `#scheduled-at-input-{id}`, converts to UTC ISO via `new Date(input.value).toISOString()` (Pitfall 1 fix), POSTs `{scheduled_at: utcIso}`, calls `window.loadData()` on success
- `window.markViewedClick(listingId)` — POSTs to mark-viewed, calls `window.loadData()` on success, `window.showToast` on error

**`app/static/index.html`** — Added `.viewing-dt-input` and `.viewing-picker-wrap` CSS using existing CSS custom properties (`--surface-2`, `--border`, `--text`, `--font-mono`, `--radius`, `--blue`). No new colors.

### Task 3: 4 GREEN integration tests in test_viewing_workflow.py

Replaced 4 `pytest.skip("Filled by Plan 06-02")` bodies:

| Test | What it verifies |
|------|-----------------|
| `test_schedule_viewing_sets_status` | Seeds entry, POSTs valid ISO, asserts `status=="viewing_scheduled"` and `scheduled_at` stored |
| `test_invalid_iso_returns_400` | POSTs `"not-an-iso-string"`, asserts 400 + status unchanged |
| `test_z_suffix_parses` | POSTs `"2026-08-15T15:00:00Z"` (Z suffix), asserts 200 + stored verbatim |
| `test_mark_viewed_flips_status` | Seeds `viewing_scheduled` entry, asserts flip to `viewed` + history entry; also asserts 400 on `approved→viewed` invalid transition (D-03) |

`test_regenerate_brief` and `test_refresh_ku` remain `pytest.skip("Filled by Plan 06-03")` / `pytest.skip("Filled by Plan 06-04")`.

**Final result:** `pytest app/tests/test_viewing_workflow.py -q` → 4 passed, 2 skipped.

## Verification Results

```
pytest app/tests/test_viewing_workflow.py -q
4 passed, 2 skipped, 3 warnings in 0.35s

Inline verification (python3 -c):
- POST /api/entry/nonexistent/schedule-viewing {"scheduled_at": "2026-08-01T15:00:00Z"} → 404 ✓
- POST /api/entry/nonexistent/schedule-viewing {"scheduled_at": "bad-iso"} → 400 ✓
- POST /api/entry/nonexistent/mark-viewed → 400 ✓

grep check: scheduleViewingClick + markViewedClick across detail-panel.js + index.html → count=6 ≥ 4 ✓
```

## Deviations from Plan

### Auto-fixed Issues

None.

### Scope Adjustments

**1. Buttons added to detail-panel.js, not index.html**
- The plan's `<action>` section said "if the executor finds the detail-panel structure has moved to `app/static/js/detail-panel.js`, apply the same changes to the appropriate file."
- `detail-panel.js` is the file that currently owns the detail panel render code (all button/panel DOM construction lives there). Changes applied there as directed.
- CSS added to `index.html` (the only CSS file in the project).

**2. `scheduleViewingClick` and `markViewedClick` placed outside IIFE**
- The plan said "global scope or attached to `window`". Placed after the IIFE closing `})();` as `window.scheduleViewingClick = function...` for clean global exposure without polluting the IIFE's private scope.

## Known Stubs

None — all buttons are wired to real endpoints. The brief-generation call from schedule-viewing is deliberately not wired yet (Plan 06-03 handles it; comment marker left in endpoint).

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| T-06-03 mitigated | app/main.py | `datetime.fromisoformat` guard rejects malformed `scheduled_at` with HTTP 400 — tested by `test_invalid_iso_returns_400` |

No new network endpoints beyond the two planned ones. No new auth paths. State transitions flow through `data_store._lock` (existing RLock).

## Self-Check: PASSED

Files verified:
- FOUND: app/main.py (contains schedule_viewing + mark_viewed_endpoint)
- FOUND: app/static/js/detail-panel.js (contains scheduleViewingClick + markViewedClick)
- FOUND: app/static/index.html (contains .viewing-dt-input CSS)
- FOUND: app/tests/test_viewing_workflow.py (4 implemented tests + 2 skips)
- FOUND: .planning/phases/06-viewing-workflow-extras/06-02-SUMMARY.md

Commits verified:
- 4f7e6da: feat(06-02): add POST /api/entry/{id}/schedule-viewing and /mark-viewed endpoints
- 06c3b0c: feat(06-02): add Schedule viewing / Mark viewed buttons to detail panel
- 5404143: test(06-02): fill 4 viewing workflow integration tests — all GREEN
