---
phase: 03-ai-quality-price-intelligence
plan: 02
subsystem: ai
tags: [ai, checklist, schema, frontend, data_store, security]

# Dependency graph
requires:
  - phase: 03-01
    provides: evaluate_listing(listing, context_prefix=""), max_tokens=1500, Wave 0 xfail stubs for test_eval_quality.py

provides:
  - SYSTEM_PROMPT extended with 7-key checklist schema block (price_per_sqm, rooms_area, parking, renovation_potential, floor, year_material, mandatory_extras)
  - evaluate_listing() returns checklist:{} in both success and error branches
  - data_store.write_checklist_ai(listing_id, checklist) — persists ai_checklist with source="ai", preserves source=="user" entries
  - ingest_handler.EXPECTED_CHECKLIST_KEYS and ALLOWED_CHECKLIST_VALUES frozensets
  - ingest_handler._whitelist_checklist(raw) — 7-key whitelist helper, never-raise
  - process_ingest_batch calls write_checklist_ai after add_to_pending (inside outer _lock — RLock-safe)
  - buildAiChecklistEl(listingId) JS function in index.html — badge strip for pending tab
  - test_checklist_in_response and test_checklist_user_override_preserved: PASS (flipped from XFAIL)

affects:
  - 03-03 (dossier card AI badge rendering — same buildAiChecklistEl pattern)
  - 03-04 (write_checklist_ai re-used for price-drop re-evaluation of pending entries per D-16)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Checklist whitelist pattern: EXPECTED_CHECKLIST_KEYS + ALLOWED_CHECKLIST_VALUES frozensets; _whitelist_checklist never-raise helper"
    - "ai_checklist sub-key pattern: checklists[listing_id].ai_checklist avoids collision with existing section keys"
    - "User override preservation: write_checklist_ai checks source=='user' before overwriting (D-09)"
    - "XSS mitigation: buildAiChecklistEl uses textContent only — never innerHTML (Security V5, T-03-07)"

key-files:
  created: []
  modified:
    - app/ai_evaluator.py
    - app/data_store.py
    - app/ingest_handler.py
    - app/static/index.html
    - app/tests/test_eval_quality.py
    - .planning/phases/03-ai-quality-price-intelligence/03-02-PLAN.md

key-decisions:
  - "Checklist stored at checklists[listing_id].ai_checklist (sub-key, not replacing section keys) — avoids collision with existing 5-section post-viewing checklist structure (RESEARCH Pattern 8)"
  - "write_checklist_ai acquires _lock internally; safe when called from inside process_ingest_batch outer _lock because _lock is RLock (reentrant) — RESEARCH Pitfall 1"
  - "buildAiChecklistEl supports both flat string and {result, source} shapes for forward compatibility"

patterns-established:
  - "Pattern: AI checklist whitelist — always return all 7 canonical keys, drop unknown keys, coerce invalid values to 'unknown'"
  - "Pattern: source-tagged checklist entries — {result, source: 'ai'|'user'} shape enables user override detection"
  - "Pattern: pending card badge strip — DOM-built with textContent, CSS variable colors for pass/fail/unknown"

requirements-completed:
  - EVAL-02

coverage:
  - id: D1
    description: "SYSTEM_PROMPT extended with 7-key checklist schema block naming canonical criterion keys and pass/fail/unknown values"
    requirement: EVAL-02
    verification:
      - kind: unit
        ref: "grep -c 'price_per_sqm' app/ai_evaluator.py → >= 1"
        status: pass
    human_judgment: false

  - id: D2
    description: "evaluate_listing() returns checklist:{} in both success setdefault block and error fallback dict"
    requirement: EVAL-02
    verification:
      - kind: unit
        ref: "grep -c 'setdefault(\"checklist\"' app/ai_evaluator.py → 1; grep -c '\"checklist\":' app/ai_evaluator.py → >= 2"
        status: pass
    human_judgment: false

  - id: D3
    description: "data_store.write_checklist_ai persists AI checklist to checklists[id].ai_checklist with source='ai'; preserves source=='user' entries"
    requirement: EVAL-02
    verification:
      - kind: unit
        ref: "tests/test_eval_quality.py::test_checklist_user_override_preserved"
        status: pass
    human_judgment: false

  - id: D4
    description: "ingest_handler EXPECTED_CHECKLIST_KEYS (7 keys) and ALLOWED_CHECKLIST_VALUES frozensets; _whitelist_checklist always returns 7 valid-value keys"
    requirement: EVAL-02
    verification:
      - kind: unit
        ref: "python3 -c \"import ingest_handler; assert len(ingest_handler.EXPECTED_CHECKLIST_KEYS)==7; out=ingest_handler._whitelist_checklist({'price_per_sqm':'pass','garbage':'x','floor':'bogus'}); assert out['price_per_sqm']=='pass' and out['floor']=='unknown' and 'garbage' not in out and len(out)==7; print('OK')\""
        status: pass
    human_judgment: false

  - id: D5
    description: "process_ingest_batch calls write_checklist_ai after add_to_pending; checklists[id].ai_checklist written end-to-end via /api/ingest"
    requirement: EVAL-02
    verification:
      - kind: integration
        ref: "tests/test_eval_quality.py::test_checklist_in_response"
        status: pass
    human_judgment: false

  - id: D6
    description: "buildAiChecklistEl renders badge strip in pending tab using textContent only; [AI] prefix with pass/fail/unknown colors"
    requirement: EVAL-02
    verification:
      - kind: unit
        ref: "grep -c 'function buildAiChecklistEl' app/static/index.html → 1; grep -c 'buildAiChecklistEl(entry.id)' → 1; grep -c '\\.innerHTML' unchanged"
        status: pass
    human_judgment: true
    rationale: "Visual rendering requires browser inspection to confirm badge strip appears below meta row with correct colors and [AI] prefix — automated grep validates code structure but not visual output"

