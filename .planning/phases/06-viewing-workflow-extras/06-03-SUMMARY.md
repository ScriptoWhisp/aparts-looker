---
phase: "06-viewing-workflow-extras"
plan: "03"
subsystem: "brief_generator + API endpoints + detail panel UI"
tags: [fastapi, anthropic, negotiation_brief, viewing_workflow, frontend, unit_tests, VIEW-03]
dependency_graph:
  requires:
    - data_store.save_negotiation_brief (06-01)
    - POST /api/entry/{id}/schedule-viewing (06-02)
    - data_store.set_viewing_scheduled (06-01)
  provides:
    - app/brief_generator.py (generate_negotiation_brief, generate_and_save_brief)
    - POST /api/entry/{id}/regenerate-brief
    - schedule-viewing now spawns brief daemon thread on success
    - _buildNegotiationBrief(brief, entry) JS function
    - window.regenerateBriefClick(listingId, btn) JS global
    - 3 GREEN unit tests in test_brief_generator.py
    - test_regenerate_brief GREEN in test_viewing_workflow.py
  affects:
    - app/brief_generator.py
    - app/main.py
    - app/static/js/detail-panel.js
    - app/static/index.html
    - app/tests/test_brief_generator.py
    - app/tests/test_viewing_workflow.py
tech_stack:
  added: []
  patterns:
    - ai_evaluator.py structure mirrored for brief_generator.py (HTTP call + never-raise)
    - _extract_json with raw_decode + greedy re.search fallback (Pitfall 3)
    - _validate_no_hallucinated_numbers post-hoc check (Pitfall 4)
    - Pitfall 5 lock pattern: snapshot-under-lock, HTTP-outside-lock, save-under-lock
    - threading.Thread(daemon=True) fire-and-forget for brief generation (Pattern 4)
    - textContent-only DOM writes for AI output (XSS safety, T-06-06)
    - monkeypatch config.ANTHROPIC_API_KEY + threading.Thread for test determinism
key_files:
  created:
    - app/brief_generator.py
  modified:
    - app/main.py
    - app/static/js/detail-panel.js
    - app/static/index.html
    - app/tests/test_brief_generator.py
    - app/tests/test_viewing_workflow.py
decisions:
  - "brief_generator.py imports data_store only inside generate_and_save_brief (not at module scope) to avoid circular import and aid testability"
  - "generate_negotiation_brief uses temperature=0.3 and max_tokens=1200 (hardcoded per 06-RESEARCH.md § Assumptions A6 — adding env vars is friction for a personal tool)"
  - "Detail panel render order changed to AI depth → brief card → COO to satisfy D-07 (below AI Verdict, above COO)"
  - "test_regenerate_brief uses a _SyncThread stub that runs target synchronously, eliminating race conditions in tests"
  - "regenerateBriefClick re-enables button after 1500ms delay (not immediately) to give daemon thread time to save"
  - "pre-existing test failures in test_commute.py / test_pending.py / test_ingest.py traced to uncommitted working-directory changes from prior phases — out of scope for Plan 06-03"
metrics:
  duration: "~35 minutes"
  completed: "2026-07-10T21:00:00Z"
  tasks_completed: 3
  tasks_total: 3
  files_modified: 5
  files_created: 1
status: complete
---

# Phase 06 Plan 03: Negotiation Brief Generator Summary

**One-liner:** New brief_generator.py module with Anthropic HTTP call, Pitfall-5 lock pattern, and post-hoc number validation; schedule-viewing now spawns brief thread; new regenerate-brief endpoint; detail panel brief card rendered via textContent with Regenerate button — all covered by 4 GREEN tests

## What Was Built

### Task 1: app/brief_generator.py — Anthropic call + post-hoc validation

New module (~250 lines) mirroring `ai_evaluator.py` structure:

- **`SYSTEM_PROMPT`**: Russian system prompt requiring strict JSON with `brief_ru`, `suggested_offer_low_eur`, `suggested_offer_high_eur`. Temperature 0.3, max_tokens 1200.
- **`_extract_json(text)`**: Strips markdown fences, uses `JSONDecoder().raw_decode` to ignore trailing prose, falls back to greedy `re.search(r"\{.*\}", text, re.DOTALL)` for Pitfall 3 (stray leading wrapper in Russian output).
- **`_validate_no_hallucinated_numbers(brief, authoritative)`**: Extracts every 4-6 digit number from `brief_ru` and verifies it appears in the authoritative facts dict (as string). Returns False if any number is missing (Pitfall 4).
- **`generate_negotiation_brief(entry, price_history, district_avg_price_per_sqm, coo_monthly_eur)`**: Pure function. Builds AUTHORITATIVE FACTS block from entry fields + price_history + district avg + COO. Makes Anthropic POST. Calls `_validate_no_hallucinated_numbers` post-hoc; sets `needs_review=True` if grounding fails. Never raises — returns fallback dict with `brief_ru=""` and `error` key on any failure.
- **`generate_and_save_brief(listing_id)`**: Daemon-thread target. Follows Pitfall 5 EXACTLY: snapshot under `data_store._lock`, release lock, call `generate_negotiation_brief` outside lock, re-acquire lock to call `data_store.save_negotiation_brief`. `data_store` imported inside function body to avoid circular import.

### Task 2: app/main.py — Wire brief_generator + add regenerate-brief endpoint

- Added `import brief_generator` to module imports.
- **Updated `POST /api/entry/{id}/schedule-viewing`**: After `data_store.set_viewing_scheduled` returns True, spawns `threading.Thread(target=brief_generator.generate_and_save_brief, args=(listing_id,), daemon=True).start()`. Response message updated: `"Scheduled; negotiation brief generating in background"`. Removed Plan 06-02 comment marker.
- **New `POST /api/entry/{id}/regenerate-brief`**: Verifies entry exists in `properties[]` under lock (returns 404 if not found), then spawns same daemon thread. Returns 200 immediately (fire-and-forget).

### Task 3: Tests + Negotiation brief card in detail panel

**`app/tests/test_brief_generator.py`** — 3 skipped tests filled, all GREEN:

| Test | What it verifies |
|------|-----------------|
| `test_returns_expected_shape` | Mocked Anthropic response → result has `brief_ru="Тест"`, `suggested_offer_low_eur=150000`, `suggested_offer_high_eur=160000`. Monkeypatches `config.ANTHROPIC_API_KEY` + `requests.post`. |
| `test_never_raises_on_network_error` | `requests.RequestException` → returns dict with `brief_ru=""` and `error` key; no exception propagates. |
| `test_number_validation` | Pure unit: `175000` and `2800` in facts → True; `9999` not in facts → False; no numbers in brief → True. |

**`app/tests/test_viewing_workflow.py`** — `test_regenerate_brief` filled, GREEN:
- Seeds `properties[]` entry with `status=viewing_scheduled`.
- Monkeypatches `main.threading.Thread` with `_SyncThread` that runs target synchronously (test determinism).
- Monkeypatches `brief_generator.generate_and_save_brief` to a sync stub that saves a known brief.
- POST → 200; asserts `entry.negotiation_brief.brief_ru == "тест"`.
- Also asserts 404 for nonexistent listing.

**`app/static/js/detail-panel.js`**:
- Added `_buildNegotiationBrief(brief, entry)` private function: card root `.brief-card`, headline row with label + "Regenerate" button, `needs_review` badge (⚠ yellow), brief body paragraph via `.textContent` (XSS-safe), offer range `textContent` line.
- Inserted brief card in `_renderMainPane` AFTER `_buildAiDepthSection(entry)` (AI Verdict) and BEFORE `_buildCostOfOwnership` (D-07). Conditional on `entry.negotiation_brief && entry.negotiation_brief.brief_ru` (hide-when-empty per D-13 pattern).
- Added `window.regenerateBriefClick(listingId, btn)` global: POSTs to `/api/entry/{id}/regenerate-brief`, shows "Generating…" toast, refreshes `loadData()` after 1500ms delay. 2-second debounce via button disable (T-06-09).

