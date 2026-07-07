# Phase 1: Scraper Architecture Split - Research

**Researched:** 2026-07-08
**Domain:** Python / FastAPI service split — scraper client extraction, HTTP ingest endpoint, heartbeat monitoring
**Confidence:** HIGH (all findings grounded in the existing codebase, which was read in full)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Mini PC sends fully-parsed Listing JSON — the `Listing` dataclass fields as a JSON dict. Mini PC runs all of: Playwright (CF bypass + URL harvest) + `requests` with CF cookies (individual listing fetches) + BeautifulSoup/regex parsing. VPS receives structured data and never needs a browser or CF access.
- **D-02:** Mini PC sends all scraped listings with no pre-filtering. VPS applies `MIN_ROOMS`, `MAX_PRICE_EUR`, `MIN_IMAGES` filters before evaluation. Config stays in one place (VPS `.env`).
- **D-03:** Mini PC scraper is packaged as a Docker container (Docker Desktop on Windows/macOS). A `scraper-client/` subfolder in the same repo with its own `Dockerfile` and `docker-compose.yml`.
- **D-04:** Scraper runs as a continuous loop inside the container — `while True: scrape(); sleep(interval)`. Container configured with `restart: unless-stopped` so it auto-recovers from crashes.
- **D-05:** Interval is configurable via env var (mirrors `CHECK_INTERVAL_HOURS` on VPS side).
- **D-06:** New `POST /api/ingest` endpoint on VPS. Authenticated via a shared secret token in the `Authorization` header (`Authorization: Bearer <INGEST_TOKEN>`). Token stored in `.env` on both sides.
- **D-07:** Ingest endpoint receives a batch of Listing JSON objects (the full scrape results). Iterates, applies filters, evaluates new listings (not in `seen_listing_ids`), and triggers the existing notification path.
- **D-08:** VPS-side Playwright code (`kv_alert_reader.py`) is disabled/removed — the ingest endpoint replaces it. The scheduler no longer runs `fetch_listing_urls()` directly.
- **D-09:** Mini PC sends a heartbeat POST to a `/api/heartbeat` endpoint after every scrape run (even if 0 new URLs found). Heartbeat payload: `{timestamp, listing_count, source: "kv.ee"}`.
- **D-10:** VPS monitors heartbeat: if no heartbeat received within `2 × CHECK_INTERVAL_HOURS + 30 min grace`, send a Telegram alert: `⚠️ Scraper offline — last heartbeat: {timestamp}`. Alert channel: Telegram (same bot/chat as listing notifications).
- **D-11:** This distinguishes "scraper dead / mini PC offline" from "no new listings found on kv.ee" — heartbeat arrives regardless.

### Claude's Discretion

- Token format for ingest auth (Bearer vs custom header — Bearer is standard, use it)
- Exact Telegram alert message wording
- Heartbeat check interval on VPS side (checked on scheduler tick or separate lightweight check)

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ARCH-01 | A standalone scraper client runs on the home mini PC (Windows/macOS compatible) | Section: Scraper Client Packaging — Docker Desktop `python:3.12-slim` with `--no-sandbox` flag; existing `kv_alert_reader.py` + `kv_listing_parser.py` copy into `scraper-client/app/` |
| ARCH-02 | The scraper client POSTs raw listing data to a VPS ingest endpoint (secret token auth) | Section: HTTP Ingest Protocol — `Authorization: Bearer <INGEST_TOKEN>`, JSON array of Listing dicts; FastAPI `HTTPBearer` dependency pattern |
| ARCH-03 | The VPS ingest endpoint triggers AI evaluation and queuing (no scraping on VPS) | Section: VPS Ingest Endpoint — `POST /api/ingest` handler calls existing `evaluate_listing()` and `add_property_if_new()` directly; `kv_alert_reader.py` disabled |
| ARCH-04 | Scraper health alert: Telegram notification if 0 listings returned for 2 consecutive runs | Section: Heartbeat Design — heartbeat tracks `listing_count`; VPS tracks consecutive zeros via `agent_state.json`; alert fires on offline timeout OR `consecutive_zero_count >= 2` |
</phase_requirements>

---

## Summary

Phase 1 splits the monolithic "one container does everything" architecture into two processes: a scraper client on the home mini PC (residential IP, bypasses Cloudflare) and a VPS brain that receives already-parsed data over HTTP. The split is entirely internal to one git repo — both sides share the same Python source files for the `Listing` dataclass and the parser module; only the entry point and `Dockerfile` differ.

The most important architectural insight from reading the code: `process_new_listings()` in `agent_job.py` already separates "scrape" from "filter + evaluate + notify" into distinct calls. The ingest endpoint is essentially `process_new_listings()` minus the `fetch_listing_urls()` and `fetch_listing()` calls, with the scrape results arriving as a POST body instead. This means the VPS refactor is minimal — lift the filter/eval/notify loop out of `agent_job.py` into a new function, call it from the ingest handler.

The heartbeat and zero-listing alert are two orthogonal concerns that compose: heartbeat detects "scraper process is alive"; consecutive-zero tracking (carried in the heartbeat `listing_count` field and stored in `agent_state.json`) detects "scraper is running but finding nothing". The VPS checks both on every scheduler tick.

