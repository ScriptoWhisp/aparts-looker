---
phase: 6
reviewers: [claude]
reviewed_at: 2026-07-14T19:31:00Z
plans_reviewed: ["06-01-PLAN.md", "06-02-PLAN.md", "06-03-PLAN.md", "06-04-PLAN.md", "06-05-PLAN.md"]
runtime_note: |
  Only claude was invoked. gemini was detected but not authenticated (no GEMINI_API_KEY);
  no other reviewer CLIs (codex/opencode/qwen/cursor-agent/coderabbit/agy) are installed.
  The claude reviewer is running in a separate CLI session from the orchestrator; still
  same model family, so blind-spot coverage is weaker than a truly independent AI.
---

# Cross-AI Plan Review — Phase 6

## Claude Review

Now I have the concrete file:line evidence needed. Let me write the review.

---

## Cross-AI Plan Review: Phase 6 — Viewing Workflow & Extras

### Summary

Phase 6 shipped a coherent viewing lifecycle (schedule → viewed), negotiation brief generation, and KÜ enrichment. The plans are well-structured and mostly match the shipped code. Two functional gaps exist that the plans document but the implementation partially misses: district price comps are never fed to the brief generator (hardcoded `None`), and the hallucination validator will fire spuriously on any listing with a year built, training the user to ignore the warning badge. The pre-existing test failures from Phase 5's uncommitted work leave a murky test baseline. No data-loss or security risks were found; the RLock/Pitfall 5 implementation is correct throughout.

---

### Strengths

- **Pitfall 5 correctly implemented end-to-end.** `generate_and_save_brief` at `brief_generator.py:264-291` does exactly what the plan specifies: snapshot under `with data_store._lock`, release, call Anthropic outside the lock, re-acquire to save. `_lock` is a `threading.RLock`, so the re-entrant call to `load_app_data()` inside the outer lock context at line 265 is safe and intentional — the outer lock makes the snapshot extraction (not just the load) atomic.

- **Never-raise pattern enforced consistently.** `generate_negotiation_brief` (`brief_generator.py:200-242`) catches `(requests.RequestException, json.JSONDecodeError, KeyError, ValueError)` and returns a fallback dict including `"error": "AI call failed — retry via Regenerate button."`. `lookup_ku_for_address` (`ku_lookup.py`) wraps its entire body in `try/except Exception: return None`. Both daemon-thread targets (`generate_and_save_brief:298`, `_dispatch_ku_lookup`) log and exit on any exception.

- **`mark_viewed` transition guard enforced.** `data_store.py:273-281` explicitly checks `entry.get("status") != "viewing_scheduled"`, logs a warning citing D-03, and returns False. `main.py:548-550` raises `HTTPException(400)` on that False, preventing accidental status flips from `approved → viewed` directly.

- **`save_ku_enrichment` preserves manual notes (Pitfall 7).** `data_store.py:335` reads `existing = entry.get("ku") or {}` before overwriting, preserving `existing.get("manual", "")`. Tested by `test_data_store.py::test_save_ku_preserves_manual`.

- **Atomic JSON writes.** `data_store.py:79-81` uses `.tmp` + `os.replace()`, which is atomic on POSIX. No partial-write corruption risk even if a daemon thread is killed mid-write.

- **setdefault migration is additive and zero-downtime.** `load_app_data():108-112` adds all 5 Phase 6 fields to every properties[] and pending[] entry on load. Existing JSON is untouched on disk; defaults appear transparently.

- **Error brief is persisted to entry.** When Anthropic fails, `generate_and_save_brief` still calls `save_negotiation_brief` with the error dict (line 291). The frontend can surface "AI call failed — retry via Regenerate button" rather than showing a blank card.

- **textContent-only DOM writes enforced throughout.** All AI output (brief_ru, KÜ name/address) uses `.textContent` assignment in `detail-panel.js`. No `innerHTML` anywhere in the new Phase 6 code.

---

### Concerns

**[MEDIUM] `_validate_no_hallucinated_numbers` will false-positive on year_built for virtually every listing**

`brief_generator.py:93-101` builds `authoritative_numbers` from `{price_eur, price_per_sqm, score, district_avg, coo, first_price, last_price}`. But the AUTHORITATIVE FACTS block fed to the model at `brief_generator.py:150-157` includes `Год постройки: {year}` — a 4-digit year like "1970". The validator's regex `r"(\d{4,6})"` at line 98 will match "1970" in the brief, find it absent from `authoritative_numbers`, and return `False` → `needs_review=True`. This fires on every listing that has a year built, which is most of them. The `needs_review` warning badge becomes a permanent fixture, training the user to ignore it (cry-wolf problem). The hallucination defense remains architecturally sound but the implementation omits `year_built` from the authoritative set.

**[MEDIUM] `district_avg` hardcoded to `None` — district comps missing from brief**

