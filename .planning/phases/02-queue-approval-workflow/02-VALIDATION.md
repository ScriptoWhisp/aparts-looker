---
phase: 2
slug: queue-approval-workflow
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-08
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest 8.x + httpx (FastAPI TestClient) — already installed |
| **Config file** | none — tests auto-discovered in `app/tests/` |
| **Quick run command** | `python3.11 -m pytest app/tests/ -x -q` |
| **Full suite command** | `python3.11 -m pytest app/tests/ -v` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `python3.11 -m pytest app/tests/ -x -q`
- **After every plan wave:** Run `python3.11 -m pytest app/tests/ -v`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** ~10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 2-01-01 | 01 | 1 | QUEUE-01 | — | Ingest writes to pending[], not properties[] | integration | `pytest app/tests/test_pending.py::test_ingest_writes_to_pending -x -q` | ❌ W0 | ⬜ pending |
| 2-01-02 | 01 | 1 | QUEUE-01 | — | DEFAULT_APP_DATA includes pending[] and rejected[] | unit | `pytest app/tests/test_pending.py::test_data_model_keys -x -q` | ❌ W0 | ⬜ pending |
| 2-02-01 | 02 | 1 | QUEUE-02 | — | sendPhoto called with 3-button inline keyboard | unit | `pytest app/tests/test_pending.py::test_send_pending_card_buttons -x -q` | ❌ W0 | ⬜ pending |
| 2-02-02 | 02 | 1 | QUEUE-02 | — | callback_query approve action extracted correctly | unit | `pytest app/tests/test_pending.py::test_callback_query_parse_approve -x -q` | ❌ W0 | ⬜ pending |
| 2-02-03 | 02 | 1 | QUEUE-05 | — | callback_query reject_reason extracted correctly | unit | `pytest app/tests/test_pending.py::test_callback_query_parse_reason -x -q` | ❌ W0 | ⬜ pending |
| 2-03-01 | 03 | 2 | QUEUE-03 | — | GET /api/pending returns pending items only | integration | `pytest app/tests/test_pending.py::test_get_pending_endpoint -x -q` | ❌ W0 | ⬜ pending |
| 2-03-02 | 03 | 2 | QUEUE-04 | — | POST /api/pending/<id>/approve moves item to properties[] | integration | `pytest app/tests/test_pending.py::test_approve_moves_listing -x -q` | ❌ W0 | ⬜ pending |
| 2-03-03 | 03 | 2 | QUEUE-04 | — | Second approve returns 404 (double-tap guard) | integration | `pytest app/tests/test_pending.py::test_double_approve -x -q` | ❌ W0 | ⬜ pending |
| 2-03-04 | 03 | 2 | QUEUE-05 | — | POST /api/pending/<id>/reject archives with reason in rejected[] | integration | `pytest app/tests/test_pending.py::test_reject_with_reason -x -q` | ❌ W0 | ⬜ pending |
| 2-04-01 | 04 | 2 | QUEUE-06 | — | POST /api/draft/<id> calls create_draft with draft_body | integration | `pytest app/tests/test_pending.py::test_draft_endpoint -x -q` | ❌ W0 | ⬜ pending |
| 2-04-02 | 04 | 2 | QUEUE-07 | — | /send <id> sends email from pending_drafts | unit | `pytest app/tests/test_pending.py::test_send_command_after_draft -x -q` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `app/tests/test_pending.py` — stubs for all QUEUE-01 through QUEUE-07 tests (new file)
- [ ] `app/tests/conftest.py` update — add `mock_gmail` fixture (monkeypatches `gmail_client.create_draft`) and `mock_answer_callback` fixture (patches `telegram_client.answer_callback_query`)

*Existing infrastructure (pytest + httpx + FastAPI TestClient) already installed from Phase 1 Wave 0.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Inline keyboard renders in Telegram with 3 buttons | QUEUE-02 | Requires real Telegram client | Send a test card to the bot; confirm [Approve] [Reject] [More] buttons appear |
| editMessageCaption updates card and removes buttons after tap | QUEUE-02/04 | Requires real Telegram client + live state | Tap [Approve] on a real card; confirm caption updates to "✅ Approved — date" and buttons disappear |
| answerCallbackQuery removes Telegram loading spinner | QUEUE-02 | Requires real Telegram client | Observe no spinner or error after button tap |
| Gmail draft appears in Gmail web UI after Draft email button click | QUEUE-06 | Requires real Gmail credentials + deployed stack | Click "Draft email" in web UI; open Gmail Drafts folder and confirm email with correct subject/body |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 10s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** 2026-07-08 — plan-checker PASS (all 13 dimensions, 11/11 tests automated)
