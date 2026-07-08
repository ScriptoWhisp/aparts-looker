# Phase 3: AI Quality & Price Intelligence - Pattern Map

**Mapped:** 2026-07-08
**Files analyzed:** 7 new/modified files
**Analogs found:** 7 / 7

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `app/ai_evaluator.py` | service | request-response | `app/ai_evaluator.py` (self) | exact — extend existing |
| `app/data_store.py` | service | CRUD | `app/data_store.py` (self) | exact — extend existing |
| `app/ingest_handler.py` | service | batch | `app/ingest_handler.py` (self) | exact — extend existing |
| `app/config.py` | config | — | `app/config.py` (self) | exact — extend existing |
| `app/static/index.html` | component | request-response | `app/static/index.html` (self) | exact — extend existing |
| `app/tests/test_eval_quality.py` | test | — | `app/tests/test_pending.py` | role-match |
| `app/tests/test_price_intelligence.py` | test | — | `app/tests/test_ingest.py` | role-match |

---

## Pattern Assignments

### `app/ai_evaluator.py` (service, request-response)

**Analog:** `app/ai_evaluator.py` (direct extension)

**Imports pattern** (lines 1-19):
```python
import json
import re

import requests

from config import ANTHROPIC_API_KEY, ANTHROPIC_MODEL, BUYER_PROFILE
from kv_listing_parser import Listing
```

**Current function signature** (line 66):
```python
def evaluate_listing(listing: Listing) -> dict:
```
Extend to:
```python
def evaluate_listing(listing: Listing, context_prefix: str = "") -> dict:
```

**User message assembly pattern** (lines 72-85) — inject prefix before listing_summary:
```python
    listing_summary = f"""
Title/address: {listing.title}
URL: {listing.url}
Price: {listing.price_eur} EUR ({listing.price_per_sqm} EUR/m2)
Rooms: {listing.rooms}
Area: {listing.area_sqm} m2
Year built: {listing.year_built}
Material: {listing.material}
Condition (stated): {listing.condition}
Floor: {listing.floor}/{listing.floor_total}
Parking: {listing.parking}
Renovation needed (text signals): {listing.needs_renovation}
Description: {listing.description[:1500]}
"""
    # Phase 3: prepend context_prefix to user turn (anchors + district avg)
    user_content = context_prefix + listing_summary
```

**API call pattern** (lines 98-113) — replace `listing_summary` with `user_content` and bump max_tokens:
```python
    try:
        resp = requests.post(
            API_URL,
            headers={
                "x-api-key": ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": ANTHROPIC_MODEL,
                "max_tokens": 1500,           # was 1000 — increased for checklist output
                "system": SYSTEM_PROMPT,
                "messages": [{"role": "user", "content": user_content}],
            },
            timeout=30,
        )
```

**setdefault fallback pattern** (lines 120-127) — add `checklist` key:
```python
        result.setdefault("score", 0)
        result.setdefault("verdict", "")
        result.setdefault("strengths", [])
        result.setdefault("concerns", [])
        result.setdefault("should_draft_email", False)
        result.setdefault("draft_subject", "")
        result.setdefault("draft_body", "")
        result.setdefault("checklist", {})    # NEW — Phase 3
        return result
```

**Error fallback dict** (lines 130-138) — add `checklist` key to hardcoded fallback:
```python
    except (requests.RequestException, json.JSONDecodeError, KeyError, ValueError):
        return {
            "score": 0,
            "verdict": "Could not get AI evaluation (API error) — review this listing manually.",
            "strengths": [],
            "concerns": [],
            "should_draft_email": False,
            "draft_subject": "",
            "draft_body": "",
            "checklist": {},    # NEW — Phase 3
        }
```

**SYSTEM_PROMPT extension** — append `checklist` field to the JSON schema block in the existing `SYSTEM_PROMPT` f-string (lines 23-56). The existing schema ends at `"draft_body"`. Add after it:
```python
  "checklist": {{
    "price_per_sqm":        "pass" | "fail" | "unknown",
    "rooms_area":           "pass" | "fail" | "unknown",
    "parking":              "pass" | "fail" | "unknown",
    "renovation_potential": "pass" | "fail" | "unknown",
    "floor":                "pass" | "fail" | "unknown",
    "year_material":        "pass" | "fail" | "unknown",
    "mandatory_extras":     "pass" | "fail" | "unknown"
  }}

Use exactly these key names. Fill each from listing text only.
Use "unknown" when the listing text does not address the criterion.
```

---

### `app/data_store.py` (service, CRUD)

**Analog:** `app/data_store.py` (direct extension)

