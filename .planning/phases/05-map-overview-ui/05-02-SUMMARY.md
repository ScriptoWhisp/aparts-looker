---
phase: 05-map-overview-ui
plan: 02
subsystem: ors-nominatim-backend
tags: [ors, nominatim, geocoding, commute-time, isochrone, backend-endpoints, phase-5]

# Dependency graph
requires:
  - phase: 05-01
    provides: config.ORS_API_KEY, BOLT_HQ_LAT/LNG, Listing.lat/lng, data_store migration
provides:
  - ingest_handler._fetch_commute_minutes(lat, lng)
  - ingest_handler._geocode_with_nominatim(query)
  - main._run_geocode_backfill()
  - GET /api/isochrone
  - POST /api/refresh-isochrone
  - POST /api/geocode-backfill
  - app/static/isochrone.geojson (placeholder, overwritten on first refresh)
  - commute_minutes populated on every new pending entry at ingest time (when ORS_API_KEY set)
affects:
  - 05-03 (district heat zones — reads commute_minutes from entries for display)
  - 05-04 (map rendering — fetches /api/isochrone, reads commute_minutes for commute badge)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ORS Matrix API [lon, lat] order with inline comment at every call site (RESEARCH Pitfall 2)"
    - "Soft-skip pattern: if not config.ORS_API_KEY: return None (no exception, no log)"
    - "Background-thread pattern: POST /api/geocode-backfill spawns thread, sync=1 runs inline"
    - "Never-raise convention applied to all new helpers and endpoints"
    - "1.1s sleep between Nominatim calls (usage policy compliance, T-05-16)"

key-files:
  created:
    - app/tests/test_ors_api.py
    - app/tests/test_commute.py
    - app/static/isochrone.geojson
  modified:
    - app/ingest_handler.py
    - app/main.py

key-decisions:
  - "ORS Matrix response: durations[0][1] not [0][0] — sources=[0] means row 0 = Bolt HQ to all locs; col 0 = src-to-src (null), col 1 = src-to-dest (listing)"
  - "_run_geocode_backfill lives in main.py not ingest_handler.py for simplicity (single module pattern)"
  - "POST /api/geocode-backfill ?sync=1 parameter enables deterministic test behavior without thread races"
  - "isochrone.geojson committed as placeholder so GET /api/isochrone never 404s before first refresh call"
  - "Test fix (Rule 1): seed app_data['properties'] = [] in test_geocode_backfill_endpoint to control entry count; DEFAULT_PROPERTIES would cause 15 geocodes instead of 1"

# Metrics
duration: 7min
completed: 2026-07-09
status: complete
---

# Phase 5 Plan 02: ORS API + Nominatim Geocoding Backend Summary

**ORS Matrix + Nominatim integrated into ingest pipeline: commute_minutes populated at ingest time, three new admin endpoints, placeholder GeoJSON committed — all 13 Plan-02 tests green, 65/65 full suite passing**

## Performance

- **Duration:** 7 min
- **Started:** 2026-07-09T12:16:40Z
- **Completed:** 2026-07-09T12:23:00Z
- **Tasks:** 3 of 4 auto-executed (Task 4 is a human-verify checkpoint)
- **Files modified:** 4 (2 production + 1 test updated + 1 new static file + 2 new test files)

## Accomplishments

- Created 13-test Wave 0 scaffold (`app/tests/test_ors_api.py` x 7, `app/tests/test_commute.py` x 6) following TDD RED/GREEN cycle — all GREEN after implementation
- Added `import time`, `import requests`, `from typing import Optional` to `ingest_handler.py`
- Implemented `_fetch_commute_minutes(lat, lng)` in `ingest_handler.py`:
  - Soft-skips when `config.ORS_API_KEY` is empty (returns None, zero HTTP calls)
  - Calls ORS Matrix API `driving-car` from Veerenni 28 to listing coordinates
  - `[lon, lat]` order at every ORS call site with inline comment (RESEARCH Pitfall 2)
  - Returns `max(1, round(duration_secs / 60))` or None on null duration or any exception
  - Never logs `config.ORS_API_KEY` (T-05-11 mitigation)
  - Accesses `durations[0][1]` (col 1 = destination, not col 0 = source-to-source which is null)
- Implemented `_geocode_with_nominatim(query)` in `ingest_handler.py`:
  - `User-Agent: ApartsLooker/1.0 daniel.tjulinov@gmail.com` (Nominatim policy requirement)
  - Returns `(float(lat), float(lng))` on success or `(None, None)` on any error/empty response
  - Never raises
- Wired `_fetch_commute_minutes` into `process_ingest_batch` after the `add_to_pending` / `send_pending_card` / reload cycle — mutates `pending[]` entry in-place (MAP-06)
- Created `app/static/isochrone.geojson` placeholder (`{"type": "FeatureCollection", "features": []}`) so `GET /api/isochrone` has something to serve immediately
- Added 3 new endpoints to `main.py` (all declared before `app.mount`):
  - `GET /api/isochrone`: reads static GeoJSON, falls back to empty FeatureCollection on missing file or parse error
  - `POST /api/refresh-isochrone`: calls ORS isochrones/driving-car, writes result to `app/static/isochrone.geojson`; returns `{ok: false, error: "..."}` (200) when unconfigured or ORS fails
  - `POST /api/geocode-backfill`: spawns background thread by default; runs inline with `?sync=1` for tests and one-time admin use; implements `_run_geocode_backfill()` with 1.1s sleep between Nominatim calls