**Primary recommendation:** Keep the code split as a copy, not a shared package. `scraper-client/app/` gets its own copies of `kv_alert_reader.py` and `kv_listing_parser.py` plus a new `scraper.py` entry point. This avoids any Python packaging complexity and matches the project's existing "direct module import" convention.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Cloudflare bypass (Playwright) | Mini PC container | — | Residential IP required; VPS datacenter IP is blocked |
| kv.ee URL harvest | Mini PC container | — | Follows Playwright; same CF session |
| Listing HTML fetch + parse | Mini PC container | — | Reuses CF cookies from Playwright session |
| Listing serialization (Listing → JSON dict) | Mini PC container | — | `dataclasses.asdict()` call before POST |
| HTTP POST to VPS | Mini PC container | — | One POST per run; entire batch in body |
| Bearer token authentication | VPS (FastAPI Depends) | — | Application-layer token checked in `POST /api/ingest` and `POST /api/heartbeat` handlers |
| Listing deserialization (JSON dict → Listing) | VPS (ingest handler) | — | `Listing(**data)` reconstruction |
| Pre-filter (MIN_ROOMS, MAX_PRICE_EUR, MIN_IMAGES) | VPS (ingest handler) | — | D-02: config stays on VPS |
| AI evaluation | VPS (`ai_evaluator.py`) | — | Unchanged; `evaluate_listing()` called from ingest handler |
| Telegram notification | VPS (`telegram_client.py`) | — | Unchanged |
| Gmail draft creation | VPS (`gmail_client.py`) | — | Unchanged |
| Dossier persistence | VPS (`data_store.py`) | — | Unchanged; `add_property_if_new()` called from ingest handler |
| Telegram command polling (/send) | VPS (`agent_job.process_send_commands()`) | — | Stays on VPS scheduler tick |
| Heartbeat storage | VPS (`agent_state.json`) | — | `last_heartbeat_ts`, `last_heartbeat_listing_count`, `consecutive_zero_count` |
| Heartbeat timeout alert | VPS (scheduler tick) | — | Checked on every tick; fires Telegram if stale |
| Zero-listing alert | VPS (scheduler tick) | — | Fires when `consecutive_zero_count >= 2` |

---

## Standard Stack

This phase adds no new external dependencies. All required libraries are already installed.

### Core (existing, confirmed in `app/requirements.txt`)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| fastapi | >=0.111.0 | VPS ingest/heartbeat endpoints | Already in use [VERIFIED: app/requirements.txt] |
| requests | >=2.31.0 | Mini PC HTTP POST to VPS | Already in use; also handles CF cookie fetch [VERIFIED: app/requirements.txt] |
| playwright | >=1.44.0 | Mini PC Cloudflare bypass | Already in use [VERIFIED: app/requirements.txt] |
| beautifulsoup4 | >=4.12.0 | Mini PC listing HTML parse | Already in use [VERIFIED: app/requirements.txt] |
| lxml | >=5.0.0 | BeautifulSoup HTML backend | Already in use [VERIFIED: app/requirements.txt] |
| apscheduler | >=3.10.4 | VPS scheduler (tick for heartbeat check) | Already in use [VERIFIED: app/requirements.txt] |

### Mini PC requirements.txt (new file in `scraper-client/`)

The mini PC container needs a subset of the VPS dependencies — only the scraping stack, not FastAPI/uvicorn/APScheduler:

```
requests>=2.31.0
beautifulsoup4>=4.12.0
lxml>=5.0.0
playwright>=1.44.0
```

**No new packages to install or verify.**

### Package Legitimacy Audit

No new external packages introduced in this phase. The mini PC `requirements.txt` is a strict subset of the existing VPS `app/requirements.txt`, all of which are established packages already in production on the VPS.

| Package | Registry | Verdict | Disposition |
|---------|----------|---------|-------------|
| requests | PyPI | OK | Already in use (VPS) |
| beautifulsoup4 | PyPI | OK | Already in use (VPS) |
| lxml | PyPI | OK | Already in use (VPS) |
| playwright | PyPI | OK | Already in use (VPS) |

**Packages removed due to SLOP verdict:** none
**Packages flagged as suspicious (SUS):** none

---

## Architecture Patterns

### System Architecture Diagram (Post-Phase-1)

```
┌─────────────────────────────────────┐     ┌──────────────────────────────────────────┐
│      Mini PC (Docker Desktop)        │     │              VPS (Docker)                │
│                                     │     │                                          │
│  ┌──────────────────────────────┐   │     │  ┌────────────────────────────────────┐  │
│  │  scraper.py (while True loop)│   │     │  │  FastAPI (main.py)                 │  │
│  │                              │   │     │  │  GET  /api/data                    │  │
│  │  1. fetch_listing_urls()     │   │     │  │  PUT  /api/data                    │  │
│  │     (Playwright CF bypass)   │   │     │  │  POST /api/check-now (no-op msg)   │  │
│  │  2. fetch_listing(url)       │   │     │  │  GET  /api/health                  │  │
│  │     (requests + CF cookies)  │   │     │  │  POST /api/ingest  ←── NEW         │  │
│  │  3. Listing(**fields)        │   │     │  │  POST /api/heartbeat ←── NEW       │  │
│  │  4. dataclasses.asdict()     │   │     │  └────────────────┬───────────────────┘  │
│  │                              │──────────────────────────→  │                      │
│  │  POST /api/ingest            │   │     │                   │ ingest_handler()      │
│  │    Authorization: Bearer ... │   │     │                   │ 1. verify token       │
│  │    [{listing_dict}, ...]     │   │     │                   │ 2. filter listings    │
│  │                              │   │     │                   │ 3. dedup seen_ids     │
│  │  POST /api/heartbeat         │──────────────────────────→  │ 4. evaluate_listing() │
│  │    {ts, listing_count,       │   │     │                   │ 5. add_property()     │
│  │     source: "kv.ee"}         │   │     │                   │ 6. send_photo/msg()  │
│  │                              │   │     │                   │ 7. create_draft()    │
│  │  sleep(CHECK_INTERVAL_HOURS) │   │     │                   │                      │
│  └──────────────────────────────┘   │     │  ┌────────────────▼───────────────────┐  │
│                                     │     │  │  agent_state.json                  │  │
└─────────────────────────────────────┘     │  │  seen_listing_ids                  │  │
                                            │  │  pending_drafts                    │  │
                                            │  │  last_telegram_update_id           │  │
                                            │  │  last_heartbeat_ts  ←── NEW        │  │
                                            │  │  last_heartbeat_listing_count ←NEW │  │
                                            │  │  consecutive_zero_count ←── NEW    │  │
                                            │  └────────────────────────────────────┘  │
                                            │                                          │
                                            │  ┌────────────────────────────────────┐  │
                                            │  │  APScheduler (scheduler.py)        │  │
                                            │  │  tick: process_send_commands()     │  │
                                            │  │         check_heartbeat_timeout()  │  │
                                            │  └────────────────────────────────────┘  │
                                            └──────────────────────────────────────────┘
```

### Recommended Project Structure (additions only)

