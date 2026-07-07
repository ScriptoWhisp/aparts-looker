---
phase: 01-scraper-architecture-split
plan: "01"
subsystem: scraper-client
tags: [scraper, docker, playwright, residential-ip, mini-pc, architecture-split]
dependency_graph:
  requires: []
  provides:
    - scraper-client/app/scraper.py (while-True loop entry point)
    - scraper-client/app/kv_scraper.py (Playwright + CF cookie scraper)
    - scraper-client/app/kv_listing_parser.py (HTML parser + Listing dataclass)
    - scraper-client/Dockerfile
    - scraper-client/docker-compose.yml
  affects:
    - plan 01-02 (VPS ingest endpoint — depends on Listing field contract defined here)
tech_stack:
  added: []
  patterns:
    - while-True loop with time.sleep (mini PC scraper cadence, no APScheduler)
    - dataclasses.asdict() serialization for Listing → JSON dict
    - os.environ direct reads (no config.py in scraper-client)
    - never-raise outer loop (try/except Exception + log.exception)
key_files:
  created:
    - scraper-client/Dockerfile
    - scraper-client/docker-compose.yml
    - scraper-client/.env.example
    - scraper-client/.gitignore
    - scraper-client/app/requirements.txt
    - scraper-client/app/scraper.py
    - scraper-client/app/kv_scraper.py
    - scraper-client/app/kv_listing_parser.py
  modified: []
decisions:
  - "D-01 implemented: mini PC sends fully-parsed Listing JSON via dataclasses.asdict()"
  - "D-03 implemented: scraper-client/ subfolder with its own Dockerfile + docker-compose.yml"
  - "D-04 implemented: while-True loop with restart: unless-stopped auto-recovery"
  - "D-09/D-11 implemented: heartbeat POSTed unconditionally (including zero-listing runs)"
  - "kv_alert_reader.py renamed to kv_scraper.py in scraper-client (per STATE.md concern)"
metrics:
  duration: "~2 minutes"
  completed: "2026-07-08"
  tasks_completed: 3
  tasks_total: 3
  files_created: 8
  files_modified: 0
status: complete
---

# Phase 01 Plan 01: Scraper Client Skeleton Summary

Standalone scraper-client Docker container with Playwright CF bypass, listing parse, dataclasses.asdict serialization, and POST to VPS /api/ingest + /api/heartbeat in a while-True loop.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Create scraper-client folder skeleton + Docker/compose/env files | 9db5f65 | Dockerfile, docker-compose.yml, .env.example, .gitignore, app/requirements.txt |
| 2 | Copy kv_alert_reader → kv_scraper (config import fix) and kv_listing_parser byte-identically | 93cbb12 | kv_scraper.py, kv_listing_parser.py |
| 3 | Write scraper.py entry point (while-True loop, dataclasses.asdict, ingest + heartbeat POSTs) | 4a45e16 | scraper.py |

## What Was Built

The `scraper-client/` subfolder is a self-contained Docker image for Daniel's home mini PC. It contains:

- **`scraper.py`** — entry point with a `while True` loop that calls `run_once()` inside `try/except Exception`, sleeps `CHECK_INTERVAL_HOURS * 3600` between runs. The `run_once()` function calls `fetch_listing_urls()`, fetches each URL via `fetch_listing()`, filters for `raw_ok=True`, serializes via `dataclasses.asdict()`, POSTs the batch to `/api/ingest`, and unconditionally POSTs a heartbeat to `/api/heartbeat` (even when zero listings found — critical for the VPS consecutive-zero alert in plan 01-03).

- **`kv_scraper.py`** — copy of `app/kv_alert_reader.py` renamed as discussed in STATE.md. The only functional change: `from config import KV_SEARCH_URL` replaced with `KV_SEARCH_URL = os.environ.get("KV_SEARCH_URL", "")` so it runs without a `config.py` module. All Playwright/CF-cookie logic is preserved verbatim.

- **`kv_listing_parser.py`** — byte-identical copy of `app/kv_listing_parser.py`. `diff -q` confirms no changes. The `Listing` dataclass field set is the JSON contract with the VPS ingest handler (plan 01-02 depends on this).

- **`Dockerfile`** — `python:3.12-slim` base, `playwright install chromium --with-deps` (matching the existing VPS Dockerfile pattern), `CMD ["python", "scraper.py"]`. No EXPOSE, no VOLUME — scraper is an outbound client only.

- **`docker-compose.yml`** — single `scraper` service with `restart: unless-stopped` (D-04 auto-recovery) and `shm_size: '256m'` (Playwright OOM guard on Docker Desktop, per Pitfall 6).

- **`app/requirements.txt`** — scraper subset: `requests>=2.31.0`, `beautifulsoup4>=4.12.0`, `lxml>=5.0.0`, `playwright>=1.44.0`. No server-side packages (fastapi, uvicorn, apscheduler excluded).

- **`.env.example`** — documents `VPS_INGEST_URL`, `INGEST_TOKEN`, `KV_SEARCH_URL`, `CHECK_INTERVAL_HOURS` with placeholder values. `.gitignore` excludes the concrete `.env` so Daniel's token never enters git.

## Verification Results

All automated gates passed:

1. All 8 files exist under `scraper-client/`.
2. `diff -q app/kv_listing_parser.py scraper-client/app/kv_listing_parser.py` — no output (byte-identical).
3. `python3 -c "import ast; ast.parse(...)` — exits 0 for all three Python files.
4. Docker build: **Pending** — requires Daniel to run `docker compose -f scraper-client/docker-compose.yml build` on Docker Desktop. Cannot be verified in CI without Docker Desktop.
5. Import smoke test: **Pending** — requires Docker Desktop + built image to run `docker compose ... run --rm scraper python -c "import scraper; print('ok')"`.

Items 4 and 5 are manual-only gates that require Docker Desktop; they are documented here for Daniel to verify before deploying the mini PC container.

## Deviations from Plan

None — plan executed exactly as written.

The module docstring in `kv_scraper.py` was updated to reflect the mini-PC role (per task action), which is consistent with the plan's wording.

## User Setup Required

Before the mini PC container can run end-to-end:

1. **Install Docker Desktop** on the mini PC (Windows or macOS). ARCH-01 requires Docker Desktop; this plan produces the buildable image.
2. **Generate INGEST_TOKEN**: `python -c "import secrets; print(secrets.token_hex(32))"` — copy to `scraper-client/.env` AND to VPS `.env` (plan 01-02 adds the VPS side).
3. **Copy `KV_SEARCH_URL`** from VPS `.env` into `scraper-client/.env`.
4. **Set `VPS_INGEST_URL`** to `https://<your-vps-domain>` in `scraper-client/.env`.
5. Run `docker compose -f scraper-client/docker-compose.yml build` to verify the image builds.

Note: Plan 01-02 must be deployed to the VPS before the mini PC container can POST successfully. The two plans run in parallel in Wave 1; both must land before the end-to-end flow works.

## Known Stubs

None — all code paths are wired. The `_post()` helper logs errors on POST failure but does not stub data; `run_once()` genuinely calls the scraper and posts results.

## Self-Check: PASSED

All files confirmed present on disk. All three commits confirmed in git log.
