---
phase: 03-ai-quality-price-intelligence
verified: 2026-07-09T10:00:00Z
status: human_needed
score: 5/6
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Open the dossier in a browser. Select any listing that has at least one price_history entry. Verify a 'Days on market: N days' label appears on the dossier card."
    expected: "A numeric 'Days on market' label is visible on the main dossier card, computed from the first price_history date to today."
    why_human: "Frontend rendering of state.priceHistory via daysOnMarket(id); no Selenium/Playwright in the test suite. Per VALIDATION.md row 03-03-04 (INTEL-02 marked manual)."
  - test: "Open the Pending tab. Ingest a listing and let it evaluate. On the pending card, verify that an AI checklist badge strip appears below the meta line, with [AI]-prefixed labels and colour-coded pass/fail/unknown badges."
    expected: "AI checklist badges are visible on pending cards, distinct from user-filled entries. Source badge prefix reads '[AI]'."
    why_human: "Visual rendering of buildAiChecklistEl badges; no automated browser test. Per VALIDATION.md manual-only verification row for EVAL-02."
  - test: "Open the dossier main card for any listing that has at least one price_history entry. Verify a price history list appears (one line per date entry, formatted as 'YYYY-MM-DD — NNN NNN €')."
    expected: "Price history plain-text entries are visible on the dossier card."
    why_human: "Frontend rendering of buildPriceHistoryEl; no automated browser test. Per VALIDATION.md manual-only verification row for INTEL-01 UI."
---

# Phase 3: AI Quality & Price Intelligence — Verification Report

**Phase Goal:** The AI evaluator produces calibrated, anchor-grounded scores with a structured checklist, and the system tracks price history and listing age — automatically re-queuing listings when prices drop significantly.
**Verified:** 2026-07-09T10:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | The evaluation prompt sent to Claude includes 2–3 previously-approved listings with their scores as calibration anchors before asking for a new score (EVAL-01) | VERIFIED | `_build_context_prefix()` in `app/ingest_handler.py` lines 73–141: sorts `properties[]` by score descending, takes top 3, returns numbered Anchor block when >= 2 exist (returns "" when < 2 per D-02). `process_ingest_batch` calls it before `evaluate_listing`. `test_anchor_injection` and `test_anchor_skipped_below_threshold` both PASS. |
| 2 | Each evaluation response includes a structured pass/fail checklist covering the BUYER_PROFILE criteria assessable from listing text (EVAL-02) | VERIFIED | SYSTEM_PROMPT in `app/ai_evaluator.py` lines 55–77 names all 7 keys with pass/fail/unknown values. `evaluate_listing()` returns `checklist` via `setdefault("checklist", {})` (line 155) and in error fallback (line 167). `_whitelist_checklist()` and `write_checklist_ai()` are wired in `process_ingest_batch`. `test_checklist_in_response` and `test_checklist_user_override_preserved` both PASS. |
| 3 | The evaluation prompt includes the running price/m² average for the listing's district, computed from seen listings (EVAL-03) | VERIFIED | `_build_context_prefix()` lines 114–135: reads `properties[]` + `pending[]`, collects pricePerSqm/price_per_sqm values matching the district via `getattr(listing, "district", "")`, emits district average line. `test_district_avg_injected` and `test_district_avg_omitted_unknown` both PASS. |
| 4 | Every scrape records the current price for each known listing; price history is tracked (INTEL-01) | VERIFIED | `data_store.record_price_in_data()` (lines 100–117): no-lock in-place mutator, idempotent same-day, 90-entry cap. `DEFAULT_APP_DATA` and `load_app_data()` include `price_history: {}`. `_record_and_check_price_drop()` is called for both dedup-hit and new-listing branches in `process_ingest_batch`. `test_record_price_new`, `test_record_price_idempotent`, `test_ingest_records_price_for_known` all PASS. |
| 5 | When a seen listing's price drops 5% or more since last scrape, it is automatically re-evaluated (EVAL-04) | VERIFIED | `_record_and_check_price_drop()` computes drop against previous history entry; calls `_handle_price_drop()` when threshold met. `_handle_price_drop()` dispatches: approved→re-score+Telegram; pending→silent update+checklist refresh; price-rejected→re-queue to pending+Telegram; other-rejected→untouched. `test_price_drop_reeval_pending`, `test_price_drop_below_threshold_no_reeval`, `test_price_rejected_requeued`, `test_location_rejected_not_requeued` all PASS. |
| 6 | Listings show days-on-market in the dossier card; listings whose URL returns 404 are marked as removed with the date (INTEL-02 + INTEL-03) | PARTIAL — INTEL-03 VERIFIED, INTEL-02 human-needed | INTEL-03: `_mark_removed_listings()` in `ingest_handler.py` marks `removed=True` + `removed_at` on properties[] and pending[] entries with `raw_ok=False`. Removed badge rendered in `renderMain` and `buildPendingCard` via `textContent` only (lines 834–841, 1325–1331). `test_removed_listing_marked` and `test_removed_listing_marked_pending` both PASS. INTEL-02: `daysOnMarket()` JS helper exists (line 1174), wired in renderMain and buildPendingCard. However days-on-market display is frontend-only and requires visual browser verification. |

