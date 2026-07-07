# Phase 1: Scraper Architecture Split - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-07
**Phase:** 1-scraper-architecture-split
**Areas discussed:** Mini PC payload format, Mini PC run method & packaging, Offline detection & heartbeat

---

## Mini PC Payload Format

| Option | Description | Selected |
|--------|-------------|----------|
| Fully-parsed Listing JSON | Mini PC runs Playwright + requests + BeautifulSoup; VPS receives structured Listing dataclass fields | ✓ |
| Raw HTML | Mini PC fetches raw HTML; VPS parses | |
| URL-only | Mini PC sends only harvested URLs; VPS fetches + parses | |

**User's choice:** Fully-parsed Listing JSON (Option A)
**Notes:** Mini PC handles all scraping complexity (CF bypass + individual listing fetches + HTML parsing). VPS receives structured data and never needs a browser. `Listing` dataclass serialised with `dataclasses.asdict()` on mini PC; deserialised with `Listing(**data)` on VPS. Mini PC sends all scraped listings with no pre-filtering — VPS applies MIN_ROOMS / MAX_PRICE_EUR / MIN_IMAGES so config stays in one place.

---

## Mini PC Run Method & Packaging

| Option | Description | Selected |
|--------|-------------|----------|
| Docker container | `scraper-client/` subfolder, own Dockerfile + docker-compose.yml; continuous loop, `restart: unless-stopped` | ✓ |
| Standalone Python script | Raw Python script, user runs manually or via Task Scheduler / launchd | |
| Systemd / launchd service | Native OS service; Linux-specific tooling incompatible with Windows | |

**User's choice:** Docker container
**Notes:** Docker Desktop on Windows or macOS. Scraper runs as a continuous `while True: scrape(); sleep(interval)` loop. `restart: unless-stopped` provides auto-recovery from crashes. Interval configurable via env var mirroring `CHECK_INTERVAL_HOURS`. Dockerfile must not assume Linux-only tools. `scraper-client/` lives as a subfolder in the same repo.

---

## Offline Detection & Heartbeat

| Option | Description | Selected |
|--------|-------------|----------|
| Heartbeat POST to /api/heartbeat | Mini PC POSTs after every scrape run (even 0 listings); VPS alerts Telegram if silent for 2×interval + 0.5h | ✓ |
| Poll-based check | VPS checks kv.ee directly to test if scraper is up | |
| No monitoring | Alert only when 0 consecutive runs return listings | |

**User's choice:** Heartbeat POST endpoint
**Notes:** Heartbeat payload: `{timestamp, listing_count, source: "kv.ee"}`. VPS tracks last heartbeat timestamp; if `now - last_heartbeat > 2 × CHECK_INTERVAL_HOURS + 0.5h`, sends Telegram alert: `⚠️ Scraper offline — last heartbeat: {timestamp}`. Check runs on scheduler tick (same APScheduler job, lightweight). Distinguishes "scraper dead / mini PC offline" from "no new listings found on kv.ee" — heartbeat arrives regardless. The old `POST /api/check-now` endpoint remains but responds with "waiting for next scraper heartbeat" instead of launching a local scrape.

---

## Claude's Discretion

- **Token format for ingest auth:** Bearer token in `Authorization` header (`Authorization: Bearer <INGEST_TOKEN>`) — standard HTTP convention
- **Telegram alert message wording:** `⚠️ Scraper offline — last heartbeat: {timestamp}` (clear, actionable)
- **Heartbeat check interval:** Checked on the existing APScheduler tick (no separate lightweight scheduler needed; the check is trivial)

## Deferred Ideas

None — discussion stayed within Phase 1 scope. Additional scraper sources (city24.ee, kinnisvara24.ee) are Phase 4.
