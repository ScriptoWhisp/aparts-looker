---
phase: 6
slug: viewing-workflow-extras
status: passed
verified: 2026-07-10
verifier: gsd-verifier (sonnet)
---

# Phase 6 — Verification Report

**Status:** ✓ PASSED
**Goal-backward audit:** all 4 implemented success criteria + 1 formally deferred criterion verified against shipped code.

## Success Criteria

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| SC-1 | Approved listing → "viewing_scheduled" via web app | ✓ PASSED | `POST /api/entry/{id}/schedule-viewing` (main.py) → `data_store.set_viewing_scheduled()`; `scheduleViewingClick` in detail-panel.js; 4 GREEN integration tests |
| SC-2 | Negotiation brief auto-generated on transition | ✓ PASSED | `schedule-viewing` spawns daemon thread → `brief_generator.generate_and_save_brief` (Pitfall-5 lock discipline); `_buildNegotiationBrief` card via `.textContent`; 4 GREEN tests |
| SC-3 | Post-viewing checklist (D-08 reinterpretation: web-only) | ✓ PASSED | `/mark-viewed` endpoint; existing FULL_CHECKLIST surface unchanged; no Telegram post-viewing dialog code; tests pass |
| SC-4 | KÜ data surfaced when found | ✓ PASSED | `ku_lookup.py` with `legal_form == "23"` filter (Pitfall 2); `_dispatch_ku_lookup` fires on approval; `/refresh-ku` endpoint; `_buildKuCard` hides when empty (D-13); 4 GREEN tests |
| SC-5 | PDF export | **DEFERRED per D-14** | ROADMAP row struck-through; REQUIREMENTS EXPORT-01 marked Deferred; traceability link back to `06-CONTEXT.md § Deferred Ideas` |

## Decision Coverage

All 14 locked decisions D-01…D-14 verified with concrete code markers (verifier's marker table preserved in the plan-checker output above). No silent drops.

## Test Suite

Phase 6 test files: **17/17 GREEN, 0 skips.**

Live run confirmed by verifier:
- `pytest app/tests/test_viewing_workflow.py -x` → 6 passed
- `pytest app/tests/test_brief_generator.py -x` → 3 passed
- `pytest app/tests/test_ku_lookup.py -x` → 3 passed
- `pytest app/tests/test_data_store.py -x` (Phase 6 cases) → 5 passed

11 pre-existing failures elsewhere in `app/tests` are traceable to uncommitted pre-Phase-6 working-tree changes (session work in `ingest_handler.py` / `ai_evaluator.py` adding a `commute_minutes` kwarg that predates Phase 6). Out of scope for this verification.

## Human Verification Recommended

- Round-trip schedule a viewing for 15:00 local, reload, confirm wall-clock time displays correctly (UTC ISO ↔ local timezone plumbing).
- Approve a listing whose address resolves in ariregister vs one that doesn't; confirm KÜ card appears only for the resolved one.
- Immediately after scheduling, reload the panel to observe the fire-and-forget brief-generation thread land its output within 2–5 s.
- Verify the "Mark viewed" button is greyed with tooltip before `scheduled_at` and becomes clickable after.

## Sign-off

Phase 6 delivers its goal. VIEW-01, VIEW-02 (reinterpreted per D-08), VIEW-03, and ENRICH-01 are shipped end-to-end from data model through UI. EXPORT-01 is formally deferred with traceability. Ready to mark Phase 6 complete in STATE.md.
