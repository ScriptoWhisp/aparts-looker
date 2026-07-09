---
phase: 05-map-overview-ui
plan: 01
subsystem: data-model
tags: [geocoding, kv-ee, regex, data-store, listing, coordinates, testing]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: Listing dataclass and kv_listing_parser structure that this extends
  - phase: 02-pending-queue
    provides: data_store patterns (load-modify-save, _pending_to_property, setdefault migration)
provides:
  - config.ORS_API_KEY env-var constant
  - config.BOLT_HQ_LAT = 59.4203 and config.BOLT_HQ_LNG = 24.7205 (Veerenni 28, Tallinn)
  - kv_listing_parser.Listing.lat and Listing.lng fields (Optional[float], default None)
  - kv_listing_parser._extract_coords(html) private helper with Estonia bounding-box validation
  - 6 COORD_*_RE module-level regex constants for three coord embedding shapes
  - data_store.update_listing_coords(id, lat, lng, commute_minutes) bool-returning helper
  - data_store.get_listing_coords(id) dict-returning reader (never-raise)
  - data_store.load_app_data() per-entry setdefault for lat/lng/commute_minutes
  - data_store._pending_to_property() carry-over of lat/lng/commute_minutes
  - app/tests/test_geocoding.py 13-test Wave 0 scaffold (all green)
affects:
  - 05-02 (Nominatim backfill + ORS commute times — reads all symbols from this plan)
  - 05-03 (district heat zones — reads lat/lng from entries)
  - 05-04 (map rendering + detail panel — reads all three geocoding fields)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-entry setdefault migration in load_app_data() following D-11 zero-downtime pattern"
    - "Three-pattern coordinate extraction with Estonia bounding-box validation (T-05-01)"
    - "load-modify-save pattern for update_listing_coords (matching add_to_pending)"
    - "Never-raise reader pattern for get_listing_coords (matching get_price_history)"
    - "TDD RED/GREEN cycle: test scaffold committed before production code"

key-files:
  created:
    - app/tests/test_geocoding.py
  modified:
    - app/config.py
    - app/data_store.py
    - app/kv_listing_parser.py

key-decisions:
  - "BOLT_HQ_LAT/LNG are hard-coded float constants (not env vars) per D-06 — they are known real-world coordinates"
  - "ORS_API_KEY uses empty-string default (no exception on miss) matching existing token patterns"
  - "_extract_coords probes raw resp.text not BeautifulSoup text — coords live in script blocks BeautifulSoup strips"
  - "Estonia bounding box (57.5-59.7 lat, 21.7-28.2 lng) rejects decimal false-positives in HTML (T-05-01 mitigation)"
  - "lat/lng fields appended after raw_ok in Listing dataclass to preserve field order for schema evolution"

patterns-established:
  - "Coord extraction: three fallback regex patterns (JSON-LD, script var, data-attribute) with bounding-box validation"
  - "Per-entry migration: setdefault on properties[] + pending[] inside load_app_data() under existing lock"

requirements-completed:
  - MAP-01
  - MAP-04
  - MAP-05
  - MAP-06