**Score:** 5/6 truths fully verified (Truth 6 is split: INTEL-03 is VERIFIED via tests; INTEL-02 requires human visual verification per VALIDATION.md)

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `app/config.py` PRICE_DROP_THRESHOLD | `float(os.environ.get("PRICE_DROP_THRESHOLD", "0.05"))` | VERIFIED | Line 29; default 0.05 confirmed |
| `app/ai_evaluator.py` — `evaluate_listing(listing, context_prefix="")` | Extended signature + checklist in response schema | VERIFIED | Lines 87–168; context_prefix prepended to user_content; setdefault("checklist",{}) in success branch; checklist:{} in error fallback |
| `app/ai_evaluator.py` — SYSTEM_PROMPT | 7-key checklist schema embedded | VERIFIED | Lines 55–77; all 7 criterion keys named with pass/fail/unknown guidance |
| `app/ai_evaluator.py` — max_tokens | 1500 | VERIFIED | Line 136 |
| `app/ingest_handler.py` — `_build_context_prefix(listing, data)` | Anchor block + district avg, never-raise | VERIFIED | Lines 73–141 |
| `app/ingest_handler.py` — `EXPECTED_CHECKLIST_KEYS` + `ALLOWED_CHECKLIST_VALUES` | frozensets | VERIFIED | Lines 31–40 |
| `app/ingest_handler.py` — `_whitelist_checklist(raw)` | Returns full 7-key dict, coerces invalid to "unknown" | VERIFIED | Lines 54–70 |
| `app/ingest_handler.py` — `_record_and_check_price_drop(app_data, listing, today_str)` | Price recording + drop detection orchestrator | VERIFIED | Lines 144–181 |
| `app/ingest_handler.py` — `_handle_price_drop(app_data, listing, prev_price, new_price)` | Re-evaluation dispatcher by state | VERIFIED | Lines 184–277 |
| `app/ingest_handler.py` — `_mark_removed_listings(app_data, batch_dicts)` | Marks raw_ok=False listings removed | VERIFIED | Lines 280–306 |
| `app/data_store.py` — `DEFAULT_APP_DATA["price_history"]` | `{}` with comment | VERIFIED | Line 51 |
| `app/data_store.py` — `load_app_data()` setdefault migration | `data.setdefault("price_history", {})` | VERIFIED | Line 91 |
| `app/data_store.py` — `record_price_in_data(data, listing_id, price_eur, date_str)` | No-lock mutator, idempotent, 90-entry cap | VERIFIED | Lines 100–117 |
| `app/data_store.py` — `get_price_history(listing_id)` | Thread-safe reader | VERIFIED | Lines 120–130 |
| `app/data_store.py` — `write_checklist_ai(listing_id, checklist)` | Writes ai_checklist, preserves source=="user" | VERIFIED | Lines 243–262 |
| `app/data_store.py` — `get_rejected_by_reason(reason)` | Thread-safe reader for rejected[] by reason | VERIFIED | Lines 265–276 |
| `app/static/index.html` — `state.priceHistory` + loadData assignment | Populated from GET /api/data | VERIFIED | Line 472 (declaration), line 503 (assignment in loadData) |
| `app/static/index.html` — `daysOnMarket(listingId)` | Computes today - first history date | VERIFIED | Lines 1174–1185 |
| `app/static/index.html` — `buildPriceHistoryEl(listingId)` | Returns DOM div or null | VERIFIED | Lines 1186–1204 |
| `app/static/index.html` — `buildAiChecklistEl(listingId)` | AI checklist badge strip | VERIFIED | Lines 1206–1265 |
| `app/static/index.html` — Removed badge in renderMain | textContent-only, red colour | VERIFIED | Lines 834–841 |
| `app/static/index.html` — Removed badge in buildPendingCard | textContent-only, red colour | VERIFIED | Lines 1325–1331 |
| `app/static/index.html` — buildAiChecklistEl wired in buildPendingCard | `buildAiChecklistEl(entry.id)` call | VERIFIED | Line 1301 |
| `app/static/index.html` — saveData does NOT include priceHistory | body only sends properties+checklists | VERIFIED | Line 517 |
| `app/tests/test_eval_quality.py` | 6 tests, all PASS, no xfail | VERIFIED | All 6 tests confirmed PASS; `grep -c "xfail"` = 0 |
| `app/tests/test_price_intelligence.py` | 9 tests, all PASS, no xfail | VERIFIED | All 9 tests confirmed PASS; `grep -c "xfail"` = 0 |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `process_ingest_batch` | `_build_context_prefix` | Called before `evaluate_listing` (line 374) | WIRED | `context_prefix = _build_context_prefix(listing, app_data)` then passed as kwarg |
| `process_ingest_batch` | `evaluate_listing` | `evaluate_listing(listing, context_prefix)` (line 375) | WIRED | Updated call site in ingest_handler.py |
| `process_ingest_batch` | `write_checklist_ai` | After `add_to_pending` (lines 398–401) | WIRED | `data_store.write_checklist_ai(listing.id, _whitelist_checklist(evaluation.get("checklist",{})))` |
| `process_ingest_batch` | `_record_and_check_price_drop` | Both dedup-hit (line 344) and new-listing (line 425) branches | WIRED | Replaces bare `record_price_in_data` calls |
| `process_ingest_batch` | `_mark_removed_listings` | After for loop, before save (line 432) | WIRED | `_mark_removed_listings(app_data, listing_dicts)` |
| `_handle_price_drop` | `_build_context_prefix` + `evaluate_listing` | Lines 200–203 | WIRED | Re-evaluation uses same calibration path as new listings |
| `_handle_price_drop` | `write_checklist_ai` | For pending re-evaluation (lines 241–244) | WIRED | Checklist refreshed on pending price-drop re-eval |
| `_handle_price_drop` | `telegram_client.send_message` | Lines 224–228, 268–271 | WIRED | Telegram notifications for approved drops and price-rejected re-queues |
| `renderMain` | `daysOnMarket(p.id)` + `buildPriceHistoryEl(p.id)` | Lines 821, 831 | WIRED | Post-innerHTML DOM insertion via textContent |
| `buildPendingCard` | `buildAiChecklistEl(entry.id)` | Line 1301 | WIRED | AI badge strip appended to pending card |
| `GET /api/data` | `price_history` key | Returns `load_app_data()` verbatim | WIRED | No backend routing changes needed; key present in DEFAULT_APP_DATA and via setdefault migration |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `index.html` renderMain — daysOnMarket label | `state.priceHistory[id]` | Populated from `GET /api/data` response key `price_history` | Yes — `record_price_in_data` writes real scrape timestamps/prices | FLOWING |
| `index.html` buildPriceHistoryEl | `state.priceHistory[id]` | Same as above | Yes | FLOWING |
| `index.html` buildAiChecklistEl | `state.checklists[id].ai_checklist` | Written by `write_checklist_ai` after `evaluate_listing` | Yes — AI-populated checklist from Claude response | FLOWING |
| `index.html` removed badge | `p.removed`, `p.removed_at` | Set by `_mark_removed_listings` on raw_ok=False signal | Yes | FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| PRICE_DROP_THRESHOLD == 0.05 | `python3 -c "import config; assert config.PRICE_DROP_THRESHOLD == 0.05; print('OK')"` | OK | PASS |
| evaluate_listing accepts context_prefix="" | `python3 -c "from ai_evaluator import evaluate_listing; import inspect; sig = inspect.signature(evaluate_listing); assert 'context_prefix' in sig.parameters; print('OK')"` | OK | PASS |
| price_history in load_app_data | `python3 -c "import data_store; d = data_store.load_app_data(); assert 'price_history' in d; print('OK')"` | OK | PASS |
| _whitelist_checklist drops unknown keys + coerces invalid to "unknown" | `python3 -c "import ingest_handler; out = ingest_handler._whitelist_checklist({'price_per_sqm':'pass','garbage':'x','floor':'bogus'}); assert out['price_per_sqm']=='pass' and out['floor']=='unknown' and 'garbage' not in out and len(out)==7; print('OK')"` | OK | PASS |
| All 4 required helpers callable in data_store | `python3 -c "import data_store; assert all(callable(getattr(data_store, n)) for n in ['write_checklist_ai','record_price_in_data','get_price_history','get_rejected_by_reason']); print('OK')"` | OK | PASS |
| All 5 required helpers callable in ingest_handler | `python3 -c "import ingest_handler; assert all(callable(getattr(ingest_handler, n)) for n in ['_build_context_prefix','_whitelist_checklist','_record_and_check_price_drop','_handle_price_drop','_mark_removed_listings']); print('OK')"` | OK | PASS |
| Full test suite: 39 passed, 0 failed | `cd app && python3 -m pytest tests/ -v` | 39 passed, 3 warnings | PASS |
| Phase 3 test files: 15 passed, 0 failed, 0 xfail | `cd app && python3 -m pytest tests/test_eval_quality.py tests/test_price_intelligence.py -v` | 15 passed | PASS |

