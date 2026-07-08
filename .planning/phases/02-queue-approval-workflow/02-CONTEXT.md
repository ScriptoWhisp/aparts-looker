# Phase 2: Queue & Approval Workflow - Context

**Gathered:** 2026-07-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Add a pending queue layer between listing ingestion and the main dossier. Every newly evaluated listing lands in a PENDING state first. Daniel reviews via compact Telegram card (photo + score + inline buttons) or the web UI "Pending" tab, then approves (→ dossier) or rejects (→ archived with reason). On approval, an email to the mäkler can be drafted on Daniel's explicit request — not automatically.

Out of scope for Phase 2:
- AI evaluation quality improvements (Phase 3)
- Reply-reading + follow-up drafting as a personal assistant (reading mäkler responses, drafting conversation replies) — future phase
- Price history / longevity tracking (Phase 3)
- Additional scraper sources (Phase 4)

</domain>

<decisions>
## Implementation Decisions

### Pending Queue Data Model
- **D-01:** `pending[]` and `rejected[]` lists are added to `app_data.json` alongside the existing `properties[]` list. Same file, same `data_store._lock`. No new JSON file.
- **D-02:** A pending listing entry carries the full `Listing` dataclass fields **plus** the evaluation result: `score`, `verdict`, `strengths`, `concerns`, `draft_body`, and a `queued_at` timestamp.
- **D-03:** `ingest_handler.process_ingest_batch()` writes to `pending[]` directly after `evaluate_listing()`, under `data_store._lock`. Replaces the current `add_property_if_new()` call for new listings.
- **D-04 (Claude):** A `rejected[]` entry carries the same listing fields + evaluation + `rejection_reason` (string enum) + `rejected_at` timestamp. Mirrors the pending entry structure.

### State Machine
- **D-05:** Three terminal/active states for a listing: `pending` (in pending[]) → `approved` (in properties[]) or `rejected` (in rejected[]). Rejection is **permanent** — no un-reject path.

### Telegram Approval Mechanics
- **D-06:** Compact Telegram card uses `sendPhoto`: listing photo as image, caption contains `score/100 | verdict | price EUR + price/m² | rooms/area m² | address`. Three inline keyboard buttons: **[Approve] [Reject] [More]**.
- **D-07:** Tapping **[More]** sends the VPS web UI URL for that specific pending listing (e.g., `https://vps/pending/<id>`). Not a second Telegram message — a direct link to the web UI.
- **D-08:** After approve or reject, call `editMessageCaption` to update the card caption to show the action taken (e.g., `✅ Approved — 2026-07-08` or `❌ Rejected: Price — 2026-07-08`) and remove the inline keyboard. Prevents double-tap.
- **D-09:** The bot must respond to `callback_query` events (Telegram Bot API), not just text messages. `process_send_commands()` in `agent_job.py` must be extended to poll and dispatch `callback_query` updates.

### Rejection Reason Collection
- **D-10:** After tapping **[Reject]**, the bot sends a follow-up message: "Why reject?" with inline buttons for a quick reason pick.
- **D-11 (Claude):** Reason options: **Price / Location / Condition / Other** — 4 choices, covers main rejection triggers from Daniel's buyer profile.
- **D-12:** Rejection is permanent — no "Restore" or un-reject path in Telegram or web UI.

### Email Draft Flow (Opt-In)
- **D-13:** Email drafting is **not automatic on approval**. Approval just moves listing from `pending[]` to `properties[]`.
- **D-14:** Daniel triggers a draft explicitly via a **"Draft email" button** in the web UI dossier/approved listing view. This calls a new backend endpoint (`POST /api/draft/<id>`).
- **D-15 (Claude):** The draft uses the `draft_body` pre-computed during evaluation (stored in the pending entry, carried over to the approved listing on move). No extra AI call at request time — instant.
- **D-16:** After creating the Gmail draft, Daniel sends it via the existing `/send <id>` Telegram command (QUEUE-07 unchanged).

### Claude's Discretion
- Rejection reason options: **Price / Location / Condition / Other** (D-11)
- `draft_body` reused from evaluation — no re-generation at draft request time (D-15)
- Direct `ingest_handler` → `pending[]` write (no intermediary handler) (D-03)
- `rejected[]` entry structure mirrors `pending[]` with added reason/date fields (D-04)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `app/requirements.txt` — VPS dependencies; DO NOT add unnecessary packages
- `.planning/REQUIREMENTS.md` QUEUE-01 through QUEUE-07 — the 7 requirements this phase must satisfy

