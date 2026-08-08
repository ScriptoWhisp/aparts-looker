# Phase 02: Queue & Approval Workflow - Pattern Map

**Mapped:** 2026-07-08
**Files analyzed:** 9
**Analogs found:** 8 / 9 (pending_handler.py is net-new with no direct analog)

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `app/data_store.py` | store | CRUD | `app/data_store.py` (itself) | self — extend existing |
| `app/ingest_handler.py` | service | request-response | `app/ingest_handler.py` (itself) | self — modify call site |
| `app/main.py` | controller | request-response | `app/main.py` (itself) | self — add endpoints |
| `app/agent_job.py` | service | event-driven | `app/agent_job.py` (itself) | self — add dispatcher branch |
| `app/telegram_client.py` | utility | request-response | `app/telegram_client.py` (itself) | self — add functions |
| `app/pending_handler.py` | service | CRUD | `app/ingest_handler.py` | role-match |
| `app/config.py` | config | — | `app/config.py` (itself) | self — add one constant |
| `app/static/index.html` | component | request-response | existing index.html vanilla-JS | self — add tab |
| `app/tests/test_pending.py` | test | — | `app/tests/test_ingest.py` | exact |

---

## Pattern Assignments

### `app/data_store.py` — extend DEFAULT_APP_DATA, load_app_data, add new functions

**Analog:** `app/data_store.py` itself (lines 44, 75-97)

**DEFAULT_APP_DATA extension pattern** (line 44 — add `pending` and `rejected` keys):
```python
# CURRENT (line 44):
DEFAULT_APP_DATA = {"properties": DEFAULT_PROPERTIES, "checklists": {}, "settings": {}}

# PHASE 02 TARGET:
DEFAULT_APP_DATA = {
    "properties": DEFAULT_PROPERTIES,
    "checklists": {},
    "settings": {},
    "pending": [],
    "rejected": [],
}
```

**setdefault pattern** (lines 75-81 — add two more lines after line 80):
```python
def load_app_data():
    with _lock:
        data = _read_json(config.APP_DATA_FILE, DEFAULT_APP_DATA)
        data.setdefault("properties", [])
        data.setdefault("checklists", {})
        data.setdefault("settings", {})
        # ADD:
        data.setdefault("pending", [])
        data.setdefault("rejected", [])
        return data
```

**Atomic move pattern** — copy `add_property_if_new` (lines 89-97) as the template for all new data_store functions:
```python
def add_property_if_new(prop: dict) -> bool:
    """Used by the agent job. Returns True if it was actually added."""
    with _lock:
        data = load_app_data()
        if any(p.get("id") == prop.get("id") for p in data["properties"]):
            return False
        data["properties"].append(prop)
        save_app_data(data)
        return True
```

**New functions to add** — follow the `add_property_if_new` pattern exactly (bool return, `with _lock:`, load → mutate → save):
```python
def add_to_pending(entry: dict) -> bool:
    """Write a pending listing entry. Returns False if already in pending or properties."""
    with _lock:
        data = load_app_data()
        listing_id = entry.get("id")
        if any(e.get("id") == listing_id for e in data["pending"]):
            return False
        if any(p.get("id") == listing_id for p in data["properties"]):
            return False
        data["pending"].append(entry)
        save_app_data(data)
        return True


def approve_listing(listing_id: str) -> bool:
    """Move listing from pending[] to properties[]. Returns False if not found."""
    with _lock:
        data = load_app_data()
        pending = data.get("pending", [])
        entry = next((e for e in pending if e.get("id") == listing_id), None)
        if entry is None:
            return False
        data["pending"] = [e for e in pending if e.get("id") != listing_id]
        data["properties"].append(_pending_to_property(entry))
        save_app_data(data)
        return True


def reject_listing(listing_id: str, reason: str) -> bool:
    """Move listing from pending[] to rejected[] with reason. Returns False if not found."""
    from datetime import datetime, timezone  # local import avoids circular
    with _lock:
        data = load_app_data()
        pending = data.get("pending", [])
        entry = next((e for e in pending if e.get("id") == listing_id), None)
        if entry is None:
            return False
        data["pending"] = [e for e in pending if e.get("id") != listing_id]
        rejected_entry = dict(entry)
        rejected_entry["rejection_reason"] = reason
        rejected_entry["rejected_at"] = datetime.now(timezone.utc).isoformat()
        data.setdefault("rejected", []).append(rejected_entry)
        save_app_data(data)
        return True


def load_pending() -> list:
    with _lock:
        return load_app_data().get("pending", [])


def get_approved_listing(listing_id: str) -> dict | None:
    with _lock:
        data = load_app_data()
        return next((p for p in data["properties"] if p.get("id") == listing_id), None)
```

