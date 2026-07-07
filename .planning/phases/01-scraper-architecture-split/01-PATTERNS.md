# Phase 1: Scraper Architecture Split - Pattern Map

**Mapped:** 2026-07-08
**Files analyzed:** 18 (11 new, 7 modified/config)
**Analogs found:** 18 / 18

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `scraper-client/app/scraper.py` | service (entry point) | event-driven loop | `app/agent_job.py` `run_check()` | role-match |
| `scraper-client/app/kv_scraper.py` | service (scraper) | request-response | `app/kv_alert_reader.py` | exact copy |
| `scraper-client/app/kv_listing_parser.py` | utility (parser) | request-response | `app/kv_listing_parser.py` | exact copy |
| `scraper-client/Dockerfile` | config | — | `app/Dockerfile` | exact |
| `scraper-client/docker-compose.yml` | config | — | `docker-compose.yml` | role-match |
| `scraper-client/.env.example` | config | — | `.env` (pattern only) | role-match |
| `app/ingest_handler.py` | service | batch / CRUD | `app/agent_job.py` `process_new_listings()` | exact |
| `app/main.py` (modified) | controller | request-response | `app/main.py` existing routes | exact |
| `app/agent_job.py` (modified) | service | event-driven | `app/agent_job.py` `run_check()` | exact |
| `app/config.py` (modified) | config | — | `app/config.py` existing vars | exact |
| `app/data_store.py` (modified) | utility | CRUD | `app/data_store.py` `DEFAULT_AGENT_STATE` | exact |
| `app/tests/__init__.py` | test | — | none | no analog |
| `app/tests/conftest.py` | test | — | none | no analog |
| `app/tests/test_ingest.py` | test | request-response | `app/main.py` (route under test) | partial |
| `app/tests/test_heartbeat.py` | test | request-response | `app/main.py` (route under test) | partial |
| `app/tests/test_listing_contract.py` | test | transform | `app/kv_listing_parser.py` `Listing` | partial |
| `app/requirements.txt` (modified) | config | — | `app/requirements.txt` | exact |
| `Caddyfile` (modified) | config | — | `Caddyfile` | exact |

---

## Pattern Assignments

### `scraper-client/app/scraper.py` (service, event-driven loop)

**Analog:** `app/agent_job.py` — the `run_check()` / `process_new_listings()` orchestration pattern, adapted to a `while True` loop without APScheduler.

**Module docstring pattern** (`app/agent_job.py` lines 1-7):
```python
"""
The periodic kv.ee check, adapted from the original GitHub-Actions version to
run in-process on a schedule and write straight into the shared data_store
instead of separate state files. Same logic, one less moving part.
"""
```
New file's docstring should explain: "kv.ee scraper client for mini PC. Runs in a while True loop, POSTs fully-parsed Listing JSON to VPS /api/ingest and /api/heartbeat after each run."

**Imports pattern** (`app/agent_job.py` lines 8-21):
```python
import logging

import config
import data_store
from ai_evaluator import evaluate_listing
from kv_alert_reader import fetch_listing_urls, get_session
from kv_listing_parser import fetch_listing, extract_object_id
from telegram_client import (...)
```
Scraper client equivalent — no config/data_store (those are VPS-side), no telegram. Uses `os.environ` directly:
```python
import dataclasses
import logging
import os
import time
from datetime import datetime, timezone

import requests as http

from kv_scraper import fetch_listing_urls, get_session
from kv_listing_parser import fetch_listing
```

**Never-raise outer loop pattern** (`app/agent_job.py` lines 126-138):
```python
def run_check() -> None:
    """Entry point called by the scheduler on each tick. Never raises -
    logs and moves on, so one bad run doesn't kill the background job."""
    log.info("Running kv.ee check...")
    state = data_store.load_agent_state()
    try:
        process_send_commands(state)
        process_new_listings(state)
    except Exception:
        log.exception("agent_job.run_check failed")
    finally:
        data_store.save_agent_state(state)
    log.info("Check complete.")
```
Scraper loop equivalent — same `try/except Exception: log.exception(...)` pattern inside `while True`:
```python
def main() -> None:
    log.info("Scraper starting. Interval: %.1fh. VPS: %s", INTERVAL_HOURS, VPS_INGEST_URL)
    while True:
        try:
            run_once()
        except Exception:
            log.exception("run_once failed — sleeping and retrying")
        time.sleep(INTERVAL_HOURS * 3600)
```