**`app/static/index.html`**:
- Added `.brief-card`, `.brief-headline`, `.brief-card-label`, `.brief-body`, `.brief-offer-range`, `.brief-review-badge`, `.brief-error` CSS block mirroring `.coo-card` style (same CSS variables, same padding, same border-radius).

## Verification Results

```
pytest app/tests/test_brief_generator.py -x -q
3 passed, 1 warning in 0.07s

pytest app/tests/test_viewing_workflow.py -x -q
5 passed, 1 skipped, 3 warnings in 0.33s
(1 skipped = test_refresh_ku from Plan 06-04)

grep check:
- _buildNegotiationBrief + regenerateBriefClick + brief-card across detail-panel.js + index.html: 11 refs >= 3 ✓
- innerHTML count in index.html: 0 (no increase) ✓
- brief_generator refs in main.py: 4 (>= 2) ✓
- POST /api/entry/nonexistent/regenerate-brief: 404 ✓
```

## Deviations from Plan

### Auto-fixed Issues

None.

### Scope Adjustments

**1. Detail panel render order adjusted to satisfy D-07**
- Original code rendered `_buildCostOfOwnership` BEFORE `_buildAiDepthSection` (which contains the AI Verdict). Per D-07 "below AI Verdict block, above cost-of-ownership card", the render order was changed to: AI depth → brief card → COO.
- Net change: swapped the order of 2 existing blocks + inserted brief card between them.

**2. data_store imported inside generate_and_save_brief body (not at module scope)**
- Plan said "NO import of data_store at module scope". Implemented exactly as specified.
- Prevents circular import: `data_store → config`; `brief_generator → config` (module scope). `data_store` import in function body is re-entrant safe since Python caches module imports.

**3. `monkeypatch.setattr(config, "ANTHROPIC_API_KEY", "test-key-abc")` added to test**
- The plan's test sketch didn't mention setting ANTHROPIC_API_KEY, but the function's first guard (`if not config.ANTHROPIC_API_KEY`) returns the fallback early if the key is empty. Monkeypatching the config attribute is required for `test_returns_expected_shape` to reach the HTTP call.
- This is not a bug fix or architectural change — it's a test implementation detail captured here for transparency.

## Known Stubs

None — all card UI paths are wired to real endpoints. The brief card renders with real data from `entry.negotiation_brief` once the daemon thread completes. The regenerate button calls the live endpoint.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| T-06-06 mitigated | app/static/js/detail-panel.js | Brief text rendered via `.textContent` (not innerHTML); AUTHORITATIVE FACTS block delimits listing data from model instructions in system prompt |
| T-06-07 mitigated | app/brief_generator.py | `log.info/warning` log only `listing_id`; ANTHROPIC_API_KEY never logged |
| T-06-08 mitigated | app/brief_generator.py | `_validate_no_hallucinated_numbers` post-hoc check sets `needs_review=True` when brief contains unknown numbers; `_buildNegotiationBrief` shows ⚠ badge |
| T-06-09 mitigated | app/static/js/detail-panel.js | Regenerate button disabled during request + 1500ms reload delay (client-side debounce) |

## Self-Check: PASSED

Files verified:
- FOUND: app/brief_generator.py (contains generate_negotiation_brief, generate_and_save_brief, _extract_json, _validate_no_hallucinated_numbers)
- FOUND: app/main.py (contains import brief_generator, schedule-viewing thread spawn, regenerate-brief endpoint)
- FOUND: app/static/js/detail-panel.js (contains _buildNegotiationBrief, regenerateBriefClick, brief card insertion)
- FOUND: app/static/index.html (contains .brief-card CSS block)
- FOUND: app/tests/test_brief_generator.py (3 filled tests, all GREEN)
- FOUND: app/tests/test_viewing_workflow.py (test_regenerate_brief filled, GREEN)

Commits verified:
- 578f04a: feat(06-03): create app/brief_generator.py — Anthropic call + post-hoc validation
- 4e9f7ca: feat(06-03): wire brief_generator into schedule-viewing + add regenerate-brief endpoint
- 774b88f: feat(06-03): fill brief_generator tests + test_regenerate_brief + add brief card to detail panel