**Deviation note:** `_pending_to_property(entry)` is a private helper that builds the dossier-facing dict from a pending entry. It must carry over `draft_body`, `contact_email`, `draft_subject` so `POST /api/draft/<id>` can access them. Model it on `_listing_to_property` in `ingest_handler.py` (lines 35-62) but use the already-serialised dict fields (no dataclass).

---

### `app/ingest_handler.py` — replace add_property_if_new call + Telegram card call

**Analog:** `app/ingest_handler.py` lines 113-124 (the try block inside process_ingest_batch)

**Current call site to replace** (lines 118-124):
```python
data_store.add_property_if_new(_listing_to_property(listing, evaluation))

card_text = format_listing_card(listing, evaluation)
if listing.image_url:
    send_photo(listing.image_url, card_text)
else:
    send_message(card_text)
```

**Phase 02 replacement** — same try/except wrapper (lines 113-141), same never-raise style:
```python
import dataclasses
from datetime import datetime, timezone

# Inside the try block, after evaluate_listing():
pending_entry = {
    **dataclasses.asdict(listing),
    "score": evaluation.get("score", 0),
    "verdict": evaluation.get("verdict", ""),
    "strengths": evaluation.get("strengths", []),
    "concerns": evaluation.get("concerns", []),
    "draft_subject": evaluation.get("draft_subject") or f"Inquiry about {listing.title}",
    "draft_body": evaluation.get("draft_body") or "",
    "queued_at": datetime.now(timezone.utc).isoformat(),
    "tg_message_id": None,
    "tg_chat_id": None,
}
data_store.add_to_pending(pending_entry)

# send_pending_card returns (message_id, chat_id) — store them for editMessageCaption
tg_message_id, tg_chat_id = send_pending_card(listing, evaluation)
if tg_message_id:
    # Update the stored entry with the Telegram message reference
    with data_store._lock:
        app_data = data_store.load_app_data()
        for e in app_data["pending"]:
            if e.get("id") == listing.id:
                e["tg_message_id"] = tg_message_id
                e["tg_chat_id"] = tg_chat_id
                break
        data_store.save_app_data(app_data)
```

**Import additions at top of ingest_handler.py** — follow the existing import style (lines 1-16):
```python
import dataclasses  # add to stdlib group
from telegram_client import send_pending_card  # replace send_photo, format_listing_card
```

**Deviation note:** `send_photo` and `format_listing_card` imports can be removed if no other call site remains. `create_draft` import also removed — draft creation moves to `POST /api/draft/<id>` endpoint. The `should_draft` block (lines 126-139) is deleted in its entirety.

---

### `app/main.py` — add 4 new endpoints

**Analog:** `app/main.py` existing endpoints (lines 57-103)

**Endpoint pattern** — copy `@app.get("/api/data")` (lines 57-59) for GET, and `@app.post("/api/ingest")` (lines 83-93) for POST-with-body:
```python
# Simple GET — copy from lines 57-59
@app.get("/api/pending")
def get_pending():
    return {"pending": data_store.load_pending()}
```

**POST with path parameter** — no existing path-param endpoint; use FastAPI convention:
```python
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
    if reason not in {"price", "location", "condition", "other"}:
        reason = "other"
    ok = data_store.reject_listing(listing_id, reason)
    if not ok:
        raise HTTPException(status_code=404, detail="Not found in pending queue")
    return {"ok": True}
```

**Draft endpoint** — combines data_store lookup + gmail_client call + agent_state update:
```python
@app.post("/api/draft/{listing_id}")
def create_draft_endpoint(listing_id: str):
    entry = data_store.get_approved_listing(listing_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Listing not found")
    contact_email = entry.get("contact_email", "")
    if not contact_email:
        return {"ok": False, "reason": "no_email"}
    ok = gmail_client.create_draft(
        contact_email,
        entry.get("draft_subject", f"Inquiry about {entry.get('name', listing_id)}"),
        entry.get("draft_body", ""),
    )
    if ok:
        with data_store._lock:
            state = data_store.load_agent_state()
            state["pending_drafts"][listing_id] = {
                "to_email": contact_email,
                "subject": entry.get("draft_subject", ""),
                "body": entry.get("draft_body", ""),
                "url": entry.get("url", ""),
            }
            data_store.save_agent_state(state)
    return {"ok": ok}
```

