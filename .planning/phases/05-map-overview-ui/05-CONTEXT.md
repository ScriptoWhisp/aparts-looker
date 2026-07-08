# Phase 5: Map & Overview UI - Context

**Gathered:** 2026-07-09
**Status:** Ready for planning

<domain>
## Phase Boundary

Replace the dossier homepage with a map-first dashboard: an interactive Tallinn map showing every listing as a score-coloured pin, a KPI stats strip, score distribution, price vs score scatter, and a recent activity feed. Clicking a pin opens a detail side panel that shows a mini-map of the listing, commute time badge, price history sparkline, and AI checklist. A 20-minute driving isochrone from Veerenni 28 (Bolt HQ) overlays the map. District heat zones show price/m² by neighbourhood. A comparison mode lets Daniel compare 2–4 listings side-by-side.

Out of scope for Phase 5:
- Additional scraper sources (Phase 4, deferred)
- Viewing workflow / negotiation briefs (Phase 6)
- Building fund / PDF export (Phase 6)
- Telegram Mini App (v2)

</domain>

<decisions>
## Implementation Decisions

### Map Library (MAP-01, MAP-02, MAP-03, MAP-04, MAP-05)
- **D-01:** Use **Leaflet + OpenStreetMap** loaded from CDN. No API key, no billing card, no env var change. OSM tiles are free and sufficient for Tallinn. Leaflet handles markers, GeoJSON overlays (heat zones, isochrone polygon), and popups.
- **D-02:** Pin style: `L.circleMarker` with colour by score tier — green (`var(--green)`) for ≥75, amber (`var(--amber)`) for 50–74, red (`var(--red)`) for <50. Pending listing pins use the same colour but smaller radius (8px vs 12px) and a dashed border to visually distinguish from approved.

### Geocoding (needed for all map features)
- **D-03:** Primary: parse lat/lng **directly from kv.ee listing HTML** — the researcher must locate the coordinate fields in the listing page HTML/JSON (kv.ee embeds coords in their map widget script block). Store as `lat` and `lng` on the properties[] / pending[] entry in `app_data.json` when parsing the listing (i.e., extend `kv_listing_parser.py`).
- **D-04:** Fallback for listings already in app_data without coords: use **Nominatim** (OSM geocoder, free, no API key). The VPS backend geocodes on the next ingest or on a one-time backfill endpoint. Store result in `app_data.json` as `lat`/`lng`.
- **D-05:** Listings with no resolvable coordinates are shown in a "no location" list below the map, not dropped.

### Commute Isochrone + Per-Listing Commute Time (MAP-04, MAP-06)
- **D-06:** Use **OpenRouteService (ORS) API** (free, no billing card, requires `ORS_API_KEY` env var). Travel mode: **driving-car**. Origin: Veerenni 28, Tallinn (coords: 59.4203°N, 24.7205°E).
- **D-07:** Isochrone computation: VPS fetches the 20-minute driving isochrone from ORS once and stores it as `app/static/isochrone.geojson`. Refreshed manually or via a `/api/refresh-isochrone` admin endpoint. Frontend loads the GeoJSON file and renders it as a Leaflet GeoJSON layer.
- **D-08:** Per-listing commute time: VPS calls **ORS Matrix API** (batch routing) to compute driving minutes from Veerenni 28 to each listing's lat/lng. Results stored as `commute_minutes` on the listing entry in `app_data.json`. Computed when lat/lng is first set. Shown as a large badge near the top of the detail panel.

### District Price Heat Zones (MAP-03)
- **D-09:** Group listings by `district` field (already in properties[] entries). Compute avg price/m² per district from all seen listings (properties[] + pending[]). Colour each district polygon by tier: dark green (cheapest quartile) → amber → red (most expensive quartile). Researcher finds Tallinn district boundary GeoJSON from OSM or Estonian open data.
- **D-10:** Heat zone overlay is a separate Leaflet layer toggled by a button. Default: visible.

### UI Layout (UI-01)
- **D-11:** **Map-first dashboard** as the homepage. Layout: left column = map (60–65% width) + overlays; right column = detail side panel (35–40% width). Filter buttons on the map (Approved / Pending / All). On narrow screens, map stacks above panel (responsive breakpoint at 900px).
- **D-12:** The overview dashboard also includes, above or alongside the map:
  - **KPI stats strip**: total approved, pending count, average score across approved, top-scoring listing link
  - **Score distribution**: small bar chart (3 bars: green/amber/red tier counts)
  - **Price vs score scatter**: small SVG/canvas chart plotting all listings, x = price, y = score
  - **Recent activity feed**: last 5 events (new listing, price drop, approval, removal) — computed from price_history + status changes