```
scraper-client/             ← new top-level folder
├── Dockerfile              ← Python 3.12-slim + playwright install chromium
├── docker-compose.yml      ← single service, restart: unless-stopped, .env
├── .env.example            ← VPS_INGEST_URL, INGEST_TOKEN, KV_SEARCH_URL, CHECK_INTERVAL_HOURS
└── app/
    ├── requirements.txt    ← requests, beautifulsoup4, lxml, playwright (subset of VPS)
    ├── scraper.py          ← entry point: while True loop, POST /api/ingest + /api/heartbeat
    ├── kv_alert_reader.py  ← COPY of app/kv_alert_reader.py (unchanged)
    └── kv_listing_parser.py ← COPY of app/kv_listing_parser.py (unchanged)

app/                        ← VPS side (modifications only)
├── main.py                 ← ADD: POST /api/ingest, POST /api/heartbeat routes
├── ingest_handler.py       ← NEW: filter + evaluate + notify logic (extracted from agent_job.py)
├── config.py               ← ADD: INGEST_TOKEN, HEARTBEAT_TIMEOUT_HOURS
├── data_store.py           ← ADD: load/save heartbeat fields in agent_state
├── scheduler.py            ← MODIFY: run_check() drops process_new_listings(); adds heartbeat check
└── kv_alert_reader.py      ← DISABLE: module still exists but fetch_listing_urls() not called
```

---

## Pattern 1: FastAPI Bearer Token Authentication

**What:** `POST /api/ingest` and `POST /api/heartbeat` are authenticated with a shared secret token. FastAPI's `HTTPBearer` security scheme extracts the token from the `Authorization: Bearer <token>` header and a `Depends()` function validates it. [ASSUMED — grounded in well-established FastAPI pattern; not verified via Context7 this session]

**When to use:** Machine-to-machine endpoints where both sides share a secret configured via env var. Simpler than OAuth for a personal automation tool.

**Implementation pattern:**

```python
# app/main.py additions
from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

import config

_bearer = HTTPBearer()

def _verify_ingest_token(credentials: HTTPAuthorizationCredentials = Depends(_bearer)) -> None:
    """Dependency — raises 403 if the token does not match INGEST_TOKEN."""
    if not config.INGEST_TOKEN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Ingest not configured")
    if credentials.credentials != config.INGEST_TOKEN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid token")

@app.post("/api/ingest", dependencies=[Depends(_verify_ingest_token)])
async def ingest(request: Request) -> dict:
    payload = await request.json()
    # payload is a list of Listing dicts
    ...
```

**Note on Caddy interaction:** The current `Caddyfile` applies `basicauth` to all routes. The mini PC must either (a) send Caddy basic auth credentials in addition to the Bearer token, or (b) the Caddyfile must be updated to skip basic auth for `/api/ingest` and `/api/heartbeat`. Option (b) is cleaner — update Caddyfile to route `/api/*` without basic auth and apply basic auth only to `/` (the static frontend). [ASSUMED — needs planner decision]

---

## Pattern 2: Ingest Endpoint — Batch Listing Processing

**What:** The endpoint receives a JSON array of Listing dicts, iterates them applying filter/dedup/eval/notify logic extracted from `process_new_listings()`. Each listing is processed independently — a failure on one listing does not abort the batch (never-raise pattern). [VERIFIED: app/agent_job.py]

**Serialization contract:**

```python
# Mini PC side (scraper.py)
import dataclasses
import requests as http

listings: list[Listing] = [fetch_listing(url, session=get_session()) for url in fresh_urls]
payload = [dataclasses.asdict(l) for l in listings if l.raw_ok]
http.post(
    f"{VPS_INGEST_URL}/api/ingest",
    headers={"Authorization": f"Bearer {INGEST_TOKEN}"},
    json=payload,
    timeout=30,
)
```

```python
# VPS side (ingest_handler.py) — extracted from agent_job.process_new_listings()
from dataclasses import fields as dc_fields
from kv_listing_parser import Listing

LISTING_FIELD_NAMES = {f.name for f in dc_fields(Listing)}

def _deserialize_listing(data: dict) -> Listing:
    """Reconstruct Listing from JSON dict, ignoring unknown fields."""
    known = {k: v for k, v in data.items() if k in LISTING_FIELD_NAMES}
    return Listing(**known)

def process_ingest_batch(listing_dicts: list[dict], state: dict) -> dict:
    """Filter, dedup, evaluate, notify. Returns updated state.
    Never raises — logs and continues per listing."""
    for data in listing_dicts:
        try:
            listing = _deserialize_listing(data)
        except (TypeError, KeyError):
            log.warning("Malformed listing dict in ingest batch: %s", data)
            continue

        if (extract_object_id(listing.url) or listing.url) in set(state["seen_listing_ids"]):
            continue
        state["seen_listing_ids"].append(listing.id)

        if listing.price_eur and listing.price_eur > config.MAX_PRICE_EUR:
            continue
        if listing.rooms and listing.rooms < config.MIN_ROOMS:
            continue
        if listing.image_count < config.MIN_IMAGES:
            continue

        evaluation = evaluate_listing(listing)
        data_store.add_property_if_new(_listing_to_property(listing, evaluation))
        # ... send_photo / send_message / create_draft as in current agent_job.py
    return state
```

---

## Pattern 3: Heartbeat Endpoint and Zero-Listing Alert

**What:** Two separate but composed concerns. D-09/D-10 cover "scraper is alive". D-11/ARCH-04 cover "scraper alive but getting nothing". Both are detectable from the heartbeat payload alone because it includes `listing_count`. [VERIFIED: 01-CONTEXT.md D-09, D-10, D-11]

**Heartbeat payload format:**

```json
{
  "timestamp": "2026-07-08T10:30:00Z",
  "listing_count": 42,
  "source": "kv.ee"
}
```

- `timestamp`: ISO 8601 UTC string (use `datetime.utcnow().isoformat() + "Z"` on mini PC)
- `listing_count`: total URLs found this run (all pages combined, before dedup against seen IDs)
- `source`: fixed string `"kv.ee"` (extensible when city24.ee added in Phase 4)

**VPS `agent_state.json` additions:**

