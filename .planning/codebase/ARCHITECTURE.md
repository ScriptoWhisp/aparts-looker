# Architecture

**Mapped:** 2026-07-07
**Pattern:** All-in-one monolith — single process, single container

---

## Overview

Single Python process that combines three concerns:
1. **FastAPI web server** — JSON API + static file serving for the apartment dossier frontend
2. **APScheduler background job** — periodic kv.ee scraper + AI evaluator loop
3. **JSON file persistence** — thread-safe state shared between the web layer and the agent

No microservices, no message queue, no separate worker container. One process does everything.

---

## Layers

```
┌─────────────────────────────────────────┐
│ Web Layer (FastAPI)       main.py        │
│  GET /api/data                           │
│  PUT /api/data                           │
│  POST /api/check-now                     │
│  GET /api/health                         │
│  GET / (static HTML)                     │
├─────────────────────────────────────────┤
│ Scheduler Layer           scheduler.py   │
│  APScheduler — fires run_check()         │
│  interval: CHECK_INTERVAL_HOURS          │
├─────────────────────────────────────────┤
│ Agent Layer               agent_job.py   │
│  process_send_commands()  — Telegram→Gmail SMTP
│  process_new_listings()   — fetch→filter→eval→notify
├────────────────┬────────────────────────┤
│ Scraper        │ Evaluator              │
│ kv_alert_reader│ ai_evaluator.py        │
│ (Playwright CF │ (Anthropic API, Claude │
│  bypass)       │  Haiku, raw HTTP)      │
│ kv_listing_parser.py                    │
│ (regex-based HTML parser)               │
├────────────────┴────────────────────────┤
│ Notification Layer                       │
│  telegram_client.py (Bot API)           │
│  gmail_client.py (IMAP APPEND + SMTP)  │
├─────────────────────────────────────────┤
│ Persistence Layer         data_store.py  │
│  app_data.json    — property dossier    │
│  agent_state.json — agent bookkeeping   │
│  threading.RLock  — process-wide lock   │
└─────────────────────────────────────────┘
```

---

## Data Flow — Primary Check Path

1. APScheduler fires `run_check()` every N hours (default: 2)
2. `process_send_commands()` — polls Telegram for `/send <id>` commands, fires SMTP if found
3. `fetch_listing_urls()` — Playwright launches headless Chromium, loads kv.ee search URL, passes Cloudflare JS challenge, harvests CF cookies into a `requests.Session`
4. `extract_object_id()` — deduplicates against `state["seen_listing_ids"]`
5. For each new URL: `fetch_listing(url, session=get_session())` — reuses CF cookies for plain HTTP fetch
6. Price/rooms/images pre-filter — skips listings outside config thresholds
7. `evaluate_listing(listing)` — sends scraped fields to Claude Haiku via raw Anthropic HTTP API; returns `{score, verdict, strengths, concerns, should_draft_email, draft_body}`
8. `add_property_if_new()` — appends to dossier via `data_store` under lock
9. `send_photo()` / `send_message()` — formats card and pushes to Telegram
10. If `should_draft_email` and `score >= DRAFT_SCORE_THRESHOLD`: `create_draft()` saves email to Gmail Drafts via IMAP APPEND
11. `save_agent_state(state)` — persists updated seen IDs and pending drafts

---

## Key Abstractions

| Abstraction | File | Role |
|---|---|---|
| `Listing` dataclass | `kv_listing_parser.py` | Parsed listing fields, single source of truth across layers |
| `data_store` module | `data_store.py` | Thread-safe JSON I/O shared between web routes and agent |
| `_session` (module-level) | `kv_alert_reader.py` | CF-cookie-bearing requests session reused within an agent run |
| `config` module | `config.py` | All env-var constants + buyer profile text |

---

## Entry Points

| Entry | Trigger |
|---|---|
| `uvicorn main:app` | Docker container start (web server) |
| `scheduler.start()` | FastAPI `@app.on_event("startup")` |
| `run_check()` | APScheduler interval + `POST /api/check-now` |

---

## Concurrency Model

- One `threading.RLock` in `data_store` serializes all JSON reads/writes
- APScheduler configured `max_instances=1, coalesce=True` — no overlapping runs
- `/api/check-now` spawns `run_check()` in a daemon thread to avoid blocking the HTTP response
- Single-user scale; no async I/O in the agent path (all synchronous)

---

## Configuration Surface

All config via environment variables (`.env` → docker-compose → container):
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
- `GMAIL_ADDRESS`, `GMAIL_APP_PASSWORD`
- `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`
- `KV_SEARCH_URL`
- `MIN_IMAGES`, `MIN_ROOMS`, `MAX_PRICE_EUR`, `DRAFT_SCORE_THRESHOLD`
- `CHECK_INTERVAL_HOURS`, `DATA_DIR`
