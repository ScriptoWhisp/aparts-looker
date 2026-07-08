---
phase: 03-ai-quality-price-intelligence
plan: "03"
subsystem: data-model
tags: [price-history, data-migration, ingest, frontend, vanilla-js, days-on-market]

# Dependency graph
requires:
  - phase: 03-02
    provides: "AI checklist evaluation + pending card badge strip — ingest_handler process_ingest_batch baseline"
provides:
  - "price_history top-level key in app_data.json (D-11, zero-downtime migration via setdefault)"
  - "record_price_in_data(data, listing_id, price_eur, date_str) — no-lock in-place mutator, idempotent same-day, capped at 90 entries"
  - "get_price_history(listing_id) — thread-safe reader returning list or []"
  - "process_ingest_batch records price for ALL listings on every scrape run (new + dedup hit)"
  - "state.priceHistory populated from GET /api/data response (no backend routing change)"
  - "daysOnMarket(listingId) JS helper — integer days since first price entry, or null"
  - "buildPriceHistoryEl(listingId) JS helper — textContent-only DOM div, or null"
  - "renderMain + buildPendingCard wired with days-on-market display"
affects:
  - "03-04: reads get_price_history to detect >=5% price drops, trigger re-evaluation"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "No-lock in-place mutator pattern: caller holds RLock, helper mutates dict, caller saves once per batch"
    - "Same-day idempotency: overwrite last entry when date matches, never duplicate"
    - "app_data reload-after-helper pattern: reload after self-saving helpers (add_to_pending, write_checklist_ai) before price_history mutation to avoid clobbering"
    - "textContent-only DOM insertion after innerHTML set: safe post-render injection for server-owned data"

key-files:
  created: []
  modified:
    - "app/data_store.py — DEFAULT_APP_DATA price_history key, load_app_data setdefault migration, record_price_in_data helper, get_price_history helper"
    - "app/ingest_handler.py — date import, today_str snapshot, dedup-branch price recording, new-listing price recording, single save_app_data at batch end"
    - "app/tests/test_price_intelligence.py — 3 INTEL-01 stubs flipped from xfail to real passing tests"
    - "app/static/index.html — state.priceHistory, loadData population, daysOnMarket helper, buildPriceHistoryEl helper, renderMain + buildPendingCard wiring"

key-decisions:
  - "reload app_data AFTER tg_message_id patch (not before) so price_history mutation lands on the final dict that save_app_data persists — discovered race when mock_send_pending_card returns (42, -100)"
  - "record_price_in_data is a no-lock mutator (caller holds RLock) rather than an atomic helper to avoid nested lock acquisition and keep the batch save atomic"
  - "today_str computed once before the batch loop — single date snapshot prevents midnight rollover splitting a batch across two dates"
  - "price history capped at 90 entries per listing with oldest-first trim (RESEARCH Pitfall 5) — 100 listings x 90 x 40 bytes = 360 KB bounded"

patterns-established:
  - "record_price_in_data no-lock pattern: exported symbol that mutates caller-owned dict; saves are the caller's responsibility"
  - "get_price_history: acquires _lock via load_app_data, returns [] on any miss — safe for plan 03-04 consumers"
  - "buildPriceHistoryEl uses textContent only — established pattern for server-owned data rendered into DOM (T-03-12)"

requirements-completed:
  - INTEL-01
  - INTEL-02

coverage:
  - id: D1
    description: "price_history key added to DEFAULT_APP_DATA and load_app_data setdefault migration (D-11)"
    requirement: INTEL-01
    verification:
      - kind: unit
        ref: "app/tests/test_price_intelligence.py#test_record_price_new"
        status: pass
    human_judgment: false
  - id: D2
    description: "record_price_in_data mutates data in place, idempotent same-day, caps at 90 entries"
    requirement: INTEL-01
    verification:
      - kind: unit
        ref: "app/tests/test_price_intelligence.py#test_record_price_new"
        status: pass
      - kind: unit
        ref: "app/tests/test_price_intelligence.py#test_record_price_idempotent"
        status: pass
    human_judgment: false
  - id: D3
    description: "ingest_handler records price for every listing on every scrape run (new and dedup hit)"
    requirement: INTEL-01
    verification:
      - kind: integration
        ref: "app/tests/test_price_intelligence.py#test_ingest_records_price_for_known"
        status: pass
    human_judgment: false
  - id: D4
    description: "Frontend state.priceHistory populated from /api/data response; daysOnMarket + buildPriceHistoryEl helpers implemented; renderMain and buildPendingCard wired"
    requirement: INTEL-02
    verification:
      - kind: other
        ref: "grep -c 'function daysOnMarket' app/static/index.html == 1; grep -c 'function buildPriceHistoryEl' app/static/index.html == 1; saveData body excludes priceHistory"
        status: pass
    human_judgment: true
    rationale: "Frontend rendering of price history and days-on-market requires visual inspection in the browser — no automated test covers the rendered DOM output for these helpers"

# Metrics
duration: 35min
completed: 2026-07-08
status: complete
---

# Phase 03 Plan 03: Price History Tracking Summary

