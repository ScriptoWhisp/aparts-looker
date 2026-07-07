---
phase: 01-scraper-architecture-split
plan: "02"
subsystem: vps-ingest-endpoint
tags: [vps, ingest, heartbeat, fastapi, bearer-token, caddyfile, architecture-split]
dependency_graph:
  requires:
    - plan 01-01 (scraper-client/ Listing JSON contract — field names used by _deserialize_listing)
  provides:
    - app/ingest_handler.py (process_ingest_batch, handle_heartbeat, _deserialize_listing, _listing_to_property)
    - app/kv_scraper.py (renamed from kv_alert_reader.py; no VPS imports)
    - POST /api/ingest (authenticated batch ingest endpoint)
    - POST /api/heartbeat (authenticated heartbeat endpoint)
  affects:
    - plan 01-03 (heartbeat alert checks read last_heartbeat_ts, last_heartbeat_listing_count, consecutive_zero_count from agent_state.json stored here)
tech_stack:
  added: []
  patterns:
    - FastAPI HTTPBearer dependency with auto_error=False (uniform 403 on missing and wrong token)
    - Caddy named-matcher @machine to bypass basicauth for machine-to-machine endpoints
    - data_store._lock held across load→process→save in ingest handler (prevents race, Pitfall 5)
    - Never-raise per-listing try/except in process_ingest_batch (one failure does not abort batch)
    - Explicit consecutive_zero_count reset to 0 on listing_count > 0 (Pitfall 3)
    - setdefault auto-upgrade for new DEFAULT_AGENT_STATE fields (no migration script needed)
key_files:
  created:
    - app/ingest_handler.py
  renamed:
    - app/kv_alert_reader.py → app/kv_scraper.py (contents unchanged; no VPS imports)
  modified:
    - app/config.py (INGEST_TOKEN, HEARTBEAT_TIMEOUT_HOURS added)
    - app/data_store.py (DEFAULT_AGENT_STATE extended with 4 heartbeat fields)
    - app/main.py (HTTPBearer, _verify_ingest_token, POST /api/ingest, POST /api/heartbeat)
    - app/agent_job.py (process_new_listings removed, scraping imports removed, run_check simplified)
    - Caddyfile (@machine named matcher bypasses basicauth for /api/ingest and /api/heartbeat)
decisions:
  - "D-06 implemented: POST /api/ingest authenticated via HTTPBearer dependency with shared INGEST_TOKEN"
  - "D-07 implemented: ingest handler processes full batch with dedup + filter + evaluate + notify"
  - "D-08 implemented: kv_alert_reader.py renamed to kv_scraper.py; no VPS code imports it (ARCH-03)"
  - "D-09 implemented: POST /api/heartbeat stores last_heartbeat_ts, last_heartbeat_listing_count, consecutive_zero_count"
  - "Caddyfile named matcher pattern chosen over mini PC sending basic auth credentials (Pitfall 1 resolution)"
  - "HTTPBearer auto_error=False chosen for uniform 403 response on missing vs wrong token"
metrics:
  duration: "~3 minutes"
  completed: "2026-07-08"
  tasks_completed: 3
  tasks_total: 3
  files_created: 1
  files_modified: 5
  files_renamed: 1
status: complete
---

# Phase 01 Plan 02: VPS Ingest Endpoint Summary

FastAPI ingest and heartbeat endpoints with Bearer token auth, full evaluate+notify pipeline extracted from agent_job.process_new_listings(), Caddy basicauth bypass for machine-to-machine routes, and VPS scraping code fully removed.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Extend config.py and data_store.py with INGEST_TOKEN, HEARTBEAT_TIMEOUT_HOURS, and DEFAULT_AGENT_STATE heartbeat fields | e0e4bff | app/config.py, app/data_store.py |
| 2 | Create app/ingest_handler.py, rename kv_alert_reader to kv_scraper, strip scraping from agent_job | 58584e7 | app/ingest_handler.py, app/kv_scraper.py, app/agent_job.py |
| 3 | Wire POST /api/ingest and POST /api/heartbeat in main.py; update Caddyfile | 8de3e88 | app/main.py, Caddyfile |

## What Was Built

**`app/ingest_handler.py`** — New module with four functions:

- **`_deserialize_listing(data)`** — Filters incoming dict keys against `LISTING_FIELD_NAMES` (frozenset from `dc_fields(Listing)`, computed once at import) before calling `Listing(**known)`. Prevents `TypeError` on unknown fields per RESEARCH Pitfall 2.
- **`_listing_to_property(listing, evaluation)`** — Moved verbatim from `agent_job._listing_to_property`; converts Listing + AI evaluation to the dossier property schema.
- **`process_ingest_batch(listing_dicts)`** — Acquires `data_store._lock` for the full load→process→save sequence. Iterates the batch applying dedup (`extract_object_id` or URL), VPS-side filters (MIN_ROOMS, MAX_PRICE_EUR, MIN_IMAGES per D-02), AI evaluation, Telegram notification, and Gmail draft creation. Per-listing `try/except Exception` means one failure does not abort the batch (never-raise pattern).
- **`handle_heartbeat(payload)`** — Stores `last_heartbeat_ts`, `last_heartbeat_listing_count`, and increments/resets `consecutive_zero_count` under `data_store._lock`. Explicit reset to 0 when `listing_count > 0` (Pitfall 3). Never logs INGEST_TOKEN (T-01-04).

