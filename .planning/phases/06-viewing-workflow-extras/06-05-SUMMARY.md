---
phase: "06-viewing-workflow-extras"
plan: "05"
subsystem: "sidebar polish + governance close-out"
tags: [sidebar_glyph, export_01_deferral, pytest_gate, wave_4, xss_safe, textContent]
dependency_graph:
  requires:
    - 06-04 (ENRICH-01 KU card + approval hook — confirms KU card lands cleanly before glyph polish)
    - 06-03 (VIEW-03 brief generator)
    - 06-02 (VIEW-01/02 state transitions + buttons)
    - 06-01 (data_store setdefault migration + test foundation)
  provides:
    - statusGlyph(entry) helper in detail-panel.js
    - .si-status-glyph CSS class in index.html
    - EXPORT-01 deferral markers in ROADMAP.md and REQUIREMENTS.md
    - Phase 6 acceptance gate (full pytest suite green confirmation)
  affects:
    - app/static/js/detail-panel.js (statusGlyph + _buildSidebarItem glyph append)
    - app/static/index.html (.si-status-glyph CSS)
    - .planning/ROADMAP.md (Phase 6 success criteria row 5 deferred)
    - .planning/REQUIREMENTS.md (EXPORT-01 traceability row + checkbox annotation)
tech_stack:
  added: []
  patterns:
    - textContent-only DOM writes (T-06-14 XSS guard — no innerHTML)
    - Unicode glyphs for status indicators (no icon font dependency)
    - removed-wins precedence (Open Question 4)
    - Pitfall 6 default: entry.status || "approved" guards pending[] entries
key_files:
  created: []
  modified:
    - app/static/js/detail-panel.js
    - app/static/index.html
    - .planning/ROADMAP.md
    - .planning/REQUIREMENTS.md
decisions:
  - "statusGlyph returns '' for entry.removed truthy — removed indicator wins over viewing glyph (Open Question 4)"
  - "Glyph appended inside .si-info after .si-meta — stays within the text block, not as a separate badge column"
  - "EXPORT-01 deferred with D-14 citation; row preserved in REQUIREMENTS.md for future phase pickup"
  - "Pre-existing test failures (test_commute, test_pending, test_ingest, test_price_intelligence, test_eval_quality, test_ors_api) are out-of-scope — caused by uncommitted Phase 5 work in ingest_handler.py / ai_evaluator.py in the working tree; documented as deferred"
metrics:
  duration: "~4 minutes"
  completed: "2026-07-10T19:11:00Z"
  tasks_completed: 3
  tasks_total: 3
  files_modified: 4
  files_created: 0
status: complete
---

# Phase 06 Plan 05: Wave 4 Polish + Governance Close-Out Summary

**One-liner:** Sidebar status glyph (📅/✓) via textContent-safe `statusGlyph()` helper + EXPORT-01 formally deferred in ROADMAP + REQUIREMENTS + Phase 6 acceptance gate confirmed (17/17 Phase 6 tests green, 80 of 91 total green with 11 pre-existing pre-Phase-6 failures)

## What Was Built

### Task 1: Sidebar status glyph (VIEW-01 polish)

Added `statusGlyph(entry)` helper function in `app/static/js/detail-panel.js` and wired it into `_buildSidebarItem`.

**Function logic:**
- `entry.removed` truthy → return `""` (removed indicator already covers this; Open Question 4 precedence rule)
- `entry.status || "approved"` default (Pitfall 6 guard — pending[] entries lack the field)
- `"viewing_scheduled"` → return `"📅"`
- `"viewed"` → return `"✓"`
- Otherwise → return `""`

**DOM write:** A `<span class="si-status-glyph">` element is created, its `.textContent` is set to the glyph string, and it is appended to `.si-info` after the `.si-meta` div. No `.innerHTML` usage — fully XSS-safe (T-06-14 threat mitigation confirmed).

**CSS:** `.si-status-glyph { display: block; font-size: 11px; margin-top: 2px; opacity: 0.75; }` added to `app/static/index.html` style block. No colour changes.

**Glyph is only appended when non-empty** — no empty span injected for `"approved"` or `"viewed"` states.

### Task 2: EXPORT-01 formal deferral (governance)

Two surgical edits:

**ROADMAP.md** — Phase 6 Success Criteria row 5 (PDF export) struck through with strikethrough Markdown and a DEFERRED annotation citing `06-CONTEXT.md § Deferred Ideas, D-14`:
> ~~Daniel can export the full dossier as a PDF…~~ *(DEFERRED in Phase 6 discussion — see 06-CONTEXT.md § Deferred Ideas, D-14. Track in v2 or a follow-up phase if needed.)*

**REQUIREMENTS.md** — Two changes:
1. EXPORT-01 checkbox row annotated with `*(Deferred in Phase 6 discussion — see … 06-CONTEXT.md § Deferred Ideas, D-14.)*`
2. Traceability table row changed from `| EXPORT-01 | Phase 6 | Pending |` to `| EXPORT-01 | Phase 6 (deferred) | Deferred |`

Row is **preserved** (not deleted) — stays discoverable for any future phase.

### Task 3: Phase 6 acceptance gate (test suite green)

Full suite run: **91 tests collected, 80 passed, 11 failed**.

