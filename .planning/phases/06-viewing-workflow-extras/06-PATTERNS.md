# Phase 6: Viewing Workflow & Extras — Pattern Map

**Mapped:** 2026-07-10
**Files analyzed:** 12 (2 new backend, 4 modified backend, 3 modified frontend, 4 new tests)
**Analogs found:** 12 / 12 (all in-repo)

Every file in this phase has a strong existing analog. Downstream planners MUST point executors at the `file:line` references below via `<read_first>` blocks — do not paraphrase; the excerpts are the pattern.

---

## File Classification

| New / Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---------------------|------|-----------|----------------|---------------|
| `app/brief_generator.py` (NEW) | service (AI wrapper) | request-response (external HTTP) | `app/ai_evaluator.py` | exact |
| `app/ku_lookup.py` (NEW) | service (scraper) | request-response (external HTTP) | `app/ai_evaluator.py` (never-raise HTTP wrap) + `app/kv_scraper.py` (params-only GET) | role-match |
| `app/data_store.py` (MOD) | model / persistence | CRUD (JSON I/O) | `data_store.approve_listing` / `reject_listing` (data_store.py:172, 186) | exact |
| `app/main.py` (MOD, 4 endpoints) | controller (FastAPI) | request-response | `POST /api/pending/{id}/reject` (main.py:479) + `POST /api/entry/{id}/cost-override` (main.py:729) + `POST /api/check-now` (main.py:132, daemon thread) | exact |
| `app/ingest_handler.py` (MOD) | service (orchestrator) | event-driven (approval hook) | `process_ingest_batch` post-hoc helpers (`_mark_removed_listings`, ingest_handler.py:364) | role-match |
| `app/ai_evaluator.py` (MOD, factor out) | utility (refactor) | request-response | current `_extract_json` + `requests.post` block (ai_evaluator.py:163-179, 258-272) | self |
| `app/static/js/detail-panel.js` (MOD) | component (vanilla JS DOM) | request-response (fetch → POST) | `_buildCostOfOwnership(coo, entry)` (detail-panel.js:775-964) — Edit/Save/Reset UI + fetch pattern | exact |
| `app/static/index.html` (MOD, CSS) | config (stylesheet) | n/a | `.coo-card` CSS block (index.html:468-527) | exact |
| `app/static/js/ui.js` (MOD, optional KPI) | component | transform | `_refreshSidebarIssueDot` (detail-panel.js:154) — status-based count | role-match |
| `app/tests/test_viewing_workflow.py` (NEW) | test (integration) | request-response | `app/tests/test_pending.py::test_ingest_writes_to_pending` (test_pending.py:6) | exact |
| `app/tests/test_brief_generator.py` (NEW) | test (unit, mocked HTTP) | request-response | `app/tests/test_pending.py::test_send_pending_card_buttons` (test_pending.py:70, mocks `requests.post`) | exact |
| `app/tests/test_ku_lookup.py` (NEW) | test (unit, mocked HTTP) | request-response | same as above | exact |
| `app/tests/test_data_store.py` (extend) | test (unit) | CRUD | existing `test_pending.test_data_model_keys` (test_pending.py:56) — setdefault assertions | role-match |

---

## Pattern Assignments

### `app/brief_generator.py` (NEW — service, request-response)

**Analog:** `app/ai_evaluator.py`

**Module docstring + imports** (mirror `ai_evaluator.py:1-27`):

```python
# ai_evaluator.py:1-26
"""
Sends a listing's scraped data to Claude for desk-review scoring against
Daniel's actual buying criteria (config.BUYER_PROFILE) ...
"""

import json
import logging
import re
from typing import Optional

import requests

import config
from config import ANTHROPIC_API_KEY, BUYER_PROFILE

log = logging.getLogger("ai_evaluator")

API_URL = "https://api.anthropic.com/v1/messages"
```

New module keeps identical shape; logger name `"brief_generator"`, same `API_URL`.

**`_extract_json` — COPY VERBATIM** from `ai_evaluator.py:163-179`. Do NOT re-derive; the `raw_decode` fallback for trailing prose is load-bearing.

