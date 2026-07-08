---
phase: 02-queue-approval-workflow
plan: "02"
subsystem: telegram-approval-loop
tags:
  - telegram
  - inline-keyboard
  - callback-query
  - approval-workflow
  - QUEUE-02
  - QUEUE-04
  - QUEUE-05
requires:
  - 02-01  # pending queue foundation (add_to_pending, _pending_to_property, test scaffold)
provides:
  - send-pending-card-fn     # callable by ingest_handler to surface listings in Telegram
  - approve-listing-fn       # callable by 02-03 web API endpoints
  - reject-listing-fn        # callable by 02-03 web API endpoints
  - callback-query-dispatcher # process_pending_action wired into process_send_commands
affects:
  - config                   # WEB_BASE_URL env var added
  - telegram_client          # 4 new functions
  - data_store               # 2 new state-transition functions
  - agent_job                # dispatcher + process_send_commands extended
  - kv_listing_parser        # image_count field added (Rule 1 auto-fix)
tech-stack:
  added:
    - Telegram editMessageCaption API  # resolves card caption after approve/reject
    - Telegram answerCallbackQuery API # dismisses loading spinner before state change
    - Telegram inline_keyboard reply_markup  # 3-button approval card + 4-button reason picker
  patterns:
    - compact callback_data format "approve:<id>", "reject:<id>", "rr:<reason>:<id>"
    - two-step rejection flow (reject shows picker, rr: executes state change)
    - chat_id guard on inbound callback_query (T-02-CQ-SPOOF)
    - whitelist reason clamping in both dispatcher and data_store (T-02-CQ-REASON defense in depth)
    - answer_callback_query before state change (RESEARCH Pitfall 1)
key-files:
  created: []
  modified:
    - app/config.py
    - app/telegram_client.py
    - app/data_store.py
    - app/agent_job.py
    - app/kv_listing_parser.py
    - app/tests/test_pending.py
decisions:
  - "send_pending_card uses compact D-06 caption format: score/100 | verdict | price EUR · price_per_sqm/m² | rooms rooms · area m² | title"
  - "Two-step rejection flow: [Reject] shows reason picker via send_rejection_prompt; reject_listing only called on rr:<reason>:<id> (D-10)"
  - "approve_listing/reject_listing live in data_store.py following add_property_if_new precedent"
  - "process_pending_action uses lazy imports from telegram_client to avoid circular dependency at module load"
  - "Rule 1 auto-fix: image_count: int = 0 added to Listing dataclass (referenced in ingest_handler but missing from dataclass)"
metrics:
  duration: "~5 minutes"
  completed: "2026-07-08"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 6
  lines_added: ~362
  lines_removed: ~10
status: complete
---

# Phase 02 Plan 02: Telegram Approval Loop — Summary

**One-liner:** Wired Telegram inline keyboard approval flow — send_pending_card sends 3-button photo cards, process_pending_action dispatches approve/reject/rr callbacks with chat_id guard, and approve_listing/reject_listing atomically move entries between queue states.

## What Was Built

### app/config.py
- Added `WEB_BASE_URL = os.environ.get("WEB_BASE_URL", "")` after `INGEST_TOKEN` (matching empty-string default pattern)

### app/telegram_client.py (+140 lines)
Four new functions added after `extract_send_commands`:

1. **`send_pending_card(listing, evaluation) -> tuple[int|None, int|None]`**
   - Caption format per D-06: `{score}/100 | {verdict} | {price:,} EUR · {price_per_sqm:,}/m² | {rooms} rooms · {area} m² | {title or url}` (U+00B7 middle-dot separator)
   - 3-button inline keyboard row: Approve (callback_data), Reject (callback_data), More (url with WEB_BASE_URL)
   - Sends sendPhoto if image_url is set, falls back to sendMessage
   - Returns (message_id, chat_id) parsed from Telegram response (for later editMessageCaption targeting)
   - Gracefully returns (None, None) on missing tokens or RequestException

2. **`edit_card_resolved(cq, resolved_caption) -> None`**
   - POSTs to editMessageCaption with reply_markup={"inline_keyboard": []} to remove buttons
   - try/except (RequestException, KeyError): pass — stale/deleted messages silently ignored (T-02-STALE-MSG)

3. **`send_rejection_prompt(cq, listing_id) -> None`**
   - Edits card to "Why reject? Pick a reason:" with 4-button row
   - callback_data format: rr:price:<id>, rr:location:<id>, rr:condition:<id>, rr:other:<id>
   - All values fit comfortably within Telegram's 64-byte callback_data limit (~30 chars max)

4. **`answer_callback_query(callback_query_id, text='') -> None`**
   - POSTs to answerCallbackQuery with timeout=10 (shorter than send calls per RESEARCH Pitfall 1)

### app/data_store.py (+44 lines)
Two new functions added after `load_pending`:

1. **`approve_listing(listing_id) -> bool`**
   - Atomic move under _lock: finds entry in pending[], removes it, appends _pending_to_property(entry) to properties[]
   - Returns False if not found (idempotency guard for double-tap, T-02-DOUBLE-TAP)

2. **`reject_listing(listing_id, reason) -> bool`**
   - Whitelist-clamps reason to {price, location, condition, other} -> "other" (T-02-CQ-REASON defense)
   - Atomic move under _lock: removes from pending[], appends to rejected[] with rejection_reason + rejected_at ISO UTC timestamp
   - Returns False if not found

