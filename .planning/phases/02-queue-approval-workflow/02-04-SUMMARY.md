---
phase: 02-queue-approval-workflow
plan: "04"
subsystem: email-draft-opt-in
tags:
  - gmail-imap
  - email-drafting
  - dossier-integration
  - fastapi
  - vanilla-js
dependencies:
  requires:
    - 02-01
    - 02-03
  provides:
    - POST /api/draft/{listing_id}
    - data_store.get_approved_listing
    - draft-email-button-ui
  affects:
    - app/data_store.py
    - app/main.py
    - app/static/index.html
    - app/tests/test_pending.py
    - app/kv_listing_parser.py
    - app/telegram_client.py
tech_stack:
  added: []
  patterns:
    - Optional[] type hints for Python 3.9 compatibility
    - MutationObserver for post-render DOM injection (avoids touching existing IIFE)
    - from __future__ import annotations for deferred type evaluation
key_files:
  created: []
  modified:
    - app/data_store.py
    - app/main.py
    - app/static/index.html
    - app/tests/test_pending.py
    - app/kv_listing_parser.py
    - app/telegram_client.py
decisions:
  - Used Optional[dict] in data_store.get_approved_listing for Python 3.9 compatibility
  - Added from __future__ import annotations to kv_listing_parser.py and telegram_client.py to fix pre-existing Python 3.9 incompatibility with | union syntax
  - Injected Draft email button via MutationObserver IIFE (third script block) rather than modifying existing renderMain string concat directly, preserving the existing first IIFE boundary
  - Task 3 human-verify checkpoint pre-approved by user before execution
metrics:
  duration: "~35 minutes"
  completed: "2026-07-08"
  task_count: 3
  file_count: 6
status: complete
---

# Phase 02 Plan 04: Email Draft Opt-In Summary

**One-liner:** POST /api/draft/{id} endpoint with get_approved_listing helper + MutationObserver-injected "Draft email" button in the dossier, backed by 11/11 green tests (zero xfail remaining).

## What Was Built

### Task 1 — data_store.get_approved_listing + POST /api/draft endpoint (committed: 4750649)

**New in `app/data_store.py`:**

- `get_approved_listing(listing_id: str) -> Optional[dict]` — thread-safe lookup in `properties[]` by id. Returns `None` if not found. Used exclusively by the draft endpoint to retrieve `contact_email`, `draft_body`, and `draft_subject` that were carried over from `pending[]` at approval time (`_pending_to_property`, D-15).

**New in `app/main.py`:**

- `import gmail_client` at module scope (line 20)
- `POST /api/draft/{listing_id}` endpoint (`create_draft_endpoint`):
  - Returns 404 if listing not in `properties[]`
  - Returns `{"ok": false, "reason": "no_email"}` if `contact_email` is empty (RESEARCH Risk 5)
  - Calls `gmail_client.create_draft(contact_email, subject, body)` using pre-computed evaluation fields
  - On success: writes `pending_drafts[listing_id]` to `agent_state` for later `/send <id>` dispatch (QUEUE-07 unchanged)

**Tests promoted from xfail to real assertions:**

| Test | Sub-assertions |
|------|---------------|
| `test_draft_endpoint` | (1) happy path: ok=True + gmail called + pending_drafts populated; (2) no-email: ok=False reason=no_email; (3) unknown id: 404 |
| `test_send_command_after_draft` | seeds pending_drafts, monkeypatches Telegram + Gmail, calls process_send_commands, asserts send_email called and draft consumed |

**Final test count: 11/11 in test_pending.py, zero xfail markers.**

### Task 2 — Draft email button in dossier approved-listing detail view (committed: 1c79391)

**Changes to `app/static/index.html`** (98 lines added, 1 modified):

Modified `renderMain` (first IIFE) to add:
- `data-listing-id`, `data-has-email`, `data-has-draft` attributes to the `.head-actions` div so the Phase 02 Plan 04 IIFE can detect draft eligibility
- `<div id="draft-email-slot"></div>` inside `.head-actions` as an injection target

**New third `<script>` block** — `Phase 02 Plan 04 -- draft-email opt-in button`:

| Function | Purpose |
|----------|---------|
| `draftEmail(listingId, statusEl, btn)` | POSTs to /api/draft/<id>, updates status span via textContent |
| `injectDraftButton()` | Finds #draft-email-slot in DOM, checks data attributes, builds button via createElement |
| MutationObserver on #main-content | Fires injectDraftButton on every dossier render cycle |
| `startObserver()` | Polls until #main-content is available, then attaches observer |

**Status messages (all via textContent, no innerHTML):**
- `ok=true`: "Draft saved to Gmail Drafts. Send it from Telegram: /send `<id>`"
- `reason=no_email`: "No agent email available — use kv.ee contact form"
- Network error: "Failed to create draft — retry"

**XSS mitigation verified:** scoped `awk` grep returns 0 `innerHTML` occurrences in Phase 02 Plan 04 region.

### Task 3 — Human end-to-end smoke test (pre-approved)

The `checkpoint:human-verify` gate (Task 3) was pre-approved by the user before executor spawn. No file changes. The 10-step smoke test (ingest → Telegram approve → dossier Draft button → Gmail draft → /send → email delivered + no-email fallback + state cleanup) is documented in the plan for the user to run against the deployed container.

## Files Changed

| File | LOC added | LOC removed | Notes |
|------|-----------|-------------|-------|
| `app/data_store.py` | +14 | 0 | `get_approved_listing` + `Optional` import |
| `app/main.py` | +44 | +3 | `import gmail_client`, `create_draft_endpoint`, `Optional` import, `from __future__ import annotations` |
| `app/tests/test_pending.py` | +89 | -6 | 2 xfail stubs replaced with real tests |
| `app/static/index.html` | +98 | -1 | Phase 02 Plan 04 script block + head-actions slot |
| `app/kv_listing_parser.py` | +1 | 0 | `from __future__ import annotations` (Rule 1 auto-fix) |
| `app/telegram_client.py` | +1 | 0 | `from __future__ import annotations` (Rule 1 auto-fix) |

## Requirements Traceability: QUEUE-01 through QUEUE-07

| Requirement | Description | Tests | Status |
|-------------|-------------|-------|--------|
| QUEUE-01 | Ingested listings write to pending[], not properties[] | test_ingest_writes_to_pending, test_data_model_keys | PASS |
| QUEUE-02 | Telegram card has Approve/Reject/More buttons | test_send_pending_card_buttons | PASS |
| QUEUE-03 | GET /api/pending returns pending queue | test_get_pending_endpoint | PASS |
| QUEUE-04 | Approve moves listing to properties[] (idempotent) | test_approve_moves_listing, test_double_approve, test_callback_query_parse_approve | PASS |
| QUEUE-05 | Reject moves to rejected[] with reason (whitelisted) | test_reject_with_reason, test_callback_query_parse_reason | PASS |
| QUEUE-06 | AI drafts email on explicit user action (not automatic) | test_draft_endpoint | PASS |
| QUEUE-07 | Actual email send requires explicit /send <id> Telegram command | test_send_command_after_draft | PASS |

**Final test suite:** 24 tests, 24 passed, 0 failed, 0 xfailed, 0 skipped.

## Commits

| Task | Hash | Message |
|------|------|---------|
| Task 1 | 4750649 | feat(02-04): add get_approved_listing + POST /api/draft endpoint + all tests green |
| Task 2 | 1c79391 | feat(02-04): add Draft email button to dossier approved-listing detail view |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Python 3.9 incompatibility with `|` union type syntax in kv_listing_parser.py and telegram_client.py**

- **Found during:** Task 1 — test run immediately failed with `TypeError: unsupported operand type(s) for |: 'type' and 'NoneType'`
- **Issue:** `kv_listing_parser.py:91` defined `fetch_listing(... session: requests.Session | None ...)` and `telegram_client.py:137` used `tuple[int | None, int | None]`. These use Python 3.10+ union syntax which fails at function definition time on Python 3.9 (the local test environment).
- **Fix:** Added `from __future__ import annotations` to both files, making all annotations lazily-evaluated strings (PEP 563). This is safe and backport-compatible.
- **Files modified:** `app/kv_listing_parser.py`, `app/telegram_client.py`
- **Commit:** 4750649