```python
# ai_evaluator.py:163-179
def _extract_json(text: str) -> dict:
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    start = text.find("{")
    if start == -1:
        raise ValueError("no JSON object found in AI response")
    obj, _end = json.JSONDecoder().raw_decode(text[start:])
    return obj
```

**Anthropic HTTP call + never-raise pattern** — replicate `ai_evaluator.evaluate_listing` (ai_evaluator.py:254-327):

```python
# ai_evaluator.py:254-327 (condensed)
if not ANTHROPIC_API_KEY:
    return _fallback_result("Skip because ANTHROPIC_API_KEY is not set — evaluation unavailable.")

try:
    resp = requests.post(
        API_URL,
        headers={
            "x-api-key": ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        json={
            "model": config.ANTHROPIC_MODEL,
            "max_tokens": config.AI_MAX_TOKENS,
            "system": SYSTEM_PROMPT,
            "messages": [{"role": "user", "content": user_content}],
        },
        timeout=45,
    )
except requests.RequestException as exc:
    log.error("AI evaluation network error for %s: %s", listing.id, exc)
    return _fallback_result(...)

if resp.status_code != 200:
    ...surface Anthropic error...
    return _fallback_result(...)

try:
    data = resp.json()
    text_blocks = [b["text"] for b in data.get("content", []) if b.get("type") == "text"]
    raw_text = "\n".join(text_blocks)
    result = _extract_json(raw_text)
except (json.JSONDecodeError, KeyError, ValueError) as exc:
    log.error(...)
    return _fallback_result(...)

result.setdefault("score", 0)
result.setdefault("verdict", "")
...
return result
```

For brief: same skeleton, replace `SYSTEM_PROMPT`, use `max_tokens=1200`, `temperature=0.3`, and setdefault `brief_ru` / `suggested_offer_low_eur` / `suggested_offer_high_eur`. Fallback dict shape must include the same keys so the frontend doesn't KeyError.

**Post-hoc number-grounding validator** — no direct analog; take from RESEARCH.md:806-819. Attach `needs_review = True` on the result dict rather than raising.

---

### `app/ku_lookup.py` (NEW — service, request-response)

**Analog for HTTP + never-raise:** `ai_evaluator.evaluate_listing` (ai_evaluator.py:257-275)
**Analog for GET + params + UA header:** `app/kv_listing_parser.py` (`fetch_listing`) — outbound `requests.get` with UA + timeout + `raise_for_status`.

Full pattern already sketched verbatim in RESEARCH.md:664-735. Executor should copy it, adjusting only:
- User-Agent string (`"ApartsLooker/1.0 daniel.tjulinov@gmail.com"`)
- Filter constant `KORTERIUHISTU_LEGAL_FORM = "23"`
- `_to_street_query` regex to drop `"-\d+\s*$"` apartment suffix and `.split(",")[0]` city drop.

Never-raise return: `Optional[dict]` (None means "no KÜ found or lookup failed" — both are non-events).

---

### `app/data_store.py` (MOD — model, CRUD)

**Analog for state-transition helpers:** `approve_listing` (data_store.py:172-183) and `reject_listing` (data_store.py:186-209).

```python
# data_store.py:172-183 — canonical shape for a state-transition helper
def approve_listing(listing_id: str) -> bool:
    """Move listing from pending[] to properties[]. Returns False if not found ..."""
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
```

New helpers (`set_viewing_scheduled`, `mark_viewed`, `save_negotiation_brief`, `save_ku_enrichment`) follow this exact `with _lock: load → find → mutate → save_app_data → return bool` sequence. Full implementations are pre-drafted in RESEARCH.md:546-640; executor should copy those verbatim.

**Analog for setdefault migration:** `load_app_data` (data_store.py:84-100). Every new field on `properties[]` and `pending[]` gets a `setdefault` in the existing for-loop:

```python
# data_store.py:84-100 — extend this exact loop
def load_app_data():
    with _lock:
        data = _read_json(config.APP_DATA_FILE, DEFAULT_APP_DATA)
        data.setdefault("properties", [])
        ...
        data.setdefault("price_history", {})
        for entry in data.get("properties", []) + data.get("pending", []):
            entry.setdefault("lat", None)
            entry.setdefault("lng", None)
            entry.setdefault("commute_minutes", None)
            entry.setdefault("energy_class", "")
            # PHASE 6 — add here:
            # entry.setdefault("status", "approved")
            # entry.setdefault("scheduled_at", None)
            # entry.setdefault("viewing_history", [])
            # entry.setdefault("negotiation_brief", None)
            # entry.setdefault("ku", None)
        return data
```

**Preserve manual notes on `refresh-ku`** — see RESEARCH.md:621-640 (`save_ku_enrichment` preserves `entry["ku"]["manual"]`). Pitfall 7.

---

### `app/main.py` (MOD — controller, 4 new POST endpoints)

**Primary analog:** `POST /api/pending/{id}/reject` (main.py:479-488) — canonical shape for a body-taking state-transition endpoint.

```python
# main.py:479-488
@app.post("/api/pending/{listing_id}/reject")
async def reject_pending(listing_id: str, request: Request):
    body = await request.json()
    reason = body.get("reason", "other")
    if reason not in {"price", "location", "condition", "other"}:
        reason = "other"
    ok = data_store.reject_listing(listing_id, reason)
    if not ok:
        raise HTTPException(status_code=404, detail="Not found in pending queue")
    return {"ok": True}
```

**Body-parse + `_find_entry_any` for entries outside pending:** `POST /api/entry/{id}/cost-override` (main.py:729-781).

```python
# main.py:729-748 — how to find + mutate an entry in properties/pending/rejected
@app.post("/api/entry/{listing_id}/cost-override")
async def cost_override(listing_id: str, request: Request) -> dict:
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Body must be a JSON object")
    ...
    with data_store._lock:
        app_data = data_store.load_app_data()
        entry = _find_entry_any(app_data, listing_id)
        if entry is None:
            raise HTTPException(status_code=404, detail="Listing not found")
        ...
        data_store.save_app_data(app_data)
    return {"ok": True, "cost_of_ownership": coo}
```

**Daemon-thread spawn (fire-and-forget brief generation / KÜ lookup):** `POST /api/check-now` (main.py:132-136).

```python
# main.py:132-136
@app.post("/api/check-now")
def check_now():
    threading.Thread(target=scheduler.run_once_now, daemon=True).start()
    return {"ok": True, "message": "Scheduler tick started in background ..."}
```

**Endpoint-by-endpoint pattern assignment:**

| New endpoint | Combine analogs |
|--------------|-----------------|
| `POST /api/entry/{id}/schedule-viewing` | reject shape (body parse, 404) + check-now (daemon thread for brief) + `set_viewing_scheduled` helper |
| `POST /api/entry/{id}/mark-viewed` | approve shape (no body, main.py:471-476) + `mark_viewed` helper |
| `POST /api/entry/{id}/regenerate-brief` | approve shape (no body) + check-now (daemon thread) |
| `POST /api/entry/{id}/refresh-ku` | approve shape (no body) + check-now (daemon thread) |

**ISO 8601 parse guard** — see main.py:151-154 for the existing `datetime.fromisoformat(s.replace("Z","+00:00"))` idiom already used in `/api/telegram/status`. Copy that; wrap in try/except → HTTPException 400.

---

### `app/ingest_handler.py` (MOD — hook KÜ lookup on approval)

**Analog:** `_mark_removed_listings` (ingest_handler.py:364-390) — a post-hoc helper called from `process_ingest_batch` under the existing `_lock`.

More directly relevant: `data_store.approve_listing` (data_store.py:172) is the natural hook — but per CONTEXT §Reusable Assets the KÜ scrape belongs in a wrapper (main.py or ingest_handler.py) so `data_store` stays free of `requests` imports. Recommended shape:

- Add `def _dispatch_ku_lookup(listing_id: str) -> None` to `ingest_handler.py` that spawns a daemon thread calling `ku_lookup.lookup_ku_for_address(address) → data_store.save_ku_enrichment(...)`.
- Call it from the approve-pending endpoint (`main.py:471-476`) right after `data_store.approve_listing(listing_id)` returns True.

Never-raise wrapper mirrors `_mark_removed_listings`:

```python
# ingest_handler.py:364-390 — never-raise post-hoc side effect
def _mark_removed_listings(app_data: dict, batch_dicts: list[dict]) -> None:
    try:
        ...
    except Exception:
        log.exception("_mark_removed_listings failed — skipping")
```

---

### `app/ai_evaluator.py` (MOD — factor out shared helper)

Extract `_extract_json` (ai_evaluator.py:163-179) and the raw Anthropic POST block (ai_evaluator.py:257-315) into a shared `_call_anthropic(system_prompt: str, user_content: str, max_tokens: int, temperature: float = 0) -> dict` helper. Executor's choice: keep it in `ai_evaluator.py` (importable by `brief_generator`) OR create `anthropic_client.py`. Recommendation from RESEARCH.md:352-360: keep the helper in a new small `anthropic_client.py` module — cleaner boundary.

Do NOT change the SYSTEM_PROMPT, the fallback shape, or `_whitelist_checklist_fills`. This is a pure extraction; all existing `test_eval_quality.py` cases must still pass.

---

### `app/static/js/detail-panel.js` (MOD — new "Negotiation brief" + "KÜ data" sections)

**Analog:** `_buildCostOfOwnership(coo, entry)` (detail-panel.js:775-964) — the canonical shape for a detail-panel card with inline Edit/Save UI + fetch.

```javascript
// detail-panel.js:775-817 — card headline pattern
function _buildCostOfOwnership(coo, entry) {
    var card = document.createElement("div");
    card.className = "coo-card";
    if (coo.overridden) card.classList.add("coo-overridden");

    var head = document.createElement("div");
    head.className = "coo-headline";
    ...
    var editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "coo-edit-btn";
    editBtn.textContent = "Edit";
    right.appendChild(editBtn);
    ...
}
```

```javascript
// detail-panel.js:924-961 — fetch → replaceCard pattern for the new endpoints
saveBtn.addEventListener("click", function () {
    var body = {};
    Object.keys(inputs).forEach(function (k) {
        var v = inputs[k].value.trim();
        if (v !== "") body[k] = Number(v);
    });
    saveBtn.disabled = true;
    fetch("/api/entry/" + encodeURIComponent(entry.id) + "/cost-override", {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify(body),
    })
        .then(function (r) { return r.ok ? r.json() : Promise.reject(r); })
        .then(function (j) {
            window.showToast && window.showToast("Cost updated", "success");
            _replaceCard(j.cost_of_ownership);
        })
        .catch(function () {
            saveBtn.disabled = false;
            window.showToast && window.showToast("Save failed", "error");
        });
});
```

New `_buildNegotiationBrief(brief, entry)` and `_buildKuCard(ku, entry)` follow this shape. Append them to `_renderMainPane` right after `_buildCostOfOwnership` at detail-panel.js:446 (brief above KÜ, per D-07 & D-13).

**Sidebar glyph** — extend `_buildSidebarItem` at detail-panel.js:120-129 by appending to `parts[]` a `statusGlyph(entry)` call (defined in RESEARCH.md:992-997). Pitfall 6: default `entry.status || "approved"`.

**Insertion point for "Schedule viewing" / "Mark viewed" buttons** — the existing action row is created only when `isPending` (detail-panel.js:484-544). Executor should add a parallel action row for approved entries (`entry.status === "approved"` → Schedule; `viewing_scheduled` + now ≥ scheduled_at → Mark viewed; always → Regenerate brief / Refresh KÜ).

**Datetime-local → UTC ISO** — see RESEARCH.md:963-989 (`scheduleViewingClick`). Copy verbatim.

---

### `app/static/index.html` (MOD — CSS for new cards)