**Import additions** (follow existing import block style, lines 10-18):
```python
import gmail_client          # add to import group
import pending_handler       # add if pending_handler.py is used
```

**No auth guard** on new endpoints — consistent with `/api/data` and `/api/check-now`; Caddy basic auth protects the web UI at the proxy level.

---

### `app/agent_job.py` — extend process_send_commands with callback_query dispatch

**Analog:** `app/agent_job.py` lines 21-39 (`process_send_commands`)

**Current structure** (lines 21-39):
```python
def process_send_commands(state: dict) -> None:
    updates, new_last_update_id = get_new_updates(state["last_telegram_update_id"])
    listing_ids = extract_send_commands(updates)
    state["last_telegram_update_id"] = new_last_update_id

    for listing_id in listing_ids:
        draft = state["pending_drafts"].get(listing_id)
        ...
```

**Phase 02 extension** — add `callback_query` dispatch after existing `/send` handling:
```python
import json  # add to imports

def process_send_commands(state: dict) -> None:
    updates, new_last_update_id = get_new_updates(state["last_telegram_update_id"])
    listing_ids = extract_send_commands(updates)
    state["last_telegram_update_id"] = new_last_update_id

    # Existing /send <id> handling (unchanged):
    for listing_id in listing_ids:
        ...

    # New: callback_query dispatch
    for update in updates:
        cq = update.get("callback_query")
        if cq:
            process_pending_action(cq)


def process_pending_action(cq: dict) -> None:
    """Dispatch an inline keyboard button tap. Never raises — never-raise pattern."""
    import pending_handler  # local import avoids circular dependency
    from telegram_client import answer_callback_query, edit_card_resolved, send_rejection_prompt

    # Chat-id guard: only process updates from Daniel's chat (RESEARCH Security Domain)
    chat_id = cq.get("message", {}).get("chat", {}).get("id")
    if str(chat_id) != str(TELEGRAM_CHAT_ID):
        log.warning("callback_query from unknown chat_id %s — ignored", chat_id)
        return

    # Answer immediately to prevent loading spinner (RESEARCH Pitfall 1)
    answer_callback_query(cq["id"])

    try:
        data_str = cq.get("data", "")
        # Compact format: "approve:<id>", "reject:<id>", "rr:<reason>:<id>"
        parts = data_str.split(":", 2)
        action = parts[0]

        if action == "approve":
            listing_id = parts[1]
            ok = data_store.approve_listing(listing_id)
            resolved_text = f"Approved — {datetime.now(timezone.utc).strftime('%Y-%m-%d')}" if ok else "Already processed"
            edit_card_resolved(cq, f"✅ {resolved_text}")

        elif action == "reject":
            listing_id = parts[1]
            send_rejection_prompt(cq, listing_id)

        elif action == "rr":  # reject_reason
            reason = parts[1]
            listing_id = parts[2]
            if reason not in {"price", "location", "condition", "other"}:
                reason = "other"
            ok = data_store.reject_listing(listing_id, reason)
            resolved_text = f"Rejected: {reason.capitalize()} — {datetime.now(timezone.utc).strftime('%Y-%m-%d')}" if ok else "Already processed"
            edit_card_resolved(cq, f"❌ {resolved_text}")

    except Exception:
        log.exception("process_pending_action failed for callback_query id=%s", cq.get("id"))
```

**Import additions** (follow lines 10-16):
```python
from datetime import datetime, timezone  # already present — no change needed
import data_store                        # already present
from config import TELEGRAM_CHAT_ID     # add to existing config imports
```

**Deviation note:** `callback_data` uses compact colon-separated format `"approve:<id>"`, `"reject:<id>"`, `"rr:<reason>:<id>"` (max ~35 bytes) rather than full JSON to stay safely within the 64-byte Telegram limit (RESEARCH Risk 2).

---

### `app/telegram_client.py` — add send_pending_card, edit_card_resolved, send_rejection_prompt, answer_callback_query

**Analog:** `app/telegram_client.py` — `send_photo` (lines 36-55) and `send_message` (lines 18-33)

**send_photo pattern to extend** (lines 36-55):
```python
def send_photo(photo_url: str, caption: str) -> None:
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        return
    try:
        resp = requests.post(
            f"{API_BASE}/sendPhoto",
            json={
                "chat_id": TELEGRAM_CHAT_ID,
                "photo": photo_url,
                "caption": caption,
                "parse_mode": "HTML",
            },
            timeout=15,
        )
        if resp.status_code != 200:
            send_message(caption)
    except requests.RequestException:
        send_message(caption)
```