**Lock declaration** (line 26) — reuse, do NOT change to `Lock`:
```python
_lock = threading.RLock()
```

**DEFAULT_APP_DATA extension** (lines 45-51) — add `price_history` key:
```python
DEFAULT_APP_DATA = {
    "properties": DEFAULT_PROPERTIES,
    "checklists": {},
    "settings": {},
    "pending": [],
    "rejected": [],
    "price_history": {},    # NEW — Phase 3: {listing_id: [{date, price}, ...]}
}
```

**load_app_data setdefault pattern** (lines 82-90) — add one line:
```python
def load_app_data():
    with _lock:
        data = _read_json(config.APP_DATA_FILE, DEFAULT_APP_DATA)
        data.setdefault("properties", [])
        data.setdefault("checklists", {})
        data.setdefault("settings", {})
        data.setdefault("pending", [])
        data.setdefault("rejected", [])
        data.setdefault("price_history", {})    # NEW — zero-downtime migration
        return data
```

**Boolean-return helper pattern** (lines 98-106, 109-120) — all new helpers follow the same shape: `with _lock:`, load, mutate, save, return bool:
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

**New helpers to add** — follow the pattern above:

`record_price_in_data(data, listing_id, price_eur, today_str) -> None` — no lock (caller holds it), mutates data in-place, no file I/O:
```python
def record_price_in_data(data: dict, listing_id: str, price_eur: int, date_str: str) -> None:
    """Mutate data dict in-place. Caller must hold _lock. No file I/O."""
    history = data.setdefault("price_history", {}).setdefault(listing_id, [])
    if history and history[-1]["date"] == date_str:
        history[-1]["price"] = price_eur     # idempotent same-day re-run
    else:
        history.append({"date": date_str, "price": price_eur})
```

`get_price_history(listing_id) -> list[dict]` — standalone thread-safe read (same shape as `load_pending()`):
```python
def get_price_history(listing_id: str) -> list[dict]:
    """Return price history for listing_id. Returns [] if not found. Thread-safe."""
    with _lock:
        data = load_app_data()
        return data.get("price_history", {}).get(listing_id, [])
```

`write_checklist_ai(listing_id, checklist) -> None` — thread-safe write (same shape as `reject_listing()`, preserves user entries):
```python
def write_checklist_ai(listing_id: str, checklist: dict) -> None:
    """Write AI-generated checklist to checklists[listing_id]["ai_checklist"].

    Existing source=="user" entries are preserved (D-09).
    """
    with _lock:
        data = load_app_data()
        ai_cl = data.setdefault("checklists", {}).setdefault(listing_id, {}).setdefault("ai_checklist", {})
        for key, result in checklist.items():
            if isinstance(ai_cl.get(key), dict) and ai_cl[key].get("source") == "user":
                continue    # preserve user overrides
            ai_cl[key] = {"result": result, "source": "ai"}
        save_app_data(data)
```

---

### `app/ingest_handler.py` (service, batch)

**Analog:** `app/ingest_handler.py` (direct extension)

**Imports pattern** (lines 13-23) — add `date` from datetime:
```python
import dataclasses
import logging
from dataclasses import fields as dc_fields
from datetime import date as _date, datetime, timezone

import config
import data_store
import telegram_client
from ai_evaluator import evaluate_listing
from kv_listing_parser import Listing, extract_object_id
```

**Private function naming pattern** (line 30) — underscore prefix, never-raise:
```python
def _deserialize_listing(data: dict) -> Listing:
    """..."""
    known = {k: v for k, v in data.items() if k in LISTING_FIELD_NAMES}
    return Listing(**known)
```
New private functions follow same shape: `_build_context_prefix`, `_record_and_check_price_drop`, `_handle_price_drop`, `_mark_removed_listings`.

**Lock scope pattern** (lines 51-131) — outer `with data_store._lock:` wraps full batch:
```python
    with data_store._lock:
        state = data_store.load_agent_state()
        for data in listing_dicts:
            try:
                ...
            except Exception:
                log.exception("Failed to process listing %s — skipping", listing.id)
        data_store.save_agent_state(state)
```

**Dedup + continue pattern** (lines 62-64) — Phase 3 changes `continue` on known listings to record price first:
```python
            dedup_key = extract_object_id(listing.url) or listing.url
            if dedup_key in set(state["seen_listing_ids"]):
                continue    # Phase 3: replace this `continue` with price recording + drop check
```

**evaluate_listing call site** (line 91) — update to pass context_prefix:
```python
                # Phase 3: build context prefix (anchors + district avg) before calling evaluate
                context_prefix = _build_context_prefix(listing, app_data)
                evaluation = evaluate_listing(listing, context_prefix)
```