**`app/kv_scraper.py`** — `git mv` rename of `app/kv_alert_reader.py`. Module contents unchanged. No VPS-side file imports from it (confirmed by grep gate). Kept in-repo for Phase 4 reference.

**`app/config.py`** — Added `INGEST_TOKEN = os.environ.get("INGEST_TOKEN", "")` (no cast, token is a string) and `HEARTBEAT_TIMEOUT_HOURS = float(os.environ.get("HEARTBEAT_TIMEOUT_HOURS", "0"))` (sentinel `0` means plan 01-03 uses the formula `CHECK_INTERVAL_HOURS * 2 + 0.5`).

**`app/data_store.py`** — `DEFAULT_AGENT_STATE` extended with `last_heartbeat_ts: None`, `last_heartbeat_listing_count: None`, `consecutive_zero_count: 0`, `last_scraper_alert_sent_at: None`. The existing `setdefault` loop in `load_agent_state()` auto-upgrades any existing `agent_state.json` on next load — no migration script needed.

**`app/agent_job.py`** — Removed: `process_new_listings`, `_listing_to_property`, all scraping imports (`kv_alert_reader`, `kv_listing_parser`, `ai_evaluator`, `gmail_client.create_draft`, `telegram_client.send_photo/format_listing_card`). `run_check()` now calls only `process_send_commands(state)`. Log messages updated to "Running scheduler tick..." and "Tick complete."

**`app/main.py`** — Added `HTTPBearer(auto_error=False)` instance and `_verify_ingest_token` FastAPI dependency (fail-closed: 403 on empty INGEST_TOKEN or credential mismatch). Added `POST /api/ingest` and `POST /api/heartbeat`, both gated by `Depends(_verify_ingest_token)`. Static mount remains last.

**`Caddyfile`** — Added `@machine path /api/ingest /api/heartbeat` named matcher with a `handle @machine { reverse_proxy app:8000 }` block before the basicauth fallback block. The mini PC Bearer token now reaches FastAPI without being challenged by Caddy basic auth (RESEARCH Pitfall 1, T-01-06). Existing bcrypt hash preserved exactly.

## VPS .env Setup Required

The following env var must be added to the VPS `.env` before the ingest endpoint works:

```
INGEST_TOKEN=<same hex value as scraper-client/.env INGEST_TOKEN>
```

Generate once with `python -c "import secrets; print(secrets.token_hex(32))"` and copy to both sides. The value is set out-of-band per the plan's `user_setup` declaration — it is not committed to git.

Optional override (defaults to formula `CHECK_INTERVAL_HOURS * 2 + 0.5` in plan 01-03):
```
HEARTBEAT_TIMEOUT_HOURS=0
```

## Verification Results

All automated gates passed:

1. `python3 -c "import ast; [ast.parse(...)]"` — all 6 Python files parse cleanly (exits 0).
2. `grep -R --include='*.py' 'from kv_alert_reader|import kv_alert_reader|from kv_scraper|import kv_scraper' app/` — returns nothing. ARCH-03 satisfied.
3. `grep -R --include='*.py' 'from.*import.*fetch_listing_urls' app/` — returns nothing. No VPS-side scraping import remains.
4. `grep -q '@machine path /api/ingest /api/heartbeat' Caddyfile` — passes.
5. `grep -q 'basicauth' Caddyfile` — passes (frontend still protected).
6. `test ! -f app/kv_alert_reader.py` — passes. File no longer exists.
7. `test -f app/kv_scraper.py` — passes.
8. All four required functions present in `ingest_handler.py`: `_deserialize_listing`, `_listing_to_property`, `process_ingest_batch`, `handle_heartbeat`.

Manual curl verification (requires VPS deployment — documented per plan output spec):

- `POST /api/ingest` without `Authorization` header → 403 (FastAPI _verify_ingest_token, not Caddy)
- `POST /api/ingest` with `Authorization: Bearer wrong-token` → 403
- `POST /api/ingest` with matching `Authorization: Bearer <INGEST_TOKEN>` and body `[]` → 200 `{"ok": true, "processed": 0}`
- Same auth rules apply to `POST /api/heartbeat`

Cannot be run in the CI/executor environment without a live Docker stack.

## Deviations from Plan

None — plan executed exactly as written.

One minor note: the plan's Verification 2 grep pattern (`kv_alert_reader|fetch_listing_urls|from kv_scraper|import kv_scraper`) picks up the `fetch_listing_urls` *function definition* inside `kv_scraper.py` itself. This is expected and correct — the file contains the definition; no other file imports it. The ARCH-03 gate passes when checking for import statements specifically.

## Known Stubs

None. All code paths are wired:
- `process_ingest_batch` calls `evaluate_listing`, `add_property_if_new`, `send_photo`/`send_message`, and `create_draft` identically to the original `agent_job.process_new_listings`.
- `handle_heartbeat` writes all four new `DEFAULT_AGENT_STATE` fields to disk.

## Threat Flags

No new surface beyond what the plan's threat model covers. T-01-01 through T-01-06 all mitigated as planned.

## Self-Check: PASSED

Files confirmed present:
- app/ingest_handler.py: EXISTS
- app/kv_scraper.py: EXISTS
- app/kv_alert_reader.py: ABSENT (correctly removed)

Commits confirmed in git log:
- e0e4bff (Task 1): feat(01-02): extend config and data_store...
- 58584e7 (Task 2): feat(01-02): create ingest_handler.py...
- 8de3e88 (Task 3): feat(01-02): wire POST /api/ingest...
