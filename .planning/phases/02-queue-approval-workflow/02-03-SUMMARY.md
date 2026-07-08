---
phase: 02-queue-approval-workflow
plan: "03"
subsystem: web-ui-approval-loop
tags:
  - fastapi
  - rest-endpoints
  - frontend
  - pending-tab
  - vanilla-js
  - xss-mitigation
dependencies:
  requires:
    - 02-01
    - 02-02
  provides:
    - GET /api/pending
    - POST /api/pending/{id}/approve
    - POST /api/pending/{id}/reject
    - pending-tab-ui
  affects:
    - app/main.py
    - app/static/index.html
    - app/tests/test_pending.py
tech_stack:
  added: []
  patterns:
    - FastAPI path-parameter endpoints
    - DOM createElement/textContent (XSS-safe rendering)
    - Vanilla JS tab switching with module-scoped IIFE
key_files:
  created: []
  modified:
    - app/main.py
    - app/static/index.html
    - app/tests/test_pending.py
decisions:
  - Container cleared via DOM removeChild loop instead of innerHTML="" to satisfy strict XSS grep in verify step
  - Pending tab added as second <script> IIFE to avoid modifying the large existing closure
  - Tab switching implemented via data-action click delegation pattern (matches existing codebase)
  - _setActiveTabButton exposed on window to allow cross-IIFE coordination
metrics:
  duration: "~25 minutes"
  completed: "2026-07-08"
  task_count: 2
  file_count: 3
status: checkpoint
checkpoint_state:
  reached_task: 3
  tasks_completed: 2
  awaiting: human-verify
---

# Phase 02 Plan 03: Web UI Approval Loop Summary

**One-liner:** Three FastAPI pending endpoints (GET/approve/reject) plus a vanilla-JS Pending tab in index.html with inline reason picker and XSS-safe DOM rendering.

## What Was Built

### Task 1 — REST Endpoints (committed: 54f75f1)

Three new FastAPI endpoints added to `app/main.py` at lines 83-107 (above the StaticFiles mount):

| Endpoint | Line | Behavior |
|----------|------|----------|
| `GET /api/pending` | 83 | Returns `{"pending": [...]}` from `data_store.load_pending()` |
| `POST /api/pending/{listing_id}/approve` | 88 | Moves to properties[], returns 404 on double-tap |
| `POST /api/pending/{listing_id}/reject` | 96 | Whitelists reason, moves to rejected[] with `rejected_at` ISO timestamp |

Server-side reason whitelist: `{"price","location","condition","other"}` — any unknown value clamped to `"other"`.

**Tests promoted from xfail:**
- `test_get_pending_endpoint` — seeds pending[], GET /api/pending, asserts response shape
- `test_approve_moves_listing` — seeds, POST approve, asserts pending empty + properties has entry
- `test_double_approve` — first POST 200, second POST 404 (idempotency)
- `test_reject_with_reason` — known reason stored correctly; garbage reason clamped to "other"

New helper `_seed_pending(listing_id)` seeds entries directly via `data_store._lock` for test isolation.

**All 22 tests pass** (+ 2 xfailed for Plan 04: test_draft_endpoint, test_send_command_after_draft).

### Task 2 — Pending Tab UI (committed: f9dca6a)

Changes to `app/static/index.html` (244 lines added, total: 1272 lines):

**Sidebar tab buttons** (lines 1016-1022):
- "Dossier" button — switches back to main dossier view
- "Pending" button — activates `showPendingTab()`

**Main IIFE additions** (lines 1024-1056):
- `window._setActiveTabButton(tabName)` — cross-IIFE visual state helper
- `show-dossier-tab` click handler added to existing IIFE

**Second `<script>` block** (lines 1061-1269) — Phase 02 Plan 03 pending queue tab module:

| Function | Purpose |
|----------|---------|
| `showPendingTab()` | Entry point — sets active state and calls renderPendingTab |
| `renderPendingTab()` | Fetches /api/pending, shows loading/error/list states |
| `renderPendingList(container, entries)` | Renders heading + empty state or entry cards |
| `buildPendingCard(entry)` | Builds card DOM node via createElement/textContent (XSS-safe) |
| `approvePending(listingId)` | POST approve, re-render on success |
| `showRejectPicker(listingId, actionRow)` | Inline 4-button reason picker (toggle on re-click) |
| `rejectPending(listingId, reason)` | POST reject with JSON body, re-render on success |

**XSS mitigation verified:**
- All listing fields (title, verdict, price, score) inserted via `.textContent` only
- Container clearing done via `while (el.firstChild) el.removeChild(el.firstChild)` (no `innerHTML = ""`)
- `awk` scoped grep confirms zero `innerHTML` assignments in the Phase 02 Plan 03 code region

## Files Changed

| File | LOC added | LOC removed | Notes |
|------|-----------|-------------|-------|
| `app/main.py` | +27 | 0 | 3 new endpoints at lines 83-107 |
| `app/tests/test_pending.py` | +90 | -12 | 4 xfail stubs replaced with real assertions + _seed_pending helper |
| `app/static/index.html` | +244 | 0 | Tab buttons + pending tab JS module |

## Threat Model Compliance

| Threat | Status |
|--------|--------|
| T-02-XSS | Mitigated — textContent + DOM clearing (no innerHTML for user data) |
| T-02-REJ-INJ | Mitigated — server-side whitelist in reject endpoint (tested inline) |
| T-02-NO-AUTH | Accepted — consistent with /api/data pattern; Caddy basic auth at proxy |
| T-02-CSRF | Accepted — single-user personal tool, no untrusted browser contexts |
| T-02-SC | Mitigated — no new packages added |

## Commits

| Task | Hash | Message |
|------|------|---------|
| Task 1 | 54f75f1 | feat(02-03): add GET /api/pending + approve + reject endpoints with tests |
| Task 2 | f9dca6a | feat(02-03): add Pending tab to static index.html (fetch, render, approve, reject) |

## Checkpoint State — Task 3

**Status:** AWAITING HUMAN VERIFICATION

Task 3 is a `checkpoint:human-verify` gate. The implementation is complete and committed. Human must deploy and smoke-test the browser UI before this plan is marked complete.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Container clearing used DOM removeChild instead of innerHTML=""**

- **Found during:** Task 2 verify step
- **Issue:** The automated verify uses `awk` to find any `innerHTML` in the Phase 02 Plan 03 region, including `innerHTML = ""` (safe container reset). The strict grep counted these as violations.
- **Fix:** Replaced all three `elem.innerHTML = ""` occurrences in the pending tab module with `while (el.firstChild) el.removeChild(el.firstChild)` — semantically equivalent, passes strict grep.
- **Files modified:** `app/static/index.html`
- **Commit:** f9dca6a

**2. [Rule 2 - Missing feature] Added cross-IIFE tab button helper via window._setActiveTabButton**

- **Found during:** Task 2 implementation
- **Issue:** The existing code uses a single IIFE. Adding the pending tab as a second IIFE required coordination of tab button visual state between the two closures.
- **Fix:** Exposed `window._setActiveTabButton` from inside the first IIFE so the second can call it.
- **Files modified:** `app/static/index.html`
- **Commit:** f9dca6a

## Known Stubs

None. All pending tab functions are fully implemented and wired to live API endpoints.

## UI Polish Deferred (Backlog)

- Loading spinner animation during fetch (currently shows static "Loading pending listings…" text)
- Card transition animation when approve/reject removes a card
- Score color coding on cards (green/amber/red based on score value)
- "Draft email" button on pending cards (wired to Plan 04 /api/draft endpoint)

## Self-Check: PASSED

- Task 1 commit exists: 54f75f1
- Task 2 commit exists: f9dca6a
- app/main.py has 3 new endpoints above StaticFiles mount (lines 83-107)
- 4 previously-xfail tests now pass with real assertions
- No innerHTML in Pending tab code region (verified by awk grep returning 0)
- All 22 tests pass + 2 xfailed (Plan 04 placeholders)
- SUMMARY.md written at checkpoint state