### Existing VPS Code to Modify
- `app/data_store.py` — `load_app_data()`, `save_app_data()`, `DEFAULT_APP_DATA` (add pending/rejected keys); `data_store._lock` (used for all pending writes)
- `app/ingest_handler.py` — `process_ingest_batch()` — change `add_property_if_new()` → `add_to_pending()`; `handle_heartbeat()` unchanged
- `app/agent_job.py` — `process_send_commands()` must be extended to handle `callback_query` events for inline button taps; add `process_pending_action()` dispatcher
- `app/main.py` — add `GET /api/pending`, `POST /api/pending/<id>/approve`, `POST /api/pending/<id>/reject`, `POST /api/draft/<id>` endpoints
- `app/telegram_client.py` — add `send_pending_card()` (sendPhoto + inline keyboard), `edit_card_resolved()` (editMessageCaption), `send_rejection_prompt()` (follow-up message with reason buttons), `answer_callback_query()` (required by Bot API)
- `app/config.py` — add `WEB_BASE_URL` env var (used to construct the [More] link)

### Phase 1 Canonical Context (already shipped)
- `.planning/phases/01-scraper-architecture-split/01-CONTEXT.md` — ingest endpoint design, data_store patterns, heartbeat fields

### Architecture Reference
- `.planning/codebase/ARCHITECTURE.md` — current system layers; pending queue sits in the Agent Layer between ingest and notification
- `.planning/codebase/CONVENTIONS.md` — naming patterns, never-raise error handling, RLock usage

No external specs referenced during discussion.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `telegram_client.send_photo(chat_id, photo_url, caption)` — foundation for the compact card; extend to accept `reply_markup` (inline keyboard)
- `telegram_client.send_message(chat_id, text)` — reuse for rejection reason prompt and error messages
- `gmail_client.create_draft(to, subject, body)` — reuse as-is for the "Draft email" button flow
- `data_store.load_app_data()` / `save_app_data()` + `_lock` — reuse for pending/rejected reads and writes; same lock governs all
- `agent_job.process_send_commands()` — existing `getUpdates` poller; extend to handle `callback_query` alongside text `message` updates
- `ai_evaluator.evaluate_listing()` — already returns `draft_body`; no change needed, just ensure pending entry stores it

### Established Patterns
- **Never-raise:** All handlers catch exceptions, log, and continue — new pending/approve/reject handlers must follow this
- **Env-var config:** `WEB_BASE_URL` follows the same pattern as `INGEST_TOKEN`, `TELEGRAM_BOT_TOKEN`
- **Thread-safe JSON:** `with data_store._lock:` wraps full load → modify → save for all pending/approved/rejected writes
- **Boolean return:** `approve_listing(id)` → `bool`, `reject_listing(id, reason)` → `bool` (matches `add_property_if_new()` pattern)
- **Telegram Bot API `getUpdates`:** Current polling window already handles text messages; adding `allowed_updates=["message","callback_query"]` to `getUpdates` call enables button events

### Integration Points
- `app/ingest_handler.py:process_ingest_batch()` — the write point for new pending listings (replaces `add_property_if_new()`)
- `app/main.py` — 4 new REST endpoints for web UI and the draft trigger
- `app/agent_job.py:process_send_commands()` — the entry point for all Telegram-driven actions including button taps
- `app/telegram_client.py` — all card sending and editing functions added here; no business logic
- Web UI static HTML — add "Pending" tab to `app/static/` frontend (existing tab-based structure)

</code_context>

<specifics>
## Specific Ideas

- **Card caption format:** `85/100 | "Great price/m² in sought-after area" | 189,000 EUR · 2,890/m² | 3 rooms · 65 m² | Tammsaare tee 57`
- **Resolved card format (approved):** `✅ Approved — 2026-07-08`
- **Resolved card format (rejected):** `❌ Rejected: Price — 2026-07-08`
- **[More] link format:** `https://{WEB_BASE_URL}/pending/{listing_id}` — routes to the web UI pending detail view
- **Rejection prompt message:** `"Why reject? Pick a reason:"` followed by inline buttons `[Price] [Location] [Condition] [Other]`
- **Draft email trigger:** "Draft email" button in the approved listing detail view in web UI — not in Telegram
- **Callback query data format:** JSON string `{"action":"approve","id":"<listing_id>"}` or `{"action":"reject","id":"<listing_id>"}` or `{"action":"more","id":"<listing_id>"}` or `{"action":"reject_reason","id":"<listing_id>","reason":"price"}`

</specifics>

<deferred>
## Deferred Ideas

- **Mäkler reply assistant** — reading mäkler email responses and drafting follow-up replies acting as a personal assistant / conversation thread manager. This is a richer agentic flow that goes beyond initial outreach. Future phase (Phase 6 or beyond).

</deferred>

---

*Phase: 2-Queue & Approval Workflow*
*Context gathered: 2026-07-08*
