---
phase: 03-ai-quality-price-intelligence
plan: 04
subsystem: api
tags: [price-drop, re-evaluation, removed-listing, telegram, python, testing]

# Dependency graph
requires:
  - phase: 03-03
    provides: price history recording (record_price_in_data), process_ingest_batch structure with price-recording calls
  - phase: 03-01
    provides: _build_context_prefix, evaluate_listing with context_prefix="" signature, PRICE_DROP_THRESHOLD constant
  - phase: 03-02
    provides: write_checklist_ai, _whitelist_checklist, send_pending_card, structured checklist output
provides:
  - ingest_handler._record_and_check_price_drop — drop detection + recording in a single call
  - ingest_handler._handle_price_drop — re-evaluation dispatcher (approved/pending/rejected-price/other)
  - ingest_handler._mark_removed_listings — post-loop removed marker
  - data_store.get_rejected_by_reason — thread-safe reader for rejected entries by reason
  - Removed badge rendering in index.html renderMain + buildPendingCard
  - All 15 Wave 0 stubs flipped to PASS (Phase 3 test surface complete)
affects:
  - verify-work (Phase 3 gate — all 7 requirements have automated coverage)
  - frontend dossier (Removed badge visible when p.removed === true)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "never-raise dispatch helper: _handle_price_drop wraps evaluate_listing call in own try/except so network failure logs without corrupting state"
    - "same-day idempotency guard: _record_and_check_price_drop checks history[-1].date != today_str before triggering drop detection"
    - "PREPEND notes pattern: price-drop note is prepended rather than overwriting existing entry.notes (RESEARCH Pitfall 6, T-03-16)"
    - "dedup_key is extract_object_id(url) or full URL fallback — tests must seed seen_listing_ids with the resolved key, not raw listing.id"

key-files:
  created: []
  modified:
    - app/ingest_handler.py
    - app/data_store.py
    - app/static/index.html
    - app/tests/test_price_intelligence.py
    - app/tests/test_eval_quality.py

key-decisions:
  - "Guard the evaluate_listing call inside _handle_price_drop with its own try/except so network failures during re-evaluation log but do not corrupt app_data state"
  - "dedup_key for test URLs uses full URL not listing.id — tests seed seen_listing_ids with 'https://www.kv.ee/test-1.html' since extract_object_id requires 6-8 digit patterns"
  - "Removed badge placed after AI checklist and before actionRow in buildPendingCard (textContent only — no innerHTML)"
  - "_mark_removed_listings passes listing_dicts (original raw dicts with raw_ok) not deserialized Listing objects"

patterns-established:
  - "Price-drop re-evaluation dispatches by state without touching unmatched categories (properties/pending/rejected-price each handled, rejected-other silently skipped)"
  - "Removed-listing detection is post-loop so a single batch can detect both new listings AND removed ones atomically before save"

requirements-completed:
  - EVAL-04
  - INTEL-03
  - EVAL-01
  - EVAL-03

coverage:
  - id: D1
    description: "_record_and_check_price_drop replaces bare record_price_in_data calls and detects >= 5% drop"
    requirement: EVAL-04
    verification:
      - kind: unit
        ref: "tests/test_price_intelligence.py#test_price_drop_reeval_pending"
        status: pass
      - kind: unit
        ref: "tests/test_price_intelligence.py#test_price_drop_below_threshold_no_reeval"
        status: pass
    human_judgment: false
  - id: D2
    description: "_handle_price_drop dispatches to approved/pending/price-rejected by state and sends Telegram on approved + rejected re-queue"
    requirement: EVAL-04
    verification:
      - kind: unit
        ref: "tests/test_price_intelligence.py#test_price_drop_reeval_pending"
        status: pass
      - kind: unit
        ref: "tests/test_price_intelligence.py#test_price_rejected_requeued"
        status: pass
      - kind: unit
        ref: "tests/test_price_intelligence.py#test_location_rejected_not_requeued"
        status: pass
    human_judgment: false
  - id: D3
    description: "_mark_removed_listings marks properties[] and pending[] entries with removed=True + removed_at date when raw_ok=False"
    requirement: INTEL-03
    verification:
      - kind: unit
        ref: "tests/test_price_intelligence.py#test_removed_listing_marked"
        status: pass
      - kind: unit
        ref: "tests/test_price_intelligence.py#test_removed_listing_marked_pending"
        status: pass
    human_judgment: false
  - id: D4
    description: "data_store.get_rejected_by_reason thread-safe reader returns filtered rejected entries"
    requirement: EVAL-04
    verification:
      - kind: unit
        ref: "tests/test_price_intelligence.py#test_price_rejected_requeued"
        status: pass
    human_judgment: false
  - id: D5
    description: "_build_context_prefix injects anchor block when >= 2 scored properties, skips below threshold"
    requirement: EVAL-01
    verification:
      - kind: unit
        ref: "tests/test_eval_quality.py#test_anchor_injection"
        status: pass
      - kind: unit
        ref: "tests/test_eval_quality.py#test_anchor_skipped_below_threshold"
        status: pass
    human_judgment: false
  - id: D6
    description: "_build_context_prefix injects district price/m² average when matching entries exist, omits when listing has no district"
    requirement: EVAL-03
    verification:
      - kind: unit
        ref: "tests/test_eval_quality.py#test_district_avg_injected"
        status: pass
      - kind: unit
        ref: "tests/test_eval_quality.py#test_district_avg_omitted_unknown"
        status: pass
    human_judgment: false
  - id: D7
    description: "Removed badge renders in dossier renderMain and buildPendingCard when removed===true (textContent only)"
    requirement: INTEL-03
    verification: []
    human_judgment: true
    rationale: "Frontend DOM rendering requires a browser or headless browser check — no automated test covers the badge rendering path"