coverage:
  - id: D1
    description: "config.ORS_API_KEY, BOLT_HQ_LAT, BOLT_HQ_LNG are importable module-level constants"
    requirement: MAP-01
    verification:
      - kind: unit
        ref: "python3 -c \"import sys; sys.path.insert(0,'app'); import config; assert config.BOLT_HQ_LAT == 59.4203; assert config.BOLT_HQ_LNG == 24.7205; print('OK')\""
        status: pass
    human_judgment: false
  - id: D2
    description: "Listing dataclass exposes lat: Optional[float] and lng: Optional[float] fields (default None)"
    requirement: MAP-01
    verification:
      - kind: unit
        ref: "tests/test_geocoding.py::test_listing_dataclass_has_lat_lng"
        status: pass
    human_judgment: false
  - id: D3
    description: "data_store.load_app_data() per-entry setdefault migrates lat/lng/commute_minutes to None on existing entries"
    requirement: MAP-04
    verification:
      - kind: unit
        ref: "tests/test_geocoding.py::test_load_app_data_migrates_missing_lat_lng"
        status: pass
      - kind: unit
        ref: "tests/test_geocoding.py::test_load_app_data_preserves_existing_coords"
        status: pass
    human_judgment: false
  - id: D4
    description: "data_store.update_listing_coords(id, lat, lng, commute_minutes) mutates entries and returns True/False"
    requirement: MAP-04
    verification:
      - kind: unit
        ref: "tests/test_geocoding.py::test_update_listing_coords_pending"
        status: pass
      - kind: unit
        ref: "tests/test_geocoding.py::test_update_listing_coords_properties"
        status: pass
      - kind: unit
        ref: "tests/test_geocoding.py::test_update_listing_coords_not_found"
        status: pass
    human_judgment: false
  - id: D5
    description: "data_store.get_listing_coords(id) returns coord dict or all-None dict on miss"
    requirement: MAP-04
    verification:
      - kind: unit
        ref: "tests/test_geocoding.py::test_get_listing_coords_hit"
        status: pass
      - kind: unit
        ref: "tests/test_geocoding.py::test_get_listing_coords_miss"
        status: pass
    human_judgment: false
  - id: D6
    description: "data_store._pending_to_property() carries lat, lng, commute_minutes to the new property entry"
    requirement: MAP-04
    verification:
      - kind: unit
        ref: "tests/test_geocoding.py::test_pending_to_property_carries_coords"
        status: pass
    human_judgment: false
  - id: D7
    description: "_extract_coords(html) extracts coordinates from JSON-LD, script var, and data-attribute patterns"
    requirement: MAP-05
    verification:
      - kind: unit
        ref: "tests/test_geocoding.py::test_coord_regex_json_ld_pattern"
        status: pass
      - kind: unit
        ref: "tests/test_geocoding.py::test_coord_regex_script_var_pattern"
        status: pass
      - kind: unit
        ref: "tests/test_geocoding.py::test_coord_regex_data_attribute_pattern"
        status: pass
      - kind: unit
        ref: "tests/test_geocoding.py::test_coord_regex_no_match_returns_none"
        status: pass
    human_judgment: false
  - id: D8
    description: "fetch_listing wires _extract_coords(resp.text) and populates listing.lat/lng when patterns match"
    requirement: MAP-05
    verification:
      - kind: unit
        ref: "tests/test_listing_contract.py (regression, 2 passed)"
        status: pass
    human_judgment: true
    rationale: "fetch_listing integration with real kv.ee HTML not testable without live network request — bounding-box and regex correctness are verified by unit tests, but actual kv.ee HTML shape can only be confirmed by a live probe during Plan 02 Nominatim backfill"

# Metrics
duration: 3min
completed: 2026-07-09
status: complete
---

# Phase 5 Plan 01: Geocoding Data Model Foundation Summary

**Phase 5 data-model foundation: Listing.lat/lng fields, three-pattern coord extraction with Estonia bounding-box validation, and zero-downtime data_store migration — all 13 Wave 0 tests green, 52/52 suite passing**

## Performance

- **Duration:** 3 min
- **Started:** 2026-07-09T12:10:05Z
- **Completed:** 2026-07-09T12:13:00Z
- **Tasks:** 5
- **Files modified:** 4 (3 production + 1 test)

## Accomplishments

- Extended `kv_listing_parser.Listing` with `lat: Optional[float]` and `lng: Optional[float]` fields (appended after `raw_ok` to preserve field order)
- Added 6 `COORD_*_RE` module-level regex constants covering JSON-LD structured data, JavaScript variable short form, and HTML data-attribute embedding shapes
- Implemented `_extract_coords(html)` private helper with three-pattern fallback and Estonia bounding-box validation (57.5-59.7 lat, 21.7-28.2 lng) to reject false-positive decimal matches (T-05-01 threat mitigation)
- Wired `_extract_coords(resp.text)` into `fetch_listing()` — populates `listing.lat/lng` on successful pattern match from raw HTML (not BeautifulSoup text, which strips script blocks)
- Added `config.ORS_API_KEY` (env-var default empty string), `config.BOLT_HQ_LAT = 59.4203`, `config.BOLT_HQ_LNG = 24.7205` as importable constants
- Added `data_store.update_listing_coords()` and `data_store.get_listing_coords()` thread-safe helpers following existing load-modify-save and never-raise reader patterns respectively
- Extended `data_store.load_app_data()` with per-entry setdefault loop migrating existing `pending[]` and `properties[]` entries to include `lat`, `lng`, `commute_minutes` fields without disrupting existing installs (D-11 zero-downtime pattern)
- Extended `data_store._pending_to_property()` to carry `lat`, `lng`, `commute_minutes` to property entries so map pins remain stable after approval (Plan 04 requirement)
- Created 13-test Wave 0 scaffold (`app/tests/test_geocoding.py`) following TDD RED/GREEN cycle — all 13 pass