- **D-13:** **Full visual redesign** — executor picks a new color system. Anchor: **sharp, data-first, professional** (reference aesthetic: similar to Linear/Vercel dark-mode data tooling). Fonts (Space Grotesk, Inter, IBM Plex Mono) may be retained at executor discretion. The current paper/ink/blueprint palette is NOT required to carry over. The executor should produce something that makes numbers legible at a glance and feels like a serious apartment-hunting tool.

### Individual Listing Detail Panel
- **D-14:** The side panel opens when a map pin is clicked. It shows:
  - Commute time badge (large, prominent, top of panel)
  - Mini-map (small embedded Leaflet map, listing pin + isochrone overlay)
  - Price history sparkline (SVG line chart of price_history data)
  - AI checklist badge strip (7-key pass/fail/unknown from Phase 3 checklists data)
  - All existing card fields (score, verdict, strengths, concerns, price, area, rooms, address, link)
  - Approve / Reject / Draft email action buttons (for pending listings)
- **D-15:** The side panel is reused for both approved and pending listings. State-specific actions are shown conditionally.

### Comparison Mode (UI-02)
- **D-16:** Checkboxes on each listing card (both in map pin popups and any list view). When 2–4 are checked, a floating "Compare N selected" button appears (bottom centre of viewport). Clicking opens a full-screen comparison table with all fields aligned in columns, one listing per column. Maximum 4 listings compared at once.
- **D-17:** Comparison table rows: score, price, price/m², area, rooms, commute time, district, year built, material, parking, floor, AI checklist per key. Rows where values differ are highlighted.

### Claude's Discretion
- Exact charting library for scatter plot and score distribution (pure SVG, Chart.js CDN, or Recharts — executor picks what fits in the single-file SPA pattern; Chart.js is probably cleanest)
- Whether the "recent activity feed" is a computed view or requires a new `activity_log` key in app_data
- How the side panel transitions (slide-in animation, instant replacement, or expand from pin)
- Exact colour palette, spacing, typographic scale for the redesign (anchor: sharp/data-first/dark or high-contrast)
- How to handle the 1,500-line index.html growth — split into multiple static files or keep single-file (executor judges based on resulting size)
- District heat zone colour scale exact values (executor picks 4-tier colour ramp)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` MAP-01 through MAP-06 — map requirements
- `.planning/REQUIREMENTS.md` UI-01, UI-02 — redesign and comparison requirements

### Existing Frontend to Redesign
- `app/static/index.html` — entire 1,499-line SPA; understand existing tab structure, CSS variable system, state object, loadData(), renderMain(), buildPendingCard() before redesigning
- `app/main.py` — GET /api/data endpoint (returns load_app_data() verbatim) and all existing API routes

### Existing Data Produced by Prior Phases
- `.planning/phases/03-ai-quality-price-intelligence/03-CONTEXT.md` — price_history structure (D-11/D-13), checklists[id].ai_checklist shape (D-06/D-08), commute_minutes field does NOT yet exist — must be added
- `app/data_store.py` — DEFAULT_APP_DATA shape; new fields (lat, lng, commute_minutes) need setdefault migration
- `app/kv_listing_parser.py` — Listing dataclass; researcher must check if lat/lng can be extracted from kv.ee HTML

### External APIs (researcher must check)
- OpenRouteService isochrone API: `https://api.openrouteservice.org/v2/isochrones/{profile}` — POST, free tier, requires ORS_API_KEY
- OpenRouteService matrix API: `https://api.openrouteservice.org/v2/matrix/{profile}` — batch driving times
- Nominatim geocoding: `https://nominatim.openstreetmap.org/search?q={address}&format=json` — free, no key, 1 req/sec limit
- Tallinn district GeoJSON: researcher finds from OSM (overpass-turbo) or Estonian open data portal (maaamet.ee / opendata.riik.ee)

### Architecture Reference
- `.planning/codebase/ARCHITECTURE.md` — layer diagram; geocoding + ORS calls land in a new backend helper or ingest extension
- `.planning/codebase/CONVENTIONS.md` — never-raise pattern, RLock usage, setdefault migration

