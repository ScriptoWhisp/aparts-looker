---
phase: 02-queue-approval-workflow
verified: 2026-07-08T00:00:00Z
status: passed
score: 10/11 must-haves verified
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Browser smoke test — Pending tab end-to-end"
    expected: "Click Pending tab, see ingested listings as cards with photo/score/price; click Approve — card disappears and listing appears in main dossier; click Reject — 4-button reason picker appears; select reason — card disappears from Pending; inspect app_data.json to confirm pending[] empty, properties[] and rejected[] updated correctly"
    why_human: "DOM rendering, tab switching, card visibility, and JSON state on the VPS cannot be verified by grep or test runner. Plan 02-03 Task 3 checkpoint:human-verify was reached but the 'approved' signal was not captured in the SUMMARY — the SUMMARY status field is 'checkpoint', not 'complete'."
  - test: "Browser smoke test — Draft email button + /send lifecycle"
    expected: "Approve a listing via Telegram or web UI; open dossier detail view; 'Draft email' button visible only when contact_email and draft_body are present; click it — status reads 'Draft saved to Gmail Drafts. Send it from Telegram: /send <id>'; Gmail Drafts shows the draft; send /send <id> in Telegram — email delivered to inbox; agent_state.json pending_drafts does not contain the id"
    why_human: "Gmail IMAP/SMTP integration, Telegram interactive flow, and cross-surface state cleanup cannot be verified by grep or unit test. Plan 02-04 Task 3 checkpoint:human-verify was pre-approved without documentation of the human completing the 10-step smoke test."
---

# Phase 02: Queue & Approval Workflow — Verification Report