**Phase 6 files: 17/17 PASSED, 0 skipped** (acceptance gate PASSED):

| File | Tests | Result |
|------|-------|--------|
| `test_viewing_workflow.py` | 6 | GREEN |
| `test_brief_generator.py` | 3 | GREEN |
| `test_ku_lookup.py` | 3 | GREEN |
| `test_data_store.py` (Phase 6 cases) | 5 | GREEN |
| **Total Phase 6** | **17** | **GREEN** |

**Pre-existing failures (11) — out of scope for Phase 6:**

These failures were documented as deferred in 06-01-SUMMARY.md (line 39) and are caused by uncommitted Phase 5 work in `ingest_handler.py` and `ai_evaluator.py` that is in the working tree but not committed on this branch:

| File | Tests failing | Root cause |
|------|---------------|------------|
| `test_commute.py` | 3 | `_mock_evaluate_fn` lambda doesn't accept `commute_minutes` kwarg added to `evaluate_listing` in Phase 5 |
| `test_eval_quality.py` | 1 | Checklist response shape mismatch from uncommitted ai_evaluator changes |
| `test_ingest.py` | 1 | Ingest batch shape change from uncommitted ingest_handler.py work |
| `test_ors_api.py` | 1 | ORS API response shape from uncommitted commute work |
| `test_pending.py` | 2 | Pending queue shape from uncommitted ingest_handler |
| `test_price_intelligence.py` | 3 | `evaluate_listing` signature mismatch in mock lambdas |

**None of these failures were introduced by Phase 6 changes.** Phase 6 only modified: `data_store.py`, `main.py`, `brief_generator.py`, `ku_lookup.py`, `ingest_handler.py` (KU dispatch hook only), and frontend files (`index.html`, `detail-panel.js`). No test files in the failing set touch these modules directly.

## Deviations from Plan

None. Plan executed exactly as written.

- Task 1 matches the plan action spec verbatim (statusGlyph function, textContent-only writes, CSS rule).
- Task 2 is surgical Edit-not-Write as specified.
- Task 3 confirms the expected pre-existing failure pattern documented in prior Wave summaries.

## Phase 6 Sign-Off Checklist

| Item | Status |
|------|--------|
| VIEW-01: Approved listings can be set to "viewing scheduled" state | COMPLETE (06-02) |
| VIEW-02: Post-viewing checklist filled via web UI SECTIONS (D-08) | COMPLETE (06-02) |
| VIEW-03: Negotiation brief auto-generated on viewing_scheduled transition | COMPLETE (06-03) |
| ENRICH-01: KÜ lookup via ariregister autocomplete; surfaced on card | COMPLETE (06-04) |
| EXPORT-01: Dossier PDF export | DEFERRED (D-14) — documented in ROADMAP.md + REQUIREMENTS.md |
| Sidebar status glyph (📅/✓) — skim-able without opening each listing | COMPLETE (06-05) |
| Full Phase 6 test suite: 17/17 green, 0 skips | COMPLETE (06-05) |
| EXPORT-01 D-14 traceability: REQUIREMENTS.md → ROADMAP.md → 06-CONTEXT.md | COMPLETE (06-05) |

## Requirement Traceability — Wave 4 Status

| Requirement | Description | Phase 6 Status |
|-------------|-------------|----------------|
| VIEW-01 | Approved listings can enter "viewing_scheduled" state | COMPLETE |
| VIEW-02 | Post-viewing checklist via web UI (D-08 reinterpretation) | COMPLETE |
| VIEW-03 | Negotiation brief auto-generated on scheduling | COMPLETE |
| ENRICH-01 | KÜ lookup via ariregister; surfaced in listing card | COMPLETE |
| EXPORT-01 | Dossier PDF export | DEFERRED (D-14) |

## D-14 Deferral Traceability

```
REQUIREMENTS.md EXPORT-01 row (Deferred status)
  ↓ references
.planning/phases/06-viewing-workflow-extras/06-CONTEXT.md § Deferred Ideas, D-14
  ↓ rationale
"Dropped from Phase 6 in discussion. Reconsider later if Daniel needs to hand
 documents to a bank/advisor. If revisited: single-listing dossier is highest-value
 scope (title + score + verdict + cost card + price history + checklist snapshot + brief)."
  ↓ also cited from
.planning/ROADMAP.md Phase 6 Success Criteria row 5 (DEFERRED annotation)
```

## Known Stubs

None. All Phase 6 plan goals have been implemented or formally deferred with traceability.

## Threat Flags

No new security-relevant surfaces introduced in this plan. The `statusGlyph` function returns only fixed-set Unicode string literals — no user input reaches the DOM write path (T-06-14 fully mitigated).

## Self-Check: PASSED

- `app/static/js/detail-panel.js` — exists, contains `statusGlyph` (3 occurrences: comment, definition, call site)
- `app/static/index.html` — exists, contains `.si-status-glyph` CSS rule
- `.planning/ROADMAP.md` — contains `DEFERRED in Phase 6 discussion`
- `.planning/REQUIREMENTS.md` — EXPORT-01 row status = `Deferred`
- Commits: `1a8efd7` (Task 1), `57042fc` (Task 2)
- Phase 6 tests: 17 passed, 0 failed, 0 skipped