---

### Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
|-------------|-------------|-------------|--------|---------|
| EVAL-01 | 03-01, 03-04 | Evaluation prompt includes 2-3 calibration anchors from approved listings | SATISFIED | `_build_context_prefix()` verified; 2 automated tests PASS |
| EVAL-02 | 03-02, 03-04 | Evaluation output includes structured 7-key pass/fail/unknown checklist | SATISFIED | SYSTEM_PROMPT schema, `write_checklist_ai`, `_whitelist_checklist` all verified; 2 automated tests PASS; AI badge strip in pending tab verified |
| EVAL-03 | 03-01, 03-04 | Evaluation prompt includes district price/m² average | SATISFIED | District avg line in `_build_context_prefix()` verified; 2 automated tests PASS |
| EVAL-04 | 03-04 | >= 5% price drop triggers re-evaluation and re-queuing | SATISFIED | `_record_and_check_price_drop` + `_handle_price_drop` verified; 4 automated tests PASS covering all dispatch branches |
| INTEL-01 | 03-03 | Price history recorded per listing on every scrape | SATISFIED | `record_price_in_data`, `get_price_history`, dedup-branch wiring verified; 3 automated tests PASS |
| INTEL-02 | 03-03 | Days-on-market tracked and surfaced in listing card | NEEDS HUMAN | `daysOnMarket()` helper exists and is wired in renderMain + buildPendingCard; no automated browser test per VALIDATION.md |
| INTEL-03 | 03-04 | URL 404 listings marked as removed with date | SATISFIED | `_mark_removed_listings()` verified; removed badge in renderMain + buildPendingCard via textContent; 2 automated tests PASS |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None | — | No TBD/FIXME/XXX debt markers found in phase 3 files | — | — |
| None | — | No stub patterns (placeholder returns, empty handlers) found | — | — |
| `app/static/index.html` | 815 | Pre-existing `el.innerHTML =` in renderMain | Info (pre-existing) | Phase 3 additions all use post-innerHTML DOM insertion with textContent; no new innerHTML risk introduced |