**Phase Goal:** Add a pending queue layer between listing ingestion and the main dossier. Every newly evaluated listing lands in PENDING state first. Daniel reviews via compact Telegram card (photo + score + inline buttons) or the web UI "Pending" tab, then approves (→ dossier) or rejects (→ archived with reason). On approval, an email to the mäkler can be drafted on Daniel's explicit request — not automatically.
**Verified:** 2026-07-08T00:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A freshly ingested listing lands in pending[], NOT in properties[] | VERIFIED | `test_ingest_writes_to_pending` PASSED; `ingest_handler.py:109` calls `data_store.add_to_pending(pending_entry)`; `add_property_if_new` call is absent from executable code |
| 2 | `load_app_data()` back-fills pending:[] and rejected:[] on old JSON (zero-downtime migration) | VERIFIED | `data_store.py:88-89` — two `setdefault` calls; `DEFAULT_APP_DATA` at line 49-50 includes both keys; `test_data_model_keys` PASSED |
| 3 | `ingest_handler.process_ingest_batch()` calls `data_store.add_to_pending()` instead of `add_property_if_new()` | VERIFIED | `ingest_handler.py:109` — `data_store.add_to_pending(pending_entry)` is the only data-store write for new listings; no `add_property_if_new` call in executable code; `from gmail_client import create_draft` and `should_draft` block absent |
| 4 | Telegram card for pending listings has photo + score + 3 inline buttons (Approve/Reject/More) | VERIFIED | `telegram_client.send_pending_card` at line 139 produces caption per D-06, 3-button inline_keyboard; `test_send_pending_card_buttons` PASSED with real assertions |
| 5 | Tapping [Approve] in Telegram moves the pending entry to properties[] within one scheduler tick | VERIFIED | `agent_job.process_pending_action` at line 49-56 calls `data_store.approve_listing`; `approve_listing` atomically moves entry; `test_callback_query_parse_approve` PASSED; `test_approve_moves_listing` PASSED |
| 6 | Tapping [Reject] in Telegram shows 4-button reason picker; selecting a reason moves entry to rejected[] with reason | VERIFIED | Two-step flow: "reject" action calls `send_rejection_prompt`; "rr:" action calls `data_store.reject_listing`; `test_callback_query_parse_reason` PASSED; `test_reject_with_reason` PASSED |
| 7 | Every callback_query is acknowledged with answerCallbackQuery before any state change | VERIFIED | `agent_job.py:41` — `answer_callback_query(cq.get("id", ""))` called before the try block that performs state transitions; verified in `test_callback_query_parse_approve` |
| 8 | callback_query from any chat_id other than TELEGRAM_CHAT_ID is ignored | VERIFIED | `agent_job.py:36-38` — chat-id guard returns early with log.warning; tested by inline sub-assertion in `test_callback_query_parse_approve` (wrong chat_id → approve_listing NOT called) |
| 9 | GET /api/pending returns pending[], POST /api/pending/<id>/approve returns 404 on double-tap, POST /api/pending/<id>/reject whitelists reason | VERIFIED | `main.py:87-109` — 3 endpoints above StaticFiles mount; `test_get_pending_endpoint`, `test_approve_moves_listing`, `test_double_approve`, `test_reject_with_reason` all PASSED |
| 10 | POST /api/draft/<id> calls gmail_client.create_draft and queues into pending_drafts; returns {"ok": false, "reason": "no_email"} on empty contact_email; returns 404 if not found | VERIFIED | `main.py:134-170` — endpoint exists, wired to `data_store.get_approved_listing` and `gmail_client.create_draft`; `test_draft_endpoint` PASSED with all 3 sub-assertions |
| 11 | Web UI Pending tab renders listings and supports Approve/Reject with reason picker; Draft email button appears in dossier detail view conditional on contact_email + draft_body | PRESENT — browser behavior unverified | `index.html` contains `showPendingTab`, `renderPendingTab`, `approvePending`, `showRejectPicker`, `rejectPending` (Plan 03 IIFE) and `draftEmail`, `injectDraftButton`, MutationObserver (Plan 04 IIFE); all wired to live /api/pending/* and /api/draft/ endpoints; DOM rendering and tab behavior require human verification |

**Score:** 10/11 truths verified (1 present, browser behavior unverified)

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `app/data_store.py` DEFAULT_APP_DATA with pending:[] and rejected:[] | D-01 schema | VERIFIED | Lines 49-50 — both keys present |
| `app/data_store.py` add_to_pending(entry:dict)->bool | D-05 duplicate guard | VERIFIED | Line 109 — dedup checks both pending[] and properties[] |
| `app/data_store.py` load_pending()->list | Thread-safe read | VERIFIED | Line 123 — under _lock |
| `app/data_store.py` _pending_to_property(entry:dict)->dict | Carries draft fields per D-15 | VERIFIED | Lines 169-205 — copies draft_body, contact_email, draft_subject |
| `app/data_store.py` approve_listing(listing_id)->bool | Atomic move pending→properties | VERIFIED | Lines 129-140 |
| `app/data_store.py` reject_listing(listing_id, reason)->bool | Atomic move pending→rejected, whitelist | VERIFIED | Lines 143-166 |
| `app/data_store.py` get_approved_listing(listing_id)->Optional[dict] | Draft endpoint lookup | VERIFIED | Lines 208-216 |
| `app/ingest_handler.py` pending_entry dict with evaluation fields + queued_at | D-02 schema | VERIFIED | Lines 95-108 — all required fields present |
| `app/telegram_client.py` send_pending_card() | D-06 caption + 3-button keyboard | VERIFIED | Lines 139-197 |
| `app/telegram_client.py` edit_card_resolved() | D-08 caption update + keyboard removal | VERIFIED | Lines 200-217 |
| `app/telegram_client.py` send_rejection_prompt() | D-11 4-reason picker | VERIFIED | Lines 220-245 |
| `app/telegram_client.py` answer_callback_query() | RESEARCH Pitfall 1 acknowledgement | VERIFIED | Lines 248-260 |
| `app/config.py` WEB_BASE_URL constant | D-07 deep-link base | VERIFIED | Line 31 |
| `app/agent_job.py` process_pending_action(cq) | D-09 dispatcher | VERIFIED | Lines 22-77 |
| `app/agent_job.py` process_send_commands() iterates callback_query | D-09 wiring | VERIFIED | Lines 100-104 |
| `app/main.py` GET /api/pending | QUEUE-03 | VERIFIED | Line 87-89 |
| `app/main.py` POST /api/pending/{id}/approve | QUEUE-04 | VERIFIED | Lines 92-97 |
| `app/main.py` POST /api/pending/{id}/reject | QUEUE-05 | VERIFIED | Lines 100-109 |
| `app/main.py` POST /api/draft/{listing_id} | QUEUE-06 | VERIFIED | Lines 134-170 |
| `app/main.py` imports gmail_client at module scope | Draft endpoint dependency | VERIFIED | Line 20 |
| `app/static/index.html` Pending tab JS (showPendingTab, renderPendingTab, approvePending, rejectPending) | QUEUE-03 web UI | PRESENT (wired) | Lines 1063-1269; no innerHTML for user data in Plan 03 region (awk grep: 0) |
| `app/static/index.html` Draft email button (draftEmail, injectDraftButton, MutationObserver) | QUEUE-06 web trigger | PRESENT (wired) | Lines 1275-end of script; no innerHTML in Plan 04 region (awk grep: 0) |
| `app/tests/test_pending.py` 11 tests all passing | Test coverage | VERIFIED | All 11 PASSED on Python 3.9 runtime (confirmed by test run) |
| `app/tests/conftest.py` mock_send_pending_card + mock_gmail fixtures | Test infrastructure | VERIFIED | Used by test_ingest_writes_to_pending and test_draft_endpoint |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| ingest_handler.process_ingest_batch | data_store.add_to_pending | Direct call at line 109 | WIRED | Also patches tg_message_id/tg_chat_id after send_pending_card |
| ingest_handler.process_ingest_batch | telegram_client.send_pending_card | Lazy getattr at line 114 — resolves to real function now that Plan 02-02 shipped | WIRED | Gracefully returns (None, None) if attribute missing |
| telegram_client.send_pending_card | Returns (message_id, chat_id) | Stored in pending entry (tg_message_id, tg_chat_id) for later editMessageCaption targeting | WIRED | Lines 117-126 ingest_handler |
| agent_job.process_send_commands | process_pending_action | Lines 100-104 — iterates updates, dispatches callback_query events | WIRED | Second loop after /send command loop |
| process_pending_action | data_store.approve_listing / reject_listing | Direct calls at lines 51, 69 | WIRED | chat-id guard and whitelist clamp applied first |
| data_store.approve_listing | _pending_to_property | Called at line 138 — converts pending entry to dossier shape | WIRED | Carries draft_body, contact_email, draft_subject per D-15 |
| GET /api/pending | data_store.load_pending() | main.py line 89 | WIRED | Same RLock as ingest write path |
| POST /api/pending/{id}/approve | data_store.approve_listing | main.py line 94 | WIRED | 404 on False return (double-tap guard) |
| POST /api/pending/{id}/reject | data_store.reject_listing | main.py line 106 | WIRED | Server-side whitelist clamp before call |
| POST /api/draft/{id} | data_store.get_approved_listing | main.py line 147 | WIRED | Looks up contact_email/draft_body/draft_subject from properties[] |
| POST /api/draft/{id} | gmail_client.create_draft | main.py line 158 | WIRED | Pre-computed draft_body — no live AI call (D-15) |
| POST /api/draft/{id} | data_store pending_drafts | main.py lines 160-168 | WIRED | Feeds the /send <id> QUEUE-07 path |
| index.html Pending tab | /api/pending/* endpoints | fetch("/api/pending"), fetch("/api/pending/<id>/approve"), fetch("/api/pending/<id>/reject") | WIRED | Lines 1088, 1211, 1249 |
| index.html Draft button | /api/draft/<id> endpoint | fetch("/api/draft/<id>") | WIRED | Line 1292 |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| All 11 test_pending.py tests pass | `python3 -m pytest app/tests/test_pending.py -v` | 11 passed, 0 failed, 0 xfailed | PASS |
| Full test suite (24 tests) passes | `python3 -m pytest app/tests/ -v` | 24 passed, 0 failed | PASS |
| ingest_handler imports absent (add_property_if_new, gmail_client create_draft, should_draft) | grep on executable code | Only appear in module docstring, not in executable code | PASS |
| callback_data count in telegram_client | grep -c "callback_data" | 7 occurrences (Approve, Reject, + 4 rejection reasons, + 2 in send_rejection_prompt) | PASS |
| No innerHTML in Plan 03 pending tab region | awk scoped grep | 0 occurrences | PASS |
| No innerHTML in Plan 04 draft button region | awk scoped grep | 0 occurrences | PASS |
| No TBD/FIXME/XXX debt markers in modified files | grep on 5 key files | 0 occurrences | PASS |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| QUEUE-01 | 02-01 | Ingested listings enter PENDING queue, not main dossier | SATISFIED | test_ingest_writes_to_pending PASSED; ingest_handler calls add_to_pending |
| QUEUE-02 | 02-02 | Telegram card compact: score + verdict + price/m² + inline buttons | SATISFIED | send_pending_card D-06 caption format; test_send_pending_card_buttons PASSED |
| QUEUE-03 | 02-03 | Web app "Pending" tab with full listing detail + approve/reject | SATISFIED (code) | GET /api/pending wired; index.html Pending tab JS present; browser rendering human-needed |
| QUEUE-04 | 02-02, 02-03 | Approving moves listing to main dossier | SATISFIED | test_approve_moves_listing PASSED; test_callback_query_parse_approve PASSED; test_double_approve (404 on repeat) PASSED |
| QUEUE-05 | 02-02, 02-03 | Rejecting archives with reason | SATISFIED | test_reject_with_reason PASSED; test_callback_query_parse_reason PASSED; whitelist enforced in both data_store and agent_job (defense in depth) |
| QUEUE-06 | 02-04 | AI drafts email on explicit user action, not automatically | SATISFIED | test_draft_endpoint PASSED; create_draft_endpoint only fires on POST /api/draft/{id} — no auto-trigger on approval; D-13 enforced |
| QUEUE-07 | 02-04 | Email draft requires explicit /send <id> before sending | SATISFIED | test_send_command_after_draft PASSED; pending_drafts populated by draft endpoint, consumed by process_send_commands |

All 7 requirements QUEUE-01 through QUEUE-07 are satisfied at the implementation level. Browser-level verification for QUEUE-03 (Pending tab UI) and the cross-surface QUEUE-06/QUEUE-07 lifecycle remains pending human smoke test.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `app/static/index.html` | 622, 768, 814, 997, 1010 | innerHTML for rendering state and template strings | INFO | Pre-existing, outside Phase 2 scope. Phase 2 code regions (Plan 03 and Plan 04) use textContent exclusively (0 innerHTML in both awk-scoped checks). |

No TBD, FIXME, or XXX markers found in any Phase 2 modified files.

---

### Human Verification Required

#### 1. Pending Tab Browser Flow (Plan 02-03 checkpoint gate)

**Test:** Deploy the container, open the dossier in a browser, ingest a synthetic listing via POST /api/ingest, click the "Pending" tab in the nav.
**Expected:** Listing appears as a card with photo, score/100, price/m², title; click Approve — card disappears from Pending and listing appears in main dossier tab; ingest a second listing, click Reject — 4-button reason picker appears; click Price — card disappears from Pending, does NOT appear in main dossier; inspect app_data.json (via docker exec) — pending[] empty, properties[] has first listing, rejected[] has second with rejection_reason=="price".
**Why human:** DOM rendering, tab activation, CSS visual state, card layout, and optimistic UI re-render after POST cannot be verified by grep or pytest. Plan 02-03 SUMMARY status is "checkpoint" (not "complete") — the Task 3 human-verify gate was reached but no "approved" signal is recorded in the SUMMARY.

#### 2. Draft Email + /send Cross-Surface Lifecycle (Plan 02-04 checkpoint gate)

**Test:** After approving a listing that has a contact_email (either via Telegram tap or web Approve button), open the dossier detail view for that listing.
**Expected:** "Draft email" button is visible for listings with both contact_email and draft_body; clicking it shows "Draft saved to Gmail Drafts. Send it from Telegram: /send <id>"; Gmail Drafts folder contains the draft addressed to the agent; sending "/send <id>" in Telegram dispatches the email; agent_state.json pending_drafts no longer contains that id after successful send; for a listing with empty contact_email, the "Draft email" button is NOT rendered.
**Why human:** Gmail IMAP APPEND and SMTP send require real credentials and a live mail server. Telegram interactive flow (typing /send <id> and receiving the confirmation) requires a live bot. Plan 02-04 Task 3 was described as "pre-approved by user before executor spawn" — this is not the same as a human completing the 10-step smoke test on the deployed container.

---

### Gaps Summary

No gaps blocking automated goal achievement. All 11 tests pass. All 7 requirements have implementation evidence. The two human-verification items above are browser/email/Telegram runtime behaviors that automated checks cannot reach. The phase codebase is complete and correctly wired.

The single open item is the two unrecorded human smoke tests: Plan 02-03's Task 3 checkpoint:human-verify gate and Plan 02-04's Task 3 checkpoint:human-verify gate. Both SUMMARY files describe these as reached/pre-approved but neither contains the verifier's explicit "approved" confirmation after walking the 10-step deployed smoke test.

---

_Verified: 2026-07-08_
_Verifier: Claude (gsd-verifier)_
