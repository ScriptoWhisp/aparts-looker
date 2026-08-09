---
quick_id: 260809-i1z
slug: add-description-translation-bulleted-sum
status: complete
subsystem: shortlist-detail
tags: [ai-evaluator, description-translation, shortlist, wave-c]
dependency-graph:
  requires: [ai_evaluator.evaluate_listing, models.Listing]
  provides: [description_ru, description_bullets, DescriptionCard, POST /api/entry/{id}/regenerate-description]
  affects: [ingest_handler.process_ingest_batch, data_store, Shortlist MainPane]
tech-stack:
  added: []
  patterns: [piggybacked-AI-call, JSONB-reassignment, fire-and-forget-regenerate]
key-files:
  created:
    - backend/alembic/versions/0005_description_translation.py
    - backend/tests/test_ai_translation.py
    - frontend/src/components/shortlist/DescriptionCard.tsx
    - frontend/src/test/DescriptionCard.test.tsx
  modified:
    - backend/models.py
    - backend/ai_evaluator.py
    - backend/data_store.py
    - backend/ingest_handler.py
    - backend/routes_entries.py
    - frontend/src/types/api.ts
    - frontend/src/lib/api.ts
    - frontend/src/routes/Shortlist.tsx
    - frontend/e2e/fixtures/seed.ts
    - frontend/e2e/qa-shortlist.spec.ts
    - frontend/src/test/mocks/fixtures.ts
    - frontend/src/test/mocks/handlers.ts
decisions:
  - Wave C piggybacks description_ru + description_bullets onto the existing evaluate_listing() Claude call — no second Anthropic API round-trip
  - regenerate-description endpoint persists ONLY the translation fields (via data_store.save_ai_translation), deliberately not overwriting score/verdict/checklist owned by other cards
metrics:
  duration: ~2h
  completed: 2026-08-09
---

# Quick Task 260809-i1z: Description translation + bulleted summary (Wave C) Summary

Added a description-translation + bulleted-summary card to the Shortlist detail view. Daniel now sees, for every shortlisted listing: (1) 5-10 AI-extracted Russian key-facts bullets, (2) a full Russian translation of the raw kv.ee description (default-open), and (3) the raw Estonian original (collapsible, default-closed) — all piggybacked onto the existing `evaluate_listing()` Claude call with no extra API round-trip.

## What Changed

**Backend:**
- `alembic/versions/0005_description_translation.py` — adds nullable `description_ru` (TEXT) and `description_bullets` (JSONB) columns to `listings`.
- `models.py` — matching `Mapped` columns on `Listing`.
- `ai_evaluator.py` — extends the `evaluate_listing()` prompt/schema with `description_ru` (full literal RU translation, ET real-estate terms kept with a RU gloss) and `description_bullets` (5-10 bullets, ≤90 chars each). New `_validate_description_ru` / `_validate_description_bullets` never-raise validators (max-length truncation, malformed-item dropping, empty-list/string fallback).
- `data_store.py` — new `save_ai_translation()` helper (JSONB reassignment); `_row_to_property_dict` / `_row_to_pending_dict` now expose `description_ru` / `description_bullets`.
- `ingest_handler.py` — pending entry now carries `description_ru` / `description_bullets` from the evaluation result on ingest; new `regenerate_description_translation()` daemon-thread target reuses the full `evaluate_listing()` flow but persists only the translation fields (checklist/score/brief untouched, per scope constraint).
- `routes_entries.py` — new `POST /api/entry/{id}/regenerate-description` (fire-and-forget, mirrors `regenerate-brief`).

**Frontend:**
- `types/api.ts` — `Entry.description` / `description_ru` / `description_bullets`.
- `lib/api.ts` — `regenerateDescription()`.
- `components/shortlist/DescriptionCard.tsx` — new card: bullets list, RU translation (collapsible, default-open when present), ET original (collapsible, default-closed, `whitespace-pre-wrap`, plain-text — no `dangerouslySetInnerHTML`), empty/loading/error states, all Russian-labeled.
- `routes/Shortlist.tsx` — slotted full-width between `VerdictBand` and the checklist/finance grid.