**New functions** — follow same try/except + early-return guard style:
```python
def send_pending_card(listing, evaluation: dict) -> tuple[int | None, int | None]:
    """Send compact pending card with inline keyboard. Returns (message_id, chat_id) or (None, None)."""
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        return None, None

    score = evaluation.get("score", 0)
    verdict = evaluation.get("verdict", "")
    price = listing.price_eur or 0
    price_m2 = listing.price_per_sqm or 0
    rooms = listing.rooms or "?"
    area = listing.area_sqm or "?"
    caption = f"{score}/100 | {verdict} | {price:,} EUR · {price_m2:,}/m² | {rooms} rooms · {area} m² | {listing.title or listing.url}"

    reply_markup = {
        "inline_keyboard": [[
            {"text": "Approve", "callback_data": f"approve:{listing.id}"},
            {"text": "Reject",  "callback_data": f"reject:{listing.id}"},
            {"text": "More",    "url": f"https://{WEB_BASE_URL}/pending/{listing.id}"},
        ]]
    }

    try:
        if listing.image_url:
            resp = requests.post(
                f"{API_BASE}/sendPhoto",
                json={
                    "chat_id": TELEGRAM_CHAT_ID,
                    "photo": listing.image_url,
                    "caption": caption,
                    "parse_mode": "HTML",
                    "reply_markup": reply_markup,
                },
                timeout=15,
            )
        else:
            resp = requests.post(
                f"{API_BASE}/sendMessage",
                json={
                    "chat_id": TELEGRAM_CHAT_ID,
                    "text": caption,
                    "parse_mode": "HTML",
                    "reply_markup": reply_markup,
                },
                timeout=15,
            )
        if resp.status_code == 200:
            result = resp.json().get("result", {})
            return result.get("message_id"), result.get("chat", {}).get("id")
    except requests.RequestException:
        pass
    return None, None


def edit_card_resolved(cq: dict, resolved_caption: str) -> None:
    """Update card caption to resolved state and remove inline keyboard."""
    try:
        requests.post(
            f"{API_BASE}/editMessageCaption",
            json={
                "chat_id": cq["message"]["chat"]["id"],
                "message_id": cq["message"]["message_id"],
                "caption": resolved_caption,
                "reply_markup": {"inline_keyboard": []},
            },
            timeout=15,
        )
    except (requests.RequestException, KeyError):
        pass  # never-raise — stale message_id or deleted message is acceptable


def send_rejection_prompt(cq: dict, listing_id: str) -> None:
    """Edit the card to show reason picker buttons."""
    try:
        requests.post(
            f"{API_BASE}/editMessageCaption",
            json={
                "chat_id": cq["message"]["chat"]["id"],
                "message_id": cq["message"]["message_id"],
                "caption": "Why reject? Pick a reason:",
                "reply_markup": {
                    "inline_keyboard": [[
                        {"text": "Price",     "callback_data": f"rr:price:{listing_id}"},
                        {"text": "Location",  "callback_data": f"rr:location:{listing_id}"},
                        {"text": "Condition", "callback_data": f"rr:condition:{listing_id}"},
                        {"text": "Other",     "callback_data": f"rr:other:{listing_id}"},
                    ]]
                },
            },
            timeout=15,
        )
    except (requests.RequestException, KeyError):
        pass


def answer_callback_query(callback_query_id: str, text: str = "") -> None:
    """Acknowledge a callback query to dismiss the Telegram loading spinner."""
    try:
        requests.post(
            f"{API_BASE}/answerCallbackQuery",
            json={"callback_query_id": callback_query_id, "text": text},
            timeout=10,
        )
    except requests.RequestException:
        pass
```

**Import additions** (follow lines 1-13):
```python
from config import TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, WEB_BASE_URL  # add WEB_BASE_URL
```

---

### `app/pending_handler.py` — NEW file (no direct analog; closest is ingest_handler.py)

**Analog:** `app/ingest_handler.py` — module docstring, logging, never-raise, bool-return patterns