**HTTP POST helper** — follow `app/kv_listing_parser.py` never-raise pattern on network calls (`fetch_listing` lines 98-104):
```python
    try:
        getter = session if session else requests
        resp = getter.get(url, headers=HEADERS, timeout=timeout)
        resp.raise_for_status()
    except requests.RequestException:
        listing.raw_ok = False
        return listing
```
Scraper POST helper:
```python
def _post(path: str, payload) -> None:
    try:
        resp = http.post(
            f"{VPS_INGEST_URL}{path}",
            headers={"Authorization": f"Bearer {INGEST_TOKEN}"},
            json=payload,
            timeout=30,
        )
        resp.raise_for_status()
    except http.RequestException as exc:
        log.error("POST %s failed: %s", path, exc)
```

**Listing serialization** — `dataclasses.asdict()` before POST (no analog in current codebase; this is new):
```python
payload = [dataclasses.asdict(l) for l in listings if l.raw_ok]
```

**Logging setup** — copy from `app/agent_job.py` line 23:
```python
log = logging.getLogger("agent_job")
```
Scraper equivalent: `log = logging.getLogger("scraper")` with `logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")` at module level (needed because this is a standalone script with no FastAPI logging setup).

---

### `scraper-client/app/kv_scraper.py` (service, request-response)

**Analog:** `app/kv_alert_reader.py` — **exact copy** (file renamed from `kv_alert_reader.py` to `kv_scraper.py`).

Only change: update the `from config import KV_SEARCH_URL` import to use `os.environ` directly, since the scraper client has no `config.py` module:
```python
# Original (app/kv_alert_reader.py line 16):
from config import KV_SEARCH_URL

# Replacement in scraper-client/app/kv_scraper.py:
import os
KV_SEARCH_URL = os.environ.get("KV_SEARCH_URL", "")
```

All other code — `LISTING_PATH_RE`, `BASE_URL`, `MAX_PAGES`, `_session`, `get_session()`, `fetch_listing_urls()` — is copied verbatim from `app/kv_alert_reader.py` lines 20-116.

**Module docstring** (`app/kv_alert_reader.py` lines 1-8): update to say "kv.ee scraper for mini PC" instead of references to the original context.

---

### `scraper-client/app/kv_listing_parser.py` (utility, request-response)

**Analog:** `app/kv_listing_parser.py` — **exact copy, no changes needed.**

The `Listing` dataclass is the JSON contract between mini PC and VPS. Both sides must have identical field definitions. Copy verbatim. Do not modify.

---

### `scraper-client/Dockerfile` (config)

**Analog:** `app/Dockerfile` lines 1-16 — same base image, same Playwright install command.

```dockerfile
# app/Dockerfile (full file):
FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && \
    playwright install chromium --with-deps

COPY . .

RUN mkdir -p /app/data
VOLUME ["/app/data"]

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

Scraper client Dockerfile — same base and Playwright install, different CMD (no uvicorn, no VOLUME, no EXPOSE):
```dockerfile
FROM python:3.12-slim

WORKDIR /app

COPY app/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && \
    playwright install chromium --with-deps

COPY app/ .

CMD ["python", "scraper.py"]
```

---

### `scraper-client/docker-compose.yml` (config)

**Analog:** `docker-compose.yml` lines 1-10 (the `app` service block).

```yaml
# docker-compose.yml (app service):
services:
  app:
    build: ./app
    restart: unless-stopped
    env_file: .env
    volumes:
      - apartment_data:/app/data
    expose:
      - "8000"
```

Scraper client equivalent — same `restart: unless-stopped`, no volumes (no data to persist), add `shm_size` for Playwright on Docker Desktop:
```yaml
services:
  scraper:
    build: .
    restart: unless-stopped
    env_file: .env
    shm_size: '256m'
