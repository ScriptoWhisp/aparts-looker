# Phase 1: Scraper Architecture Split - Context

**Gathered:** 2026-07-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Extract the kv.ee scraping logic (Playwright + cookie harvest + listing fetch + HTML parsing) into a standalone Docker container that runs on Daniel's home mini PC and delivers fully-parsed Listing JSON to the VPS via HTTP POST. The VPS gains a new `/api/ingest` endpoint that receives listing data, applies filters, triggers AI evaluation, and queues results — never launching a browser. A heartbeat mechanism lets the VPS detect when the scraper goes offline and alerts via Telegram.

Out of scope for Phase 1:
- The pending queue / approval workflow (Phase 2)
- AI evaluation quality improvements (Phase 3)
- Additional scraper sources — city24.ee, kinnisvara24.ee (Phase 4)

</domain>

<decisions>
## Implementation Decisions

### Payload Format
- **D-01:** Mini PC sends **fully-parsed Listing JSON** — the `Listing` dataclass fields as a JSON dict. Mini PC runs all of: Playwright (CF bypass + URL harvest) + `requests` with CF cookies (individual listing fetches) + BeautifulSoup/regex parsing. VPS receives structured data and never needs a browser or CF access.
- **D-02:** Mini PC sends **all scraped listings** with no pre-filtering. VPS applies `MIN_ROOMS`, `MAX_PRICE_EUR`, `MIN_IMAGES` filters before evaluation. Config stays in one place (VPS `.env`).

### Mini PC Packaging & Run Method
- **D-03:** Mini PC scraper is packaged as a **Docker container** (Docker Desktop on Windows/macOS). A `scraper-client/` subfolder in the same repo with its own `Dockerfile` and `docker-compose.yml`.
- **D-04:** Scraper runs as a **continuous loop** inside the container — `while True: scrape(); sleep(interval)`. Container configured with `restart: unless-stopped` so it auto-recovers from crashes.
- **D-05:** Interval is configurable via env var (mirrors `CHECK_INTERVAL_HOURS` on VPS side).

### VPS Ingest Endpoint
- **D-06:** New `POST /api/ingest` endpoint on VPS. Authenticated via a shared secret token in the `Authorization` header (e.g., `Authorization: Bearer <INGEST_TOKEN>`). Token stored in `.env` on both sides.
- **D-07:** Ingest endpoint receives a **batch** of Listing JSON objects (the full scrape results). Iterates, applies filters, evaluates new listings (not in `seen_listing_ids`), and triggers the existing notification path.
- **D-08:** VPS-side Playwright code (`kv_alert_reader.py`) is **disabled/removed** — the ingest endpoint replaces it. The scheduler no longer runs `fetch_listing_urls()` directly.

### Heartbeat & Health Alert
- **D-09:** Mini PC sends a **heartbeat POST** to a `/api/heartbeat` endpoint after every scrape run (even if 0 new URLs found). Heartbeat payload: `{timestamp, listing_count, source: "kv.ee"}`.
- **D-10:** VPS monitors heartbeat: if no heartbeat received within `2 × CHECK_INTERVAL_HOURS` + 30 min grace, send a Telegram alert: `⚠️ Scraper offline — last heartbeat: {timestamp}`. Alert channel: Telegram (same bot/chat as listing notifications).
- **D-11:** This distinguishes "scraper dead / mini PC offline" from "no new listings found on kv.ee" — heartbeat arrives regardless.

### Claude's Discretion
- Token format for ingest auth (Bearer vs custom header — Bearer is standard, use it)
- Exact Telegram alert message wording
- Heartbeat check interval on VPS side (checked on scheduler tick or separate lightweight check)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing Scraping Code (to be extracted)
- `app/kv_alert_reader.py` — Playwright scraper + CF cookie harvest + URL collection. This entire module moves to the mini PC client.
- `app/kv_listing_parser.py` — Individual listing fetch + HTML parsing → Listing dataclass. Also moves to mini PC client.
- `app/kv_listing_parser.py` `Listing` dataclass — The JSON contract between mini PC and VPS. Mini PC serialises `Listing` fields; VPS deserialises them.

### VPS-Side Code to Modify
- `app/agent_job.py` — `process_new_listings()` currently calls `fetch_listing_urls()` and `fetch_listing()`. In Phase 1, this logic moves to the ingest endpoint handler; `agent_job.py` is refactored or deprecated for the scraping portion.
- `app/main.py` — New endpoints `POST /api/ingest` and `POST /api/heartbeat` are added here.
- `app/scheduler.py` — The scheduled `run_check()` call needs adjustment once scraping is removed from VPS.
- `app/data_store.py` — `seen_listing_ids` deduplication logic reused in ingest handler.
- `app/config.py` — New env vars: `INGEST_TOKEN` (shared secret), heartbeat timeout config.

### Requirements
- `.planning/REQUIREMENTS.md` ARCH-01–04 — the 4 requirements this phase must satisfy.

### Architecture Reference
- `.planning/codebase/ARCHITECTURE.md` — Current system architecture; the ingest endpoint sits between the new scraper layer and the existing evaluation/notification layers.

No external specs referenced during discussion.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `Listing` dataclass (`kv_listing_parser.py`) — Already the clean data contract. Serialize with `dataclasses.asdict()` on mini PC; deserialize with `Listing(**data)` on VPS.
- `data_store.py` `seen_listing_ids` + `_lock` — Reuse as-is for deduplication in ingest handler.
- `telegram_client.send_message()` — Reuse for heartbeat failure alert.
- Existing filter logic in `agent_job.process_new_listings()` — Extract and reuse in ingest endpoint.

### Established Patterns
- **Never-raise**: existing code returns safe fallbacks on failure; ingest endpoint should follow the same pattern — log and continue on individual listing failure, never crash the batch.
- **Env-var config**: all secrets/settings via env vars in `.env`; `INGEST_TOKEN` follows same pattern.
- **Thread-safe JSON**: `data_store._lock` (RLock) is already process-wide; ingest endpoint uses the same lock path.

### Integration Points
- `app/main.py` — Add `POST /api/ingest` and `POST /api/heartbeat` routes alongside existing API routes.
- `app/agent_job.py` — `process_new_listings()` body is the source for the filter + evaluate + notify logic to move into the ingest handler.
- `scraper-client/` (new) — New subfolder in repo root. Contains `Dockerfile`, `docker-compose.yml`, `scraper.py` (the loop), copies/imports of `kv_alert_reader.py` and `kv_listing_parser.py`.

</code_context>

<specifics>
## Specific Ideas

- Docker Desktop is the deployment target for mini PC (Windows or macOS). Dockerfile must not assume Linux-only tools.
- The scraper loop interval on mini PC mirrors `CHECK_INTERVAL_HOURS` — same cadence as the old VPS scheduler.
- Heartbeat timeout = `2 × CHECK_INTERVAL_HOURS + 0.5 hours` grace period.
- The old `POST /api/check-now` endpoint can remain but should trigger a Telegram message saying "waiting for next scraper heartbeat" rather than running a local scrape.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 1-Scraper Architecture Split*
*Context gathered: 2026-07-07*