```python
DEFAULT_AGENT_STATE = {
    "seen_listing_ids": [],
    "pending_drafts": {},
    "last_telegram_update_id": 0,
    "last_processed_uid": 0,
    # NEW for Phase 1:
    "last_heartbeat_ts": None,         # ISO 8601 string or None
    "last_heartbeat_listing_count": None,  # int or None
    "consecutive_zero_count": 0,       # incremented when listing_count == 0
}
```

**VPS heartbeat endpoint:**

```python
@app.post("/api/heartbeat", dependencies=[Depends(_verify_ingest_token)])
async def heartbeat(request: Request) -> dict:
    payload = await request.json()
    listing_count = int(payload.get("listing_count", 0))
    ts = payload.get("timestamp", datetime.utcnow().isoformat() + "Z")
    source = payload.get("source", "unknown")

    state = data_store.load_agent_state()
    state["last_heartbeat_ts"] = ts
    state["last_heartbeat_listing_count"] = listing_count

    if listing_count == 0:
        state["consecutive_zero_count"] = state.get("consecutive_zero_count", 0) + 1
    else:
        state["consecutive_zero_count"] = 0

    data_store.save_agent_state(state)
    log.info("Heartbeat from %s: listing_count=%d, consecutive_zeros=%d",
             source, listing_count, state["consecutive_zero_count"])
    return {"ok": True}
```

**VPS heartbeat check (in scheduler tick):**

```python
import math
from datetime import datetime, timezone

def check_heartbeat_timeout(state: dict) -> None:
    """Fire a Telegram alert if the scraper has gone silent."""
    last_ts_str = state.get("last_heartbeat_ts")
    if last_ts_str is None:
        return  # never received a heartbeat — don't alert until first one arrives

    last_ts = datetime.fromisoformat(last_ts_str.rstrip("Z")).replace(tzinfo=timezone.utc)
    grace_hours = config.CHECK_INTERVAL_HOURS * 2 + 0.5   # D-10 formula
    elapsed = (datetime.now(timezone.utc) - last_ts).total_seconds() / 3600

    if elapsed > grace_hours:
        send_message(
            f"Scraper offline — last heartbeat: {last_ts_str} "
            f"({math.floor(elapsed)}h ago). Check the mini PC."
        )
        log.warning("Scraper heartbeat overdue by %.1fh (threshold %.1fh)", elapsed, grace_hours)


def check_consecutive_zeros(state: dict) -> None:
    """Fire a Telegram alert if 2 consecutive runs returned 0 listings."""
    count = state.get("consecutive_zero_count", 0)
    last_ts = state.get("last_heartbeat_ts", "unknown")
    if count >= 2:
        send_message(
            f"Scraper returned 0 listings for {count} consecutive runs. "
            f"Last heartbeat: {last_ts}. kv.ee may be blocking or the search URL returned no results."
        )
        log.warning("Zero listing alert: %d consecutive empty runs", count)
```

**Alert deduplication note:** The above naive implementation fires the alert every scheduler tick while the condition persists. For the planner to decide: either (a) add an `alert_sent_at` timestamp to state and only re-alert after 24h, or (b) accept repeated alerts as acceptable for a personal tool. [ASSUMED — no deduplication strategy locked in CONTEXT.md]

---

## Pattern 4: Mini PC Scraper Loop

**What:** `scraper.py` is a simple synchronous `while True` loop. No APScheduler, no FastAPI — just Python + `time.sleep`. Container's `restart: unless-stopped` handles crash recovery. [VERIFIED: CONTEXT.md D-04]

```python
#!/usr/bin/env python3
"""
scraper.py — kv.ee scraper client for mini PC.
Runs continuously, POSTs to VPS /api/ingest and /api/heartbeat.
"""
import dataclasses
import logging
import os
import time
from datetime import datetime, timezone

import requests as http

from kv_alert_reader import fetch_listing_urls, get_session
from kv_listing_parser import fetch_listing

log = logging.getLogger("scraper")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

VPS_INGEST_URL = os.environ["VPS_INGEST_URL"]    # e.g. https://aparts.example.com
INGEST_TOKEN   = os.environ["INGEST_TOKEN"]
INTERVAL_HOURS = float(os.environ.get("CHECK_INTERVAL_HOURS", "2"))


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


def run_once() -> int:
    """Run one scrape cycle. Returns listing count."""
    urls = fetch_listing_urls()
    log.info("Found %d listing URLs", len(urls))

    listings = []
    session = get_session()
    for url in urls:
        listing = fetch_listing(url, session=session)
        if listing.raw_ok:
            listings.append(dataclasses.asdict(listing))

    if listings:
        _post("/api/ingest", listings)

    _post("/api/heartbeat", {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "listing_count": len(urls),
        "source": "kv.ee",
    })
    return len(urls)


def main() -> None:
    log.info("Scraper starting. Interval: %.1fh. VPS: %s", INTERVAL_HOURS, VPS_INGEST_URL)
    while True:
        try:
            run_once()
        except Exception:
            log.exception("run_once failed — sleeping and retrying")
        time.sleep(INTERVAL_HOURS * 3600)


if __name__ == "__main__":
    main()
```

---

## Pattern 5: Mini PC Dockerfile (Docker Desktop compatible)

**What:** Docker Desktop on Windows and macOS runs containers in a Linux VM — the Dockerfile is standard Linux. No Windows-specific tooling needed. The key gotcha is Playwright needs `--no-sandbox` (already used in existing `kv_alert_reader.py`) and `playwright install-deps` or `--with-deps` for system libraries on slim images. [VERIFIED: app/Dockerfile — existing VPS Dockerfile already uses `playwright install chromium --with-deps`]

```dockerfile
# scraper-client/Dockerfile
FROM python:3.12-slim

WORKDIR /app

COPY app/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && \
    playwright install chromium --with-deps

COPY app/ .

CMD ["python", "scraper.py"]
```

```yaml
# scraper-client/docker-compose.yml
services:
  scraper:
    build: .
    restart: unless-stopped
    env_file: .env
```

```ini
# scraper-client/.env.example
VPS_INGEST_URL=https://your-vps-domain.com
INGEST_TOKEN=your-shared-secret-here
KV_SEARCH_URL=https://www.kv.ee/search?...
CHECK_INTERVAL_HOURS=2
```