```

---

### `scraper-client/.env.example` (config)

**Analog:** None in codebase. Pattern is standard Docker `.env` convention used by both `docker-compose.yml` files.

Template:
```ini
VPS_INGEST_URL=https://your-vps-domain.com
INGEST_TOKEN=your-shared-secret-here
KV_SEARCH_URL=https://www.kv.ee/search?...
CHECK_INTERVAL_HOURS=2
```

---

### `app/ingest_handler.py` (service, batch / CRUD)

**Analog:** `app/agent_job.py` `process_new_listings()` lines 72-123 — this is the exact body to extract and adapt.

**Source function to copy from** (`app/agent_job.py` lines 72-123):
```python
def process_new_listings(state: dict) -> None:
    new_urls = fetch_listing_urls()
    log.info("Scraped %d total URLs from kv.ee", len(new_urls))

    seen = set(state["seen_listing_ids"])
    fresh_urls = [u for u in new_urls if (extract_object_id(u) or u) not in seen]
    log.info("%d URLs already seen, %d new to process", len(new_urls) - len(fresh_urls), len(fresh_urls))

    for url in fresh_urls:
        log.info("Fetching listing: %s", url)
        listing = fetch_listing(url, session=get_session())
        if not listing.raw_ok:
            log.warning("Failed to fetch listing: %s", url)
            continue

        state["seen_listing_ids"].append(listing.id)

        if listing.price_eur and listing.price_eur > config.MAX_PRICE_EUR:
            log.info("Skipping %s — price %s > max %s", listing.id, listing.price_eur, config.MAX_PRICE_EUR)
            continue
        if listing.rooms and listing.rooms < config.MIN_ROOMS:
            log.info("Skipping %s — rooms %s < min %s", listing.id, listing.rooms, config.MIN_ROOMS)
            continue
        if listing.image_count < config.MIN_IMAGES:
            log.info("Skipping %s — only %d images (min %d), likely inactive", listing.id, listing.image_count, config.MIN_IMAGES)
            continue

        log.info("Evaluating listing %s: %s", listing.id, listing.title)
        evaluation = evaluate_listing(listing)
        log.info("Score: %s/100 — %s", evaluation.get('score'), evaluation.get('verdict'))
        data_store.add_property_if_new(_listing_to_property(listing, evaluation))

        card_text = format_listing_card(listing, evaluation)
        if listing.image_url:
            send_photo(listing.image_url, card_text)
        else:
            send_message(card_text)

        should_draft = (
            evaluation.get("should_draft_email")
            and evaluation.get("score", 0) >= config.DRAFT_SCORE_THRESHOLD
        )
        if should_draft and listing.contact_email:
            subject = evaluation.get("draft_subject") or f"Inquiry about {listing.title}"
            body = evaluation.get("draft_body") or ""
            if create_draft(listing.contact_email, subject, body):
                state["pending_drafts"][listing.id] = {
                    "to_email": listing.contact_email,
                    "subject": subject,
                    "body": body,
                    "url": listing.url,
                }
```

**Also copy `_listing_to_property()`** (`app/agent_job.py` lines 26-48) — moves to `ingest_handler.py` since it is only used by the ingest path.

**Deserialization addition** (new pattern, no analog — per RESEARCH.md Pattern 2):
```python
from dataclasses import fields as dc_fields
from kv_listing_parser import Listing

_LISTING_FIELDS = {f.name for f in dc_fields(Listing)}

def _deserialize_listing(data: dict) -> Listing:
    """Reconstruct Listing from JSON dict, ignoring unknown fields."""
    known = {k: v for k, v in data.items() if k in _LISTING_FIELDS}
    return Listing(**known)
```

**Never-raise per-listing pattern** — same `try/except` + `log.warning` + `continue` as `process_new_listings()` line 84-86.

---

### `app/main.py` (modified — add POST /api/ingest and POST /api/heartbeat)

**Analog:** `app/main.py` existing routes, lines 28-55.

**Existing route pattern to follow** (lines 33-39):
```python
@app.put("/api/data")
async def put_data(request: Request):
    payload = await request.json()
    if not isinstance(payload, dict) or "properties" not in payload:
        return JSONResponse({"error": "expected an object with a 'properties' field"}, status_code=400)
    data_store.save_app_data(payload)
    return {"ok": True}
```

**Existing imports block** (lines 10-16) — extend with FastAPI security imports:
```python
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

import data_store
import scheduler
```
Add: `from fastapi import Depends, FastAPI, HTTPException, Request, status` and `from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer`.

**Auth dependency** (new pattern — per RESEARCH.md Pattern 1):
```python
_bearer = HTTPBearer()

def _verify_ingest_token(credentials: HTTPAuthorizationCredentials = Depends(_bearer)) -> None:
    """Dependency — raises 403 if the token does not match INGEST_TOKEN."""
    if not config.INGEST_TOKEN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Ingest not configured")
    if credentials.credentials != config.INGEST_TOKEN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid token")
```

**Ingest endpoint** — `async def` for body reading, delegates to sync helper (per RESEARCH.md Pattern 2 correction):
```python
@app.post("/api/ingest", dependencies=[Depends(_verify_ingest_token)])
async def ingest(request: Request) -> dict:
    listing_dicts = await request.json()
    return ingest_handler.process_ingest_batch(listing_dicts)