**Module template** (copy docstring + logging setup from ingest_handler.py lines 1-18):
```python
"""
Approve, reject, and draft-trigger operations for the pending listing queue.

Called by main.py API endpoints (web UI) and agent_job.process_pending_action
(Telegram callback_query). All state transitions are atomic under data_store._lock.
Never raises — all functions log errors and return False/None on failure.
"""

import logging

import data_store
import gmail_client

log = logging.getLogger("pending_handler")
```

**Deviation note:** The data_store functions (`approve_listing`, `reject_listing`, `add_to_pending`) may live directly in `data_store.py` per CONTEXT D-03 rather than in a separate `pending_handler.py`. If the planner keeps all state-transition logic in `data_store.py`, `pending_handler.py` may not be needed. The CONTEXT indicates the draft-trigger logic (`create_email_draft`) is the main candidate for a separate handler. Planner should decide: either put `approve_listing`/`reject_listing` in `data_store.py` (simpler) or in `pending_handler.py` (layered). Recommend `data_store.py` to match the `add_property_if_new` precedent.

---

### `app/config.py` — add WEB_BASE_URL

**Analog:** `app/config.py` lines 30-31 (`INGEST_TOKEN` pattern)

**Pattern to copy** (line 30):
```python
INGEST_TOKEN = os.environ.get("INGEST_TOKEN", "")
```

**Addition** (place after `INGEST_TOKEN`):
```python
WEB_BASE_URL = os.environ.get("WEB_BASE_URL", "")
```

No type conversion needed — URL is a plain string with empty-string default (same as `INGEST_TOKEN`, `TELEGRAM_BOT_TOKEN`).

---

### `app/static/index.html` — add Pending tab

**Analog:** existing `index.html` vanilla-JS SPA patterns (confirmed by RESEARCH)

**Pattern to follow:** JS variable-based tab switching with `fetch('/api/pending')`, conditional render in the main render function. No framework, no router. Inline `<button onclick="...">` for Approve/Reject actions.

**Approve action pattern:**
```javascript
fetch('/api/pending/' + listingId + '/approve', {method: 'POST'})
    .then(r => r.json())
    .then(function(d) { if (d.ok) renderPendingTab(); });
```

**Reject action pattern** — reveal inline reason selector div, then POST with reason:
```javascript
function rejectListing(listingId, reason) {
    fetch('/api/pending/' + listingId + '/reject', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({reason: reason})
    }).then(r => r.json()).then(function(d) { if (d.ok) renderPendingTab(); });
}
```

**Draft email button** — in approved listing detail view only when `draft_body` and `contact_email` are non-empty:
```javascript
fetch('/api/draft/' + listingId, {method: 'POST'})
    .then(r => r.json())
    .then(function(d) {
        if (d.ok) { /* show "Draft created — use /send <id> in Telegram" */ }
        else if (d.reason === 'no_email') { /* show "No agent email available" */ }
    });
```

**Deviation note:** `draft_body` must be rendered with `textContent` not `innerHTML` to prevent XSS (RESEARCH Security Domain).

---

### `app/tests/test_pending.py` — NEW: 11 tests for QUEUE-01 through QUEUE-07

**Analog:** `app/tests/test_ingest.py` (exact match — same framework, same fixture pattern)

**File structure pattern** (copy from test_ingest.py):
```python
"""
Tests for Phase 02 pending queue: QUEUE-01 through QUEUE-07.
"""

# All tests use fixtures from conftest.py:
#   client           — FastAPI TestClient with INGEST_TOKEN = "test-token-abc"
#   tmp_agent_state  — redirects data_store I/O to temp files
#   mock_telegram    — patches send_message, send_photo (add mock_send_pending_card below)
```

**Test function pattern** — copy from test_ingest.py lines 25-68:
```python
def test_ingest_writes_to_pending(client, tmp_agent_state, monkeypatch):
    """QUEUE-01: ingest batch writes to pending[], not properties[]."""
    import ingest_handler
    import data_store

    monkeypatch.setattr(ingest_handler, "evaluate_listing", lambda l: {
        "score": 80, "verdict": "Good", "strengths": [], "concerns": [],
        "draft_subject": "Test", "draft_body": "body",
    })
    monkeypatch.setattr(ingest_handler, "send_pending_card", lambda l, e: (42, -100))

    listing_payload = [{"id": "1234567", "url": "https://kv.ee/1234567.html",
                        "title": "Test", "price_eur": 200000, "rooms": 3,
                        "area_sqm": 60.0, "image_count": 10, "raw_ok": True}]

    resp = client.post("/api/ingest", json=listing_payload,
                       headers={"Authorization": "Bearer test-token-abc"})
    assert resp.status_code == 200

    data = data_store.load_app_data()
    assert len(data["pending"]) == 1
    assert len([p for p in data["properties"] if p.get("id") == "1234567"]) == 0
```