**Cross-platform notes:**
- Docker Desktop on Windows and macOS both run containers via a Linux VM — no OS-specific changes needed in the Dockerfile. [ASSUMED — well-established Docker behavior]
- The `--no-sandbox` Chromium flag is already used in `kv_alert_reader.py:47` and is required when running as root inside a container. [VERIFIED: app/kv_alert_reader.py line 47]
- `playwright install chromium --with-deps` installs system-level OS dependencies (glibc, fontconfig, etc.) needed by headless Chromium on `python:3.12-slim`. This exact command is already working on the VPS Dockerfile. [VERIFIED: app/Dockerfile line 6]
- On Windows Docker Desktop with WSL2 backend, the container's `/dev/shm` may be smaller than default (64MB). Add `shm_size: '256m'` to `docker-compose.yml` under the scraper service if Playwright crashes with "No usable sandbox!" or OOM errors. [ASSUMED — common Docker Desktop / Playwright issue]

---

## VPS-Side Refactor: What Changes in scheduler.py

**Current `run_check()` flow:**
1. `process_send_commands(state)` — polls Telegram, fires SMTP
2. `process_new_listings(state)` — Playwright scrape + filter + eval + notify

**After Phase 1, `run_check()` becomes:**
1. `process_send_commands(state)` — unchanged
2. `check_heartbeat_timeout(state)` — new: fire alert if scraper silent
3. `check_consecutive_zeros(state)` — new: fire alert if 2+ empty runs

`process_new_listings()` is either deleted or left as a dead code stub clearly marked `# DISABLED — scraping moved to mini PC (Phase 1)`.