```

**Heartbeat endpoint** — same auth pattern (per RESEARCH.md Pattern 3):
```python
@app.post("/api/heartbeat", dependencies=[Depends(_verify_ingest_token)])
async def heartbeat(request: Request) -> dict:
    payload = await request.json()
    return ingest_handler.handle_heartbeat(payload)
```

**Route ordering** — new routes go before the static mount (line 55), matching existing pattern.

---

### `app/agent_job.py` (modified — remove scraping, add heartbeat checks)

**Analog:** `app/agent_job.py` existing `run_check()` function (lines 126-138) and `process_send_commands()` (lines 51-69).

**`run_check()` after Phase 1** — same structure, remove `process_new_listings()` call, add heartbeat checks:
```python
def run_check() -> None:
    """Entry point called by the scheduler on each tick. Never raises -
    logs and moves on, so one bad run doesn't kill the background job."""
    log.info("Running scheduler tick...")
    state = data_store.load_agent_state()
    try:
        process_send_commands(state)
        check_heartbeat_timeout(state)
        check_consecutive_zeros(state)
    except Exception:
        log.exception("agent_job.run_check failed")
    finally:
        data_store.save_agent_state(state)
    log.info("Tick complete.")
```

**`process_send_commands()`** — unchanged, copy verbatim (lines 51-69).

**`check_heartbeat_timeout()` and `check_consecutive_zeros()`** — new functions, no analog. Pattern derived from existing `send_message()` usage in `process_send_commands()` lines 59, 66, 68.

**Imports to remove** from `app/agent_job.py` (lines 13-14 after Phase 1):
```python
# REMOVE:
from kv_alert_reader import fetch_listing_urls, get_session
from kv_listing_parser import fetch_listing, extract_object_id
```

---

### `app/config.py` (modified — add INGEST_TOKEN, HEARTBEAT_TIMEOUT_HOURS)

**Analog:** `app/config.py` existing env var pattern (lines 8-28).

**Pattern to follow** (lines 23-28):
```python
DRAFT_SCORE_THRESHOLD = int(os.environ.get("DRAFT_SCORE_THRESHOLD", "60"))
MIN_IMAGES = int(os.environ.get("MIN_IMAGES", "5"))
MIN_ROOMS = int(os.environ.get("MIN_ROOMS", "2"))
MAX_PRICE_EUR = int(os.environ.get("MAX_PRICE_EUR", "260000"))

CHECK_INTERVAL_HOURS = float(os.environ.get("CHECK_INTERVAL_HOURS", "2"))
```

New vars follow the same pattern — string for token (no type cast), float for hours:
```python
INGEST_TOKEN = os.environ.get("INGEST_TOKEN", "")
HEARTBEAT_TIMEOUT_HOURS = float(os.environ.get("HEARTBEAT_TIMEOUT_HOURS", "0"))
# 0 means "use the formula: CHECK_INTERVAL_HOURS * 2 + 0.5"
```

---

### `app/data_store.py` (modified — add heartbeat fields to DEFAULT_AGENT_STATE)

**Analog:** `app/data_store.py` line 45 — the `DEFAULT_AGENT_STATE` dict.

**Current default** (line 45):
```python
DEFAULT_AGENT_STATE = {"seen_listing_ids": [], "pending_drafts": {}, "last_telegram_update_id": 0, "last_processed_uid": 0}
```

**Pattern for adding new fields** — `load_agent_state()` uses `state.setdefault(k, v)` (lines 91-95) to forward-upgrade existing JSON files automatically. New fields added to `DEFAULT_AGENT_STATE` are picked up on next load with no migration needed:
```python
def load_agent_state():
    with _lock:
        state = _read_json(config.AGENT_STATE_FILE, DEFAULT_AGENT_STATE)
        for k, v in DEFAULT_AGENT_STATE.items():
            state.setdefault(k, v)
        return state
