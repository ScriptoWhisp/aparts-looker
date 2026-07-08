# Phase 5: Map & Overview UI - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-09
**Phase:** 5-Map & Overview UI
**Areas discussed:** Map library, Geocoding, Commute isochrone source, Commute mode, UI layout direction, Overview dashboard content, Individual listing detail panel, Comparison mode trigger, Visual redesign style, Design reference

---

## Map Library

| Option | Description | Selected |
|--------|-------------|----------|
| Leaflet + OpenStreetMap | Free, no API key, CDN-loaded, ~40KB | ✓ |
| Mapbox GL JS | Better tiles, free tier, requires API key | |
| Google Maps JS | Familiar but overkill, billing card required | |

**User's choice:** Leaflet + OpenStreetMap
**Notes:** No API key, no config change needed. All required features (markers, GeoJSON overlays, popups) are available.

---

## Geocoding

| Option | Description | Selected |
|--------|-------------|----------|
| Parse lat/lng from kv.ee HTML | kv.ee embeds coords in their map widget — primary approach | ✓ |
| Nominatim (OSM geocoder) | Free, no API key, fallback for listings without embedded coords | ✓ (fallback) |
| Manual pin placement | Daniel adds coordinates manually via web UI | |

**User's choice:** Parse from kv.ee HTML (primary), Nominatim as fallback
**Notes:** Daniel suggested this during the Nominatim question — kv.ee has a map view on listings, so coordinates are likely embedded in the listing HTML. Researcher must confirm and locate the field.

---

## Commute Isochrone Source

| Option | Description | Selected |
|--------|-------------|----------|
| OpenRouteService API | Free, no billing card, driving-car profile, ORS_API_KEY env var | ✓ |
| Pre-computed static GeoJSON | Compute once offline, store in repo, no runtime dependency | |
| Straight-line radius circle | Rough proxy, zero complexity, no external API | |

**User's choice:** OpenRouteService API
**Notes:** VPS fetches isochrone once on demand and stores as static GeoJSON file. Refreshed via admin endpoint.

---

## Commute Travel Mode

| Option | Description | Selected |
|--------|-------------|----------|
| Driving (Recommended) | Most relevant for Tallinn; ORS driving-car profile | ✓ |
| Public transit | Requires GTFS + OTP/Digitransit; significant complexity | |
| Walking | Only useful for very close listings | |

**User's choice:** Driving
**Notes:** Per-listing commute time via ORS Matrix API (batch routing from Veerenni 28 to all listing coords).

---

## UI Layout Direction

| Option | Description | Selected |
|--------|-------------|----------|
| Map-first homepage: map + side panel | Map replaces overview; detail opens as right panel | ✓ |
| Map as new tab alongside existing tabs | New Map tab added, current views unchanged | |
| Current layout with embedded map widget | Minimal change, map widget in Approved tab | |

**User's choice:** Map-first homepage
**Notes:** Daniel also clarified that the overview page should not be *only* a map — it's a full dashboard with stats, charts, and activity feed. Individual listing detail views should also have their own mini-map.

---

## Map Filters (follow-up)

| Option | Description | Selected |
|--------|-------------|----------|
| All listings with Approved/Pending/All toggle | Filter buttons on map; pending pins smaller/different style | ✓ |
| Only Approved listings on map | Simpler, but misses the pending queue | |
| You decide | Executor picks simplest approach | |

**User's choice:** All listings with filter buttons (Approved / Pending / All)

---

## Overview Dashboard Content (beyond the map)

| Option | Description | Selected |
|--------|-------------|----------|
| Key stats strip | Total approved, pending count, avg score, top listing | ✓ |
| Score distribution chart | Bar chart: green/amber/red tier counts | ✓ |
| Price vs score scatter | All listings plotted: price (x) vs score (y) | ✓ |
| Recent activity feed | Last 5 events: new listing, price drop, approval, removal | ✓ |

**User's choice:** All four selected
**Notes:** Daniel confirmed all four — the overview is a proper dashboard, not just a map page.

---

## Individual Listing Detail Panel

| Option | Description | Selected |
|--------|-------------|----------|
| Mini-map of listing location | Small Leaflet map with pin + isochrone | ✓ |
| Price history sparkline | Inline SVG chart of price_history data | ✓ |
| AI checklist badge strip | 7-key pass/fail/unknown from Phase 3 | ✓ |
| Commute time prominently displayed | Large badge near top of panel | ✓ |

**User's choice:** All four selected

---

## Comparison Mode Trigger

| Option | Description | Selected |
|--------|-------------|----------|
| Checkbox on each card + floating Compare button | Select 2–4, floating CTA, full-screen comparison table | ✓ |
| Pin/star button with persistent dock | Star adds to pinned list, Compare from dock | |
| Right-click context menu on map pin | Only works from map | |

**User's choice:** Checkboxes + floating Compare button

---

## Visual Redesign Style

| Option | Description | Selected |
|--------|-------------|----------|
| Keep existing design system (paper/ink/blueprint) | Layout redesign only, colors stay | |
| Fresh palette, keep fonts | Swap paper-green for darker tones | |
| Full redesign — executor picks new system | Executor has full creative freedom | ✓ |

**User's choice:** Full redesign — executor picks new system
**Notes:** "I want smart and informative design, made by product thinking concepts." Anchor given: sharp, data-first, professional.

---

## Design Reference

| Option | Description | Selected |
|--------|-------------|----------|
| Linear / Vercel — dark dense data tools | Near-black, high-contrast, monospace data | |
| Airbnb / Zillow — property card UI | White/light, large images, property-native | |
| Notion / Craft — editorial/document | Content-first, generous whitespace | |
| You decide — sharp and data-first | Executor has anchor but full creative freedom | ✓ |

**User's choice:** You decide — something sharp and data-first
**Notes:** No specific product reference. Executor anchors on: data-dense, professional, numbers legible at a glance.

---

## Claude's Discretion

- Exact charting library for scatter plot and score distribution (Chart.js CDN recommended)
- Whether recent activity feed requires a new `activity_log` key in app_data or is computed on-the-fly
- Side panel transition animation style
- Exact color palette, spacing, typographic scale for the redesign
- Whether to split index.html into multiple static files given expected growth
- District heat zone color ramp values

## Deferred Ideas

- Phase 4 (city24.ee + kinnisvara24.ee) — deferred, cross-portal dedup too complex
- Public transit commute mode — requires GTFS + OTP
- Telegram Mini App — v2 requirement
- Leaflet.markercluster for dense pin areas — nice-to-have, defer
- Custom filter presets on the map — out of scope Phase 5
