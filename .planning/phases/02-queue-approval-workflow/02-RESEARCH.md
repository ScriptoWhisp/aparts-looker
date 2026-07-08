# Phase 02: Queue & Approval Workflow - Research

**Researched:** 2026-07-08
**Domain:** Telegram Bot API inline keyboards, FastAPI endpoint patterns, JSON state machine, plain-JS tab UI
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** `pending[]` and `rejected[]` lists added to `app_data.json`, same file, same `data_store._lock`. No new JSON file.
- **D-02:** Pending entry carries full `Listing` dataclass fields plus evaluation result: `score`, `verdict`, `strengths`, `concerns`, `draft_body`, and a `queued_at` timestamp.
- **D-03:** `ingest_handler.process_ingest_batch()` writes to `pending[]` directly after `evaluate_listing()`, replacing `add_property_if_new()` for new listings.
- **D-04 (Claude):** A `rejected[]` entry carries the same listing fields + evaluation + `rejection_reason` + `rejected_at` timestamp.
- **D-05:** Three states: `pending` → `approved` (properties[]) or `rejected` (rejected[]). Rejection is permanent.
- **D-06:** Compact Telegram card uses `sendPhoto`: listing photo as image, caption = `score/100 | verdict | price EUR + price/m² | rooms/area | address`. Three inline keyboard buttons: [Approve] [Reject] [More].
- **D-07:** [More] button sends the VPS web UI URL (`https://{WEB_BASE_URL}/pending/{listing_id}`) — not a second Telegram message.
- **D-08:** After approve or reject, call `editMessageCaption` to update the card caption and remove the inline keyboard.
- **D-09:** Bot must respond to `callback_query` events; `process_send_commands()` in `agent_job.py` must be extended to poll and dispatch `callback_query` updates.
- **D-10:** After tapping [Reject], bot sends a follow-up message: "Why reject?" with inline buttons for reason.
- **D-11 (Claude):** Reason options: Price / Location / Condition / Other.
- **D-12:** Rejection is permanent — no un-reject path.
- **D-13:** Email drafting is NOT automatic on approval; approval only moves listing to properties[].
- **D-14:** Draft triggered via "Draft email" button in web UI calling `POST /api/draft/<id>`.
- **D-15 (Claude):** Draft uses `draft_body` pre-computed at evaluation time — no extra AI call at request time.
- **D-16:** After creating Gmail draft, Daniel sends it via existing `/send <id>` Telegram command.

### Claude's Discretion
- Rejection reason options: Price / Location / Condition / Other (D-11)
- `draft_body` reused from evaluation — no re-generation at draft request time (D-15)
- Direct `ingest_handler` → `pending[]` write (D-03)
- `rejected[]` entry structure mirrors `pending[]` with added reason/date fields (D-04)

### Deferred Ideas (OUT OF SCOPE)
- Mäkler reply assistant — reading mäkler email responses and drafting follow-up replies. Future phase.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| QUEUE-01 | New scraped listings enter a PENDING queue state, not the main dossier list | D-03 write path in ingest_handler; data_store pending[] |
| QUEUE-02 | Telegram card for pending listings is compact: score + 1-line verdict + price/m² + inline buttons | sendPhoto + InlineKeyboardMarkup; D-06 caption format |
| QUEUE-03 | Web app shows a "Pending" tab with full listing detail and approve/reject actions | GET /api/pending + plain-JS tab addition to index.html |
| QUEUE-04 | Approving a listing moves it to the main dossier list | POST /api/pending/<id>/approve; atomic pending→properties move |
| QUEUE-05 | Rejecting a listing archives it with a reason | POST /api/pending/<id>/reject; callback_query reason flow |
| QUEUE-06 | On approval, AI drafts an outreach email to the mäkler (not automatic) | POST /api/draft/<id>; gmail_client.create_draft reuse |
| QUEUE-07 | Email draft requires Daniel's explicit `/send <id>` approval before sending | Existing agent_job.process_send_commands; pending_drafts in agent_state |
</phase_requirements>

---

## Summary

Phase 02 adds a three-state lifecycle (pending → approved | rejected) between listing ingestion and the main dossier. The technical scope is narrow and well-contained: three Python modules get new functions, one module gets a control-flow branch, one static HTML file gets a tab, and four FastAPI endpoints are added. No new pip packages are required — all primitives (requests, JSON, threading.RLock, FastAPI, httpx TestClient) are already in requirements.txt.