```

New `DEFAULT_AGENT_STATE`:
```python
DEFAULT_AGENT_STATE = {
    "seen_listing_ids": [],
    "pending_drafts": {},
    "last_telegram_update_id": 0,
    "last_processed_uid": 0,
    # Phase 1: heartbeat tracking
    "last_heartbeat_ts": None,
    "last_heartbeat_listing_count": None,
    "consecutive_zero_count": 0,
    "last_scraper_alert_sent_at": None,
}
```

**Lock pattern for ingest** — use the existing `with _lock:` pattern from `load_agent_state()` / `save_agent_state()` (lines 91-101). The ingest handler wraps its full load-process-save sequence in one `with data_store._lock:` block.

---

### `app/requirements.txt` (modified — add pytest, httpx)

**Analog:** `app/requirements.txt` — existing file (pinned versions).
```
# Add to end of existing requirements.txt:
pytest>=8.0.0
httpx>=0.27.0
```
httpx is required by FastAPI's `TestClient` for async testing. Follow existing pinning style.

---

### `Caddyfile` (modified — skip basicauth for /api/ingest and /api/heartbeat)

**Analog:** `Caddyfile` lines 1-8 — current global basicauth block.

**Current** (lines 3-8):
```caddyfile
:80 {
    basicauth {
        daniel $2a$14$ltXqsLzSQO7XpcFerMU8K.WBtphoHWGYqtUotJhiq.6H5sp2rWB4C
    }
    reverse_proxy app:8000
}
```

**New pattern** — use Caddy named matchers to route machine-to-machine endpoints without basicauth:
```caddyfile
:80 {
    @machine path /api/ingest /api/heartbeat
    handle @machine {
        reverse_proxy app:8000
    }
    handle {
        basicauth {
            daniel $2a$14$ltXqsLzSQO7XpcFerMU8K.WBtphoHWGYqtUotJhiq.6H5sp2rWB4C
        }
        reverse_proxy app:8000
    }
}
```

---

### `app/tests/__init__.py` (test package init)

**Analog:** None in codebase (no tests currently exist).

Empty file — standard Python package marker:
```python
```

---

### `app/tests/conftest.py` (shared test fixtures)

**Analog:** None in codebase. Standard FastAPI TestClient pattern (from RESEARCH.md).

**Pattern** — FastAPI `TestClient` with `app` import and mock overrides:
```python
import pytest
from fastapi.testclient import TestClient

import config
from main import app

@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(config, "INGEST_TOKEN", "test-token-abc")
    return TestClient(app)
```

Mock `data_store` and `telegram_client` via `monkeypatch` on a per-test basis (no shared mock needed in conftest — keep conftest minimal).

---

### `app/tests/test_ingest.py` (integration tests for POST /api/ingest)

**Analog:** `app/main.py` routes (the system under test). Test structure mirrors route behavior.

**Test pattern** — use `conftest.py` `client` fixture, assert on HTTP status and response body:
```python
def test_ingest_authenticated(client, monkeypatch):
    monkeypatch.setattr("ingest_handler.process_ingest_batch", lambda dicts: {"ok": True, "processed": 0})
    resp = client.post(
        "/api/ingest",
        json=[],
        headers={"Authorization": "Bearer test-token-abc"},
    )
    assert resp.status_code == 200

def test_ingest_unauthenticated(client):
    resp = client.post("/api/ingest", json=[])
    assert resp.status_code == 403

def test_ingest_wrong_token(client):
    resp = client.post("/api/ingest", json=[], headers={"Authorization": "Bearer wrong"})
    assert resp.status_code == 403
```

**Import assertion test** — verify `ingest_handler.py` does not import kv_alert_reader or playwright:
```python
def test_no_playwright_import():
    import ingest_handler
    import sys
    assert "playwright" not in sys.modules or "kv_alert_reader" not in dir(ingest_handler)
```

---

### `app/tests/test_heartbeat.py` (unit tests for heartbeat logic)

**Analog:** `app/agent_job.py` heartbeat check functions (to be created). Tests verify state transitions.

**Test pattern** — unit tests on the heartbeat handler function directly (not via HTTP):
```python
def test_consecutive_zeros(monkeypatch):
    # POST heartbeat with listing_count=0 twice; assert consecutive_zero_count == 2
    ...

def test_zero_count_resets(monkeypatch):
    # POST heartbeat with listing_count=0, then listing_count=10; assert counter == 0
    ...

def test_timeout_alert(monkeypatch):
    # Set last_heartbeat_ts to (threshold+1) hours ago; assert send_message called
    ...

def test_no_alert_when_no_baseline(monkeypatch):
    # last_heartbeat_ts is None; assert send_message NOT called
    ...
```

---

### `app/tests/test_listing_contract.py` (Listing serialization tests)

**Analog:** `app/kv_listing_parser.py` `Listing` dataclass (lines 49-69).

**Test pattern** — round-trip serialization: `Listing → asdict → _deserialize_listing → Listing`:
```python
import dataclasses
from kv_listing_parser import Listing
from ingest_handler import _deserialize_listing