### app/agent_job.py (+56 lines)
- Added `from config import TELEGRAM_CHAT_ID` to imports
- New **`process_pending_action(cq) -> None`** dispatcher function:
  - Chat-id guard first: `str(chat_id) != str(TELEGRAM_CHAT_ID)` -> log.warning, return (T-02-CQ-SPOOF)
  - Calls `answer_callback_query` immediately before any state change (RESEARCH Pitfall 1)
  - Parses compact callback_data with `split(":", 2)`: approve / reject (shows picker) / rr (executes rejection)
  - "reject" action calls `send_rejection_prompt` only — two-step flow per D-10
  - "rr" action applies secondary reason whitelist clamp + calls `reject_listing`
  - Entire dispatch body in try/except Exception: log.exception (never-raise)
- Extended **`process_send_commands`** to iterate updates a second time dispatching callback_query events

### app/kv_listing_parser.py (1 line, Rule 1 fix)
- Added `image_count: int = 0` to `Listing` dataclass
- Field was referenced in `ingest_handler.py:82` but absent from the dataclass, causing AttributeError

### app/tests/test_pending.py (+85 lines)
- `test_send_pending_card_buttons`: promoted from xfail — monkeypatches requests.post, verifies sendPhoto call, 3-button keyboard structure, button texts, callback_data values, and (42, -100) return value
- `test_callback_query_parse_approve`: promoted from xfail — verifies approve dispatch, caption starts with "✅ Approved", answer_callback_query called, plus inline chat_id guard sub-assertion (wrong chat_id = approve_listing NOT called)
- `test_callback_query_parse_reason`: promoted from xfail — verifies rr:price dispatch, reject_listing("1234567", "price") called, caption starts with "❌ Rejected: Price"

## Test Results

```
18 passed, 6 xfailed, 0 failures
```

| Test | Status |
|------|--------|
| test_data_model_keys | PASS |
| test_ingest_writes_to_pending | PASS |
| test_send_pending_card_buttons | PASS (was xfail) |
| test_callback_query_parse_approve | PASS (was xfail) |
| test_callback_query_parse_reason | PASS (was xfail) |
| test_get_pending_endpoint | xfail (02-03) |
| test_approve_moves_listing | xfail (02-03) |
| test_double_approve | xfail (02-03) |
| test_reject_with_reason | xfail (02-03) |
| test_draft_endpoint | xfail (02-04) |
| test_send_command_after_draft | xfail (02-04) |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Added image_count field to Listing dataclass**
- **Found during:** Task 1 test run
- **Issue:** `ingest_handler.py:82` references `listing.image_count` but the `Listing` dataclass in `kv_listing_parser.py` had no `image_count` field — causes AttributeError in `test_ingest_writes_to_pending`
- **Fix:** Added `image_count: int = 0` after `image_url` field in the Listing dataclass
- **Files modified:** `app/kv_listing_parser.py`
- **Commit:** 63abede (included in Task 1 commit)

No other deviations — plan executed as written.

## Security Verification

All threat mitigations from the threat register implemented:

| Threat ID | Mitigation | Verified |
|-----------|-----------|---------|
| T-02-CQ-SPOOF | chat_id guard in process_pending_action (log.warning + return) | test_callback_query_parse_approve inline sub-assertion |
| T-02-CQ-REASON | Whitelist clamp in BOTH agent_job and data_store.reject_listing (defense in depth) | Code inspection |
| T-02-CQ-INJ | Static compact callback_data format; listing.id from ingest schema | Code inspection |
| T-02-DOUBLE-TAP | approve_listing/reject_listing return False when not in pending[] | Logic in data_store functions |
| T-02-STALE-MSG | try/except (RequestException, KeyError) in edit_card_resolved | Code inspection |
| T-02-SC | No new packages introduced | requirements.txt unchanged |

## Caption Formatting Notes

- None-value handling for numeric fields: `listing.price_eur or 0`, `listing.price_per_sqm or 0` — formats as 0 when None (not "None")
- None-value handling for rooms/area: `listing.rooms if listing.rooms is not None else "?"` — shows "?" when unset (distinct from 0)
- Caption uses Python `:,` format specifier for thousands separator on price values

## Telegram callback_data Byte Counts

Format `approve:<kv_id>` for 8-digit listing ID = 15 bytes. Format `rr:condition:<kv_id>` = 23 bytes. Both well within the 64-byte Telegram limit. No issues observed.

## Known Stubs

None — all plan artifacts are fully wired. `send_pending_card` is callable from `ingest_handler` (lazy import via `getattr` pattern from Plan 02-01 resolves to the real function). `approve_listing`/`reject_listing` are production-ready for Plan 02-03's web API endpoints.

## Threat Flags

No new security surface beyond what was planned in the threat model.

## Self-Check: PASSED

- app/config.py — WEB_BASE_URL present
- app/telegram_client.py — 4 new functions present (send_pending_card, edit_card_resolved, send_rejection_prompt, answer_callback_query)
- app/data_store.py — approve_listing and reject_listing present
- app/agent_job.py — process_pending_action present
- Commits: 63abede (Task 1), 0ddf62f (Task 2)
- Tests: 18 passed, 6 xfailed, 0 failures
