---
quick_id: 260808-vae
slug: expand-interactive-checklist-to-full-100
status: complete
one_liner: "96-item structured checklist registry (4 sections, 5 onsite sub-groups) replacing the 13-key AI-fillable subset, with lazy legacy-key migration and a mobile-first collapsible/filterable UI"
key_files:
  created:
    - backend/checklist_registry.py
    - backend/routes_checklist.py
    - backend/tests/test_checklist_registry.py
  modified:
    - backend/ai_evaluator.py
    - backend/ingest_handler.py
    - backend/data_store.py
    - backend/main.py
    - frontend/src/types/api.ts
    - frontend/src/lib/api.ts
    - frontend/src/lib/queries.ts
    - frontend/src/lib/checklistMeta.ts
    - frontend/src/components/shortlist/ChecklistCard.tsx
    - frontend/src/test/mocks/fixtures.ts
    - frontend/src/test/mocks/handlers.ts
    - frontend/src/test/ChecklistCard.test.tsx
    - frontend/e2e/qa-shortlist.spec.ts
metrics:
  completed: "2026-08-08"
---

# Quick Task 260808-vae: Expand interactive checklist to full ~100-item registry Summary

96-item structured checklist registry (4 sections, 5 onsite sub-groups) replacing the 13-key AI-fillable subset, with lazy legacy-key migration and a mobile-first collapsible/filterable UI.

## What shipped

**Backend**

- `backend/checklist_registry.py` — single source of truth: 96 items across
  4 sections (`evaluation` 13, `ask_seller` 16, `request_docs` 20, `onsite`
  47 across 5 sub-groups: first_impression, structure, onsite_systems,
  common_areas, neighborhood). Every item has a stable `key`, `section`,
  `group`, non-empty `label_ru`, optional `label_et`/`hint`, `ai_fillable`
  flag, and auto-inferred `order`. `LEGACY_KEY_MAP` maps all 13 pre-Wave-A
  keys (`s09_01/02`, `s14_01..10`, `s16_01..04`) onto their new homes.
- `ai_evaluator.AI_FILLABLE_CHECKLIST_KEYS` and the prompt's `checklist_fills`
  JSON schema block are now generated dynamically from the registry (12
  ai_fillable items) — can never drift out of sync again.
- `ingest_handler.EXPECTED_CHECKLIST_KEYS` sourced from the same registry
  helper (this path backs a pass/fail/unknown re-eval branch that appears
  unreachable in production — `evaluate_listing()` only ever returns
  `checklist_fills`, never `checklist` — left wired since a test exercises
  it directly with a mocked `evaluate_listing`).
- `data_store.set_checklist_user_mark` lazily folds an old key's
  state/note/marked_at forward onto the new key the first time a listing's
  checklist is touched post-Wave-A, then drops the old key — no bulk
  migration script.
- New `GET /api/checklist-registry` (`routes_checklist.py`) serves the full
  registry as `{sections: [{id, label_ru, subgrouped, groups: [{id, label_ru,
  items: [...]}]}], legacy_key_map}`.

**Frontend**

- `types/api.ts` / `lib/api.ts` / `lib/queries.ts` — `ChecklistRegistry*`
  types, `fetchChecklistRegistry()`, `useChecklistRegistry()` (1h staleTime,
  fetched once per session).
- `lib/checklistMeta.ts` — rewritten as pure helpers
  (`indexRegistryByKey`, `buildReverseLegacyMap`, `lookupWithLegacyFallback`,
  `useChecklistMeta`) over the fetched registry; `isKnownStateShorthand` kept.
- `components/shortlist/ChecklistCard.tsx` — full rewrite: 4 collapsible
  sections with `N/total marked` progress, onsite's 5 sub-groups as
  smaller/italic collapsible headers, All/To do/OK/Flagged filter chips that
  force-expand only matching sections/sub-groups and hide non-matching
  sections entirely, a 4-state item cycle (unknown → ok → flag → skip), and
  a debounced per-item note textarea. Frontend-side legacy-key fallback
  resolves old keys in both `ai_checklist_fills` and `checklist.user_marks`
  so pre-existing data renders correctly even before the backend's lazy
  write-time migration has touched a listing. Touch targets ≥44px; note
  textarea uses `text-base` (16px) so iOS does not zoom on focus.

## Deviations from Plan

### Auto-fixed Issues (Rule 2 — missing critical functionality)

