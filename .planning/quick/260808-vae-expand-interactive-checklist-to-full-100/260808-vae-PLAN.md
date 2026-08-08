---
quick_id: 260808-vae
slug: expand-interactive-checklist-to-full-100
mode: quick
---

# Quick Task 260808-vae: Expand interactive checklist to full ~100-item registry (Wave A of 3)

## Task

Expand the interactive checklist from 13 AI-fillable items to the full ~100-item
checklist Daniel actually uses when evaluating a Tallinn apartment. Structured
registry, AI autofill where possible, mobile-first collapsible section UI,
per-item note. Wave A of a 3-wave series — Wave B (finance calculator) and
Wave C (score breakdown table) are explicitly out of scope for this task.

## Tasks

1. **Backend registry** — `backend/checklist_registry.py`: structured
   `ChecklistItemDef` registry (~96 items across 4 sections: evaluation,
   ask_seller, request_docs, onsite — onsite has 5 sub-groups), `LEGACY_KEY_MAP`
   mapping all 13 pre-Wave-A keys onto their new homes, helper functions
   (`get_registry`, `get_ai_fillable_keys`, `get_ai_fillable_items`,
   `get_sections`, `legacy_keys_for`).
2. **Backend wiring** — `ai_evaluator.py` (dynamic `AI_FILLABLE_CHECKLIST_KEYS`
   + generated prompt schema block), `ingest_handler.py` (dynamic
   `EXPECTED_CHECKLIST_KEYS`), `data_store.py` (lazy legacy-key migration in
   `set_checklist_user_mark`), new `routes_checklist.py` +
   `GET /api/checklist-registry` registered in `main.py`.
3. **Backend tests** — `tests/test_checklist_registry.py`: registry structure,
   legacy map coverage, migration behavior, endpoint shape.
4. **Frontend types/client** — `types/api.ts` (`ChecklistRegistry*` types),
   `lib/api.ts` (`fetchChecklistRegistry`), `lib/queries.ts`
   (`useChecklistRegistry`, 1h staleTime).
5. **Frontend registry helpers** — `lib/checklistMeta.ts` rewrite: pure
   lookup/index helpers over fetched registry data + `useChecklistMeta` hook +
   `isKnownStateShorthand` kept as-is.
6. **Frontend UI rewrite** — `components/shortlist/ChecklistCard.tsx`:
   section-based collapsible layout, onsite sub-groups, All/To do/OK/Flagged
   filter chips, 4-state item cycle, note textarea, mobile touch targets
   >=44px, frontend legacy-key read fallback.
7. **Frontend tests** — `ChecklistCard.test.tsx` rewrite (vitest + MSW),
   `qa-shortlist.spec.ts` rewrite (Playwright, against the live registry
   endpoint).

## Constraints

- No changes to `PATCH /api/entry/{id}/checklist-item` request/response contract.
- Every registry item has non-empty `label_ru`.
- Mobile-first; verified via Playwright webkit-mobile.
- Registry fetched once per session (1h staleTime), never refetched per listing.
- Do NOT build the finance calculator (Wave B) or score breakdown table (Wave C).

## Verification

- `docker exec aparts-looker-app-1 pytest` — all backend tests green.
- `cd frontend && npx vitest run` — all vitest tests green.
- `cd frontend && npx playwright test qa-shortlist.spec.ts` — checklist tests green.
- `curl http://127.0.0.1:8000/api/checklist-registry` — 4 sections, 96 items.