duration: 9min
completed: 2026-07-09
status: complete
---

# Phase 3 Plan 04: Price-Drop Re-eval Dispatch, Removed Detection, All Stubs Green Summary

**Price-drop re-evaluation dispatch (approved/pending/rejected-price states), removed-listing marking post-loop, and all 15 Wave 0 test stubs flipped to PASS, completing the Phase 3 test surface**

## Performance

- **Duration:** 9 min
- **Started:** 2026-07-08T21:04:21Z
- **Completed:** 2026-07-09T21:13:00Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Implemented `_record_and_check_price_drop`, `_handle_price_drop`, `_mark_removed_listings` in ingest_handler — all never-raise, RLock-safe
- Implemented `data_store.get_rejected_by_reason` thread-safe reader
- Wired `_record_and_check_price_drop` into both dedup-hit and new-listing branches (replaces bare `record_price_in_data` calls)
- Wired `_mark_removed_listings` post-loop before `save_app_data` so raw_ok=False listings are marked atomically
- Flipped all 10 remaining Wave 0 stubs to PASS (4 in test_eval_quality.py, 6 in test_price_intelligence.py)
- Added Removed badge (red, textContent) in both `renderMain` and `buildPendingCard` in index.html

## Task Commits

Each task was committed atomically:

1. **Task 1: Price-drop detection + removed-listing marking backend** - `5a157c8` (feat)
2. **Task 2: Flip remaining 10 Wave 0 stubs to PASS + Removed badge in frontend** - `265fdb4` (feat)

## Files Created/Modified

- `app/ingest_handler.py` — Added _record_and_check_price_drop, _handle_price_drop, _mark_removed_listings; updated process_ingest_batch
- `app/data_store.py` — Added get_rejected_by_reason
- `app/static/index.html` — Added Removed badge in renderMain (headActions block) and buildPendingCard
- `app/tests/test_price_intelligence.py` — Replaced 6 xfail stubs with real passing tests
- `app/tests/test_eval_quality.py` — Replaced 4 xfail stubs with real passing tests

## Decisions Made

- **dedup_key seeding in tests:** For test URLs like `test-1.html`, `extract_object_id` returns None (requires 6-8 digit patterns), so `dedup_key` falls back to the full URL. Tests must seed `seen_listing_ids` with the full URL `"https://www.kv.ee/test-1.html"` not `"test-1"`.
- **Inner try/except on evaluate_listing:** `_handle_price_drop` wraps `evaluate_listing` in its own try/except beyond the outer never-raise guard, so a network failure logs and returns early without partially mutating state.
- **PREPEND price-drop note:** Per RESEARCH Pitfall 6 and T-03-16, entry["notes"] is prepended not overwritten — `"[Price drop X%, re-scored Y/100] " + (entry.get("notes") or "")`.
- **Same-day idempotency guard:** `_record_and_check_price_drop` checks `history[-1]["date"] != today_str` BEFORE calling `record_price_in_data` to capture the previous entry, so same-day re-scrapes don't trigger drop detection (T-03-14).

## Deviations from Plan

None — plan executed exactly as written. One minor implementation insight documented:

**[Rule 1 - Bug fix in tests] Test URL dedup_key mismatch**
- **Found during:** Task 2 (test_price_rejected_requeued first run)
- **Issue:** Tests seeded `seen_listing_ids` with `"test-1"` but the ingest computes `dedup_key = "https://www.kv.ee/test-1.html"` (full URL fallback when extract_object_id returns None). The listing was not recognized as a dedup-hit, causing it to be processed as new instead.
- **Fix:** Updated all price-drop tests to seed `seen_listing_ids` with the full URL string.
- **Files modified:** app/tests/test_price_intelligence.py
- **Verification:** All 9 price-intelligence tests pass.

---

**Total deviations:** 1 auto-fixed (Rule 1 — test bug)
**Impact on plan:** Test fix only, no production code change.

## Issues Encountered

None beyond the test dedup_key mismatch documented above.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

Phase 3 is complete. All 7 requirements (EVAL-01, EVAL-02, EVAL-03, EVAL-04, INTEL-01, INTEL-02, INTEL-03) have automated test coverage. INTEL-02 additionally has a manual browser check per VALIDATION.md.

Ready for `/gsd-verify-work` for the phase.

---
*Phase: 03-ai-quality-price-intelligence*
*Completed: 2026-07-09*