**Analog:** the `.coo-card` block at index.html:468-527. Mirror class names → `.brief-card`, `.ku-card`. Reuse `--text`, `--text-muted`, `--font-mono` CSS variables. Same padding (`10px 14px` for compact mobile per index.html:216), same border-radius, same "Edit" button styling (`.coo-edit-btn` → `.brief-edit-btn` if regenerate flow needs Edit affordance).

Optional new filter chip / sidebar glyph CSS: append a `.si-status-glyph` class (mirror `.si-pending-dot` at index.html — find it via `.si-` prefix). Executor's discretion per D-CONTEXT.

---

### `app/static/js/ui.js` (MOD — optional overview KPI)

**Analog:** `_refreshSidebarIssueDot(listingId, dotEl)` (detail-panel.js:154-167) — counting entries by a status field.

If executor decides to add an "upcoming viewings" KPI, follow this shape: iterate `window.state.properties`, filter `entry.status === "viewing_scheduled"`, count, set textContent.

---

### `app/tests/test_viewing_workflow.py` (NEW — integration)

**Analog:** `app/tests/test_pending.py::test_ingest_writes_to_pending` (test_pending.py:6-53).

```python
# test_pending.py:6-53 — canonical shape for a POST endpoint integration test
def test_ingest_writes_to_pending(client, tmp_agent_state, mock_send_pending_card, monkeypatch):
    import data_store, ingest_handler

    monkeypatch.setattr(
        ingest_handler,
        "evaluate_listing",
        lambda listing, context_prefix="": {"score": 80, ...},
    )
    ...
    resp = client.post("/api/ingest", json=listing_payload,
                        headers={"Authorization": "Bearer test-token-abc"})
    assert resp.status_code == 200
    data = data_store.load_app_data()
    assert data["pending"][0]["score"] == 80
```

For Phase 6 tests: use `client` fixture (conftest.py:59), seed `app_data.json` via `data_store.save_app_data`, POST to the new endpoint, assert on `data_store.load_app_data()` result.

**Mocking Anthropic in the brief-triggering endpoints:** `monkeypatch.setattr(brief_generator, "generate_negotiation_brief", lambda *a, **k: {"brief_ru": "...", ...})`. Follows test_pending.py:13-24 shape verbatim.

**Fixtures already available in conftest.py:** `client`, `tmp_agent_state`, `mock_telegram` (conftest.py:39-110). Reuse — do not add new fixtures unless a scenario requires it.

---

### `app/tests/test_brief_generator.py` (NEW — unit)

**Analog:** `app/tests/test_pending.py::test_send_pending_card_buttons` (test_pending.py:70-100).

```python
# test_pending.py:70-100 — mocking requests.post with MagicMock
def test_send_pending_card_buttons(monkeypatch):
    from unittest.mock import MagicMock
    import telegram_client
    from kv_listing_parser import Listing

    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {"result": {"message_id": 42, ...}}
    ...
    monkeypatch.setattr(...requests.post..., ...)
```

For brief tests: mock `requests.post` (module-level, `brief_generator.requests.post`), return canned Anthropic response shape `{"content": [{"type": "text", "text": "{\"brief_ru\": \"...\", ...}"}]}`. Assert on the returned dict shape + never-raise on `requests.RequestException`.

---

### `app/tests/test_ku_lookup.py` (NEW — unit)

Same shape as `test_brief_generator.py`. Mock `ku_lookup.requests.get`. Test cases:
- `legal_form == "23"` present → returns dict
- Only `legal_form == "6"` (garage) → returns None (Pitfall 2)
- `requests.RequestException` → returns None (never-raise)
- Malformed JSON → returns None

---

### `app/tests/test_data_store.py` (extend)

**Analog:** `test_pending.py::test_data_model_keys` (test_pending.py:56-67).

```python
# test_pending.py:56-67
def test_data_model_keys(tmp_agent_state):
    import data_store
    data = data_store.load_app_data()
    assert "pending" in data
    ...
    assert data["pending"] == []
```