**2. [Rule 1 - Bug] main.py `HTTPAuthorizationCredentials | None` incompatible with FastAPI/pydantic on Python 3.9**

- **Found during:** Task 1 — even with `from __future__ import annotations`, FastAPI's pydantic dependency evaluates the string annotation `'HTTPAuthorizationCredentials | None'` at route registration time and fails with `TypeError: Unable to evaluate type annotation`
- **Fix:** Changed to `Optional[HTTPAuthorizationCredentials]` (with `from typing import Optional` import), which pydantic handles correctly on Python 3.9.
- **Files modified:** `app/main.py`
- **Commit:** 4750649

**3. [Rule 2 - Missing feature] MutationObserver approach for Draft button injection**

- **Found during:** Task 2 — the existing `renderMain` uses `el.innerHTML = head + overview + notes + sectionsHtml` to render the full dossier. After this call, the DOM is built. The Draft email button needs to be injected after render without touching the existing IIFE's large closure.
- **Fix:** Added `data-listing-id`, `data-has-email`, `data-has-draft` attributes to `.head-actions` and `#draft-email-slot` placeholder in the existing `renderMain` string concat (minimal change, 2 lines). A third IIFE with `MutationObserver` on `#main-content` injects the button via `createElement`/`textContent` without touching the existing IIFE.
- **Files modified:** `app/static/index.html`
- **Commit:** 1c79391

## Threat Model Compliance

| Threat | Status |
|--------|--------|
| T-02-DRAFT-AUTO | Mitigated — draft only on explicit button click (D-13), actual send requires /send <id> (QUEUE-07) |
| T-02-DRAFT-INJ | Mitigated — listing_id used only as dict lookup key; draft_body/contact_email come from server-side evaluation |
| T-02-DRAFT-XSS | Mitigated — textContent only in Phase 02 Plan 04 region (verified by scoped awk grep returning 0) |
| T-02-EMAIL-LEAK | Accepted — only "no_email" boolean returned to browser, not the address |
| T-02-SC | Mitigated — no new packages added |

## Known Stubs

None. The `POST /api/draft/{listing_id}` endpoint is fully wired: it reads pre-computed `draft_body`/`contact_email` from `properties[]`, calls `gmail_client.create_draft` (Phase 1 implementation, unchanged), and populates `pending_drafts` for the existing `/send <id>` Telegram command.

## Phase 3 Hand-off Notes

- `draft_body` reused from Phase 2 evaluation time (no live AI call on button click, per D-15). Phase 3 calibrated scoring will affect the content of `draft_body` generated during ingest/evaluation, but will not change the draft creation plumbing.
- The `QUEUE-06 → QUEUE-07` chain (Draft button → /send <id>) is fully operational and requires no changes in Phase 3.
- Legacy `DEFAULT_PROPERTIES` entries (hardcoded dossier properties from before Phase 2) have no `contact_email` or `draft_body` fields, so the Draft email button is correctly hidden for them (the `data-has-email="0"` and `data-has-draft="0"` attributes prevent injection).

## Self-Check: PASSED

- `4750649` exists in git log: confirmed
- `1c79391` exists in git log: confirmed
- `app/data_store.py` has `get_approved_listing` function: confirmed
- `app/main.py` has `POST /api/draft/{listing_id}` endpoint: confirmed
- `app/main.py` imports `gmail_client` at module scope: confirmed
- `app/static/index.html` contains `draftEmail` function: confirmed
- `app/static/index.html` contains `Phase 02 Plan 04` comment: confirmed
- `app/static/index.html` contains `/api/draft/` reference: confirmed
- Zero `innerHTML` in Phase 02 Plan 04 region (awk scoped grep): confirmed
- All 11 tests in test_pending.py pass (zero xfail): confirmed
- All 24 tests in app/tests/ pass: confirmed
- STATE.md and ROADMAP.md NOT modified (orchestrator owns those): confirmed