**1. Added `label_ru` and `subgrouped` fields to registry groups/sections in the API response**
- **Found during:** Frontend UI design — the spec's example endpoint JSON only
  showed `{"id": ..., "items": [...]}` for groups, but the UI requirement
  ("smaller/italic headers" for onsite's 5 sub-groups) needs real display
  text for each group, and the frontend needs to know which sections render
  sub-group headers vs. a flat list.
- **Fix:** `get_registry()` includes `label_ru` on every group (via a new
  `GROUP_LABELS` dict) and `subgrouped: bool` on every section
  (`SUBGROUPED_SECTIONS = {"onsite"}`).
- **Files:** `backend/checklist_registry.py`, `backend/tests/test_checklist_registry.py`
- **Commits:** included in `860e48b`, `7f03a63`, `b7a7331`

**2. Added `legacy_key_map` to the registry endpoint response**
- **Found during:** Implementing the frontend's required read-time legacy-key
  fallback ("Migration & backward compat" section of the task spec) — the
  frontend needs the old→new key map to resolve pre-existing
  `ai_checklist_fills`/`user_marks` data without duplicating
  `LEGACY_KEY_MAP` as a second hardcoded copy in TypeScript.
- **Fix:** `get_registry()` includes `legacy_key_map` alongside `sections`.
- **Files:** `backend/checklist_registry.py`, `frontend/src/lib/checklistMeta.ts`

None of these are architectural changes — both are data the UI genuinely
needs to satisfy requirements already in the task spec; neither adds new
persisted state or changes the `PATCH /api/entry/{id}/checklist-item` contract.

### Auto-fixed Issues (Rule 1 — bug)

**3. Fixed default-open section/sub-group state never reflecting flagged items**
- **Found during:** Initial vitest run — a `useState(() => {...})` initializer
  for `openSections`/`openGroups` computed default-openness from `sections`,
  but `sections` is empty on first render (registry loads async), so the
  initializer always froze every section/group closed.
- **Fix:** Default openness is now a pure function
  (`defaultSectionOpen`/`defaultGroupOpen`) computed fresh from the current
  `sections` on every render; `openSections`/`openGroups` state only records
  explicit user toggles that override that default.
- **Files:** `frontend/src/components/shortlist/ChecklistCard.tsx`
- **Commit:** `d7121cd`

## Known Stubs

None — every item resolves to a real registry entry with a non-empty
`label_ru`; no placeholder/mock data flows into the rendered UI.

## Threat Flags

None — `GET /api/checklist-registry` is a read-only, unauthenticated,
static-content endpoint (same trust boundary as the existing `/api/settings`
GET). No new write paths, auth paths, or schema changes at a trust boundary.

## Registry item count by section

| Section | Items | Sub-groups |
|---|---|---|
| evaluation (Оценка по критериям) | 13 | — (flat) |
| ask_seller (Вопросы продавцу) | 16 | — (flat) |
| request_docs (Документы к запросу) | 20 | — (flat; 11 docs_request + 9 kinnistusraamat) |
| onsite (На месте) | 47 | 5 (first_impression 2, structure 11, onsite_systems 12, common_areas 15, neighborhood 7) |
| **Total** | **96** | |

AI-fillable: 12 of 96 items.

## Test counts

| Layer | Count | Result |
|---|---|---|
| Backend pytest (full suite) | 215 passed, 3 skipped | green |
| Backend pytest (new `test_checklist_registry.py`) | 13 | green |
| Frontend vitest (full suite) | 159 | green |
| Frontend vitest (new `ChecklistCard.test.tsx`) | 21 | green |
| Playwright `qa-shortlist.spec.ts` (chromium-desktop + webkit-mobile) | 21 passed, 2 pre-existing unrelated failures | see deferred-items.md |

## Deferred Items

See `260808-vae-deferred-items.md` — 8 pre-existing e2e failures found while
running the full Playwright suite, none touching files this task modified
(NegotiationCard gating copy, mobile-snapshots layout assertions, feedback
flow, inbox flow). Logged, not fixed, per scope boundary.

## Self-Check: PASSED

- FOUND: backend/checklist_registry.py
- FOUND: backend/routes_checklist.py
- FOUND: backend/tests/test_checklist_registry.py
- FOUND: frontend/src/components/shortlist/ChecklistCard.tsx
- FOUND: frontend/src/lib/checklistMeta.ts
- FOUND: frontend/src/test/ChecklistCard.test.tsx
- FOUND: frontend/e2e/qa-shortlist.spec.ts
- FOUND commit 860e48b (feat(backend): checklist_registry)
- FOUND commit 0fc90f4 (feat(backend): AI evaluator dynamic keys)
- FOUND commit 7f03a63 (feat(backend): /api/checklist-registry endpoint)
- FOUND commit b7a7331 (test(backend): registry structure + legacy migration)
- FOUND commit ff641c8 (feat(frontend): useChecklistRegistry hook + api client)
- FOUND commit d7121cd (feat(frontend): rewrite ChecklistCard)
- FOUND commit f832792 (test(frontend): vitest + playwright)