For Phase 6 add:
- `test_setdefault_status_legacy` — write app_data.json with a `properties[]` entry lacking `status`, load, assert `status == "approved"`.
- `test_set_viewing_scheduled_missing` — call `set_viewing_scheduled("nonexistent-id", ...)`, assert False.
- `test_reschedule_appends_history` — call twice, assert `len(viewing_history) == 2`.
- `test_save_ku_preserves_manual` — set `entry["ku"] = {"auto": {}, "manual": "notes"}`, call `save_ku_enrichment` with new auto, assert `manual == "notes"` (Pitfall 7).

---

## Shared Patterns

### Thread-safe JSON I/O
**Source:** `data_store._lock` + `load_app_data` / `save_app_data` (data_store.py:26, 84-105)
**Apply to:** every helper in this phase that reads or writes properties[]/pending[]/rejected[].

```python
# data_store.py:26
_lock = threading.RLock()

# data_store.py:172-183 — canonical load → mutate → save under lock
with _lock:
    data = load_app_data()
    ...mutate...
    save_app_data(data)
    return True
```

**Critical constraint (Pitfall 5):** never hold `_lock` around the Anthropic call or ariregister GET. See RESEARCH.md:483-503 for the split load-under-lock / call-outside-lock / re-save-under-lock pattern for `generate_and_save_brief(listing_id)`.

### Never-raise on external HTTP
**Source:** `ai_evaluator.evaluate_listing` (ai_evaluator.py:257-315)
**Apply to:** `brief_generator.py`, `ku_lookup.py`, any thread target.

Always catch `requests.RequestException`, `json.JSONDecodeError`, `KeyError`, `ValueError`. Log via `log.exception(...)` or `log.error(...)`. Return a fallback dict (brief) or None (KÜ) — never propagate.

### Daemon-thread dispatch for slow work
**Source:** `main.py:132-136` (`check_now`) and the pattern used in `POST /api/geocode-backfill` (main.py:880-881).

```python
threading.Thread(target=<callable>, args=(...), daemon=True).start()
return {"ok": True, "message": "..."}
```

**Apply to:** `schedule-viewing` (spawns brief-generation), `refresh-ku` (spawns lookup), `regenerate-brief` (spawns brief), `approve_pending` (spawns KÜ lookup on approval hook).

### setdefault-on-load migration
**Source:** `data_store.load_app_data` (data_store.py:84-100)
**Apply to:** every new persistent field. Zero-downtime deploy; legacy JSON keeps loading.

### FastAPI POST endpoint shape
**Source:** `main.py:479-488` (reject_pending) + `main.py:729-781` (cost_override)
**Apply to:** all four new `/api/entry/{id}/...` endpoints.

Shape: `@app.post` decorator, `async def` if body needed / sync if not, `await request.json()`, validate, call `data_store` helper, `HTTPException(404)` on miss, return `{"ok": True, ...}`.

### Detail-panel card + Edit UI
**Source:** `detail-panel.js:775-964` (`_buildCostOfOwnership`)
**Apply to:** `_buildNegotiationBrief`, `_buildKuCard`. Same `card = document.createElement("div"); card.className = "..."-card"`; same headline / body / Edit / fetch / `_replaceCard` pattern; same `window.showToast` for user feedback.

### Test fixture reuse
**Source:** `app/tests/conftest.py` (`client`, `tmp_agent_state`, `mock_telegram`)
**Apply to:** every new test file. Do NOT create parallel fixtures.

---

## No Analog Found

None. Every file in Phase 6 has a strong in-repo analog. The novel logic (post-hoc number-grounding for the brief, `_to_street_query` normaliser for ariregister) is small and self-contained — RESEARCH.md provides concrete draft code for both (RESEARCH.md:721-735 and 806-819).

---

## Metadata

**Analog search scope:** `app/*.py`, `app/static/js/*.js`, `app/static/index.html`, `app/tests/*.py`
**Files scanned:** ~20 backend + frontend files (targeted reads of the identified analogs; no whole-file loads of files > 1000 lines)
**Pattern extraction date:** 2026-07-10