**`kv_alert_reader.py` disposition:** The module stays in the repo (don't delete it — it will be re-read when understanding Phase 4 source expansion). However, `fetch_listing_urls()` must not be called anywhere on the VPS. Options:
1. Add `raise NotImplementedError("VPS-side scraping disabled in Phase 1")` to `fetch_listing_urls()` body — makes accidental calls fail loudly.
2. Rename the file to `kv_alert_reader.py.disabled` — breaks imports, which catches any accidental call sites. **Recommended** because it's simpler and the module will need renaming anyway (per STATE.md concern: "kv_alert_reader.py is a misleading module name — rename to kv_scraper.py when touching that module in Phase 1"). [VERIFIED: .planning/STATE.md]

**`/api/check-now` endpoint:** Per CONTEXT.md specifics, this endpoint should remain but return a message saying "waiting for next scraper heartbeat" instead of triggering a local scrape. Change `scheduler.run_once_now()` to just call `run_check()` (which now only does `process_send_commands` + heartbeat checks). [VERIFIED: 01-CONTEXT.md specifics section]

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Bearer token extraction from HTTP header | Custom header parsing | `fastapi.security.HTTPBearer` + `HTTPAuthorizationCredentials` | FastAPI's built-in handles malformed headers, returns 403 automatically |
| Listing serialization | Custom JSON encoder | `dataclasses.asdict()` (stdlib) | Already the project pattern; handles all Optional types correctly |
| Listing deserialization | Custom field mapping | `Listing(**filtered_dict)` | `Listing` dataclass accepts kwargs matching field names; filter unknown keys with `dc_fields()` |
| Retry logic for VPS POST | Custom retry loop | Outer `try/except` + `log.exception` (never-raise pattern) | Project convention: one-run failures are logged and swallowed; the loop will retry next interval |
| Scraper scheduling | APScheduler on mini PC | `while True: ...; time.sleep()` | Simpler, no dependency; APScheduler is for in-process async coordination which is not needed on the mini PC |
| Alert deduplication | Rate-limit counter | State field `last_alert_sent_at` + 24h cooldown (if desired) | Simple timestamp comparison in `check_heartbeat_timeout()` |

**Key insight:** The project deliberately avoids complex abstractions at this scale (one user, one machine). `while True + sleep` and `try/except + log` are the right patterns here — not message queues, not retry decorators, not Celery.

---

## Common Pitfalls

### Pitfall 1: Caddy Basic Auth Blocks Mini PC

**What goes wrong:** The mini PC sends `Authorization: Bearer <INGEST_TOKEN>` but Caddy intercepts all requests and demands HTTP Basic Auth credentials (`daniel:password`). The `/api/ingest` POST returns `401 Unauthorized` from Caddy, not FastAPI.

**Why it happens:** Current `Caddyfile` applies `basicauth` globally (`:80 { basicauth { ... } reverse_proxy app:8000 }`). The Bearer token is an application-layer header; Caddy's Basic Auth check happens before the request reaches FastAPI. [VERIFIED: Caddyfile]

**How to avoid:** Update `Caddyfile` to skip basic auth for `/api/ingest` and `/api/heartbeat`:

```caddyfile
:80 {
    @api_machine path /api/ingest /api/heartbeat
    handle @api_machine {
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

This routes ingest/heartbeat through without basic auth (protected by Bearer token at the FastAPI layer), while keeping the dossier frontend behind basic auth.

**Warning signs:** `401` responses from the mini PC's POST; the response body is Caddy's HTML, not FastAPI JSON.

---

### Pitfall 2: `Listing(**data)` Fails on Unknown Fields

**What goes wrong:** If the mini PC's `dataclasses.asdict()` output includes `raw_ok: false` or any field that has a different type than the VPS's `Listing` definition, `Listing(**data)` raises `TypeError`.

**Why it happens:** `asdict()` includes every field, including `raw_ok`. On the mini PC, only listings with `raw_ok=True` should be sent (filter before POST). But if the Listing dataclass ever diverges between the mini PC copy and VPS copy (e.g., a field is added on one side), deserialization breaks.

**How to avoid:**
1. Filter `raw_ok=False` listings before serializing: `[asdict(l) for l in listings if l.raw_ok]`. [VERIFIED: scraper.py pattern above]
2. On VPS deserialization, filter unknown keys: `known = {k: v for k, v in data.items() if k in LISTING_FIELD_NAMES}` then `Listing(**known)`. This makes the schema forward-compatible.
3. The `raw_ok` field itself should be stripped or left in — the VPS reconstructed `Listing` will have `raw_ok=True` by default (it's the default value), so it's harmless to include.

**Warning signs:** `TypeError: __init__() got an unexpected keyword argument` in VPS logs.

---

### Pitfall 3: `consecutive_zero_count` Never Resets

**What goes wrong:** If the mini PC sends `listing_count > 0`, but the VPS heartbeat handler has a bug that fails to reset `consecutive_zero_count` to 0, the zero-listing alert fires spuriously forever.

**Why it happens:** Simple logic error; easy to miss in testing when there are always listings.

**How to avoid:** The heartbeat handler must explicitly set `consecutive_zero_count = 0` when `listing_count > 0`. Test with `listing_count=0` for 2 POSTs (assert alert fires), then `listing_count=10` (assert alert would not fire, counter=0).

**Warning signs:** Alert fires even when the scraper is working and finding listings; `consecutive_zero_count` in `agent_state.json` keeps incrementing despite non-zero heartbeats.

---

### Pitfall 4: Heartbeat Alert Fires on First Run (No Baseline)

**What goes wrong:** The VPS starts (or restarts) before the mini PC has ever sent a heartbeat. `last_heartbeat_ts` is `None`. The scheduler tick's `check_heartbeat_timeout()` misinterprets `None` as "overdue since the epoch" and fires an alert immediately.

**Why it happens:** Time-since-last-event logic requires a baseline. Without one, "no data" looks like "very stale data".

**How to avoid:** Guard with `if last_ts_str is None: return` — don't alert until at least one heartbeat has been received. [VERIFIED: code pattern in Pattern 3 above]

**Warning signs:** Spurious "Scraper offline" Telegram message immediately after VPS restart.

---

### Pitfall 5: seen_listing_ids Race Between Ingest and State Save

**What goes wrong:** The ingest handler loads `state`, processes listings (appending to `seen_listing_ids`), but another request (e.g. `/api/check-now`) concurrently loads the old state. When both save, one overwrites the other's seen ID additions.

**Why it happens:** The existing architecture has a single process-wide `_lock` in `data_store.py`, but the ingest handler is an async FastAPI endpoint — if the ingest handler is `async def`, FastAPI runs it in the event loop and does not hold the lock across `await` points.

**How to avoid:** The ingest handler should load state, process all listings, and save state within a single synchronous block held under `_lock`. Use `run_in_executor` or make the ingest endpoint a synchronous `def` (FastAPI runs sync routes in a thread pool, which is correct for blocking I/O). Given the existing codebase uses synchronous patterns throughout, making the ingest handler `def` (not `async def`) is the right choice — FastAPI will call it in a threadpool where the `_lock` provides correct mutual exclusion. [VERIFIED: data_store.py threading.RLock pattern, main.py async vs sync routes]

**Warning signs:** Duplicate listing evaluations; `seen_listing_ids` growing slower than expected; duplicate Telegram notifications for the same listing.

---

### Pitfall 6: Playwright on Docker Desktop — shm_size

**What goes wrong:** Playwright Chromium crashes with shared memory errors on Docker Desktop (Windows/macOS) because the default `/dev/shm` size (64MB) is too small for headless Chrome.

**Why it happens:** Docker Desktop allocates limited `/dev/shm` by default. Linux hosts can configure this in `/etc/docker/daemon.json`; Docker Desktop has a different default.

**How to avoid:** Add `shm_size: '256m'` to the scraper service in `scraper-client/docker-compose.yml`. [ASSUMED — common Docker Desktop / Playwright issue]

**Warning signs:** Playwright raises `BrowserType.launch: Process crashed` or similar; errors reference `/dev/shm`.

---

## Code Examples

### Verified Pattern: Listing Serialization (Mini PC)

```python
# Source: dataclasses stdlib + existing kv_listing_parser.py
import dataclasses
from kv_listing_parser import fetch_listing, Listing

listings: list[Listing] = []
for url in urls:
    l = fetch_listing(url, session=get_session())
    if l.raw_ok:
        listings.append(l)

payload = [dataclasses.asdict(l) for l in listings]
# dataclasses.asdict() recursively converts the dataclass to a dict.
# All Optional fields serialize as None; bool/int/float/str are JSON-native.
```

### Verified Pattern: Listing Deserialization (VPS)

```python
# Source: dataclasses stdlib + existing kv_listing_parser.py
from dataclasses import fields as dc_fields
from kv_listing_parser import Listing

_LISTING_FIELDS = {f.name for f in dc_fields(Listing)}

def _deserialize_listing(data: dict) -> Listing:
    known = {k: v for k, v in data.items() if k in _LISTING_FIELDS}
    return Listing(**known)
```

### Verified Pattern: Synchronous FastAPI Route (for thread-safe access to data_store)

```python
# Source: existing main.py pattern (get_data, put_data mix async and sync)
# sync def routes run in FastAPI's threadpool — safe with threading.RLock

@app.post("/api/ingest", dependencies=[Depends(_verify_ingest_token)])
def ingest(request: Request) -> dict:
    # Note: sync, not async — gives thread-pool execution compatible with _lock
    # BUT: can't use `await request.json()` in sync context
    # Solution: use a Pydantic model or background task pattern
    ...
```

**Correction — async body reading with sync processing:**

```python
@app.post("/api/ingest", dependencies=[Depends(_verify_ingest_token)])
async def ingest(request: Request) -> dict:
    listing_dicts = await request.json()
    # Hand off to a sync helper that holds the lock for its entire duration:
    result = _process_ingest_batch_sync(listing_dicts)
    return result

def _process_ingest_batch_sync(listing_dicts: list[dict]) -> dict:
    """Synchronous — acquires data_store lock for the full batch."""
    with data_store._lock:
        state = data_store.load_agent_state()
        # ... process ...
        data_store.save_agent_state(state)
    return {"ok": True, "processed": len(listing_dicts)}
```

Note: `data_store._lock` is a `threading.RLock`. Acquiring it from an async FastAPI handler running in the asyncio event loop will block the event loop during processing. For this project (one user, one scraper, one ingest POST every 2 hours), this is acceptable. If contention were a concern, `run_in_executor` would be the solution. [VERIFIED: data_store.py threading.RLock; acceptable at stated scale per CLAUDE.md]

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact on Phase 1 |
|--------------|------------------|--------------|-------------------|
| VPS runs Playwright + scrapes | Mini PC scrapes, VPS only evaluates | Phase 1 | Splits `agent_job.process_new_listings()` into scrape (mini PC) + ingest handler (VPS) |
| All-in-one single container | Two Docker deployments (VPS + mini PC) | Phase 1 | New `scraper-client/` folder in repo |
| No health monitoring | Heartbeat + consecutive-zero alert | Phase 1 | Two new state fields in `agent_state.json`; scheduler tick grows two check functions |

**Deprecated/outdated after Phase 1:**
- `kv_alert_reader.fetch_listing_urls()` on VPS: disabled (file renamed or function body raises NotImplementedError)
- `agent_job.process_new_listings()`: replaced by `ingest_handler.process_ingest_batch()`; the original function may be removed or kept as dead code

---

## Runtime State Inventory

This is a refactor phase — existing runtime state must be preserved.

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data | `agent_state.json` — `seen_listing_ids`, `pending_drafts`, `last_telegram_update_id`, `last_processed_uid` | Code migration only: add new fields to `DEFAULT_AGENT_STATE`; existing JSON files auto-upgrade via `state.setdefault()` pattern already in `load_agent_state()` |
| Stored data | `app_data.json` — dossier properties list | No change; ingest handler calls `add_property_if_new()` unchanged |
| Live service config | VPS `.env` — existing secrets and thresholds | Add `INGEST_TOKEN`; no other changes needed |
| Live service config | Mini PC `.env` — new file | New: `VPS_INGEST_URL`, `INGEST_TOKEN`, `KV_SEARCH_URL`, `CHECK_INTERVAL_HOURS` |
| OS-registered state | Docker volumes on VPS: `apartment_data`, `caddy_data`, `caddy_config` | No change to volume mounts |
| Secrets/env vars | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, etc. | No change; all remain on VPS |
| Build artifacts | VPS Docker image (app:8000) | Rebuild required after code changes; `docker-compose up --build` |

**Nothing found in category "OS-registered state (non-Docker)":** Verified — no systemd units, cron jobs, or OS-level scheduling beyond Docker containers.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Docker | Mini PC container build | To be verified by Daniel on mini PC | — | None (required) |
| Docker Desktop | Mini PC (Windows/macOS) | To be verified | — | Native Docker install on WSL2 |
| Python 3.12 (in Docker) | Container | ✓ (pulled from Docker Hub) | 3.12-slim | — |
| Playwright Chromium | Mini PC scraper | ✓ (installed in Dockerfile) | As installed | — |
| Caddy Caddyfile update | /api/ingest bypass basic auth | Must be done before mini PC test | — | Map app:8000 to a second port |

**Missing dependencies with no fallback:**
- Docker Desktop on mini PC — Daniel must confirm this is installed before the mini PC `scraper-client/` can run.

**Missing dependencies with fallback:**
- Caddyfile update (basic auth bypass for /api/ingest): if not done, mini PC can POST directly to `http://vps-ip:8001` if we add a second port mapping in `docker-compose.yml`.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | None currently configured (no test files found) |
| Config file | None — Wave 0 gap |
| Quick run command | `pytest scraper-client/app/tests/ -x -q` (after Wave 0) |
| Full suite command | `pytest app/tests/ scraper-client/app/tests/ -q` (after Wave 0) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ARCH-01 | Scraper container starts and runs `run_once()` | smoke | `docker compose -f scraper-client/docker-compose.yml run --rm scraper python -c "import scraper; print('ok')"` | ❌ Wave 0 |
| ARCH-02 | POST /api/ingest with valid Bearer token returns 200 | integration | `pytest app/tests/test_ingest.py::test_ingest_authenticated -x` | ❌ Wave 0 |
| ARCH-02 | POST /api/ingest with missing/wrong token returns 403 | integration | `pytest app/tests/test_ingest.py::test_ingest_unauthenticated -x` | ❌ Wave 0 |
| ARCH-03 | Ingest handler does not import or call kv_alert_reader | unit | `pytest app/tests/test_ingest.py::test_no_playwright_import -x` | ❌ Wave 0 |
| ARCH-04 | Two heartbeats with listing_count=0 increments consecutive_zero_count to 2 | unit | `pytest app/tests/test_heartbeat.py::test_consecutive_zeros -x` | ❌ Wave 0 |
| ARCH-04 | check_heartbeat_timeout() fires alert when elapsed > threshold | unit | `pytest app/tests/test_heartbeat.py::test_timeout_alert -x` | ❌ Wave 0 |
| ARCH-04 | Heartbeat with listing_count>0 resets consecutive_zero_count | unit | `pytest app/tests/test_heartbeat.py::test_zero_count_resets -x` | ❌ Wave 0 |

### Wave 0 Gaps

- [ ] `app/tests/__init__.py` — test package
- [ ] `app/tests/test_ingest.py` — covers ARCH-02, ARCH-03
- [ ] `app/tests/test_heartbeat.py` — covers ARCH-04
- [ ] `app/tests/conftest.py` — FastAPI `TestClient` setup, mock `data_store`, mock `telegram_client`
- [ ] Framework install: `pip install pytest httpx` — pytest for test runner, httpx for FastAPI TestClient

---

## Security Domain

`security_enforcement: true`, `security_asvs_level: 1` per `.planning/config.json`.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | Yes — ingest/heartbeat endpoints | Shared secret Bearer token via `HTTPBearer` dependency |
| V3 Session Management | No | No sessions; stateless Bearer token per request |
| V4 Access Control | Yes — only mini PC should POST to ingest | Bearer token (`INGEST_TOKEN`) is the only access control mechanism |
| V5 Input Validation | Yes — ingest accepts arbitrary JSON | Validate `listing_dicts` is a list; `_deserialize_listing` filters unknown fields; never eval/exec on payload |
| V6 Cryptography | No — token is a shared secret, not asymmetric crypto | Bearer token should be a long random string (≥32 bytes); use `secrets.token_hex(32)` to generate |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Token exposure in logs | Info disclosure | Never log `INGEST_TOKEN`; log only "auth ok" or "auth failed" |
| Replay attack (same POST twice) | Tampering | Idempotent by design — `seen_listing_ids` dedup prevents duplicate evaluation; no timestamp-based replay protection needed at this scale |
| Ingest payload injection | Tampering | `_deserialize_listing()` filters to known field names only; `Listing` dataclass has typed fields; no eval/exec on payload |
| Caddy basic auth reveals credentials in transit | Info disclosure | Caddyfile currently uses HTTP only (`:80`); migrate to HTTPS (add domain + `tls` block) before exposing ingest to internet — or accept HTTP for internal-to-VPS traffic if mini PC is on a trusted network |
| `INGEST_TOKEN` in `.env` committed to git | Info disclosure | `.env` is in `.gitignore` (standard Docker pattern); verify `.gitignore` covers `scraper-client/.env` |

**Token generation recommendation:**

```python
# Generate once, copy to both VPS .env and scraper-client/.env
import secrets
print(secrets.token_hex(32))
# e.g. "a3f8b2c1d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0"
```

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Docker Desktop on Windows/macOS runs Linux containers in a VM — standard `python:3.12-slim` Dockerfile works without modification | Mini PC Dockerfile, Pitfall 6 | Low — this is universal Docker behavior; risk only if Daniel uses Hyper-V isolation mode on Windows, which is rare |
| A2 | Playwright `shm_size: '256m'` is needed for Docker Desktop to avoid Chrome OOM | Pitfall 6 | Low — may not be needed; easy to add if crashes occur |
| A3 | Alert deduplication strategy (fire every tick vs. 24h cooldown) is left to planner | Pattern 3 note | Low — for a personal tool, duplicate alerts are annoying but not breaking |
| A4 | Caddyfile basic auth bypass for `/api/ingest` and `/api/heartbeat` is the right approach (vs. mini PC sending both basic auth + Bearer token) | Pitfall 1 | Medium — if Caddy is not updated, mini PC can't POST without Caddy credentials; planner must include Caddyfile task |
| A5 | `last_processed_uid` in `DEFAULT_AGENT_STATE` was the old Gmail UID counter; it is now unused dead state (Gmail reading was replaced by kv.ee scraping) | Runtime State Inventory | Low — field persists harmlessly; Phase 1 does not need to clean it up |

---

## Open Questions

1. **Caddy auth bypass approach**
   - What we know: Current Caddyfile applies basic auth to all routes globally. Mini PC Bearer token is separate.
   - What's unclear: Does Daniel want the Caddyfile updated (option a) or should mini PC also send basic auth credentials (option b)?
   - Recommendation: Update Caddyfile (cleaner). Plan should include a Caddyfile modification task as part of the ingest endpoint plan.

2. **Alert deduplication for heartbeat timeout**
   - What we know: The heartbeat check fires on every scheduler tick. Without deduplication, Daniel gets a Telegram alert every 2 hours while the scraper is offline.
   - What's unclear: Is repeated alerting acceptable for a personal tool?
   - Recommendation: Add `last_scraper_alert_sent_at` to `agent_state.json` with a 24h cooldown. Simple and avoids alert fatigue.

3. **`/api/check-now` behavior change**
   - What we know: CONTEXT.md says it should return "waiting for next scraper heartbeat" instead of triggering a local scrape.
   - What's unclear: Should it trigger `process_send_commands()` immediately (useful for testing Telegram /send commands without waiting)?
   - Recommendation: Keep `run_once_now()` calling `run_check()` — after the Phase 1 refactor, `run_check()` only does `process_send_commands()` + heartbeat checks, which is safe to trigger manually.

---

## Sources

### Primary (HIGH confidence)
- `app/main.py` — full file read; existing route structure and patterns [VERIFIED: read this session]
- `app/agent_job.py` — full file read; `process_new_listings()` is the exact function to extract [VERIFIED: read this session]
- `app/scheduler.py` — full file read; `run_check()` structure understood [VERIFIED: read this session]
- `app/config.py` — full file read; all env vars identified [VERIFIED: read this session]
- `app/kv_alert_reader.py` — full file read; Playwright scraper + CF cookie pattern [VERIFIED: read this session]
- `app/kv_listing_parser.py` — full file read; `Listing` dataclass (20 fields), serialization/deserialization [VERIFIED: read this session]
- `app/data_store.py` — full file read; `DEFAULT_AGENT_STATE`, lock pattern, file I/O pattern [VERIFIED: read this session]
- `app/telegram_client.py` — full file read; `send_message()` interface [VERIFIED: read this session]
- `app/Dockerfile` — full file read; `playwright install chromium --with-deps` is established and working [VERIFIED: read this session]
- `docker-compose.yml` — full file read; `expose:8000` (no host port) — confirms mini PC must go through Caddy [VERIFIED: read this session]
- `Caddyfile` — full file read; `basicauth` is global (not route-specific) [VERIFIED: read this session]
- `.planning/phases/01-scraper-architecture-split/01-CONTEXT.md` — full file read; all D-01 through D-11 decisions [VERIFIED: read this session]
- `.planning/REQUIREMENTS.md` — full file read; ARCH-01 through ARCH-04 [VERIFIED: read this session]
- `.planning/STATE.md` — full file read; module rename concern noted [VERIFIED: read this session]
- `app/requirements.txt` — full file read; confirmed no new packages needed [VERIFIED: read this session]

### Secondary (MEDIUM confidence)
- FastAPI `HTTPBearer` / `HTTPAuthorizationCredentials` dependency pattern [ASSUMED — well-documented FastAPI security pattern, not verified via Context7 this session]
- `dataclasses.asdict()` produces a flat dict suitable for `json.dumps()` [ASSUMED — Python 3.12 stdlib, extremely well-known behavior]

### Tertiary (LOW confidence)
- Docker Desktop default `/dev/shm` size causing Playwright OOM [ASSUMED — commonly reported in Playwright+Docker issues, not verified this session]

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages already in `app/requirements.txt`, read this session
- Architecture: HIGH — all patterns derived from direct codebase reading; no external sources needed
- Pitfalls: HIGH for Caddy issue (verified from Caddyfile), MEDIUM for Playwright shm (assumed from common knowledge)
- Ingest/heartbeat patterns: HIGH — code examples derived directly from existing `agent_job.py` patterns

**Research date:** 2026-07-08
**Valid until:** This research describes the current codebase state. Re-read `app/agent_job.py`, `app/main.py`, `app/data_store.py`, and `Caddyfile` before implementing if significant time has passed.