def test_listing_roundtrip():
    original = Listing(id="123456", url="https://www.kv.ee/test-123456.html", price_eur=200000, rooms=3)
    serialized = dataclasses.asdict(original)
    reconstructed = _deserialize_listing(serialized)
    assert reconstructed.id == original.id
    assert reconstructed.price_eur == original.price_eur

def test_unknown_fields_ignored():
    data = dataclasses.asdict(Listing(id="1", url="u")) 
    data["future_field"] = "some_value"
    listing = _deserialize_listing(data)  # must not raise
    assert listing.id == "1"
```

---

## Shared Patterns

### Bearer Token Auth Guard
**Source:** `app/main.py` (new pattern, derived from FastAPI docs + RESEARCH.md Pattern 1)
**Apply to:** `POST /api/ingest`, `POST /api/heartbeat`
```python
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

_bearer = HTTPBearer()

def _verify_ingest_token(credentials: HTTPAuthorizationCredentials = Depends(_bearer)) -> None:
    if not config.INGEST_TOKEN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Ingest not configured")
    if credentials.credentials != config.INGEST_TOKEN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid token")
```

### Never-Raise Pattern
**Source:** `app/agent_job.py` lines 126-138 (outer try/except) and `app/kv_listing_parser.py` lines 98-104 (inner per-item try/except)
**Apply to:** `scraper.py` main loop, `ingest_handler.process_ingest_batch()` per-listing loop
```python
# Outer loop (scraper.py):
try:
    run_once()
except Exception:
    log.exception("run_once failed — sleeping and retrying")

# Per-item (ingest_handler.py):
try:
    listing = _deserialize_listing(data)
except (TypeError, KeyError):
    log.warning("Malformed listing dict in ingest batch: %s", data)
    continue
```

### Thread-Safe State Access
**Source:** `app/data_store.py` lines 91-101 (`load_agent_state` / `save_agent_state` with `_lock`)
**Apply to:** `ingest_handler.py` sync batch processing helper
```python
# data_store.py lines 91-101:
def load_agent_state():
    with _lock:
        state = _read_json(config.AGENT_STATE_FILE, DEFAULT_AGENT_STATE)
        for k, v in DEFAULT_AGENT_STATE.items():
            state.setdefault(k, v)
        return state

def save_agent_state(state):
    with _lock:
        _write_json(config.AGENT_STATE_FILE, state)
```
Ingest handler must load, process all listings, and save within a single `with data_store._lock:` block to prevent concurrent state corruption.

### Env Var Config Pattern
**Source:** `app/config.py` lines 8-28
**Apply to:** `app/config.py` new vars (`INGEST_TOKEN`, `HEARTBEAT_TIMEOUT_HOURS`), `scraper-client/app/scraper.py` inline `os.environ` reads
```python
# String var (no cast):
INGEST_TOKEN = os.environ.get("INGEST_TOKEN", "")
# Float var:
CHECK_INTERVAL_HOURS = float(os.environ.get("CHECK_INTERVAL_HOURS", "2"))
# Int var:
DRAFT_SCORE_THRESHOLD = int(os.environ.get("DRAFT_SCORE_THRESHOLD", "60"))
```

### Logging Pattern
**Source:** `app/agent_job.py` line 23, `app/kv_alert_reader.py` line 18
**Apply to:** All new Python modules
```python
log = logging.getLogger("module_name")
# Use:
log.info("...")   # normal operational flow
log.warning("...") # skipped items, recoverable issues
log.error("...")   # errors during operation
log.exception("...") # caught exceptions with traceback
```

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `app/tests/__init__.py` | test | — | No tests exist in codebase yet |
| `app/tests/conftest.py` | test | — | No tests exist; FastAPI TestClient pattern is new |
| `app/tests/test_ingest.py` | test | request-response | No tests exist; standard pytest + TestClient pattern |
| `app/tests/test_heartbeat.py` | test | — | No tests exist |
| `app/tests/test_listing_contract.py` | test | transform | No tests exist |

For these files, use standard pytest + FastAPI `TestClient` conventions (httpx as transport). Reference: FastAPI docs and RESEARCH.md Validation Architecture section.

---

## Metadata

**Analog search scope:** `/Users/danieltjulinov/PycharmProjects/aparts-looker/app/` (all `.py` files), `Caddyfile`, `docker-compose.yml`, `app/Dockerfile`
**Files scanned:** 11 source files read in full
**Pattern extraction date:** 2026-07-08