No external UI framework specs — frontend stays vanilla JS + CSS.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `app_data.json` `properties[]` and `pending[]` entries — already contain score, price_eur, price_per_sqm, district, rooms, area_sqm, title, url, image_url; Phase 3 added price_history and checklists[id].ai_checklist
- `state` JS object in index.html — already holds `properties`, `pending`, `rejected`, `checklists`, `priceHistory`; needs `commute_minutes` and `lat/lng` fields
- `loadData()` in index.html — fetches /api/data and populates state; extend to extract new fields
- `buildAiChecklistEl()` from Phase 3 — reusable in the detail panel for the AI badge strip
- `daysOnMarket()` and `buildPriceHistoryEl()` from Phase 3 — reusable in the detail panel
- CSS design system: `--green/--amber/--red/--paper/--ink/--blueprint` variables — pin colours and score tier badges already have matching variables (executor may extend or replace)

### Established Patterns
- **Never-raise**: all new backend handlers catch exceptions, log, continue
- **Thread-safe JSON**: `with data_store._lock:` wraps load → modify → save
- **setdefault migration**: new fields added via `data.setdefault("field", default)` in `load_app_data()`
- **No new Python packages unless essential** — ORS calls via `requests` (already installed); Leaflet loaded from CDN; charting loaded from CDN if needed
- **CDN-loaded JS**: index.html already loads Google Fonts from CDN; same pattern for Leaflet CSS/JS
- **textContent-only DOM writes**: existing convention from Phase 2/3; new UI must follow this for XSS safety

### Integration Points
- **kv_listing_parser.py**: add lat/lng extraction from kv.ee HTML page (new fields on Listing dataclass or post-parse enrichment)
- **ingest_handler.py**: after parsing, trigger ORS matrix batch call for any listings with new lat/lng; store commute_minutes on the entry
- **data_store.py**: add `lat`, `lng`, `commute_minutes` to DEFAULT_APP_DATA entry shape; add `setdefault` in `load_app_data()`; new helper `update_listing_coords(listing_id, lat, lng, commute_minutes)`
- **main.py**: new endpoints — `GET /api/isochrone` (serves isochrone.geojson) and optionally `POST /api/geocode-backfill` (one-time backfill for existing listings)
- **app/static/**: Leaflet CSS/JS added via CDN `<link>/<script>` tags in index.html; isochrone.geojson served as static file via FastAPI StaticFiles

</code_context>

<specifics>
## Specific Ideas

- **Map-first layout**: Left ~60%, right ~40%. Filter buttons overlaid on map: `[Approved] [Pending] [All]` — pill style, toggle.
- **Pin tooltip on hover**: Show listing title, price, score badge (coloured). Full detail in the side panel on click.
- **Dashboard KPI strip**: 4 numbers in a horizontal row above the map: `Approved: N | Pending: N | Avg score: N | Best: N/100 (Title)`. Compact, monospace font.
- **Score distribution bars**: 3 vertical bars (green/amber/red) showing count per tier. SVG or simple CSS flex bars.
- **Price vs score scatter**: Dots plotted on a small SVG canvas. Each dot sized or coloured by days-on-market. Hover shows tooltip.
- **Commute badge in detail panel**: Large pill badge at top right, e.g. `⏱ 18 min drive`. Green if <15min, amber if 15–25, red if >25.
- **Mini-map in detail panel**: ~200px tall Leaflet instance, non-interactive (zoomable but no clicks). Shows listing pin + isochrone polygon.
- **Price history sparkline**: Inline SVG line (no external charting lib needed for a 5-10 point line). Same "et-EE" locale formatting as Phase 3.
- **Comparison table highlight**: Rows where the best value exists get a subtle green-bg highlight in that column.
- **Isochrone visual**: Semi-transparent filled polygon (opacity 0.15) with a solid border. Colour: blueprint/blue tone.
- **District heat zone**: Fills by avg price/m² tier; tooltip on hover shows district name + avg price.
- **Design anchor**: Sharp, dark or high-contrast, data-dense. Think monitoring dashboard meets real estate dossier. Make numbers legible, make scores pop.

</specifics>

<deferred>
## Deferred Ideas

- Phase 4 (city24.ee + kinnisvara24.ee scrapers) — deferred by Daniel; cross-portal dedup too complex for MVP
- Price history sparkline chart on dossier card (noted in Phase 3 deferred — now landing in Phase 5 detail panel)
- Public transit commute mode — would require Tallinn GTFS + OTP or Digitransit; defer to post-MVP
- Telegram Mini App for mobile dossier access — v2 requirement (V2-01)
- Animated pin clustering for when many listings appear in the same area (Leaflet.markercluster plugin) — nice-to-have, defer
- "Saved searches" or custom filter presets on the map — out of scope for Phase 5

</deferred>

---

*Phase: 5-Map & Overview UI*
*Context gathered: 2026-07-09*