**conftest.py additions** — add two fixtures following the `mock_telegram` pattern (lines 84-114):
```python
@pytest.fixture
def mock_send_pending_card(monkeypatch):
    """Patch send_pending_card to return (42, -100) without making real Telegram API calls."""
    import telegram_client
    import ingest_handler
    mock = MagicMock(return_value=(42, -100))
    monkeypatch.setattr(telegram_client, "send_pending_card", mock)
    monkeypatch.setattr(ingest_handler, "send_pending_card", mock)
    yield mock


@pytest.fixture
def mock_gmail(monkeypatch):
    """Patch gmail_client.create_draft to return True without making IMAP calls."""
    import gmail_client
    mock = MagicMock(return_value=True)
    monkeypatch.setattr(gmail_client, "create_draft", mock)
    yield mock
```

**Integration test pattern for approve endpoint** (copy structure from test_ingest.py lines 25-68):
```python
def test_approve_moves_listing(client, tmp_agent_state):
    """QUEUE-04: POST /api/pending/<id>/approve moves item pending→properties."""
    import data_store
    import json, config

    # Seed pending entry directly
    with data_store._lock:
        data = data_store.load_app_data()
        data["pending"].append({"id": "1234567", "url": "https://kv.ee/1234567.html",
                                 "title": "Test", "price_eur": 200000, "draft_body": "body",
                                 "contact_email": "agent@test.ee"})
        data_store.save_app_data(data)

    resp = client.post("/api/pending/1234567/approve")
    assert resp.status_code == 200
    assert resp.json()["ok"] is True

    data = data_store.load_app_data()
    assert len(data["pending"]) == 0
    assert any(p.get("id") == "1234567" for p in data["properties"])
```

---

## Shared Patterns

### Never-Raise Error Handling
**Source:** `app/ingest_handler.py` lines 113-141 (the per-listing try/except), `app/telegram_client.py` lines 39-55
**Apply to:** All new functions in `pending_handler.py`, `telegram_client.py`, `agent_job.py`
```python
try:
    # ... operation ...
except Exception:
    log.exception("Description of what failed — skipping")
    # return False or (None, None) depending on function return type
```

### Thread-Safe State Transition
**Source:** `app/data_store.py` lines 89-97 (`add_property_if_new`)
**Apply to:** All new data_store functions (`add_to_pending`, `approve_listing`, `reject_listing`)
```python
with _lock:
    data = load_app_data()   # RLock is re-entrant — safe to call load inside lock
    # ... find, mutate ...
    save_app_data(data)
    return True
```

### Boolean Return Convention
**Source:** `app/data_store.py` line 89 (`add_property_if_new` returns `bool`)
**Apply to:** `add_to_pending`, `approve_listing`, `reject_listing`, `create_email_draft`
- Return `True` on success, `False` on not-found or duplicate (never raise)

### Env-Var Config Pattern
**Source:** `app/config.py` line 30
**Apply to:** `WEB_BASE_URL` addition
```python
WEB_BASE_URL = os.environ.get("WEB_BASE_URL", "")
```

### Test Fixture Pattern
**Source:** `app/tests/conftest.py` lines 84-114 (`mock_telegram` fixture)
**Apply to:** `mock_send_pending_card`, `mock_gmail` fixtures in conftest.py
- Use `MagicMock`, `monkeypatch.setattr` on both the source module and all modules that import the function
- `yield` the mock so tests can assert `mock.called`, `mock.call_args`

### Telegram API Call Pattern
**Source:** `app/telegram_client.py` lines 36-55 (`send_photo`)
**Apply to:** All new `telegram_client.py` functions
- Guard: `if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID: return`
- Wrap `requests.post(...)` in `try/except requests.RequestException`
- Use `timeout=15` for send calls, `timeout=10` for ack calls
- Never re-raise

---

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `app/pending_handler.py` | service | CRUD | No dedicated "state transition handler" file exists yet; closest is ingest_handler.py but it is an ingest pipeline, not an approval router. Recommend folding approve/reject functions into data_store.py instead to match the add_property_if_new precedent. |

---

## Metadata

**Analog search scope:** `app/` directory (all .py files), `app/tests/`, `app/static/`
**Files scanned:** 8 source files read in full
**Pattern extraction date:** 2026-07-08
