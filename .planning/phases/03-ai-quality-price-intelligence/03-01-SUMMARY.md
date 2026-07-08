---
phase: 03-ai-quality-price-intelligence
plan: "01"
subsystem: ai
tags: [ai, prompt-engineering, calibration, price-intelligence, pytest, testing]

# Dependency graph
requires:
  - phase: 02-pending-queue-telegram
    provides: data_store.add_to_pending, ingest_handler.process_ingest_batch, pending[] data model
provides:
  - evaluate_listing(listing, context_prefix="") extended signature in ai_evaluator.py
  - _build_context_prefix(listing, data) private helper in ingest_handler.py
  - PRICE_DROP_THRESHOLD config constant in config.py
  - Wave 0 xfail stubs in test_eval_quality.py (6 tests)
  - Wave 0 xfail stubs in test_price_intelligence.py (9 tests)
affects:
  - 03-02-PLAN (flips test_eval_quality xfail stubs green by adding checklist output to SYSTEM_PROMPT)
  - 03-03-PLAN (flips INTEL-01 stubs green by adding record_price_in_data + get_price_history to data_store)
  - 03-04-PLAN (flips remaining price intelligence stubs green)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "context_prefix="" default parameter pattern for backward-compat signature extension"
    - "Wave 0 xfail(strict=True) stub pattern: @pytest.mark.xfail + pytest.fail('not implemented')"
    - "never-raise private helper: try/except Exception: log.exception + return ''"
    - "getattr(listing, 'district', '') safety for Listing fields that don't exist in the dataclass"
    - "RLock reentrant load_app_data() inside outer with data_store._lock block"

key-files:
  created:
    - app/tests/test_eval_quality.py
    - app/tests/test_price_intelligence.py
  modified:
    - app/ai_evaluator.py
    - app/ingest_handler.py
    - app/config.py
    - app/tests/test_pending.py
    - app/tests/test_ingest.py

key-decisions:
  - "context_prefix prepended to messages[0].content (user turn), not SYSTEM_PROMPT — keeps system prompt stable and immutable (D-06 note)"
  - "max_tokens bumped 1000 → 1500 to accommodate checklist output in plan 03-02 (RESEARCH Pitfall 4)"
  - "getattr(listing, 'district', '') used because Listing dataclass has no district field — district is only on stored properties[]/pending[] dict entries"
  - "Phase 2 test monkeypatches updated to lambda listing, context_prefix='': {...} to accept new 2-arg call signature"
  - "PRICE_DROP_THRESHOLD defaults to 0.05 (5%) per D-14"

requirements-completed:
  - EVAL-01
  - EVAL-03

coverage:
  - id: D1
    description: "Wave 0 xfail stubs: test_eval_quality.py (6 tests) and test_price_intelligence.py (9 tests) all report XFAIL with strict=True"
    requirement: EVAL-01
    verification:
      - kind: unit
        ref: "tests/test_eval_quality.py (6 xfail stubs) + tests/test_price_intelligence.py (9 xfail stubs)"
        status: pass
    human_judgment: false
  - id: D2
    description: "evaluate_listing(listing, context_prefix: str = '') extended signature in ai_evaluator.py with backward compat"
    requirement: EVAL-01
    verification:
      - kind: unit
        ref: "python3 -c \"from ai_evaluator import evaluate_listing; import inspect; sig = inspect.signature(evaluate_listing); assert 'context_prefix' in sig.parameters\""
        status: pass
    human_judgment: false
  - id: D3
    description: "_build_context_prefix(listing, data) private helper in ingest_handler.py: returns anchor block for >=2 scored properties, empty string for <2, includes district avg line when district matches"
    requirement: EVAL-01
    verification:
      - kind: unit
        ref: "behavioral check: empty properties returns '', 2 scored properties returns anchor block with 'Anchor 1'"
        status: pass
    human_judgment: false
  - id: D4
    description: "process_ingest_batch wired to call _build_context_prefix before evaluate_listing and pass result as context_prefix kwarg"
    requirement: EVAL-03
    verification:
      - kind: integration
        ref: "tests/test_ingest.py::test_ingest_batch (Phase 2 compat test passes with new 2-arg call)"
        status: pass
    human_judgment: false
  - id: D5
    description: "PRICE_DROP_THRESHOLD = float(os.environ.get('PRICE_DROP_THRESHOLD', '0.05')) added to config.py"
    verification:
      - kind: unit
        ref: "python3 -c \"import config; assert config.PRICE_DROP_THRESHOLD == 0.05\""
        status: pass
    human_judgment: false
  - id: D6
    description: "max_tokens bumped from 1000 to 1500 in the Anthropic API call"
    verification:
      - kind: unit
        ref: "grep -c '\"max_tokens\": 1500' app/ai_evaluator.py == 1"
        status: pass
    human_judgment: false

# Metrics
duration: 15min
completed: 2026-07-08
status: complete
---

# Phase 03 Plan 01: Calibration Anchors, District Avg Context, Wave 0 Test Scaffolds Summary

**Calibration anchor injection into evaluate_listing via context_prefix parameter, district price/m² average from stored properties, and 15-stub Wave 0 xfail test scaffold for plans 03-02 through 03-04**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-07-08T00:00:00Z
- **Completed:** 2026-07-08T00:15:00Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments

- Extended `evaluate_listing(listing, context_prefix: str = "")` in `ai_evaluator.py` — context_prefix is prepended to the user turn so Claude scores against concrete calibration anchors rather than in a vacuum; backward-compat default ensures all existing callers still work
- Implemented `_build_context_prefix(listing, data) -> str` in `ingest_handler.py` — never-raise helper that assembles top-2-3 scored properties[] entries as numbered anchor paragraphs, plus a district price/m² average line when matching entries exist; returns "" on <2 anchors or any exception
- Wired `_build_context_prefix` call into `process_ingest_batch` before `evaluate_listing` — loads app_data inside the existing RLock context (safe; RLock is reentrant), passes result as `context_prefix` kwarg
- Bumped `max_tokens` from 1000 to 1500 in the Anthropic API call to provide headroom for the checklist output added in plan 03-02
- Added `PRICE_DROP_THRESHOLD = float(os.environ.get("PRICE_DROP_THRESHOLD", "0.05"))` to `config.py` after `CHECK_INTERVAL_HOURS`, ready for plan 03-04
- Created Wave 0 test scaffolds: `test_eval_quality.py` (6 xfail stubs covering EVAL-01/02/03) and `test_price_intelligence.py` (9 xfail stubs covering EVAL-04/INTEL-01/03) — all 15 report XFAIL with strict=True; plans 03-02, 03-03, 03-04 will flip them green

## Task Commits

Each task was committed atomically:

1. **Task 1: Wave 0 test scaffolds + PRICE_DROP_THRESHOLD** - `9a33c2e` (test)
2. **Task 2: evaluate_listing extended + _build_context_prefix implemented** - `3c25f91` (feat)

## Files Created/Modified

- `app/tests/test_eval_quality.py` — New: 6 strict xfail stubs for EVAL-01/02/03 test cases
- `app/tests/test_price_intelligence.py` — New: 9 strict xfail stubs for EVAL-04/INTEL-01/03 test cases
- `app/ai_evaluator.py` — Modified: evaluate_listing signature extended with context_prefix; user_content = context_prefix + listing_summary; max_tokens 1000 → 1500
- `app/ingest_handler.py` — Modified: _build_context_prefix private helper added; process_ingest_batch wired to call it before evaluate_listing
- `app/config.py` — Modified: PRICE_DROP_THRESHOLD constant added after CHECK_INTERVAL_HOURS
- `app/tests/test_pending.py` — Modified: evaluate_listing monkeypatch lambda updated to accept context_prefix="" (Rule 1 auto-fix)
- `app/tests/test_ingest.py` — Modified: evaluate_listing monkeypatch lambda updated to accept context_prefix="" (Rule 1 auto-fix)

## Decisions Made

- context_prefix prepended to the user turn (`messages[0].content`), not to `SYSTEM_PROMPT` — keeps the system prompt stable and immutable (D-06 note in CONTEXT.md)
- `getattr(listing, "district", "")` used for district lookup because `Listing` dataclass has no `district` field; district is only stored on properties[]/pending[] dict entries (RESEARCH Pitfall 2)
- `load_app_data()` inside the outer `with data_store._lock:` block is safe because `_lock = threading.RLock()` (reentrant); same-thread re-acquisition does not deadlock (RESEARCH Pitfall 1)
- Phase 2 test monkeypatches updated to accept new 2-arg signature — `lambda listing, context_prefix="": {...}` — classified as Rule 1 auto-fix (the monkeypatches would break on the new call)
- PRICE_DROP_THRESHOLD defaults to 0.05 (5%) per D-14 from CONTEXT.md

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated Phase 2 test monkeypatches to accept new evaluate_listing signature**
- **Found during:** Task 2 (extend evaluate_listing signature and wire process_ingest_batch)
- **Issue:** `process_ingest_batch` now calls `evaluate_listing(listing, context_prefix)` with 2 positional args; existing Phase 2 test monkeypatches used `lambda listing: {...}` (1 arg), causing `TypeError: <lambda>() takes 1 positional argument but 2 were given`
- **Fix:** Updated lambdas in `test_pending.py::test_ingest_writes_to_pending` and `test_ingest.py::test_ingest_batch` to `lambda listing, context_prefix="": {...}`
- **Files modified:** `app/tests/test_pending.py`, `app/tests/test_ingest.py`
- **Verification:** `python3 -m pytest tests/test_pending.py tests/test_ingest.py -v` → 15 passed, 0 failures
- **Committed in:** `3c25f91` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — bug in Phase 2 tests caused by signature extension)
**Impact on plan:** Required fix for backward compat gate. No scope creep; purely mechanical lambda update.

## Issues Encountered

None — all acceptance criteria satisfied on first attempt.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Wave 0 xfail stubs are in place — plans 03-02, 03-03, 03-04 have measurable failing-test signals to flip green
- `evaluate_listing` signature is stable and backward-compatible — plan 03-02 can extend SYSTEM_PROMPT without touching the call sites
- `_build_context_prefix` is available in `ingest_handler` — ready for plan 03-04 to reuse for re-evaluation on price drop
- `PRICE_DROP_THRESHOLD` is available in `config` — ready for plan 03-04 to consume in price drop detection logic
- Phase 1 and Phase 2 tests remain green (24 passed, 15 xfailed)

## Self-Check: PASSED

- [x] `app/tests/test_eval_quality.py` exists on disk
- [x] `app/tests/test_price_intelligence.py` exists on disk
- [x] `9a33c2e` commit exists (Task 1)
- [x] `3c25f91` commit exists (Task 2)
- [x] All 15 stubs report XFAIL, 0 PASSED/FAILED/ERROR
- [x] 24 existing tests pass, no regressions
- [x] `grep -c "def evaluate_listing(listing: Listing, context_prefix: str" app/ai_evaluator.py` → 1
- [x] `grep -c "def _build_context_prefix" app/ingest_handler.py` → 1
- [x] `grep -c '"max_tokens": 1500' app/ai_evaluator.py` → 1
- [x] `python3 -c "import config; assert config.PRICE_DROP_THRESHOLD == 0.05"` → exits 0

---
*Phase: 03-ai-quality-price-intelligence*
*Completed: 2026-07-08*