## Task Commits

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Wave 0 test scaffolds | f3c4ae1 | app/tests/test_ors_api.py, app/tests/test_commute.py |
| 2 | ingest_handler helpers | e1bfa2b | app/ingest_handler.py |
| 3 | main.py endpoints + GeoJSON | bfa45f6 | app/main.py, app/tests/test_commute.py, app/static/isochrone.geojson |
| 4 | Live smoke test checkpoint | — | AWAITING HUMAN VERIFICATION |

## Files Created/Modified

- `app/tests/test_ors_api.py` — 7-test ORS API suite (created)
- `app/tests/test_commute.py` — 6-test commute/Nominatim/backfill suite (created, updated Task 3 fix)
- `app/ingest_handler.py` — Added imports + 2 private helpers + process_ingest_batch wiring (+83 lines)
- `app/main.py` — Added imports + 3 endpoints + _run_geocode_backfill (+126 lines)
- `app/static/isochrone.geojson` — Placeholder empty FeatureCollection (created)

## Decisions Made

- `durations[0][1]` not `[0][0]` for ORS Matrix response — with `sources=[0]` and `destinations=[1]`, row 0 = source Bolt HQ to all locations; col 0 = src-to-src (null), col 1 = src-to-destination (listing)
- `_run_geocode_backfill` placed in `main.py` (not a separate module) for simplicity — follows the existing `check_now` pattern
- `?sync=1` query parameter for `/api/geocode-backfill` enables both async prod behavior and synchronous test inspection without changing the function signature
- Test fix for `test_geocode_backfill_endpoint`: seed `data["properties"] = []` to prevent DEFAULT_PROPERTIES (14 entries without lat/lng) from inflating geocoded count from 1 to 15

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] ORS Matrix response index: durations[0][0] to durations[0][1]**
- **Found during:** Task 2 GREEN phase (test_fetch_commute_minutes_success failed)
- **Issue:** Initial implementation accessed `durations[0][0]` but ORS Matrix with `sources=[0], destinations=[1]` returns a 1x2 row where `[0][0]` is src-to-src (null) and `[0][1]` is src-to-dest
- **Fix:** Changed to `resp.json()["durations"][0][1]` with explaining comment
- **Files modified:** `app/ingest_handler.py`
- **Commit:** `e1bfa2b`

**2. [Rule 1 - Bug] test_geocode_backfill_endpoint: DEFAULT_PROPERTIES inflate geocoded count**
- **Found during:** Task 3 GREEN phase
- **Issue:** Test seeded only `data["pending"]` but `load_app_data()` also returns 14 DEFAULT_PROPERTIES (all without lat/lng) causing `geocoded=15` instead of `geocoded=1`
- **Fix:** Added `data["properties"] = []` in test seed to isolate the 2 test entries
- **Files modified:** `app/tests/test_commute.py`
- **Commit:** `bfa45f6`

**3. [Rule 1 - Bug] test_geocode_backfill_endpoint: wrong monkeypatch target for time.sleep**
- **Found during:** Task 3 GREEN phase (test would have been slow without fix)
- **Issue:** Test patched `ingest_handler.time.sleep` but `_run_geocode_backfill` lives in `main.py` and uses `main.time.sleep`
- **Fix:** Changed monkeypatch to `import main as main_module; monkeypatch.setattr(main_module.time, "sleep", ...)`
- **Files modified:** `app/tests/test_commute.py`
- **Commit:** `bfa45f6`

## Task 4: Live Smoke Test Status

**AWAITING — Task 4 is a `checkpoint:human-verify` that requires manual VPS verification.**

The checkpoint requires:
1. Setting `ORS_API_KEY` in `.env` on VPS and restarting the app container
2. `POST /api/refresh-isochrone` returning `{"ok": true}`
3. `GET /api/isochrone` returning a real Polygon FeatureCollection
4. `POST /api/geocode-backfill?sync=1` reporting `geocoded > 0`
5. At least one pending entry in `/api/data` having `commute_minutes` set

**Commute hit rate (live):** Not yet measured — requires ORS_API_KEY to be configured on VPS and a real scrape run to complete. With the current state (~20 existing listings), the geocode-backfill will attempt Nominatim for all entries lacking lat/lng.

**ORS quota concerns:** None observed. Free tier has 40 requests/day for matrix and isochrones — at ~20 listings this is within limits for the backfill, and ongoing ingests are at most a few new listings per run.

## Known Stubs

None — all implementations are complete. `commute_minutes` being `None` on existing entries is intentional default state until `POST /api/geocode-backfill` or a new ingest run populates values.

## Threat Flags

None — no new network endpoints, auth paths, file access patterns, or schema changes beyond what the plan's `<threat_model>` documents (T-05-11 through T-05-16). All six threats mitigated per plan.

## Self-Check: PASSED

- `app/tests/test_ors_api.py` — FOUND (7 tests)
- `app/tests/test_commute.py` — FOUND (6 tests)
- `app/static/isochrone.geojson` — FOUND (placeholder empty FeatureCollection)
- `app/ingest_handler.py` — FOUND (_fetch_commute_minutes, _geocode_with_nominatim, ingest wiring)
- `app/main.py` — FOUND (GET /api/isochrone, POST /api/refresh-isochrone, POST /api/geocode-backfill, _run_geocode_backfill)
- Commits: f3c4ae1, e1bfa2b, bfa45f6 — all verified in git log
- 13 Plan-02 tests: PASS
- 65/65 full suite: PASS
- grep -c 'log\..*ORS_API_KEY' app/ingest_handler.py app/main.py returns 0+0

---
*Phase: 05-map-overview-ui*
*Completed: 2026-07-09*