The highest-complexity piece is the Telegram `callback_query` dispatch loop. Telegram delivers button taps as a separate update type from text messages. The existing `get_new_updates()` poller does not pass `allowed_updates`, so it already receives all update types — but `extract_send_commands()` only looks at `update["message"]`. A new dispatcher branch must check `update.get("callback_query")` in the same loop and route to `process_pending_action()`. The `answerCallbackQuery` call (using the callback query's `id` field) must happen promptly after the button tap is received or Telegram displays an indefinite loading spinner on the button.

The data model change is safe: `load_app_data()` already uses `data.setdefault()` for every key, so adding `pending` and `rejected` to `DEFAULT_APP_DATA` is a zero-downtime migration — old JSON files without those keys just get empty lists on first load.

**Primary recommendation:** Implement in three logical groups — (1) data model + data_store functions, (2) ingest_handler write path + telegram_client card functions, (3) agent_job callback dispatcher + FastAPI endpoints + web UI tab. Each group is independently testable before the next.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Pending queue state machine | API / Backend (data_store) | — | State lives in JSON on VPS; all reads/writes under _lock |
| Telegram card + inline keyboard | API / Backend (telegram_client) | — | Bot API calls made from VPS server process |
| callback_query dispatch | API / Backend (agent_job) | — | Polling loop runs in VPS scheduler tick |
| Approve / reject REST endpoints | API / Backend (main.py) | — | FastAPI routes consumed by web UI JS |
| Pending tab UI | Frontend / Static | — | Plain-JS fetch added to existing index.html |
| Gmail draft trigger | API / Backend (gmail_client) | — | IMAP call on VPS; no client-side involvement |

---

## Telegram Inline Keyboard & Callback Handling

### sendPhoto with InlineKeyboardMarkup

`sendPhoto` accepts an optional `reply_markup` parameter. The value must be a JSON-serialized `InlineKeyboardMarkup` object, which is a dict with a single key `inline_keyboard` whose value is a list of rows, each row being a list of `InlineKeyboardButton` dicts.

An `InlineKeyboardButton` for callback actions requires exactly two keys: `text` (display label) and `callback_data` (1–64 bytes of arbitrary string sent back to the bot when tapped).

For the [More] button, use `url` instead of `callback_data` — Telegram opens the URL in the system browser without sending a `callback_query` to the bot at all. [CITED: core.telegram.org/bots/api#inlinekeyboardbutton]

```python
# Source: Telegram Bot API docs (core.telegram.org/bots/api#inlinekeyboardmarkup)
reply_markup = {
    "inline_keyboard": [[
        {"text": "Approve", "callback_data": '{"action":"approve","id":"abc123"}'},
        {"text": "Reject",  "callback_data": '{"action":"reject","id":"abc123"}'},
        {"text": "More",    "url": f"https://{WEB_BASE_URL}/pending/abc123"},
    ]]
}
requests.post(f"{API_BASE}/sendPhoto", json={
    "chat_id": TELEGRAM_CHAT_ID,
    "photo": photo_url,
    "caption": caption_text,
    "parse_mode": "HTML",
    "reply_markup": reply_markup,
}, timeout=15)
```

The response body from `sendPhoto` contains the sent message object under `result`. The planner must extract `result["message_id"]` from this response and store it in the pending entry — it is required by `editMessageCaption` later. [CITED: core.telegram.org/bots/api#sendphoto]

### callback_query Update Structure

When a user taps an inline button with `callback_data`, Telegram delivers an update whose top-level `callback_query` key (not `message`) contains:

```python
update = {
    "update_id": 12345,
    "callback_query": {
        "id": "unique-callback-id",           # REQUIRED for answerCallbackQuery
        "from": {"id": 987, "username": "..."},
        "message": {
            "message_id": 42,                 # REQUIRED for editMessageCaption
            "chat": {"id": -100123456789},    # REQUIRED for editMessageCaption
            ...
        },
        "data": '{"action":"approve","id":"abc123"}'  # the callback_data string
    }
}
```

The bot must call `answerCallbackQuery` with the `callback_query.id` within a reasonable time or Telegram shows an indefinite loading spinner on the button. Best practice is to call it immediately after receiving the update before performing the actual state change. [CITED: core.telegram.org/bots/api#answercallbackquery]

### answerCallbackQuery

```python
# Source: Telegram Bot API docs (core.telegram.org/bots/api#answercallbackquery)
requests.post(f"{API_BASE}/answerCallbackQuery", json={
    "callback_query_id": cq["id"],
    "text": "Done",   # optional brief notification
}, timeout=10)
```

### editMessageCaption

After approve or reject, update the card caption and remove the inline keyboard by passing `reply_markup={}`:

```python
# Source: Telegram Bot API docs (core.telegram.org/bots/api#editmessagecaption)
requests.post(f"{API_BASE}/editMessageCaption", json={
    "chat_id": cq["message"]["chat"]["id"],
    "message_id": cq["message"]["message_id"],
    "caption": "Approved — 2026-07-08",
    "parse_mode": "HTML",
    "reply_markup": {"inline_keyboard": []},   # removes buttons
}, timeout=15)
```

### getUpdates — allowed_updates Parameter

The existing `get_new_updates()` in `telegram_client.py` does not pass `allowed_updates`, which means Telegram sends all update types by default, including `callback_query`. No change to the API call is needed to start receiving button taps — only the Python dispatcher needs a new branch. [ASSUMED — based on Telegram Bot API default behavior; no `allowed_updates` currently in code, confirmed by reading telegram_client.py]

If an explicit allowlist is desired for clarity, pass:
```python
params={"offset": last_update_id + 1, "timeout": 0, "allowed_updates": '["message","callback_query"]'}
```

### Rejection Two-Step Flow

After [Reject] callback_query is received and `answerCallbackQuery` is called:
1. Call `editMessageCaption` to update the original card to `"Pending rejection — pick reason"` with a new inline keyboard of reason buttons.
2. Store the pending listing_id in memory (or embed in the next `callback_data`) so when the reason button is tapped, the bot knows which listing to reject.

The simplest approach is to embed listing_id in the reason button `callback_data` as well:
```python
reason_keyboard = {
    "inline_keyboard": [[
        {"text": "Price",     "callback_data": '{"action":"reject_reason","id":"abc123","reason":"price"}'},
        {"text": "Location",  "callback_data": '{"action":"reject_reason","id":"abc123","reason":"location"}'},
        {"text": "Condition", "callback_data": '{"action":"reject_reason","id":"abc123","reason":"condition"}'},
        {"text": "Other",     "callback_data": '{"action":"reject_reason","id":"abc123","reason":"other"}'},
    ]]
}
```
This avoids any in-memory state between the two callback_query updates and is robust to VPS restarts between button taps. The `callback_data` for each reason button is 80–100 chars — within the 1–64 byte limit only if the listing_id is short. If the listing ID is a long slug, consider a short numeric hash. [VERIFIED: Telegram callback_data limit is 1-64 bytes per core.telegram.org/bots/api#inlinekeyboardbutton]

**Pitfall: 64-byte callback_data limit.** The callback_data field is capped at 64 bytes. A JSON payload like `{"action":"reject_reason","id":"abc123","reason":"location"}` is 57 bytes — safe for short IDs. If listing IDs grow longer (e.g., full URL slugs like `"astangu-50b-1-13"` = 15 chars), the JSON string reaches ~65 bytes, which overflows. Use a compact format: `"rr:location:abc123"` (18 bytes) instead of full JSON. Parse with `split(":")`. [ASSUMED — byte count calculated from current listing ID patterns in data_store.py]

### Pitfalls: Callback Query Handling

**Pitfall 1: Not calling answerCallbackQuery.** If you process the action (approve/reject) but forget to call `answerCallbackQuery`, the Telegram client shows a loading spinner indefinitely on the button. This is a silent UX bug. The call must happen even if the action fails — answer first, act second.

**Pitfall 2: Double-tap race.** If Daniel taps [Approve] twice quickly, the bot receives two `callback_query` updates for the same listing_id. The second approve must be a no-op (listing already moved to properties[]). The `approve_listing()` function's boolean return catches this — if it returns `False` (listing not found in pending[]), send a "Already processed" `answerCallbackQuery` notification.

**Pitfall 3: Stale message_id.** If a Telegram message is deleted or the bot is removed from the chat and re-added, `editMessageCaption` will fail with a 400 error. Wrap in try/except and log — never re-raise.

**Pitfall 4: callback_query vs message in the same update.** A single update object can have EITHER `message` OR `callback_query` at the top level, never both. The dispatcher must check for `callback_query` first, then fall back to `message`. The existing `extract_send_commands()` only reads `update.get("message", {})` and will silently ignore button taps — this is correct existing behavior that needs extension, not a bug to fix.

---

## FastAPI Pending Queue Endpoints

### New Endpoints Required

All four endpoints follow the existing pattern in `main.py`: no auth guard (the dossier is behind Caddy basic auth at the reverse proxy level), synchronous handlers, and `data_store._lock` acquired inside the handler or delegated to a data_store function.

```python
# Consistent with existing /api/data, /api/check-now patterns
@app.get("/api/pending")
def get_pending():
    return {"pending": data_store.load_pending()}

@app.post("/api/pending/{listing_id}/approve")
def approve(listing_id: str):
    ok = data_store.approve_listing(listing_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Not found in pending queue")
    return {"ok": True}

@app.post("/api/pending/{listing_id}/reject")
async def reject(listing_id: str, request: Request):
    body = await request.json()
    reason = body.get("reason", "other")
    ok = data_store.reject_listing(listing_id, reason)
    if not ok:
        raise HTTPException(status_code=404, detail="Not found in pending queue")
    return {"ok": True}

@app.post("/api/draft/{listing_id}")
def create_draft_endpoint(listing_id: str):
    entry = data_store.get_approved_listing(listing_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Listing not found")
    ok = gmail_client.create_draft(
        entry.get("contact_email", ""),
        entry.get("draft_subject", f"Inquiry about {entry.get('name', listing_id)}"),
        entry.get("draft_body", ""),
    )
    if ok:
        # Store in agent_state.pending_drafts so /send <id> works (QUEUE-07)
        with data_store._lock:
            state = data_store.load_agent_state()
            state["pending_drafts"][listing_id] = {
                "to_email": entry.get("contact_email", ""),
                "subject": entry.get("draft_subject", ""),
                "body": entry.get("draft_body", ""),
                "url": entry.get("url", ""),
            }
            data_store.save_agent_state(state)
    return {"ok": ok}
```

**Note on `POST /api/draft/<id>`**: The endpoint needs to look up the approved listing to get `draft_body` and `contact_email`. These fields must be carried over from the pending entry to the approved entry during the approve operation. The approved listing in `properties[]` is currently the dossier-facing schema (id, name, price, area, etc.) which does NOT include `draft_body`. Two options:
1. Store `draft_body`/`contact_email`/`draft_subject` in the approved `properties[]` entry alongside the dossier fields.
2. Look up `draft_body` from a parallel store.

Option 1 is simpler — the dossier frontend ignores unknown fields (it reads `price`, `area`, etc. by name), so adding `draft_body` to the properties entry is safe and requires no schema migration. [ASSUMED — based on reading the frontend JS which accesses fields by name, not by destructuring the whole object]

### Path Parameter Style

The existing `main.py` has no path parameters yet. FastAPI path parameters use `{name}` in the decorator and the function parameter name must match. This is standard FastAPI behavior — no special configuration needed. [ASSUMED — standard FastAPI behavior; consistent with project's FastAPI>=0.111.0]

---

## Data Model Changes

### DEFAULT_APP_DATA Extension

Current `DEFAULT_APP_DATA` in `data_store.py`:
```python
DEFAULT_APP_DATA = {"properties": DEFAULT_PROPERTIES, "checklists": {}, "settings": {}}
```

Required addition:
```python
DEFAULT_APP_DATA = {
    "properties": DEFAULT_PROPERTIES,
    "checklists": {},
    "settings": {},
    "pending": [],
    "rejected": [],
}
```

`load_app_data()` already calls `data.setdefault()` for each key:
```python
data.setdefault("properties", [])
data.setdefault("checklists", {})
data.setdefault("settings", {})
```

Adding two more `setdefault` calls for `pending` and `rejected` makes the migration zero-downtime: existing `app_data.json` files without those keys silently get empty lists on first read. No migration script needed. [VERIFIED: reading data_store.py lines 75-81 confirms the setdefault pattern]

### Pending Entry Schema

```python
{
    # All Listing dataclass fields serialized to dict (from dataclasses.asdict())
    "id": "abc123",
    "url": "https://www.kv.ee/...",
    "title": "Astangu 50b-1",
    "price_eur": 189000,
    "area_sqm": 65.0,
    "rooms": 3,
    "price_per_sqm": 2907,
    "year_built": 1987,
    "material": "panel",
    "image_url": "https://...",
    "contact_email": "agent@example.ee",
    # ... all other Listing fields
    # Evaluation result:
    "score": 82,
    "verdict": "Great price/m² in sought-after area",
    "strengths": ["Low price/m²", "Parking included"],
    "concerns": ["Panel construction"],
    "draft_subject": "Inquiry about Astangu 50b-1",
    "draft_body": "Dear agent, I am interested in...",
    # Telegram card reference:
    "tg_message_id": 42,          # from sendPhoto response result.message_id
    "tg_chat_id": -100123456789,  # from sendPhoto response result.chat.id
    # Queue metadata:
    "queued_at": "2026-07-08T12:34:56+00:00",
}
```

### Rejected Entry Schema

Mirrors the pending entry, with two extra fields added at rejection time:
```python
{
    # ... all pending entry fields (snapshot at rejection time) ...
    "rejection_reason": "price",   # one of: price, location, condition, other
    "rejected_at": "2026-07-08T13:00:00+00:00",
}
```

### Atomic State Transitions

The approve and reject operations must be atomic: load → find → move → save, all under `data_store._lock`. The `add_property_if_new()` pattern shows the correct template:

```python
def approve_listing(listing_id: str) -> bool:
    with _lock:
        data = load_app_data()
        pending = data.get("pending", [])
        entry = next((e for e in pending if e.get("id") == listing_id), None)
        if entry is None:
            return False
        data["pending"] = [e for e in pending if e.get("id") != listing_id]
        # Build the dossier-facing property dict (include draft fields for /api/draft)
        prop = _pending_to_property(entry)
        data["properties"].append(prop)
        save_app_data(data)
        return True
```

The `load_app_data()` call inside the `with _lock:` block is safe because `_lock` is a `threading.RLock` (re-entrant) — `load_app_data()` itself also acquires `_lock` internally, and RLock allows the same thread to acquire it multiple times. [VERIFIED: data_store.py line 25 `_lock = threading.RLock()`]

### ingest_handler Change

`process_ingest_batch()` currently calls `data_store.add_property_if_new(_listing_to_property(listing, evaluation))` then `send_photo(...)`. Phase 02 replaces this with `data_store.add_to_pending(pending_entry)` then `telegram_client.send_pending_card(listing, evaluation)` which returns `(message_id, chat_id)` to be stored in the pending entry. The `tg_message_id` and `tg_chat_id` are needed for `editMessageCaption` later.

The Listing → pending_entry conversion needs `dataclasses.asdict(listing)` merged with the evaluation result dict. The `LISTING_FIELD_NAMES` frozenset in `ingest_handler.py` already handles schema-safe deserialization — the same approach works for serialization.

---

## Frontend Pending Tab

### Current Frontend Structure

`app/static/index.html` is a single-file SPA (no build step, no framework). The app renders into `<div id="app">` via a self-invoking JS function. Navigation appears to be handled by JavaScript state (not `<a href>` tabs) based on the sidebar `.prop-list` rendering pattern. [VERIFIED: reading index.html lines 246-249, 101-115]

The frontend fetches `/api/data` on load and re-renders from the returned JSON. Adding a Pending tab follows the same pattern: fetch `/api/pending`, render a list of cards, add Approve/Reject buttons that POST to the new endpoints.

### Adding a Tab Without a Framework

Pattern: add a tab toggle button to the sidebar (or a top-level nav area), and conditionally render the main content area based on a JS variable `currentTab`. No routing library needed.

```javascript
// Minimal tab switching pattern — consistent with existing vanilla JS style
var currentTab = 'dossier'; // or 'pending'

function renderApp() {
    if (currentTab === 'pending') {
        renderPendingTab();
    } else {
        renderDossierTab(); // existing render logic
    }
}

function renderPendingTab() {
    fetch('/api/pending')
        .then(r => r.json())
        .then(function(data) {
            var items = data.pending || [];
            // render listing cards with Approve/Reject buttons
        });
}
```

### Pending Tab Card Layout

Each card shows:
- Listing photo thumbnail (if `image_url` exists)
- Score badge, verdict text
- Price, area, rooms, address
- Approve button → `POST /api/pending/<id>/approve`
- Reject button → opens a reason selector (inline div, not modal, consistent with existing CSS patterns)

### Rejection Reason Prompt

On clicking Reject in the web UI, reveal a small inline div with four reason buttons (Price / Location / Condition / Other). On reason selection, POST to `/api/pending/<id>/reject` with body `{"reason":"price"}`. This avoids a modal dependency and is consistent with the existing `.section` accordion pattern in index.html.

### Draft Email Button Location

Per D-14, the "Draft email" button lives in the **approved listing detail view** (the existing dossier). After approval, the listing appears in the main dossier; its detail view gets a new "Draft email" button that calls `POST /api/draft/<id>`. This button is visible only when `contact_email` is non-empty and `draft_body` is non-empty.

---

## Validation Architecture

Nyquist validation is enabled (`workflow.nyquist_validation: true` in config.json). The project uses pytest + httpx TestClient (already installed in requirements.txt: `pytest>=8.0.0`, `httpx>=0.27.0`).

### Test Framework

| Property | Value |
|----------|-------|
| Framework | pytest 8.x + httpx (FastAPI TestClient) |
| Config file | none (pytest discovers tests in app/tests/) |
| Quick run command | `cd app && python -m pytest tests/ -x -q` |
| Full suite command | `cd app && python -m pytest tests/ -v` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | Notes |
|--------|----------|-----------|-------------------|-------|
| QUEUE-01 | Ingest batch writes to pending[], not properties[] | unit/integration | `pytest tests/test_pending.py::test_ingest_writes_to_pending -x` | Mock evaluate_listing; assert data["pending"] has entry, data["properties"] unchanged |
| QUEUE-02 | sendPhoto called with InlineKeyboardMarkup containing 3 buttons | unit | `pytest tests/test_pending.py::test_send_pending_card_buttons -x` | Mock requests.post; assert reply_markup has 3 buttons |
| QUEUE-03 | GET /api/pending returns pending items only | integration | `pytest tests/test_pending.py::test_get_pending_endpoint -x` | Seed pending[]; assert response matches |
| QUEUE-04 | POST /api/pending/<id>/approve moves item pending→properties | integration | `pytest tests/test_pending.py::test_approve_moves_listing -x` | Seed pending[]; POST; assert pending empty, properties has entry |
| QUEUE-05 | POST /api/pending/<id>/reject archives with reason | integration | `pytest tests/test_pending.py::test_reject_with_reason -x` | Seed pending[]; POST {"reason":"price"}; assert rejected[] has entry with reason |
| QUEUE-06 | POST /api/draft/<id> calls create_draft with draft_body | integration | `pytest tests/test_pending.py::test_draft_endpoint -x` | Approve listing first; mock gmail_client.create_draft; assert called |
| QUEUE-07 | /send <id> sends email using pending_drafts from agent_state | unit | `pytest tests/test_pending.py::test_send_command_after_draft -x` | Seed agent_state.pending_drafts; mock send_email; assert called |
| QUEUE-02 | callback_query parse: approve action extracted correctly | unit | `pytest tests/test_pending.py::test_callback_query_parse_approve -x` | Pure unit test on dispatcher logic |
| QUEUE-05 | callback_query parse: reject_reason extracted correctly | unit | `pytest tests/test_pending.py::test_callback_query_parse_reason -x` | Pure unit test |
| QUEUE-04 | approve_listing returns False when listing not in pending | unit | `pytest tests/test_pending.py::test_approve_not_found -x` | Assert returns False, no exception |
| QUEUE-04 | Double-tap: second approve returns 404 | integration | `pytest tests/test_pending.py::test_double_approve -x` | POST twice; second returns 404 |

### What Requires Live Testing (Manual)

| Behavior | Why Not Automated | Manual Verification |
|----------|-------------------|---------------------|
| Inline keyboard renders in Telegram | Needs real Telegram client | Send a test card; confirm 3 buttons appear |
| editMessageCaption updates and removes buttons visually | Needs real Telegram client | Tap Approve; confirm card updates |
| answerCallbackQuery removes loading spinner | Needs real Telegram client | Observe no spinner after tap |
| Gmail draft appears in Gmail web UI | Requires real Gmail credentials | Trigger /api/draft/<id>; check Gmail Drafts folder |

### Wave 0 Gaps

- [ ] `app/tests/test_pending.py` — all QUEUE-01 through QUEUE-07 automated tests (new file)
- [ ] conftest.py update: add `mock_gmail` fixture (monkeypatches `gmail_client.create_draft`) and `mock_answer_callback` fixture (patches `telegram_client.answer_callback_query`)

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Thread-safe JSON state transitions | Custom locking | `data_store._lock` (RLock) already in place | Re-entrant lock handles nested load_app_data() calls safely |
| Telegram inline keyboard serialization | Custom format | Telegram Bot API's `inline_keyboard` JSON structure | Telegram defines the exact schema — any deviation fails silently |
| Email draft construction | Custom MIME builder | `gmail_client.create_draft()` already exists | Re-uses tested IMAP APPEND path with folder fallback |
| Callback data parsing | Custom binary protocol | `json.loads()` on `callback_data` string | JSON is already a project dependency; clean, debuggable |
| Web UI tab routing | SPA router library | JS variable + conditional render (existing pattern) | Project has no build step; adding a router would require npm install |

---

## Key Risks & Pitfalls

### Risk 1: message_id Not Stored → editMessageCaption Impossible

`editMessageCaption` requires the `message_id` of the original card sent by `send_pending_card()`. This `message_id` comes from the `sendPhoto` API response body (`result.message_id`). If `send_pending_card()` does not return this value and the pending entry does not store it, there is no way to update the card after approve/reject.

**Mitigation:** `send_pending_card()` must parse the response JSON and return `(message_id, chat_id)`. The caller in `process_ingest_batch()` must store both in the pending entry. If `sendPhoto` fails and falls back to `send_message()` (existing fallback in `telegram_client.py`), `message_id` is still available in the fallback response — use `editMessageText` instead of `editMessageCaption` in that case, or accept that the card cannot be updated and skip the edit.

### Risk 2: callback_data 64-Byte Limit Overflow

Listing IDs like `"astangu-50b-1-13"` (17 chars) in a JSON payload `{"action":"reject_reason","id":"astangu-50b-1-13","reason":"location"}` is 72 bytes — over the 64-byte limit. Telegram silently rejects the message with a 400 error.

**Mitigation:** Use a compact encoding for callback_data: `"approve:astangu-50b-1-13"` (25 bytes) or `"rr:location:astangu-50b-1-13"` (30 bytes). Parse with `value.split(":", 2)`. If IDs are always numeric (the kv.ee object IDs extracted by `extract_object_id()` are 7-8 digit numbers), full JSON fits comfortably.

**Current ID format check:** `extract_object_id()` in `kv_listing_parser.py` returns a numeric string (e.g., `"1234567"`). However, the `seen_listing_ids` list in agent_state stores `listing.id` which is set by the Listing dataclass. The `id` field format must be verified — if it's always a short numeric string, JSON is fine. If it can be a URL slug, use compact format.

### Risk 3: Ingest Fails After Evaluation but Before Telegram Card

`process_ingest_batch()` currently evaluates then immediately writes to properties[] and sends the Telegram card. Phase 02 changes the order: evaluate → write to pending[] → send Telegram card. If `send_pending_card()` fails after `add_to_pending()` writes to disk, the listing is in pending[] but Daniel gets no Telegram notification.

**Mitigation:** This is acceptable — the listing will still appear in the web UI Pending tab. The never-raise pattern already handles send failures gracefully. Log a warning when `send_pending_card()` fails so the listing can be found via the web UI.

### Risk 4: Rejected listing_id Reappears in Ingest

If the mini PC scraper re-discovers a rejected listing and POSTs it again, `process_ingest_batch()` checks `seen_listing_ids` — and since the listing's ID was added to `seen_listing_ids` on first ingestion, it will be skipped by the dedup check. Rejection is permanent and the dedup prevents re-evaluation. This is the correct behavior. [VERIFIED: ingest_handler.py lines 87-91 confirm dedup uses `seen_listing_ids`]

### Risk 5: Pending Entry Has No contact_email → Draft Button Silently Does Nothing

`POST /api/draft/<id>` calls `create_draft(contact_email, ...)`, which returns `False` immediately if `contact_email` is empty (see `gmail_client.py` line 33). The endpoint must surface this to the frontend so the "Draft email" button shows an appropriate message instead of silently appearing to succeed.

**Mitigation:** Return `{"ok": false, "reason": "no_email"}` when `contact_email` is empty. Frontend shows "No agent email available — use kv.ee contact form" instead of success.

---

## Security Domain

Security enforcement is enabled (`security_enforcement: true`, `security_asvs_level: 1`).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No (single user, Caddy basic auth handles web access) | — |
| V3 Session Management | No | — |
| V4 Access Control | Partial — reject/approve endpoints must not be accessible without Caddy auth | Caddy basic auth at reverse proxy (existing) |
| V5 Input Validation | Yes — reject reason must be validated against allowed values | Whitelist check: `reason in {"price","location","condition","other"}` |
| V6 Cryptography | No | — |

### Known Threat Patterns

| Pattern | STRIDE | Mitigation |
|---------|--------|------------|
| Reject with arbitrary reason string | Tampering | Whitelist validation: only 4 allowed values; default to "other" on unknown |
| callback_data injection (crafted Telegram message) | Tampering | TELEGRAM_CHAT_ID guard: reject callback_query from any chat_id != TELEGRAM_CHAT_ID |
| Approve/reject endpoints reachable without auth | Elevation of Privilege | Caddy basic auth gate (existing); no additional token needed since this is a personal tool |
| draft_body XSS in web UI | Tampering | draft_body rendered as text content, not innerHTML; verify frontend uses textContent |

**callback_query chat_id guard:** The existing `send_message()` and `send_photo()` only send to `TELEGRAM_CHAT_ID`. The `process_send_commands()` dispatch currently does not check that incoming updates come from the expected chat. For the callback_query handler, verify:
```python
if cq.get("message", {}).get("chat", {}).get("id") != int(TELEGRAM_CHAT_ID):
    return  # ignore update from unexpected chat
```

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | getUpdates without allowed_updates receives callback_query by default | Telegram Inline Keyboard | Could miss button taps entirely — fix by adding allowed_updates param |
| A2 | Listing.id is always a short numeric string (7-8 digits) from kv.ee | Key Risks & Pitfalls | callback_data would overflow 64-byte limit with URL slugs |
| A3 | Frontend JS accesses property fields by name, not destructuring, so adding draft_body to properties[] entry is safe | FastAPI Endpoints | Could break dossier rendering if frontend iterates all keys |
| A4 | editMessageCaption with `reply_markup: {"inline_keyboard": []}` removes buttons | Telegram Inline Keyboard | Buttons might persist — alternative is `reply_markup: null` |

---

## Sources

### Primary (HIGH confidence)
- `app/data_store.py` — confirmed _lock is RLock, setdefault pattern, load/save structure
- `app/ingest_handler.py` — confirmed process_ingest_batch flow, add_property_if_new call site
- `app/telegram_client.py` — confirmed send_photo signature, get_new_updates without allowed_updates
- `app/agent_job.py` — confirmed process_send_commands structure, pending_drafts usage
- `app/main.py` — confirmed endpoint patterns, auth dependency, StaticFiles mount
- `app/static/index.html` — confirmed vanilla JS SPA, no framework, CSS variables available
- `app/gmail_client.py` — confirmed create_draft signature and early-return on empty email
- `app/requirements.txt` — confirmed pytest and httpx already installed

### Secondary (MEDIUM confidence)
- [CITED: core.telegram.org/bots/api#inlinekeyboardmarkup] — InlineKeyboardMarkup structure, callback_data 1-64 byte limit
- [CITED: core.telegram.org/bots/api#answercallbackquery] — answerCallbackQuery parameters
- [CITED: core.telegram.org/bots/api#editmessagecaption] — editMessageCaption parameters
- [CITED: core.telegram.org/bots/api#sendphoto] — sendPhoto reply_markup parameter

### Tertiary (LOW confidence / ASSUMED)
- Telegram loading spinner behavior when answerCallbackQuery is delayed — based on community documentation
- callback_data byte count calculations — manual calculation from current listing ID patterns

---

## Confidence Assessment

| Area | Level | Reason |
|------|-------|--------|
| Data model changes | HIGH | Code read directly; setdefault pattern confirmed |
| ingest_handler write path | HIGH | Current call site identified; replacement is mechanical |
| Telegram inline keyboard API | HIGH | Official docs fetched and confirmed |
| callback_query dispatch | HIGH | Existing get_new_updates confirmed; update structure from official docs |
| FastAPI endpoint patterns | HIGH | Existing main.py patterns read directly |
| Frontend tab addition | MEDIUM | JS structure inferred from HTML; full JS not read (file is large) |
| callback_data 64-byte risk | MEDIUM | Calculated from patterns; actual listing ID format needs confirmation |

**Research date:** 2026-07-08
**Valid until:** 2026-08-08 (Telegram Bot API is stable; FastAPI patterns are stable)