**Tests:**
- `backend/tests/test_ai_translation.py` — 19 tests: validator coercion/truncation/drop-malformed, `save_ai_translation` persistence + GET /api/data reflection, ingest pipeline wiring, regenerate endpoint (200/404), direct `regenerate_description_translation()` exercise with a mocked AI response.
- `frontend/src/test/DescriptionCard.test.tsx` — 11 tests (bullets, translation/original toggle states, line-break preservation, empty state, regenerate success/error).
- `frontend/e2e/qa-shortlist.spec.ts` — 3 new Playwright tests (card visible + bullets + translation expanded/original collapsed; regenerate fires the endpoint; empty state).
- `frontend/e2e/fixtures/seed.ts` + `frontend/src/test/mocks/fixtures.ts` — example description data added to `approvedEntry`; MSW handler for `regenerate-description`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] `ingest_handler.py` local `SessionLocal` import bypassed test DB isolation**
- **Found during:** running the new backend test suite — `regenerate_description_translation()` hung/misbehaved under `pytest`.
- **Issue:** `from db import SessionLocal` at module scope binds the name directly into `ingest_handler`'s namespace; the `db_session` test fixture only monkeypatches `db.SessionLocal`, `data_store.SessionLocal`, and `brief_generator.SessionLocal` (per its own documented pattern) — not an `ingest_handler`-local binding. The new function was opening a session against the real production DB instead of the test's rolled-back transaction, hanging one CI run and silently no-op'ing on a retry.
- **Fix:** switched to `import db` + `db.SessionLocal()` (matches the `routes_entries.py` convention), which resolves through the module attribute and picks up the patched value.
- **Files modified:** `backend/ingest_handler.py`
- **Commit:** 6f7c023

## Known Stubs

None — both `description_ru` and `description_bullets` are wired end-to-end (AI → DB → API → UI) and covered by tests.

## Pre-existing Bugs Discovered (out of scope, not fixed)

While running `npm run qa` for full verification, three **pre-existing** issues (unrelated to this Wave, present before this session) surfaced:

1. **`FinanceCard.test.tsx` (vitest, 2 tests) + `qa-finance.spec.ts` (playwright, 1 test)** — `FinanceCard`'s "Ежемесячно" section was changed to `defaultOpen={false}` in commit `c13b0f8` ("fix(finance): merge duplicate mortgage params + compact FinanceCard"), but these tests click `finance-add-utilities` / `finance-add-remondifond` without expanding the section first, so the button is never visible. Deterministic pre-existing failure, confirmed identical against the unmodified `mocks/fixtures.ts`.
2. **`qa-shortlist.spec.ts` — "Negotiation card is gated (opacity + locked copy) for approved status"** — `NegotiationCard.tsx`'s own docstring describes an `opacity-45 pointer-events-none` gate with an "unlocks after viewing" kicker for `approved`/`viewing_scheduled` status, but the current render code does not implement it. Stale test/docstring vs. actual component.
3. **`qa-shortlist.spec.ts` — "checklist=null..." console-error assertion** — fails because `GET /api/entry/{id}/finance-calculation` 404s against the real backend for listings that exist only via mocked `/api/data` (not seeded in the actual DB) — a data-seeding gap dating to when `FinanceCard` was slotted into `MainPane` (Wave B), unrelated to this task.

All three were reproduced in isolation with `--workers=1` to rule out resource-contention flakiness, and are explicitly out of scope per this task's constraint ("Do NOT touch checklist / finance / negotiation — Wave C is scoped to description translation only"). `mobile-snapshots.spec.ts` failures seen during a broad sweep were a test-runner misconfiguration on my part (that spec requires `--project=webkit-mobile`, not `chromium-desktop`) — not a real bug.

## Verification

- `docker exec aparts-looker-app-1 alembic current` → `0005 (head)`
- `docker exec aparts-looker-app-1 pytest --tb=short -q` → **260 passed, 3 skipped** (target ~250+ met)
- `cd frontend && npx tsc --noEmit` → clean
- `cd frontend && npx vitest run` → **179 passed / 181** (2 pre-existing unrelated `FinanceCard.test.tsx` failures, see above); all 11 new `DescriptionCard.test.tsx` tests pass
- `cd frontend && npx playwright test qa-shortlist.spec.ts --project=chromium-desktop --workers=1` → **14 passed / 16** (2 pre-existing unrelated failures, see above); all 3 new DescriptionCard Playwright tests pass

## Cost Impact

`description_ru` (up to 8000 chars) and `description_bullets` (≤15×200 chars) add roughly 1.5-2.5x to the existing evaluate_listing() *response* token count for a typical 300-800 word description (the *request* is unchanged — same listing description was already being sent). At Claude Haiku pricing this remains a fraction of a cent per listing, well within the existing "AI cost not a constraint" project posture.

## Self-Check: PASSED

- FOUND: backend/alembic/versions/0005_description_translation.py
- FOUND: backend/tests/test_ai_translation.py
- FOUND: frontend/src/components/shortlist/DescriptionCard.tsx
- FOUND: frontend/src/test/DescriptionCard.test.tsx
- FOUND commit 520c6be, 8ef769f, 18e27f0, 6f7c023, 8fcf02a, ab6d24a, e01ac9a