## Task Commits

Each task was committed atomically:

1. **Task 1: Wave 0 test scaffold** - `6c9718c` (test)
2. **Task 2: config.py constants** - `f7b0adb` (feat)
3. **Task 3: data_store migration + helpers** - `fd81b75` (feat)
4. **Task 4: kv_listing_parser extension** - `84a4c61` (feat)
5. **Task 5: Full Wave 0 green run** - no code changes needed, all 13 tests passed on first run

## Files Created/Modified

- `app/tests/test_geocoding.py` — 13-test Wave 0 scaffold for geocoding data model (created)
- `app/config.py` — Added ORS_API_KEY, BOLT_HQ_LAT, BOLT_HQ_LNG (+3 lines)
- `app/data_store.py` — Per-entry setdefault migration, update_listing_coords, get_listing_coords, _pending_to_property carry-over (+50 lines)
- `app/kv_listing_parser.py` — 6 COORD_*_RE constants, Listing.lat/lng fields, _extract_coords helper, fetch_listing wiring (+59 lines)

## Decisions Made

- `BOLT_HQ_LAT`/`BOLT_HQ_LNG` hard-coded (not env vars) per D-06 — they are fixed real-world coordinates that never change per deployment
- `ORS_API_KEY` uses empty-string default matching all existing token env vars — no exception on miss, Plan 02 will check for empty and skip ORS calls gracefully
- `_extract_coords` operates on `resp.text` (raw HTML), not `soup.get_text()` — JavaScript variable and data-attribute patterns exist in script blocks that BeautifulSoup strips when converting to text
- Estonia bounding box check (lat 57.5-59.7, lng 21.7-28.2) was implemented as specified — this rejects false-positive matches of pixel coordinates, prices, IDs, or other decimal-shaped values that happen to match the regex patterns
- `lat`/`lng` dataclass fields appended after `raw_ok` to preserve existing field serialisation order for schema evolution

## Deviations from Plan

None — plan executed exactly as written.

The acceptance criterion `grep -c '"lat": entry.get("lat")' app/data_store.py` returns 2 instead of 1 because `get_listing_coords()` also uses `entry.get("lat")` in its return dict — both occurrences are correct and the test verifying the behavior passes cleanly. The criterion comment says "inside _pending_to_property" but the grep counts all occurrences in the file.

## Issues Encountered

None — all 13 Wave 0 tests passed on first full run. Full suite 52/52 green with no new warnings introduced (3 pre-existing FastAPI deprecation warnings from before this plan).

## Live Coord Probe Note

Per the plan's `<output>` section: live probing of `_extract_coords` against a real kv.ee listing HTML page was not performed in this plan. Plan 02's Nominatim backfill path will run the first production test of which regex pattern matches actual kv.ee markup and will log the result. The three patterns cover all known embedding shapes from `05-RESEARCH.md` section 1.

## Known Stubs

None — all symbols are fully implemented and do not use placeholder values. `lat`/`lng`/`commute_minutes` being `None` by default is correct design (they will be populated by Plan 02 geocoding).

## Next Phase Readiness

Plan 02 (Nominatim + ORS commute) can begin immediately:
- `import config` will provide `ORS_API_KEY`, `BOLT_HQ_LAT`, `BOLT_HQ_LNG`
- `data_store.update_listing_coords()` is ready to receive geocoding results from Nominatim backfill
- `data_store.load_app_data()` will always provide `lat`/`lng`/`commute_minutes` keys on all entries
- `Listing.lat`/`Listing.lng` are populated by `fetch_listing()` when kv.ee HTML contains coord patterns

## Self-Check: PASSED

- `app/tests/test_geocoding.py` — FOUND
- `app/config.py` updated with ORS_API_KEY, BOLT_HQ_LAT, BOLT_HQ_LNG — FOUND
- `app/data_store.py` updated with per-entry migration, two new helpers, _pending_to_property extension — FOUND
- `app/kv_listing_parser.py` updated with COORD_*_RE, Listing.lat/lng, _extract_coords, fetch_listing wiring — FOUND
- Commits: 6c9718c, f7b0adb, fd81b75, 84a4c61 — all verified in git log
- 13 Wave 0 tests: PASS
- 52/52 full suite: PASS

---
*Phase: 05-map-overview-ui*
*Completed: 2026-07-09*