**pending_entry construction** (lines 95-108) — add checklist write after `add_to_pending`:
```python
                pending_entry = {
                    **dataclasses.asdict(listing),
                    "score": evaluation.get("score", 0),
                    "verdict": evaluation.get("verdict", ""),
                    "strengths": evaluation.get("strengths", []),
                    "concerns": evaluation.get("concerns", []),
                    "draft_subject": (
                        evaluation.get("draft_subject") or f"Inquiry about {listing.title}"
                    ),
                    "draft_body": evaluation.get("draft_body") or "",
                    "queued_at": datetime.now(timezone.utc).isoformat(),
                    "tg_message_id": None,
                    "tg_chat_id": None,
                }
                data_store.add_to_pending(pending_entry)
                # Phase 3: write AI checklist (EVAL-02, D-08)
                data_store.write_checklist_ai(listing.id, _whitelist_checklist(evaluation.get("checklist", {})))
```

**Never-raise pattern for new private functions** (lines 128-129):
```python
            except Exception:
                log.exception("Failed to process listing %s — skipping", listing.id)
```
All new private functions (`_build_context_prefix`, `_record_and_check_price_drop`, `_handle_price_drop`) wrap their body in `try/except Exception: log.exception(...); return ""` or `return`.

---

### `app/config.py` (config)

**Analog:** `app/config.py` (direct extension)

**Env var pattern** (lines 23-28) — all `int()` or `float()` casts with defaults:
```python
DRAFT_SCORE_THRESHOLD = int(os.environ.get("DRAFT_SCORE_THRESHOLD", "60"))
MIN_IMAGES = int(os.environ.get("MIN_IMAGES", "5"))
MIN_ROOMS = int(os.environ.get("MIN_ROOMS", "2"))
MAX_PRICE_EUR = int(os.environ.get("MAX_PRICE_EUR", "260000"))

CHECK_INTERVAL_HOURS = float(os.environ.get("CHECK_INTERVAL_HOURS", "2"))
```

New line follows identical pattern:
```python
PRICE_DROP_THRESHOLD = float(os.environ.get("PRICE_DROP_THRESHOLD", "0.05"))
```

---

### `app/static/index.html` (component, request-response)

**Analog:** `app/static/index.html` (direct extension)

**State object pattern** (line 472) — extend `state` to include `priceHistory`:
```javascript
var state = { properties:[], checklists:{}, selectedId:null };
// Phase 3: add priceHistory
var state = { properties:[], checklists:{}, selectedId:null, priceHistory:{} };
```

**loadData pattern** (lines 496-509) — extend to read `price_history` from API response:
```javascript
async function loadData(){
    try{
      var resp = await fetch("/api/data");
      if(!resp.ok) throw new Error("HTTP " + resp.status);
      var parsed = await resp.json();
      state.properties = (parsed.properties && parsed.properties.length) ? parsed.properties : [];
      state.checklists = parsed.checklists || {};
      state.priceHistory = parsed.price_history || {};    // NEW — Phase 3
    } catch(e){
      console.error("load failed", e);
      setGlobalNotice("...", "err");
    }
    ...
}
```

**buildPendingCard DOM-creation pattern** (lines 1143-1207) — all new UI elements use `document.createElement` + `.textContent`, never `.innerHTML` for user data. Follow exactly this pattern for price history list, AI checklist badges, and removed badge:
```javascript
function buildPendingCard(entry) {
    var card = document.createElement("div");
    card.style.background = "var(--paper-card)";
    // ...

    var meta = document.createElement("div");
    meta.style.fontFamily = "var(--font-mono)";
    meta.style.fontSize = "11px";
    meta.style.color = "var(--ink-soft)";
    meta.textContent = metaParts.join(" · ");    // textContent only
    card.appendChild(meta);
```

**CSS variable palette for new badge colors** (lines 24-35) — reuse existing vars:
- `var(--green)` / `var(--green-bg)` — pass
- `var(--red)` / `var(--red-bg)` — fail / removed
- `var(--grey)` / `var(--grey-bg)` — unknown
- `var(--amber)` / `var(--amber-bg)` — AI-sourced indicator

