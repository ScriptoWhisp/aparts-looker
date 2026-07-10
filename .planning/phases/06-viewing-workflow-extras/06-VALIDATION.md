---
phase: 6
slug: viewing-workflow-extras
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-10
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

Sourced from `06-RESEARCH.md § Validation Architecture`. Downstream planner fills in per-task refs when writing PLAN.md.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest (existing under `app/tests/`) |
| **Config file** | none — default pytest discovery |
| **Quick run command** | `pytest app/tests -x -k "viewing_workflow or brief_generator or ku_lookup"` |
| **Full suite command** | `pytest app/tests` |
| **Estimated runtime** | ~15 seconds (JSON/HTTP mocks; no browser) |

---

## Sampling Rate

- **After every task commit:** Run `pytest app/tests -x -k "viewing_workflow or brief_generator or ku_lookup"`
- **After every plan wave:** Run `pytest app/tests`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

Planner will populate the concrete task IDs when writing `06-XX-PLAN.md`. Behaviour rows come straight from `06-RESEARCH.md § Validation Architecture`.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | TBD | 1 | VIEW-01 | — | POST /api/entry/{id}/schedule-viewing sets status=viewing_scheduled + scheduled_at | integration | `pytest app/tests/test_viewing_workflow.py::test_schedule_viewing_sets_status -x` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1 | VIEW-01 | — | set_viewing_scheduled returns False on unknown listing_id | unit | `pytest app/tests/test_data_store.py::test_set_viewing_scheduled_missing -x` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1 | VIEW-01 | — | Legacy entries load with status="approved" via setdefault | unit | `pytest app/tests/test_data_store.py::test_setdefault_status_legacy -x` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1 | VIEW-01 | — | Rescheduling appends to viewing_history[] rather than overwriting | unit | `pytest app/tests/test_data_store.py::test_reschedule_appends_history -x` | ❌ W0 | ⬜ pending |
| TBD | TBD | 3 | VIEW-02 (D-08) | — | Post-viewing checklist edits via PUT /api/data reach persisted checklists[id] | integration | `pytest app/tests/test_main.py::test_put_data_saves_checklist -x` | verify existing | ⬜ pending |
| TBD | TBD | 2 | VIEW-03 | — | generate_negotiation_brief returns dict with brief_ru/offer_low/offer_high on success (mocked) | unit | `pytest app/tests/test_brief_generator.py::test_returns_expected_shape -x` | ❌ W0 | ⬜ pending |
| TBD | TBD | 2 | VIEW-03 | — | generate_negotiation_brief returns fallback dict on RequestException | unit | `pytest app/tests/test_brief_generator.py::test_never_raises_on_network_error -x` | ❌ W0 | ⬜ pending |
| TBD | TBD | 2 | VIEW-03 | — | _validate_no_hallucinated_numbers flags unfamiliar €-amounts | unit | `pytest app/tests/test_brief_generator.py::test_number_validation -x` | ❌ W0 | ⬜ pending |
| TBD | TBD | 3 | VIEW-03 | — | POST /api/entry/{id}/regenerate-brief triggers generation + updates entry | integration | `pytest app/tests/test_viewing_workflow.py::test_regenerate_brief -x` | ❌ W0 | ⬜ pending |
| TBD | TBD | 2 | ENRICH-01 | — | lookup_ku_for_address returns dict when autocomplete gives legal_form==23 (mocked) | unit | `pytest app/tests/test_ku_lookup.py::test_returns_korteriuhistu -x` | ❌ W0 | ⬜ pending |
| TBD | TBD | 2 | ENRICH-01 | — | lookup_ku_for_address returns None on only legal_form==6 results | unit | `pytest app/tests/test_ku_lookup.py::test_filters_non_korteriuhistu -x` | ❌ W0 | ⬜ pending |
| TBD | TBD | 2 | ENRICH-01 | — | lookup_ku_for_address returns None on RequestException | unit | `pytest app/tests/test_ku_lookup.py::test_never_raises_on_network_error -x` | ❌ W0 | ⬜ pending |
| TBD | TBD | 2 | ENRICH-01 | — | save_ku_enrichment preserves manual notes when overwriting auto | unit | `pytest app/tests/test_data_store.py::test_save_ku_preserves_manual -x` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1 | Timezone plumbing | — | schedule-viewing endpoint rejects malformed ISO with 400 | integration | `pytest app/tests/test_viewing_workflow.py::test_invalid_iso_returns_400 -x` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1 | Timezone plumbing | — | UTC ISO with "Z" suffix parses correctly on backend | unit | `pytest app/tests/test_viewing_workflow.py::test_z_suffix_parses -x` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `app/tests/test_viewing_workflow.py` — integration stubs for all four new POST endpoints
- [ ] `app/tests/test_brief_generator.py` — unit tests with `unittest.mock.patch("requests.post")` for Anthropic
- [ ] `app/tests/test_ku_lookup.py` — unit tests with mocked `ariregister.rik.ee` autocomplete
- [ ] `app/tests/test_data_store.py` — extend with `set_viewing_scheduled`, `mark_viewed`, `save_negotiation_brief`, `save_ku_enrichment` cases + setdefault-migration cases
- [ ] `app/tests/conftest.py` — reuse existing fixtures; no new setup expected

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Detail-panel Schedule/Regenerate/Mark-viewed/Refresh-KÜ buttons render + call the right endpoints | VIEW-01 / VIEW-03 / ENRICH-01 UI wiring | Vanilla JS + DOM; no automated frontend harness | Click through each button on a real listing; confirm state flips + toasts + panel refresh |
| Datetime picker's local time round-trips to UTC ISO and back to Europe/Tallinn display | VIEW-01 timezone plumbing | Native `<input type="datetime-local">` + browser Date semantics; hard to fake in pytest | Schedule a viewing for 15:00 local, reload — expect same wall-clock display |
| KÜ card visually shows only when auto-lookup returned data | ENRICH-01 | Rendering conditional in vanilla JS | Approve a listing whose address resolves + one that doesn't; only one shows the card |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