---

### Human Verification Required

#### 1. Days-on-market label on dossier card (INTEL-02)

**Test:** Open the dossier in a browser. Select any listing that has at least one price_history entry. Look for a "Days on market: N days" label in the head-actions area of the main dossier card.
**Expected:** A numeric days-on-market label is visible, computed as today minus the first price_history entry date.
**Why human:** Frontend rendering only; `daysOnMarket()` reads `state.priceHistory` which is populated from the API, but no Selenium/Playwright tests exist for this. Per VALIDATION.md row 03-03-04, this is explicitly marked manual.

#### 2. AI checklist badge strip on pending card (EVAL-02 visual)

**Test:** Open the Pending tab. Ingest a new listing (or find an existing pending entry). Verify a row of AI checklist badges appears below the meta line, with labels prefixed "[AI]" and colour-coded for pass (green), fail (red), unknown (grey).
**Expected:** All 7 criterion badges visible, visually distinct from user-filled entries.
**Why human:** Visual rendering of `buildAiChecklistEl`; no automated browser test. Per VALIDATION.md manual-only verification.

#### 3. Price history list on dossier card (INTEL-01 UI)

**Test:** Open an approved listing card. Verify price history entries are shown below the head-actions area (one line per date entry, formatted as "YYYY-MM-DD — NNN NNN €").
**Expected:** Price history plaintext list renders correctly.
**Why human:** Frontend rendering of `buildPriceHistoryEl`; no automated browser test. Per VALIDATION.md manual-only verification.

---

### Gaps Summary

No automated-verification gaps. All 7 requirements have either full automated test coverage (EVAL-01, EVAL-02, EVAL-03, EVAL-04, INTEL-01, INTEL-03) or are explicitly designated manual per VALIDATION.md (INTEL-02). Three human verification items remain: days-on-market display (INTEL-02, mandatory manual), AI checklist badge visual (EVAL-02 UI), and price history list display (INTEL-01 UI). These are browser-rendering checks that cannot be verified programmatically without a Selenium/Playwright test suite.

All 39 tests pass (0 failures, 0 XFAIL). All 15 Phase 3 Wave 0 stubs were flipped to PASS. No debt markers found in modified files. No new innerHTML XSS sites introduced.

---

_Verified: 2026-07-09T10:00:00Z_
_Verifier: Claude (gsd-verifier)_