**New utility functions to add** (before `buildPendingCard`, follow existing function style):
```javascript
// Compute days on market from price_history[id][0].date
function daysOnMarket(listingId) {
    var hist = state.priceHistory[listingId];
    if (!hist || !hist.length) return null;
    var first = new Date(hist[0].date);
    var now = new Date();
    return Math.floor((now - first) / 86400000);
}

// Build a DOM element showing price history as plain text list
function buildPriceHistoryEl(listingId) {
    var hist = state.priceHistory[listingId];
    if (!hist || !hist.length) return null;
    var wrap = document.createElement("div");
    wrap.style.fontFamily = "var(--font-mono)";
    wrap.style.fontSize = "11px";
    wrap.style.color = "var(--ink-soft)";
    wrap.style.marginTop = "8px";
    hist.forEach(function(entry) {
        var row = document.createElement("div");
        row.textContent = entry.date + " — " + Number(entry.price).toLocaleString("et-EE") + " €";
        wrap.appendChild(row);
    });
    return wrap;
}

// Build AI checklist badge strip for a listing
function buildAiChecklistEl(listingId) {
    var cl = state.checklists[listingId];
    if (!cl || !cl.ai_checklist) return null;
    var wrap = document.createElement("div");
    wrap.style.marginTop = "8px";
    wrap.style.display = "flex";
    wrap.style.flexWrap = "wrap";
    wrap.style.gap = "4px";
    var LABELS = {
        price_per_sqm: "price/m²", rooms_area: "rooms/area", parking: "parking",
        renovation_potential: "reno", floor: "floor",
        year_material: "year/mat", mandatory_extras: "extras"
    };
    Object.keys(cl.ai_checklist).forEach(function(key) {
        var item = cl.ai_checklist[key];
        var result = item.result || item;  // support flat string or {result, source} shape
        var source = item.source || "ai";
        var badge = document.createElement("span");
        badge.style.fontSize = "10px";
        badge.style.padding = "2px 5px";
        badge.style.borderRadius = "var(--radius)";
        badge.style.fontFamily = "var(--font-mono)";
        var dot = result === "pass" ? "✓" : result === "fail" ? "✗" : "?";
        var bg = result === "pass" ? "var(--green-bg)" : result === "fail" ? "var(--red-bg)" : "var(--grey-bg)";
        var color = result === "pass" ? "var(--green)" : result === "fail" ? "var(--red)" : "var(--grey)";
        badge.style.background = bg;
        badge.style.color = color;
        var prefix = source === "ai" ? "[AI] " : "";
        badge.textContent = prefix + dot + " " + (LABELS[key] || key);
        wrap.appendChild(badge);
    });
    return wrap;
}
```

---

### `app/tests/test_eval_quality.py` (test, Wave 0 xfail stubs)

**Analog:** `app/tests/test_pending.py` and `app/tests/test_ingest.py`

**Module docstring pattern** (test_pending.py line 1):
```python
"""Tests for Phase 02 pending queue: QUEUE-01 through QUEUE-07."""
```
New file docstring:
```python
"""Tests for Phase 03 AI evaluation quality: EVAL-01, EVAL-02, EVAL-03."""
```

**Import pattern inside test functions** (test_pending.py lines 8-11) — local imports after `sys.path` setup by conftest:
```python
def test_ingest_writes_to_pending(client, tmp_agent_state, mock_send_pending_card, monkeypatch):
    import re  # noqa: PLC0415
    import data_store  # noqa: PLC0415
    import ingest_handler  # noqa: PLC0415
```

**monkeypatch.setattr evaluate_listing pattern** (test_ingest.py lines 34-44):
```python
    monkeypatch.setattr(
        ingest_handler,
        "evaluate_listing",
        lambda listing: {
            "score": 80,
            "verdict": "Good listing",
            "strengths": ["Good price"],
            "concerns": [],
            "draft_body": "Dear agent,",
            "should_draft_email": False,
        },
    )
```
Phase 3 tests extend the lambda to accept `listing, context_prefix=""` and include `"checklist": {...}`.

**Wave 0 xfail stub pattern** (standard pytest):
```python
import pytest

@pytest.mark.xfail(reason="Wave 0 stub — not yet implemented", strict=True)
def test_anchor_injection(tmp_agent_state, monkeypatch):
    """EVAL-01: evaluate_listing receives context_prefix containing anchor block when >= 2 scored properties exist."""
    pytest.fail("not implemented")
```

**Fixture usage pattern** (conftest.py lines 39-55) — `tmp_agent_state` redirects I/O; seed state via `data_store._lock`:
```python
def test_checklist_user_override_preserved(tmp_agent_state):
    import data_store  # noqa: PLC0415

    with data_store._lock:
        data = data_store.load_app_data()
        data["checklists"]["test-1"] = {
            "ai_checklist": {"parking": {"result": "fail", "source": "user"}}
        }
        data_store.save_app_data(data)
    ...
```

---

### `app/tests/test_price_intelligence.py` (test, Wave 0 xfail stubs)

**Analog:** `app/tests/test_ingest.py`

