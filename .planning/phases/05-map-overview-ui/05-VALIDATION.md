---
phase: 5
slug: map-overview-ui
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-09
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest 7.x |
| **Config file** | `app/tests/` (existing from prior phases) |
| **Quick run command** | `cd app && python3 -m pytest tests/ -q` |
| **Full suite command** | `cd app && python3 -m pytest tests/ -v` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd app && python3 -m pytest tests/ -q`
- **After every plan wave:** Run `cd app && python3 -m pytest tests/ -v`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 05-01-01 | 01 | 1 | MAP-01 | — | N/A | manual | browser: map renders with pins | ❌ W0 | ⬜ pending |
| 05-01-02 | 01 | 1 | MAP-02 | — | N/A | manual | browser: pins colour by score tier | ❌ W0 | ⬜ pending |
| 05-01-03 | 01 | 1 | UI-01 | — | N/A | manual | browser: redesigned layout loads | ❌ W0 | ⬜ pending |
| 05-02-01 | 02 | 2 | MAP-01 | — | N/A | unit | `pytest tests/test_geocoding.py -q` | ❌ W0 | ⬜ pending |
| 05-02-02 | 02 | 2 | MAP-04 | — | N/A | unit | `pytest tests/test_ors_api.py -q` | ❌ W0 | ⬜ pending |
| 05-02-03 | 02 | 2 | MAP-04 | — | N/A | unit | `pytest tests/test_commute.py -q` | ❌ W0 | ⬜ pending |
| 05-03-01 | 03 | 2 | MAP-03 | — | N/A | manual | browser: district heat zones visible | ❌ W0 | ⬜ pending |
| 05-04-01 | 04 | 3 | MAP-04 | — | N/A | unit | `pytest tests/test_isochrone.py -q` | ❌ W0 | ⬜ pending |
| 05-04-02 | 04 | 3 | MAP-05 | — | N/A | manual | browser: commute badge in detail panel | ❌ W0 | ⬜ pending |
| 05-05-01 | 05 | 3 | UI-02 | — | N/A | manual | browser: comparison table opens | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `app/tests/test_geocoding.py` — stubs for lat/lng extraction and Nominatim fallback
- [ ] `app/tests/test_ors_api.py` — stubs for ORS isochrone + matrix API calls
- [ ] `app/tests/test_commute.py` — stubs for commute_minutes storage and retrieval
- [ ] `app/tests/test_isochrone.py` — stubs for isochrone GeoJSON generation/serving

*Existing infrastructure covers all phase requirements for backend unit tests. Frontend rendering verifications are manual-only.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Interactive Leaflet map renders with score-coloured pins | MAP-01, MAP-02 | DOM rendering; Playwright not in test suite | Load dossier, check Overview tab; verify green/amber/red pins appear for listings |
| District heat zone overlay | MAP-03 | Canvas/SVG rendering; requires live data | Toggle heat zone layer; verify district polygons fill by price tier |
| Commute badge in detail panel | MAP-05 | DOM rendering | Click a map pin; verify commute badge shows "N min drive" at top of panel |
| 20-min isochrone polygon on map | MAP-04 | GeoJSON overlay rendering | Check map; verify semi-transparent polygon centred on Veerenni 28 |
| Side-by-side comparison table | UI-02 | Interactive checkbox/modal flow | Select 2 listings via checkboxes; verify "Compare 2 selected" button appears and comparison table opens |
| Redesigned layout visual quality | UI-01 | Aesthetic/UX judgement | Load dossier; verify sharp/data-first design with legible numbers and score badges |
| Price vs score scatter chart | UI-01 | Canvas/SVG rendering | Check dashboard; verify scatter with dots for each listing |
| Mini-map in detail panel | MAP-01 | Nested Leaflet instance | Click pin; verify mini-map with listing pin + isochrone loads in panel |
| Price history sparkline in detail panel | INTEL-02 | SVG rendering | Click listing with price history; verify sparkline line chart |
| AI checklist badge strip in detail panel | EVAL-02 | DOM rendering | Click listing; verify 7-key pass/fail/unknown badges |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