`brief_generator.py:280-281`:
```python
district_avg = None
```
The code comment reads "These may be stored on the entry by prior phases" but makes no attempt to look up the district average. VIEW-03's requirement explicitly lists "district comps" as one of four negotiation data points. The conditional at `brief_generator.py:158-162` handles `None` gracefully (silently omits the district avg line from the AUTHORITATIVE FACTS block), so no error occurs — but the brief is structurally missing a key negotiation lever for every listing. Phase 3's district average is computed transiently at evaluation time and not stored per-entry, so there's nothing on `entry` to look up; a real fix would require reading all properties[] prices at brief-generation time.

**[MEDIUM] Pre-existing test failures leave a murky baseline**

Six tests in `test_pending.py`, `test_ingest.py`, `test_price_intelligence.py`, and `test_commute.py` were already failing before any Phase 6 changes (documented in 06-01 and 06-04 SUMMARYs). Root cause: uncommitted Phase 5 work passes `commute_minutes` kwarg to mocked `evaluate_listing`, breaking old mock lambdas. This means the test suite is not fully green, making it harder to detect regressions from future changes. The decision to defer the fix is documented but not tracked.

**[LOW] `mark_viewed` 400 is opaque — caller can't distinguish "not found" vs "wrong status"**

`main.py:550`: `raise HTTPException(status_code=400, detail="Listing not found or not in viewing_scheduled state")`. Both error cases return the same 400 with the same message. If the frontend ever needs to differentiate (e.g., show "already marked viewed" vs "listing doesn't exist"), it cannot. `data_store.mark_viewed` already knows which case applies (lines 271-281) but doesn't surface it.

**[LOW] `generate_negotiation_brief` exception clause is too narrow**

`brief_generator.py:235` catches `(requests.RequestException, json.JSONDecodeError, KeyError, ValueError)`. A `TypeError` or `AttributeError` from malformed response content (e.g., `data["content"]` being `None`) would propagate to the outer `generate_and_save_brief:262` try/except, which logs but does not call `save_negotiation_brief`. The entry's `negotiation_brief` field stays `None` rather than being set to the error dict. The outer catch should be sufficient for safety, but the briefless entry will silently show no brief card in the UI.

**[LOW] Dual camelCase/snake_case field access is proliferating**

`brief_generator.py:148-157` contains 5 dual-key lookups: `entry.get('name', entry.get('title', ''))`, `entry.get('area', entry.get('area_sqm', 0))`, `entry.get('pricePerSqm', entry.get('price_per_sqm', 0))`, `entry.get('year', entry.get('year_built', '?'))`, `entry.get('address', entry.get('name', ...))`. This is a symptom of properties[] entries using camelCase (legacy) and pending[]/newly-approved entries using snake_case. Any future code touching entry fields will face the same fork. The schema inconsistency is the real issue.

---

### Suggestions

1. **Fix the year_built false positive.** Add `year_built` to the authoritative numbers dict in `generate_negotiation_brief`:
   ```python
   year = entry.get('year', entry.get('year_built', ''))
   if str(year).isdigit():
       authoritative["year"] = int(year)
   ```
   Also consider `area_sqm` (3-digit; below the 4-digit floor so currently safe, but worth future-proofing).

2. **Compute district_avg at brief time.** In `generate_and_save_brief`, after loading data under lock, compute district average from `data["price_history"]` cross-referenced with each property's district. Phase 3 already has this logic in `ai_evaluator.py`; extract it to a `data_store.get_district_avg_price_per_sqm(district)` helper that `generate_and_save_brief` can call with the lock released.

3. **Fix the pre-existing test failures.** Update the `evaluate_listing` mock in `conftest.py` to accept `**kwargs` or to accept the `commute_minutes` kwarg explicitly. Six tests going from red to green costs almost nothing and restores regression confidence.

4. **Normalize 400 error payload.** Change `main.py:550` to:
   ```python
   raise HTTPException(status_code=400, detail={"error": "not_in_viewing_scheduled", "listing_id": listing_id})
   ```
   The frontend can then show a specific message.

5. **Widen the exception clause in `generate_negotiation_brief`** or add a final `except Exception` fallback that returns the error dict, so the outer `generate_and_save_brief` always persists something to the entry.

---

### Risk Assessment: **LOW**

Phase 6's core architecture — daemon threads, Pitfall 5 lock pattern, never-raise externals, atomic writes, setdefault migrations — is correctly implemented and well-tested for the behaviors it covers. The year_built false positive and missing district_avg are functional gaps that degrade UX (spurious warning badge, weaker negotiation brief) rather than cause data loss or failures. No security issues found. For a single-user personal tool, these are acceptable defects in the current sprint; the brief still generates useful output even without district comps. The two medium concerns should be addressed before Phase 5 (map UI) ships, since Phase 5 will compute district averages as a first-class feature and the plumbing between phases will need to connect.

---

## Consensus Summary

Only one reviewer was available (claude), so 'consensus' collapses to that single verdict.
For higher-signal review coverage, authenticate Gemini (`GEMINI_API_KEY=...`) or install
another reviewer CLI and re-run `/gsd-review --phase 6 --all`.