**Module docstring:**
```python
"""Tests for Phase 03 price intelligence: EVAL-04, INTEL-01, INTEL-02, INTEL-03."""
```

**Seed price_history pattern** (follows `data_store.load_app_data()` + `save_app_data()` pattern from test_pending.py):
```python
def test_record_price_new(tmp_agent_state):
    import data_store  # noqa: PLC0415

    with data_store._lock:
        data = data_store.load_app_data()
        data_store.record_price_in_data(data, "test-1", 200000, "2026-07-01")
        data_store.save_app_data(data)

    history = data_store.get_price_history("test-1")
    assert history == [{"date": "2026-07-01", "price": 200000}]
```

**Ingest batch integration test pattern** (test_ingest.py lines 25-74) — send a payload via HTTP, then read `app_data_file` directly:
```python
def test_ingest_records_price_for_known(client, tmp_agent_state, mock_send_pending_card, monkeypatch):
    import json  # noqa: PLC0415
    import ingest_handler  # noqa: PLC0415

    monkeypatch.setattr(ingest_handler, "evaluate_listing", lambda l, ctx="": {...})

    payload = [{"id": "test-1", "url": "https://www.kv.ee/test-1.html", ...}]
    client.post("/api/ingest", json=payload, headers={"Authorization": "Bearer test-token-abc"})
    # second call — same listing, now "known"
    payload[0]["price_eur"] = 188000
    client.post("/api/ingest", json=payload, headers={"Authorization": "Bearer test-token-abc"})

    app_data_file = tmp_agent_state / "app_data.json"
    app_data = json.loads(app_data_file.read_text())
    assert "test-1" in app_data.get("price_history", {})
    assert len(app_data["price_history"]["test-1"]) >= 1
```

---

## Shared Patterns

### Thread-Safe JSON (apply to all new data_store helpers)

**Source:** `app/data_store.py` lines 82-95 and 109-120

```python
# Thread-safe read-modify-write: wrap with _lock, load, mutate, save
with _lock:
    data = load_app_data()
    # ... mutate data ...
    save_app_data(data)
    return True   # boolean return convention
```

Exception: `record_price_in_data()` is a no-lock in-place mutator — caller (`process_ingest_batch`) already holds `_lock` (reentrant RLock — safe).

### Never-Raise Pattern (apply to all new private functions in ingest_handler)

**Source:** `app/ingest_handler.py` lines 128-129

```python
            except Exception:
                log.exception("Failed to process listing %s — skipping", listing.id)
```

All new private functions (`_build_context_prefix`, `_record_and_check_price_drop`, `_handle_price_drop`, `_mark_removed_listings`) must catch `Exception`, log with `log.exception()`, and return a safe default (empty string, None, or no-op).

### textContent-Only DOM Pattern (apply to all new HTML elements in index.html)

**Source:** `app/static/index.html` lines 1167, 1182

```javascript
cardHeader.textContent = (entry.score != null ? ...) + " — " + (entry.title || ...);
meta.textContent = metaParts.join(" · ");
```

Never use `.innerHTML` for data from the API. All new elements (price history rows, AI checklist badges, removed badge, days-on-market) must use `.textContent` assignment.

### Log Pattern (apply to all new handlers in ingest_handler)

**Source:** `app/ingest_handler.py` lines 49, 71-87, 90-92

```python
log.info("Ingest batch received: %d listings", len(listing_dicts))
log.info("Skipping %s — price %s > max %s", listing.id, listing.price_eur, config.MAX_PRICE_EUR)
log.info("Evaluating listing %s: %s", listing.id, listing.title)
log.info("Score: %s/100 — %s", evaluation.get("score"), evaluation.get("verdict"))
```

Use `%s` formatting (not f-strings) in all `log.*()` calls. Use `log.exception()` in except blocks.

### Monkeypatch evaluate_listing in Tests (apply to all new test files)

**Source:** `app/tests/test_ingest.py` lines 34-44 and `app/tests/test_pending.py` lines 13-24

```python
monkeypatch.setattr(
    ingest_handler,
    "evaluate_listing",
    lambda listing: {"score": 80, "verdict": "Good", ...},
)
```

Phase 3 tests patch with a lambda that accepts the new `context_prefix=""` parameter:
```python
lambda listing, context_prefix="": {"score": 80, "verdict": "Good", "checklist": {...}, ...}
```

---

## No Analog Found

None. All 7 files are extensions of existing codebase files. No greenfield files without analogs.

---

## Metadata

**Analog search scope:** `app/` directory — all Python source files and `app/static/index.html`
**Files scanned:** 7 source files read directly
**Pattern extraction date:** 2026-07-08
