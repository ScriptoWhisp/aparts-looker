---
phase: 05-map-overview-ui
plan: "03"
subsystem: api
status: complete
tags:
  - phase-5
  - map
  - district-heat-zone
  - static-geojson
dependency_graph:
  requires:
    - 05-01
  provides:
    - app/static/tallinn-districts.geojson
    - GET /api/districts
  affects:
    - 05-04
tech_stack:
  added: []
  patterns:
    - never-raise endpoint convention
    - build-time static GeoJSON artifact committed to git
    - dict grouping with None-price exclusion for avg computation
key_files:
  created:
    - app/static/tallinn-districts.geojson
    - app/tests/test_districts.py
  modified:
    - app/main.py
decisions:
  - "avg_price_per_sqm excludes None-price entries from the mean but still counts them in `count`; if all prices are None, returns null (not 0) — matches test contract"
  - "Districts sorted alphabetically in response (sorted(groups)) for consistent output; plan allowed any order"
  - "GeoJSON generated as one-time build-time artifact via Nominatim; committed to git, not fetched at runtime"
metrics:
  duration: "~15 minutes (Tasks 3+4 only; Tasks 1+2 were pre-committed)"
  completed: "2026-07-09"
  tasks_completed: 4
  tasks_total: 4
  files_created: 2
  files_modified: 1
---

# Phase 05 Plan 03: Tallinn District GeoJSON + Heat Zone API Summary

**One-liner:** Tallinn district polygons GeoJSON (8 features, 291 KB from Nominatim) plus GET /api/districts endpoint returning avg price/m² per district from properties + pending.

## Objective

Deliver the two data artifacts Plan 04 needs to render the district heat zone overlay:
1. `app/static/tallinn-districts.geojson` — static FeatureCollection with 8 Tallinn district polygons, generated once from Nominatim and committed to git.
2. `GET /api/districts` — aggregation endpoint returning per-district listing counts and average price/m² from properties[] + pending[].

Both artifacts allow Plan 04's map.js to join on `Feature.properties.name === district.name` without additional normalization.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Generate tallinn-districts.geojson from Nominatim | f020804 | app/static/tallinn-districts.geojson |
| 2 | Wave 0 test scaffold — app/tests/test_districts.py | a80b309 | app/tests/test_districts.py |
| 3 | main.py — add GET /api/districts endpoint | cf753ec | app/main.py |
| 4 | Full green run + regression check | (this summary) | — |

## Key Findings

**GeoJSON artifact:**
- Nominatim returned all 8 district relations in a single API call (no retries needed).
- File size: 291 KB (within expected 100 KB–2 MB range).
- Canonical district names committed (no " linnaosa" suffix): Haabersti, Kesklinn, Kristiine, Lasnamäe, Mustamäe, Nõmme, Pirita, Põhja-Tallinn.
- All 8 geometries are Polygon or MultiPolygon with non-empty coordinates.

**Endpoint behavior:**
- Combines `properties[]` + `pending[]` from app_data into a single grouping pass.
- Entries without a district field (empty string or None) are silently skipped.
- Entries with `price_per_sqm=None` are counted in `count` but excluded from the mean.
- If all entries in a district have `price_per_sqm=None`, `avg_price_per_sqm` returns `null`.
- Response is sorted alphabetically by district name.
- Never-raise: try/except wraps the full body; returns `{"districts": []}` on any error.

**Test suite:**
- 9 new tests in `test_districts.py` — all GREEN.
- Full suite: 74 tests, 0 failures, 3 pre-existing deprecation warnings (FastAPI `on_event` — pre-existing, out of scope).

## Endpoint Contract

```
GET /api/districts
→ {"districts": [{"name": str, "avg_price_per_sqm": float|null, "count": int}, ...]}
```

Sorted alphabetically by name. Plan 04 can join `district.name === feature.properties.name` to colour polygons by quartile.

## Deviations from Plan

### Auto-applied Logic Correction

**[Rule 2 - Missing Critical Functionality] avg excludes None prices rather than treating them as 0**

The task spec said to `sum(entry.get("price_per_sqm", 0) or 0 for entry in group) / len(group)`, which would average null prices as 0. However the test contract (`test_get_districts_excludes_null_price_per_sqm_from_avg`, `test_get_districts_all_null_avg_is_none`) requires:
- Count includes all entries regardless of price.
- Mean is computed only over entries where `price_per_sqm` is not None.
- If all prices are None, avg returns `None` not `0`.

Implementation aligned with the tests (the contract), not the literal spec text.

## Known Stubs

None — the endpoint reads live data from app_data.json. If app_data.json is empty or has no district-annotated entries, `{"districts": []}` is the correct response (not a stub).

## Threat Surface Scan

No new trust boundaries introduced beyond those in the plan's threat model (T-05-21 through T-05-24). GET /api/districts is gated by Caddy basicauth in production. Response exposes district names and averaged prices — same data surface as GET /api/data.

## Self-Check: PASSED

- `app/static/tallinn-districts.geojson` exists, 291 KB, 8 Features with canonical names.
- `app/main.py` contains exactly 1 occurrence of `@app.get("/api/districts")`.
- `app/tests/test_districts.py` contains 9 test functions.
- Full pytest suite: 74 passed, 0 failed.
- Commits f020804, a80b309, cf753ec all present in git log.