**End-to-end price history tracking: every scrape records the current price for every listing (new + known) into a new `price_history` key, `/api/data` returns it automatically, and the dossier card renders a plain-text price history list and days-on-market count**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-07-08T00:00:00Z
- **Completed:** 2026-07-08
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- `price_history: {}` added to `DEFAULT_APP_DATA` and `load_app_data()` (zero-downtime migration via `setdefault`) — D-11
- `record_price_in_data(data, listing_id, price_eur, date_str)` no-lock in-place mutator with same-day idempotency and 90-entry cap
- `get_price_history(listing_id)` thread-safe reader returning `[]` on miss
- `process_ingest_batch` refactored: `today_str` computed once, price recorded for ALL listings including dedup hits before `continue`, single `save_app_data` at batch end
- Frontend: `state.priceHistory` populated from API, `daysOnMarket()` and `buildPriceHistoryEl()` helpers added, wired into `renderMain` and `buildPendingCard` via textContent-only DOM
- 3 INTEL-01 test stubs flipped from xfail to PASSED; full suite: 29 passed, 10 xfailed

## Task Commits

1. **Task 1: Price history data model + ingest recording (INTEL-01)** - `3efb373` (feat)
2. **Task 2: Frontend price history + days-on-market display (INTEL-02)** - `5faa6ac` (feat)

## Files Created/Modified

- `app/data_store.py` — `DEFAULT_APP_DATA["price_history"]`, `load_app_data()` setdefault, `record_price_in_data()`, `get_price_history()`
- `app/ingest_handler.py` — `from datetime import date as _date`, `today_str` snapshot, dedup-branch price recording, new-listing price recording, `save_app_data(app_data)` at batch end
- `app/tests/test_price_intelligence.py` — 3 stubs replaced with real implementations (removed `@pytest.mark.xfail`)
- `app/static/index.html` — `state.priceHistory`, `loadData()` population, `daysOnMarket()`, `buildPriceHistoryEl()`, `renderMain` post-innerHTML injection, `buildPendingCard` meta line extension

## Decisions Made

- `record_price_in_data` is a no-lock mutator with the caller holding `_lock` via the outer `with data_store._lock:` in `process_ingest_batch` — avoids double-lock nesting and keeps the batch save atomic.
- `today_str` computed once before the batch loop to prevent midnight rollover splitting a batch across two dates (RESEARCH Pattern 5).
- `app_data` is reloaded AFTER the Telegram `send_pending_card` call (which may return a `tg_message_id`), rather than before. This ensures price_history mutations land on the same dict instance that is saved via `save_app_data(app_data)` at loop end — avoids the reload-race where the tg_message_id patch triggered an additional reload that discarded the price mutation.
- `buildPriceHistoryEl` and days-on-market DOM elements injected via `textContent` after `el.innerHTML = ...` in `renderMain` — preserves the existing innerHTML-based rendering pipeline while guaranteeing XSS safety for server-controlled data (T-03-12).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] app_data reload-after-tg_message_id ordering**

- **Found during:** Task 1 (test_ingest_records_price_for_known failed: price_history empty after 2 POSTs)
- **Issue:** The plan described: reload app_data after `add_to_pending`/`write_checklist_ai` → call `record_price_in_data` → Telegram → if tg_message_id: reload + patch. The second reload (for tg_message_id) produced a fresh dict without the price mutation, which was then saved at batch end, discarding the price recording.
- **Fix:** Consolidated: Telegram call first, then ONE reload that handles both tg_message_id patch and price_history mutation. Price recording now happens on the final reloaded dict before `save_app_data`.
- **Files modified:** `app/ingest_handler.py`
- **Verification:** `test_ingest_records_price_for_known` PASSED
- **Committed in:** `3efb373` (Task 1 commit, inline fix)

---

**Total deviations:** 1 auto-fixed (Rule 1 — Bug)
**Impact on plan:** Essential for correctness. The ordering bug would have silently discarded all price recordings for new listings when Telegram returned a valid message_id. No scope creep.

## Issues Encountered

- Python 3.9 is running on the local macOS system (plan expected 3.12); all code is compatible with 3.9+ — no changes needed.

## Known Stubs

None — all deliverables for this plan are fully implemented and wired.

## Threat Flags

No new trust boundaries introduced. `price_history` is returned via the existing `GET /api/data` endpoint behind Caddy basic auth (T-03-11, accepted). `buildPriceHistoryEl` uses `textContent` exclusively (T-03-12, mitigated). `record_price_in_data` guarded by `isinstance(listing.price_eur, int) and listing.price_eur > 0` (T-03-08, mitigated).

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `get_price_history(listing_id)` is ready for plan 03-04 to consume: returns the last two entries for >=5% drop detection and `_handle_price_drop` dispatch.
- `price_history[listing_id][0].date` is the oldest kept entry (up to 90) — `daysOnMarket` computation is stable.
- 6 remaining INTEL xfail stubs (test_price_drop_reeval_pending, test_price_drop_below_threshold_no_reeval, test_price_rejected_requeued, test_location_rejected_not_requeued, test_removed_listing_marked, test_removed_listing_marked_pending) are reserved for plan 03-04.

---
*Phase: 03-ai-quality-price-intelligence*
*Completed: 2026-07-08*

## Self-Check: PASSED

- `app/data_store.py` modified: FOUND
- `app/ingest_handler.py` modified: FOUND
- `app/tests/test_price_intelligence.py` modified: FOUND
- `app/static/index.html` modified: FOUND
- Commit 3efb373: FOUND
- Commit 5faa6ac: FOUND
- 3 tests PASSED: test_record_price_new, test_record_price_idempotent, test_ingest_records_price_for_known
- Full suite: 29 passed, 10 xfailed, 0 failed
