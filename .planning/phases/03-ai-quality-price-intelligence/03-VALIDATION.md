---
phase: 3
slug: ai-quality-price-intelligence
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-08
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest (already in use — `app/tests/`) |
| **Config file** | none — pytest discovers from `app/tests/` |
| **Quick run command** | `cd app && python -m pytest tests/ -x -q` |
| **Full suite command** | `cd app && python -m pytest tests/ -v` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd app && python -m pytest tests/ -x -q`
- **After every plan wave:** Run `cd app && python -m pytest tests/ -v`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** ~10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 03-01-01 | 01 | 1 | EVAL-01 | unit | `pytest tests/test_eval_quality.py::test_anchor_injection -x` | ❌ Wave 0 | ⬜ pending |
| 03-01-02 | 01 | 1 | EVAL-01 | unit | `pytest tests/test_eval_quality.py::test_anchor_skipped_below_threshold -x` | ❌ Wave 0 | ⬜ pending |
| 03-01-03 | 01 | 1 | EVAL-03 | unit | `pytest tests/test_eval_quality.py::test_district_avg_injected -x` | ❌ Wave 0 | ⬜ pending |
| 03-01-04 | 01 | 1 | EVAL-03 | unit | `pytest tests/test_eval_quality.py::test_district_avg_omitted_unknown -x` | ❌ Wave 0 | ⬜ pending |
| 03-02-01 | 02 | 2 | EVAL-02 | unit | `pytest tests/test_eval_quality.py::test_checklist_in_response -x` | ❌ Wave 0 | ⬜ pending |
| 03-02-02 | 02 | 2 | EVAL-02 | unit | `pytest tests/test_eval_quality.py::test_checklist_user_override_preserved -x` | ❌ Wave 0 | ⬜ pending |
| 03-03-01 | 03 | 3 | INTEL-01 | unit | `pytest tests/test_price_intelligence.py::test_record_price_new -x` | ❌ Wave 0 | ⬜ pending |
| 03-03-02 | 03 | 3 | INTEL-01 | unit | `pytest tests/test_price_intelligence.py::test_record_price_idempotent -x` | ❌ Wave 0 | ⬜ pending |
| 03-03-03 | 03 | 3 | INTEL-01 | integration | `pytest tests/test_price_intelligence.py::test_ingest_records_price_for_known -x` | ❌ Wave 0 | ⬜ pending |
| 03-03-04 | 03 | 3 | INTEL-02 | manual | verify days-on-market in browser dossier card | manual | ⬜ pending |
| 03-04-01 | 04 | 4 | EVAL-04 | unit | `pytest tests/test_price_intelligence.py::test_price_drop_reeval_pending -x` | ❌ Wave 0 | ⬜ pending |
| 03-04-02 | 04 | 4 | EVAL-04 | unit | `pytest tests/test_price_intelligence.py::test_price_drop_below_threshold_no_reeval -x` | ❌ Wave 0 | ⬜ pending |
| 03-04-03 | 04 | 4 | EVAL-04 | unit | `pytest tests/test_price_intelligence.py::test_price_rejected_requeued -x` | ❌ Wave 0 | ⬜ pending |
| 03-04-04 | 04 | 4 | EVAL-04 | unit | `pytest tests/test_price_intelligence.py::test_location_rejected_not_requeued -x` | ❌ Wave 0 | ⬜ pending |
| 03-04-05 | 04 | 4 | INTEL-03 | unit | `pytest tests/test_price_intelligence.py::test_removed_listing_marked -x` | ❌ Wave 0 | ⬜ pending |
| 03-04-06 | 04 | 4 | INTEL-03 | unit | `pytest tests/test_price_intelligence.py::test_removed_listing_marked_pending -x` | ❌ Wave 0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `app/tests/test_eval_quality.py` — stubs for EVAL-01, EVAL-02, EVAL-03 (6 tests, all xfail)
- [ ] `app/tests/test_price_intelligence.py` — stubs for EVAL-04, INTEL-01, INTEL-03 (10 tests, all xfail)

*Existing `app/tests/conftest.py` fixtures (`tmp_agent_state`, `client`, `mock_telegram`) are reusable.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Days-on-market visible on dossier card | INTEL-02 | Frontend rendering; no Selenium/Playwright in test suite | Open dossier, check a listing has "X days on market" displayed on the card |
| AI-filled checklist items visually distinct | EVAL-02 | UI rendering of `source: "ai"` tag | Open a pending listing's checklist; AI-filled items should show a robot/AI indicator |
| Price history list on approved listing card | INTEL-01 | Frontend rendering | Open an approved listing; verify price history entries are shown |