# Metrics
duration: 4min
completed: 2026-07-08
status: complete
---

# Phase 3 Plan 02: AI Checklist Schema, write_checklist_ai, and Pending Badge Strip Summary

**End-to-end structured AI checklist: Claude returns 7-key pass/fail/unknown assessment, VPS whitelists and persists to checklists[id].ai_checklist with source="ai", pending tab renders badge strip via buildAiChecklistEl using textContent only**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-07-08T17:44:06Z
- **Completed:** 2026-07-08T17:48:00Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- SYSTEM_PROMPT now instructs Claude to return a 7-key checklist (price_per_sqm, rooms_area, parking, renovation_potential, floor, year_material, mandatory_extras) with pass/fail/unknown values for each
- write_checklist_ai persists AI checklist entries as {result, source:"ai"} and skips any existing source=="user" entries (user override preserved per D-09)
- ingest pipeline: _whitelist_checklist drops unknown keys and coerces invalid values before write; called inside process_ingest_batch's outer _lock (RLock-reentrant safe)
- buildAiChecklistEl renders badge strip in pending tab with textContent only — XSS-safe (Security V5, T-03-07)
- 2 of 6 EVAL-02 xfail stubs flipped to PASS; 4 remaining stubs (EVAL-01/03, INTEL) stay xfail for plans 03-03/03-04

## Task Commits

1. **Task 1: Extend evaluate_listing schema + write_checklist_ai + wire checklist into ingest pipeline** - `f618c76` (feat)
2. **Task 2: Flip EVAL-02 tests green and add pending-card AI checklist badge strip** - `2a95719` (feat)

## Files Created/Modified

- `app/ai_evaluator.py` - SYSTEM_PROMPT extended with checklist schema block; setdefault("checklist", {}) in success branch; "checklist":{} in error fallback
- `app/data_store.py` - write_checklist_ai(listing_id, checklist) added — thread-safe, source=="user" preserved
- `app/ingest_handler.py` - EXPECTED_CHECKLIST_KEYS frozenset (7 keys), ALLOWED_CHECKLIST_VALUES frozenset, _whitelist_checklist helper, write_checklist_ai call after add_to_pending
- `app/static/index.html` - buildAiChecklistEl(listingId) JS function + call inside buildPendingCard after meta row
- `app/tests/test_eval_quality.py` - test_checklist_in_response and test_checklist_user_override_preserved flipped from xfail to real passing tests

## Decisions Made

- Checklist stored at checklists[listing_id].ai_checklist (not merged into existing section keys) to avoid collision with 5-section post-viewing checklist
- write_checklist_ai acquires _lock internally; safe when called inside process_ingest_batch's outer _lock because _lock is threading.RLock (reentrant)
- buildAiChecklistEl supports both flat string and {result, source} shapes for the item value — forward-compatible with any future schema changes

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Threat Flags

No new threat surface beyond what the plan's threat model covers. All mitigations applied:
- T-03-04 (non-canonical AI checklist keys): mitigated by _whitelist_checklist dropping unknown keys
- T-03-05 (key names containing PII): mitigated by same whitelist (only 7 canonical strings pass)
- T-03-06 (AI overwriting user-confirmed entry): mitigated by source=="user" preservation in write_checklist_ai
- T-03-07 (XSS via AI checklist string): mitigated by textContent-only in buildAiChecklistEl

## Next Phase Readiness

- Plan 03-03 can reuse buildAiChecklistEl pattern for dossier card AI badges
- Plan 03-04 can call write_checklist_ai for checklist updates on price-drop re-evaluation of pending entries (D-16)
- write_checklist_ai is ready for downstream callers — API stable

---
*Phase: 03-ai-quality-price-intelligence*
*Completed: 2026-07-08*
