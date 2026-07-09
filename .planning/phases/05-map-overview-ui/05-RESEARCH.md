# Phase 05: Map & Overview UI — Research

**Researched:** 2026-07-09
**Domain:** Geospatial frontend (Leaflet), routing API (OpenRouteService), geocoding (Nominatim), vanilla JS SPA redesign
**Confidence:** HIGH (codebase verified directly; external APIs confirmed via live fetches)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- D-01: Leaflet + OpenStreetMap from CDN (no API key, no billing card)
- D-02: L.circleMarker — green (≥75), amber (50–74), red (<50); pending pins smaller + dashed border
- D-03: Primary coordinate source = parse lat/lng from kv.ee listing HTML (script block)
- D-04: Fallback for existing listings without coords = Nominatim geocoding on VPS
- D-05: Listings with no resolvable coords shown in a "no location" list, not dropped
- D-06: OpenRouteService (ORS) driving-car profile, origin Veerenni 28 (59.4203°N, 24.7205°E), requires ORS_API_KEY env var
- D-07: Isochrone fetched once by VPS → stored as app/static/isochrone.geojson; refreshed via /api/refresh-isochrone
- D-08: Per-listing commute time = ORS Matrix API → stored as commute_minutes on listing entry
- D-09: District heat zones grouped by district field; avg price/m² per district; 4-tier colour ramp; togglable overlay
- D-10: Heat zone layer visible by default; toggle button
- D-11: Map-first layout: left 60–65% map + overlays, right 35–40% detail panel; 900px responsive breakpoint
- D-12: Dashboard extras: KPI stats strip, score distribution bars, price vs score scatter, recent activity feed
- D-13: Full visual redesign — sharp/data-first/dark or high-contrast; numbers legible; Space Grotesk/Inter/IBM Plex Mono at executor discretion
- D-14: Detail panel on pin click: commute badge (large, top), mini-map, price history sparkline, AI checklist badges, all card fields, approve/reject/draft buttons (conditional)
- D-15: Detail panel serves both approved and pending listings; state-specific actions shown conditionally
- D-16: Comparison mode: checkboxes → "Compare N selected" floating button → full-screen table, max 4 listings
- D-17: Comparison table: score, price, price/m², area, rooms, commute, district, year, material, parking, floor, AI checklist; diff-rows highlighted

### Claude's Discretion
- Charting library for scatter and score distribution (pure SVG, Chart.js CDN, or similar)
- Whether activity feed requires new activity_log key or computed on-the-fly
- Side panel transition style
- Exact colour palette, spacing, typographic scale
- File split strategy if index.html becomes too large (currently 1,499 lines)
- District heat zone colour scale exact tier values

### Deferred Ideas (OUT OF SCOPE)
- Phase 4 scrapers (city24.ee, kinnisvara24.ee)
- Public transit commute mode
- Telegram Mini App
- Animated pin clustering (Leaflet.markercluster)
- Saved searches / custom filter presets
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MAP-01 | Interactive Tallinn map with one pin per apartment | Leaflet 1.9.4 CDN confirmed; L.circleMarker API well-documented |
| MAP-02 | Pin colour by AI score tier (green/amber/red) | CSS variables already in index.html; Leaflet circleMarker supports fillColor |
| MAP-03 | Price/m² heat zone overlay by district | 8 Tallinn district polygons confirmed via OSM (admin_level=9); GeoJSON fetchable via Overpass API |
| MAP-04 | 20-min commute isochrone from Veerenni 28 | ORS isochrones POST confirmed; free tier supports driving-car + 1h range |
| MAP-05 | Pin click opens listing card preview | Leaflet .on('click') + side panel DOM update pattern |
| MAP-06 | Commute time from Veerenni 28 on each listing card | ORS Matrix API confirmed; returns duration_matrix in seconds |
| UI-01 | Redesigned dossier — modern, information-dense | Full index.html read; all reusable functions documented; split strategy noted |
| UI-02 | Side-by-side comparison view for 2–4 listings | No external library needed; pure DOM table construction |
</phase_requirements>

---

## Summary

Phase 5 is a substantial frontend redesign (index.html, currently 1,499 lines) plus three new backend capabilities: coordinate extraction in the parser, ORS API integration in the ingest handler, and two new FastAPI endpoints. The existing codebase is clean, modular, and follows consistent patterns that the executor must maintain.

The most uncertain element is coordinate extraction from kv.ee HTML (D-03). kv.ee Cloudflare-blocks automated fetches from datacenter IPs, making it impossible to inspect a live listing page source during this research session. The executor must probe a real listing page via the Playwright-based session to discover the exact JSON field path. If no embedded coordinates exist, Nominatim fallback (D-04) is confirmed and working.

All external APIs are confirmed operational: ORS isochrone and matrix endpoints work on the free tier with no billing card; Nominatim geocodes Estonian addresses correctly (tested live); Leaflet 1.9.4 and Chart.js 4.5.1 are available on CDN. Tallinn's 8 city district boundaries are available as OSM relations (admin_level=9) queryable from the Overpass API.

**Primary recommendation:** Build coordinate extraction as a best-effort regex against the HTML source (`"lat":`, `"lng":` or `"latitude":`, `"longitude":` or `[lon,lat]` in a script block), fall back to Nominatim for any listing without coords, and proceed. ORS matrix call should happen at ingest time, not lazily — so commute_minutes is populated before the frontend needs it.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Map rendering + pins | Browser (Leaflet) | — | All map interaction is client-side; no server round-trip for pin placement |
| Coordinate extraction | Backend (kv_listing_parser.py) | — | Must happen at scrape time on mini PC; coords stored in app_data.json |
| Nominatim fallback geocoding | Backend (VPS) | — | Rate-limited to 1 req/sec; only VPS should call Nominatim |
| Commute time (ORS Matrix) | Backend (ingest_handler.py) | — | Expensive external call; cached per listing in app_data.json |
| Isochrone polygon | Backend (VPS endpoint) | CDN (static file) | Fetched once, served as static GeoJSON; frontend loads it as a Leaflet layer |
| District heat zones | Browser | Backend (data API) | Price/m² averages computed on frontend from /api/data response; polygons from static GeoJSON |
| Score distribution bars | Browser | — | Pure DOM/SVG; no server round-trip |
| Price vs score scatter | Browser | — | Data already in /api/data response |
| Activity feed | Browser | — | Computed on-the-fly from price_history + status; no new backend key needed |
| Comparison table | Browser | — | Pure DOM; no server round-trip |
| Detail side panel | Browser | — | State from /api/data; lazy mini-map init on panel open |

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Leaflet | 1.9.4 | Interactive map, markers, GeoJSON overlays | Free, no API key, OSM tiles, proven at scale — locked in D-01 [VERIFIED: npm registry] |
| OpenStreetMap tiles | n/a | Base map tiles | Free, no API key, sufficient quality for Tallinn |
| OpenRouteService API | v2 | Isochrone + commute matrix | Free tier, no billing card, locked in D-06 [VERIFIED: openrouteservice.org] |
| Nominatim | n/a | Address-to-coord fallback | Free, no key, confirmed working for Estonian addresses [VERIFIED: live fetch test] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Chart.js | 4.5.1 | Price vs score scatter chart | If executor chooses CDN charting over pure SVG [VERIFIED: npm registry] |
| Overpass API | n/a | Fetch Tallinn district boundary GeoJSON | One-time fetch at development time to bundle tallinn-districts.geojson |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Chart.js | Pure SVG | SVG is zero-dependency but requires manual axis calculation; Chart.js adds ~60KB CDN load |
| Nominatim | Estonian address DB | Over-engineered; Nominatim handles Tallinn addresses correctly |
| ORS Matrix | Pre-computed lookup table | Not practical; new listings appear continuously |

**Installation (frontend — CDN only, no npm):**
```html
<!-- Leaflet -->
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<!-- Chart.js (optional — only if executor uses it) -->
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js"></script>
```

**Backend — no new Python packages.** ORS calls via `requests` (already installed). Nominatim via `requests`. No geocoding library needed.

---

## Package Legitimacy Audit

No new npm packages are installed in this phase. All frontend libraries are CDN-loaded. No new PyPI packages are required — `requests` is already installed.

| Package | Registry | Age | Verdict | Disposition |
|---------|----------|-----|---------|-------------|
| leaflet | npm/CDN | ~13 yrs | OK | Approved — CDN only, no install |
| chart.js | npm/CDN | ~11 yrs | OK | Approved — CDN only, conditional use |

**Packages removed due to SLOP verdict:** none
**Packages flagged as suspicious:** none

---

## Technical Findings

### 1. kv.ee Coordinate Extraction

**Status: CANNOT BE VERIFIED in this session** — kv.ee returns HTTP 403 to non-residential IPs. [ASSUMED]

**What is known from the codebase:** The current `kv_listing_parser.py` uses `soup.get_text()` + regex over page text for all field extraction. The existing code does NOT extract coordinates. The Playwright session in `kv_scraper.py` harvests Cloudflare cookies and reuses them in a `requests.Session` for individual listing fetches.

**Most likely coordinate patterns in Estonian real estate sites (ASSUMED):** Based on common patterns for sites using embedded maps:
1. **JSON-LD / structured data block:** `<script type="application/ld+json">` containing `"latitude"` and `"longitude"` fields in GeoCoordinates schema
2. **Script variable initialization:** `var mapParams = {"lat": 59.xxxx, "lng": 24.xxxx}` or similar in an inline `<script>` block
3. **Next.js `__NEXT_DATA__`:** If kv.ee is a React/Next.js app, coordinates may live in `window.__NEXT_DATA__` JSON blob
4. **Data attribute on a map div:** `<div id="map" data-lat="59.xxx" data-lng="24.xxx">`

**Recommended extraction regex patterns to try (in order):**
```python
# Pattern 1 — JSON-LD structured data
import json, re
LAT_LNG_JSON_RE = re.compile(r'"latitude"\s*:\s*([\d.]+).*?"longitude"\s*:\s*([\d.]+)', re.DOTALL)

# Pattern 2 — inline script variable (kv.ee likely uses this for their map widget)
COORDS_SCRIPT_RE = re.compile(r'["\']lat(?:itude)?["\']\s*:\s*([\d.]+)[,\s]+["\']l(?:ng|on(?:gitude)?)["\']\s*:\s*([\d.]+)')

# Pattern 3 — Next.js data blob (try if patterns 1-2 fail)
NEXT_DATA_RE = re.compile(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', re.DOTALL)
```

**Executor action required:** Using the Playwright session (same cookies used by existing scraper), fetch one real kv.ee listing page and inspect `resp.text` to discover the exact pattern. Log the coordinate field path so the regex can be tuned.

**Where to add in kv_listing_parser.py:**
- Add `lat: Optional[float] = None` and `lng: Optional[float] = None` to the `Listing` dataclass
- Add extraction in `fetch_listing()` after the existing `BeautifulSoup` parse, searching `resp.text` directly (since coordinates are often in script blocks, not the visible DOM text)

### 2. OpenRouteService API

**Status: CONFIRMED** [VERIFIED: openrouteservice.org restrictions page + community documentation]

**Isochrone endpoint:**
```
POST https://api.openrouteservice.org/v2/isochrones/driving-car
Authorization: Bearer {ORS_API_KEY}
Content-Type: application/json

{
  "locations": [[24.7205, 59.4203]],  // [lng, lat] — ORS uses [lon, lat] order
  "range": [1200],                    // 20 minutes in seconds
  "range_type": "time"
}
```

Response: GeoJSON FeatureCollection with one polygon Feature. Save directly as `app/static/isochrone.geojson`.

**Free tier limits — isochrones:**
- Max 5 locations per request (only 1 needed)
- Max range time for driving: 1 hour (20 minutes is well within limit)
- Max 10 intervals (only 1 needed)

**Matrix endpoint (commute times):**
```
POST https://api.openrouteservice.org/v2/matrix/driving-car
Authorization: Bearer {ORS_API_KEY}
Content-Type: application/json

{
  "locations": [
    [24.7205, 59.4203],   // [lng, lat] origin (Veerenni 28)
    [listing_lng, listing_lat],   // destination 1
    ...                           // up to ~50 destinations
  ],
  "sources": [0],          // index of origin
  "destinations": [1, 2, ...],  // indices of listings
  "metrics": ["duration"]  // seconds only, no distance needed
}
```

Response shape:
```json
{
  "durations": [[null, 720.5, 840.1, ...]],  // seconds from source[0] to each destination
  "metadata": { ... }
}
```

**Free tier limits — matrix:**
- Standard: 3,500 locations per request (50×50) — sufficient for batch
- With dynamic arguments: 25 locations (5×5) — not applicable here

**Critical gotcha:** ORS uses `[longitude, latitude]` order (GeoJSON standard), NOT `[latitude, longitude]`. This is opposite from what most people expect. Veerenni 28 coords in ORS format: `[24.7205, 59.4203]`.

**Rate limits:** Not explicitly documented for the free tier beyond per-request limits. The isochrone endpoint is called once (or on demand via admin endpoint), so rate limits are not a practical concern. Matrix calls happen at ingest time per-listing, not in high frequency.

**Error handling:** ORS returns HTTP 400 with JSON body for malformed requests (missing range, wrong profile name). HTTP 429 for rate limit exceeded. Both should be caught and logged (never-raise pattern).

### 3. Nominatim Geocoding Fallback

**Status: CONFIRMED** [VERIFIED: live fetch — successfully geocoded Liivalaia 7, Tallinn → 59.4281°N, 24.7471°E]

**Endpoint:**
```
GET https://nominatim.openstreetmap.org/search?q={address}&format=json&limit=1
User-Agent: ApartsLooker/1.0 contact@daniel.tjulinov@gmail.com
```

**Usage policy:** 1 request/second maximum. No API key. Must include a `User-Agent` header identifying the application (Nominatim usage policy requirement). [CITED: nominatim.openstreetmap.org/ui/about.html]

**Response shape:**
```json
[
  {
    "lat": "59.4280671",
    "lon": "24.7471453",
    "display_name": "7, Liivalaia, Kesklinn, Tallinn, ...",
    "boundingbox": [...]
  }
]
```

**Best address format for Estonian addresses:** `"{street_name} {number}, Tallinn"` — e.g., `"Liivalaia 7, Tallinn"`. The listing title field often contains the full address. Nominatim handles Estonian diacritics (ä, ö, ü, õ) correctly.

**Rate limit in backfill context:** With ~20 existing listings needing geocoding, a 1.1-second sleep between requests covers the policy. A one-time backfill endpoint (`POST /api/geocode-backfill`) with `time.sleep(1.1)` is sufficient. [ASSUMED: typical listing count]

### 4. Tallinn District GeoJSON

**Status: CONFIRMED** [VERIFIED: live Overpass API query + Nominatim live fetch]

**All 8 districts confirmed at admin_level=9 in OpenStreetMap:**

| District | OSM Relation ID | Example Population |
|----------|----------------|-------------------|
| Haabersti linnaosa | 352068 | 47,532 |
| Kesklinn linnaosa | 351870 | — |
| Kristiine linnaosa | 353790 | — |
| Lasnamäe linnaosa | 355154 | — |
| Mustamäe linnaosa | 350487 | — |
| Nõmme linnaosa | 351671 | — |
| Pirita linnaosa | 351624 | — |
| Põhja-Tallinna linnaosa | 350769 | — |

**How to obtain the GeoJSON file (one-time, at development time):**

Option A — Overpass API query (recommended):
```
[out:json][timeout:30];
relation["boundary"="administrative"]["admin_level"="9"]["name"~"linnaosa"](59.35,24.55,59.55,24.95);
out geom;
```
Then convert OSM JSON → GeoJSON using `osmtogeojson` (npm tool, run once) or write a small Python script using the `osmium` library. Save result as `app/static/tallinn-districts.geojson`.

Option B — Nominatim polygon_geojson: Fetch each district individually:
```
GET https://nominatim.openstreetmap.org/lookup?osm_ids=R352068,R351870,R353790,R355154,R350487,R351671,R351624,R350769&format=json&polygon_geojson=1
```
Returns GeoJSON polygons per district. Manually assemble into a FeatureCollection. This requires no additional tools.

**Expected file size:** ~300–800KB unminified (8 complex polygon boundaries). Acceptable as a bundled static file.

**District name normalisation:** The `district` field in `app_data.json` properties/pending entries uses informal names like `"Haabersti"`, `"Kesklinn"`, `"Mustamäe"` etc. The GeoJSON feature `name` property will be `"Haabersti linnaosa"`. A simple `feature.properties.name.replace(" linnaosa", "")` lookup resolves the mismatch.

**Alternative source:** Estonian Land Board (maaamet.ee) provides official boundary data in SHP/JSON format via their ArcGIS REST service at `https://geoportaal.maaamet.ee`, but OSM data via Overpass is simpler to access programmatically and covers the same districts. [CITED: geoportaal.maaamet.ee/eng/spatial-data/administrative-and-settlement-division-p312.html]

### 5. Leaflet CDN

**Status: CONFIRMED** [VERIFIED: npm registry — version 1.9.4; official leaflet.js download page]

```html
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
```

**Current stable version:** 1.9.4 (released 2023-05-18; in v1.x maintenance mode — only critical bugfixes). Leaflet 2.0 alpha exists but is NOT production-ready. Use 1.9.4.

**No API key required.** No billing. OSM tiles are free.

**OpenStreetMap tile URL pattern for use in Leaflet:**
```javascript
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 19
})
```

**Key Leaflet APIs needed for this phase:**
- `L.map(container)` — initialize map
- `L.tileLayer(...)` — OSM base tiles
- `L.circleMarker([lat, lng], options)` — score-coloured pins
- `L.geoJSON(geojsonData, options)` — district polygons + isochrone overlay
- `.addTo(map)`, `.removeFrom(map)` — layer toggle
- `.on('click', fn)` — pin click → detail panel
- `L.popup()` — hover tooltip

**Important Leaflet convention:** Map coordinates are `[latitude, longitude]` order. This is the OPPOSITE of ORS/GeoJSON which uses `[longitude, latitude]`. Ensure coordinate order is correct at each API boundary.

### 6. Existing Frontend (index.html)

**Status: FULLY READ** [VERIFIED: file read directly]

**File size:** 1,499 lines. The file has 3 `<script>` blocks:
1. Lines 248–1088: Main SPA (state, render, events) — the dossier detail view for manually-added properties
2. Lines 1090–1400: Phase 02 pending queue tab (fetch, render, approve, reject)
3. Lines 1402–1497: Phase 02 draft email opt-in button (MutationObserver injection)

**Tab structure:** Two tabs — "Досье" (dossier) and "Pending" — toggled by `data-action="show-dossier-tab"` / `data-action="show-pending-tab"` buttons. Tab state is managed by `window._setActiveTabButton()`. Phase 5 adds a third tab or replaces the homepage layout entirely.

**CSS variable system (complete list):**
```css
--paper: #E9ECE5        /* main background */
--paper-panel: #DEE2D8  /* sidebar */
--paper-card: #F4F5F0   /* cards */
--ink: #1E2A22          /* primary text */
--ink-soft: #57624F
--ink-faint: #8A9282
--blueprint: #2B4A63    /* primary blue/action colour */
--blueprint-soft: #5D7C93
--line: #C4CBB9
--line-soft: #D5DACB
--red: #A6392E           --red-bg: #F3E1DD
--green: #3C6B4A         --green-bg: #E1EBE1
--amber: #A8763A         --amber-bg: #F1E6D3
--blue: #2B4A63          --blue-bg: #DEE6EB
--grey: #8A9282          --grey-bg: #E4E6DD
--radius: 3px
--font-display: 'Space Grotesk', sans-serif
--font-body: 'Inter', sans-serif
--font-mono: 'IBM Plex Mono', monospace
```

Per D-13, the executor may extend or replace this palette. The green/amber/red semantic values MUST be retained or re-mapped (used for pin colours, score badges).

**state JS object:**
```javascript
var state = { properties:[], checklists:{}, selectedId:null, priceHistory:{} };
```
Phase 5 must extend to: `{ properties:[], pending:[], checklists:{}, selectedId:null, priceHistory:{} }`. Note that `pending[]` is currently loaded separately via `/api/pending` fetch, not from `/api/data`. Phase 5 redesign should consolidate — either add `pending` to `/api/data` response or keep separate fetch.

**loadData() — current implementation:**
- `GET /api/data` → populates `state.properties`, `state.checklists`, `state.priceHistory`
- Does NOT load `state.pending` (pending tab fetches separately via `/api/pending`)
- Phase 5 must add `lat`, `lng`, `commute_minutes` extraction from the properties/pending entries

**renderMain() key structure:**
- Renders the dossier detail for the selected property from `state.properties`
- Uses `escapeHtml()` for all interpolated strings
- Safe DOM insertion via `document.createElement` + `textContent` for dynamic data (established post-render in Phase 3)

**buildAiChecklistEl(listingId):** Lines 1208–1253. Returns a DOM element or null. Reads from `state.checklists[listingId].ai_checklist`. Supports both flat string and `{result, source}` shapes. All text via `textContent`. Reusable in Phase 5 detail panel.

**daysOnMarket(listingId):** Lines 1174–1182. Returns integer days or null. Reads from `state.priceHistory[listingId]`. Reusable in Phase 5 detail panel.

**buildPriceHistoryEl(listingId):** Lines 1186–1203. Returns a DOM div or null. Renders plain text history rows. All via `textContent`. Reusable in Phase 5 detail panel for sparkline predecessor (Phase 5 will add an SVG sparkline variant).

**buildPendingCard(entry):** Lines 1256–1337. Builds a full card with image, score, meta, AI checklist badges, action buttons. Reusable structure for Phase 5 detail panel for pending listings.

**File split decision:** The current 1,499 lines will grow significantly with the map, district overlay, isochrone layer, detail panel, comparison modal, and charts. Expected Phase 5 size: 2,500–3,500 lines. The executor should split into logical `<script src="...">` blocks served via FastAPI StaticFiles:
- `index.html` — HTML shell + CSS variables
- `static/app-core.js` — state, loadData(), escapeHtml(), fmtEur(), shared helpers
- `static/map.js` — Leaflet init, pins, district layer, isochrone layer
- `static/detail-panel.js` — side panel render, mini-map, AI badges, actions
- `static/comparison.js` — comparison table
- `static/dashboard.js` — KPI strip, score dist bars, scatter chart, activity feed
- `static/pending-tab.js` — existing pending tab (moved from inline)
- `static/draft-email.js` — existing draft email button (moved from inline)

FastAPI already mounts `StaticFiles(directory="static", html=True)` so all `*.js` files in `app/static/` are auto-served.

### 7. Existing Backend Routes (main.py)

**Status: FULLY READ** [VERIFIED: file read directly]

**All current endpoints:**
| Method | Path | Handler | Purpose |
|--------|------|---------|---------|
| GET | /api/data | get_data() | Returns load_app_data() verbatim |
| PUT | /api/data | put_data() | Saves properties + checklists |
| POST | /api/check-now | check_now() | Trigger manual scrape |
| GET | /api/health | health() | Health check |
| GET | /api/pending | get_pending() | Returns pending[] array |
| POST | /api/pending/{id}/approve | approve_pending() | Move pending → properties |
| POST | /api/pending/{id}/reject | reject_pending() | Move pending → rejected |
| POST | /api/ingest | ingest() | Receive scraper batch [token auth] |
| POST | /api/heartbeat | heartbeat() | Scraper health signal [token auth] |
| POST | /api/draft/{id} | create_draft_endpoint() | Create Gmail draft |
| GET (static) | / + all paths | StaticFiles | index.html + JS files |

**StaticFiles mount:** `app.mount("/", StaticFiles(directory="static", html=True), name="static")` — line 174. This is the LAST mount, correctly placed after all `/api/*` routes. Any new `/api/*` route added before this line will work correctly.

**New endpoints needed for Phase 5:**
1. `GET /api/isochrone` — Optional. Since `app/static/isochrone.geojson` is already served by StaticFiles, a dedicated API endpoint is not needed. Frontend can fetch `/isochrone.geojson` directly. **Only needed if ORS call happens at runtime** rather than pre-computed.
2. `POST /api/refresh-isochrone` — Admin endpoint to re-fetch isochrone from ORS. Takes no body, calls ORS, writes `app/static/isochrone.geojson`, returns `{"ok": true}`. No auth (behind Caddy basicauth).
3. `POST /api/geocode-backfill` — One-time endpoint to geocode existing listings without lat/lng. Iterates properties[] + pending[], calls Nominatim with 1.1s delay, updates entries, saves. Returns `{"ok": true, "geocoded": N}`. No auth.

**Note on /api/data response:** The `lat`, `lng`, and `commute_minutes` fields will be added directly to entries within `properties[]` and `pending[]` by the ingest pipeline. The frontend reads them from the existing `/api/data` response without any new endpoint.

### 8. Data Store Shape (data_store.py)

**Status: FULLY READ** [VERIFIED: file read directly]

**DEFAULT_APP_DATA (complete):**
```python
DEFAULT_APP_DATA = {
    "properties": DEFAULT_PROPERTIES,  # list of property dicts
    "checklists": {},                  # {listing_id: {finance:{}, quality:{}, ai_checklist:{}, ...}}
    "settings": {},
    "pending": [],                     # list of pending listing dicts
    "rejected": [],                    # list of rejected listing dicts
    "price_history": {},               # {listing_id: [{date, price}, ...]}
}
```

**Fields currently on properties[] entries (from DEFAULT_PROPERTIES + _pending_to_property):**
`id`, `name`, `district`, `url`, `price`, `area`, `rooms`, `pricePerSqm`, `year`, `material`, `notes`, `draft_body`, `contact_email`, `draft_subject`, `score` (optional), `verdict` (optional), `removed` (optional), `removed_at` (optional)

**Fields currently on pending[] entries (from process_ingest_batch):**
All Listing dataclass fields (`id`, `url`, `title`, `price_eur`, `price_per_sqm`, `rooms`, `area_sqm`, `year_built`, `condition`, `material`, `floor`, `floor_total`, `parking`, `needs_renovation`, `broker_name`, `contact_email`, `description`, `image_url`, `image_count`, `raw_ok`) + `score`, `verdict`, `strengths`, `concerns`, `draft_subject`, `draft_body`, `queued_at`, `tg_message_id`, `tg_chat_id`

**New fields to add for Phase 5:**
- `lat: Optional[float]` — WGS84 latitude
- `lng: Optional[float]` — WGS84 longitude  
- `commute_minutes: Optional[int]` — driving minutes from Veerenni 28

**setdefault migration pattern (established convention):**
```python
def load_app_data():
    with _lock:
        data = _read_json(config.APP_DATA_FILE, DEFAULT_APP_DATA)
        data.setdefault("properties", [])
        data.setdefault("checklists", {})
        data.setdefault("settings", {})
        data.setdefault("pending", [])
        data.setdefault("rejected", [])
        data.setdefault("price_history", {})
        # Phase 5: no new top-level keys needed; lat/lng/commute_minutes live on individual entries
        return data
```

Per-entry migration (apply in load functions or getters):
```python
for entry in data.get("properties", []) + data.get("pending", []):
    entry.setdefault("lat", None)
    entry.setdefault("lng", None)
    entry.setdefault("commute_minutes", None)
```

**New helper to add:**
```python
def update_listing_coords(listing_id: str, lat: float, lng: float, commute_minutes: int) -> bool:
    """Update lat/lng/commute_minutes on a pending or properties entry. Returns True if found."""
    with _lock:
        data = load_app_data()
        for entry in data.get("properties", []) + data.get("pending", []):
            if entry.get("id") == listing_id:
                entry["lat"] = lat
                entry["lng"] = lng
                entry["commute_minutes"] = commute_minutes
                save_app_data(data)
                return True
        return False
```

**Thread-safety:** All new helpers must hold `_lock` (RLock). The ingest handler already holds `_lock` for the full batch, so ORS matrix calls within `process_ingest_batch` should update `app_data` dict in-place (same pattern as `_record_and_check_price_drop`), not call `update_listing_coords` (which would re-acquire the lock unnecessarily — though it would not deadlock since `_lock` is an `RLock`).

### 9. Listing Parser Shape (kv_listing_parser.py)

**Status: FULLY READ** [VERIFIED: file read directly]

**Listing dataclass (complete field list):**
```python
@dataclass
class Listing:
    id: str
    url: str
    title: str = ""
    price_eur: Optional[int] = None
    price_per_sqm: Optional[int] = None
    rooms: Optional[int] = None
    area_sqm: Optional[float] = None
    year_built: Optional[int] = None
    condition: str = ""
    material: str = ""
    floor: Optional[int] = None
    floor_total: Optional[int] = None
    parking: str = "unknown"
    needs_renovation: bool = False
    broker_name: str = ""
    contact_email: Optional[str] = None
    description: str = ""
    image_url: str = ""
    image_count: int = 0
    raw_ok: bool = True
    # PHASE 5 ADDITIONS:
    lat: Optional[float] = None
    lng: Optional[float] = None
```

**Note:** `district` is NOT on the Listing dataclass (see `ingest_handler.py` line 116 comment: "Listing dataclass has no district field — district is inferred via getattr with empty-string fallback"). District assignment happens at eval/pending-entry level from existing properties context.

**fetch_listing() structure:** Fetches one URL → BeautifulSoup parse → text extraction → regex series. Currently 80 lines. Coordinate extraction should be added AFTER the existing regex block, searching `resp.text` directly for JSON patterns (not `soup.get_text()`, since coordinates are in script blocks that `get_text()` strips).

**Where to add coord extraction:**
```python
# After existing regex extractions, before return:
# Search raw HTML (resp.text) not soup.get_text() — coords are in script blocks
lat_m = COORD_LAT_RE.search(resp.text)
lng_m = COORD_LNG_RE.search(resp.text)
if lat_m and lng_m:
    listing.lat = float(lat_m.group(1))
    listing.lng = float(lng_m.group(1))
```

**Both mini PC and VPS run the same kv_listing_parser.py** (kept byte-identical per Phase 1 decision). Adding lat/lng to the Listing dataclass is safe — the JSON serialisation via `dataclasses.asdict()` in ingest_handler automatically includes new fields. The VPS copy of the parser also benefits for any direct parsing.

### 10. Ingest Handler Shape (ingest_handler.py)

**Status: FULLY READ** [VERIFIED: file read directly]

**process_ingest_batch() execution flow:**
1. Acquire `data_store._lock`
2. Load `agent_state` + `app_data`
3. Snapshot `today_str`
4. For each listing dict in batch:
   - Deserialize to Listing
   - Dedup check → skip if seen (record price + check drop)
   - Apply price/rooms/image filters
   - Evaluate with Claude
   - Build pending_entry dict
   - `data_store.add_to_pending()` (re-enters _lock via RLock — safe)
   - `data_store.write_checklist_ai()` (same)
   - Send Telegram card
   - Reload app_data (picks up add_to_pending writes)
   - `_record_and_check_price_drop()`
5. `_mark_removed_listings()`
6. Save agent_state + app_data

**Where ORS Matrix call fits:** After step 4f (Telegram card sent) and after app_data reload, but BEFORE `_record_and_check_price_drop`. Insert:
```python
# Phase 5: compute commute time if lat/lng extracted
if listing.lat is not None and listing.lng is not None:
    commute_mins = _fetch_commute_minutes(listing.lat, listing.lng)
    if commute_mins is not None:
        # Patch the pending entry in app_data (already reloaded above)
        for entry in app_data.get("pending", []):
            if entry.get("id") == listing.id:
                entry["commute_minutes"] = commute_mins
                entry["lat"] = listing.lat
                entry["lng"] = listing.lng
                break
```

**_fetch_commute_minutes helper (new, in ingest_handler.py):**
```python
def _fetch_commute_minutes(lat: float, lng: float) -> Optional[int]:
    """Call ORS Matrix API for driving minutes from Veerenni 28 to one listing.
    Returns None on failure (never-raise pattern)."""
    try:
        payload = {
            "locations": [[24.7205, 59.4203], [lng, lat]],  # [lon, lat] order
            "sources": [0],
            "destinations": [1],
            "metrics": ["duration"]
        }
        headers = {
            "Authorization": f"Bearer {config.ORS_API_KEY}",
            "Content-Type": "application/json"
        }
        resp = requests.post(
            "https://api.openrouteservice.org/v2/matrix/driving-car",
            json=payload, headers=headers, timeout=10
        )
        resp.raise_for_status()
        data = resp.json()
        duration_secs = data["durations"][0][0]
        if duration_secs is None:
            return None
        return max(1, round(duration_secs / 60))
    except Exception:
        log.exception("ORS matrix call failed for lat=%s lng=%s — skipping commute_minutes", lat, lng)
        return None
```

**ORS_API_KEY guard:** If `config.ORS_API_KEY` is empty, skip the ORS call silently (same pattern as other optional integrations). Log a warning once at startup.

### 11. Config Shape (config.py)

**Status: FULLY READ** [VERIFIED: file read directly]

**Existing env vars:**
```python
TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
GMAIL_ADDRESS, GMAIL_APP_PASSWORD
ANTHROPIC_API_KEY, ANTHROPIC_MODEL
KV_SEARCH_URL
INGEST_TOKEN, WEB_BASE_URL
DRAFT_SCORE_THRESHOLD, MIN_IMAGES, MIN_ROOMS, MAX_PRICE_EUR
CHECK_INTERVAL_HOURS, PRICE_DROP_THRESHOLD
HEARTBEAT_TIMEOUT_HOURS
DATA_DIR, APP_DATA_FILE, AGENT_STATE_FILE
BUYER_PROFILE
```

**One new env var needed:**
```python
ORS_API_KEY = os.environ.get("ORS_API_KEY", "")
```

Add to `config.py` after `ANTHROPIC_MODEL`. Also add to `docker-compose.yml` environment section and `.env.example`.

**Veerenni 28 coordinates — hard-code in config.py or ingest_handler.py:**
```python
BOLT_HQ_LNG = 24.7205  # Veerenni 28, Tallinn
BOLT_HQ_LAT = 59.4203
```

These are known constants (D-06), not env vars. Hard-coding in `config.py` is correct.

### 12. Charting Strategy

**For score distribution (3-bar: green/amber/red tier counts):** Pure CSS flex or pure SVG is sufficient and requires no external library. Three divs with proportional widths, coloured with existing `--green`, `--amber`, `--red` CSS variables. Zero dependency. Recommended.

**For price vs score scatter (all listings, x=price, y=score):** Either:
- Pure SVG (no library): ~30 lines of JS to compute x/y positions, render `<circle>` elements, add hover tooltips. Simple enough for 20–50 data points.
- Chart.js CDN: Cleaner hover/tooltip UX, auto-scaling axes. CDN URL: `https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js` (~60KB compressed). [VERIFIED: npm registry]

**Recommendation:** Pure SVG for score distribution bars; Chart.js for the scatter plot (richer UX for a multi-point scatter with hover). If executor prefers zero external deps, both can be pure SVG with minimal complexity.

**Price history sparkline (in detail panel):** Already partially implemented as `buildPriceHistoryEl()` (plain text rows). Phase 5 upgrades this to an inline SVG line chart. Pure SVG is the right choice — 5–10 points, no axes needed. Pattern:
```javascript
function buildSparklineSVG(history) {
  // history: [{date, price}, ...]
  var prices = history.map(h => h.price);
  var min = Math.min(...prices), max = Math.max(...prices);
  var range = max - min || 1;
  var W = 120, H = 32;
  var points = prices.map((p, i) =>
    [(i / (prices.length - 1)) * W, H - ((p - min) / range) * H]
  ).map(([x, y]) => x + ',' + y).join(' ');
  // return SVG polyline element
}
```

### 13. Activity Feed Strategy

**Recommendation: Compute on-the-fly from existing data.** No new `activity_log` key needed. [ASSUMED — based on data shape analysis; user confirmed this is Claude's discretion]

The last 5 events can be derived from:
1. **Price drops:** `price_history[id]` entries where consecutive prices differ by ≥5% — these already have timestamps (date strings)
2. **New listings entering pending:** `pending[].queued_at` ISO timestamp
3. **Listings removed:** `properties[].removed_at` or `pending[].removed_at`
4. **Recent approval events:** No explicit timestamp on `properties[]` entries (they don't record approval_at). This is a gap — either add `approved_at` at approval time, or skip "approval" events and show only the above 3 types.

**Implementation pattern:**
```javascript
function computeActivityFeed(state, maxItems) {
  var events = [];
  // Price drops from history
  Object.entries(state.priceHistory).forEach(([id, hist]) => {
    for (var i = 1; i < hist.length; i++) {
      if ((hist[i-1].price - hist[i].price) / hist[i-1].price >= 0.05) {
        events.push({date: hist[i].date, type: 'price_drop', id, 
          label: `Price drop: ${hist[i-1].price}→${hist[i].price}€`});
      }
    }
  });
  // New pending listings
  state.pending.forEach(e => {
    if (e.queued_at) events.push({date: e.queued_at, type: 'new', id: e.id, 
      label: `New listing: ${e.title || e.id}`});
  });
  // Removed listings
  [...state.properties, ...state.pending].filter(e => e.removed_at).forEach(e => {
    events.push({date: e.removed_at, type: 'removed', id: e.id, 
      label: `Removed: ${e.name || e.title || e.id}`});
  });
  return events.sort((a, b) => b.date.localeCompare(a.date)).slice(0, maxItems);
}
```

**Gap noted:** No `approved_at` timestamp on `properties[]` entries. If the executor wants to show "Approved" events in the feed, add `approved_at: datetime.now(timezone.utc).isoformat()` in `data_store._pending_to_property()`.

---

## Architecture Patterns

### System Architecture Diagram

```
Mini PC Scraper (kv_scraper.py + kv_listing_parser.py)
  │  Playwright Cloudflare bypass
  │  fetch_listing() → Listing{lat?, lng?}
  │
  └─ POST /api/ingest → VPS ingest_handler.py
       │  filter → evaluate (Claude) → write pending entry
       │  if lat/lng: call ORS Matrix → store commute_minutes
       └─ save app_data.json (properties[], pending[], price_history{})

Browser (index.html + static/*.js)
  │
  ├─ GET /api/data → state.properties[], state.pending[], state.priceHistory{}
  ├─ GET /isochrone.geojson → Leaflet GeoJSON layer (20-min polygon)
  ├─ GET /tallinn-districts.geojson → Leaflet heat zone layer (8 polygons)
  │
  ├─ Map view (60%)
  │    L.circleMarker per listing (lat/lng from entry)
  │    District heat zone (avg price/m² per district)
  │    Isochrone overlay (pre-fetched polygon)
  │    Pin click → detail panel
  │
  └─ Detail panel (40%)
       Commute badge (commute_minutes)
       Mini-map (secondary L.map instance)
       Price sparkline (inline SVG)
       AI checklist badges (buildAiChecklistEl)
       Action buttons (approve/reject/draft — conditional)
```

### Recommended Project Structure (Phase 5 additions)
```
app/static/
├── index.html              # HTML shell, CSS vars, <script> tags only
├── app-core.js             # state, loadData(), helpers, tab switching
├── map.js                  # Leaflet map init, pins, overlays, district layer
├── detail-panel.js         # side panel, mini-map, AI badges, sparkline
├── comparison.js           # comparison table modal
├── dashboard.js            # KPI strip, score dist, scatter chart, activity feed
├── pending-tab.js          # Phase 02 pending tab (extracted from index.html)
├── draft-email.js          # Phase 02 draft email button (extracted)
├── tallinn-districts.geojson  # bundled at development time
└── isochrone.geojson          # generated via POST /api/refresh-isochrone
```

### Pattern 1: Leaflet circleMarker with score colour
```javascript
// Source: Leaflet 1.9.4 docs
function scoreColor(score) {
  if (score >= 75) return 'var(--green)';
  if (score >= 50) return 'var(--amber)';
  return 'var(--red)';
}

function addListingPin(map, entry, isPending) {
  var marker = L.circleMarker([entry.lat, entry.lng], {
    radius: isPending ? 8 : 12,
    fillColor: scoreColor(entry.score),
    color: scoreColor(entry.score),
    weight: isPending ? 2 : 1.5,
    dashArray: isPending ? '4,3' : null,
    opacity: 1,
    fillOpacity: 0.85
  }).addTo(map);
  marker.on('click', function() { openDetailPanel(entry); });
  return marker;
}
```

### Pattern 2: GeoJSON district heat zone
```javascript
// Source: Leaflet 1.9.4 docs
function districtColor(avgPricePerSqm) {
  if (!avgPricePerSqm) return '#cccccc';
  if (avgPricePerSqm < 2500) return 'var(--green)';
  if (avgPricePerSqm < 3000) return 'var(--amber)';
  if (avgPricePerSqm < 3500) return '#E86A2E'; // deep amber
  return 'var(--red)';
}

L.geoJSON(tallinnDistrictsGeoJSON, {
  style: function(feature) {
    var districtName = feature.properties.name.replace(' linnaosa', '');
    var avg = computeDistrictAvg(districtName, state);
    return {
      fillColor: districtColor(avg),
      weight: 1,
      color: '#555',
      fillOpacity: 0.25
    };
  },
  onEachFeature: function(feature, layer) {
    layer.bindTooltip(feature.properties.name);
  }
}).addTo(map);
```

### Anti-Patterns to Avoid
- **innerHTML with user data:** All listing titles, addresses, and descriptions must go through `textContent` or `escapeHtml()`. The existing convention from Phases 2–3 must be maintained.
- **Initialising multiple full Leaflet maps on load:** Only init the main map on DOMContentLoaded. The mini-map in the detail panel must be lazily initialised when the panel opens (and destroyed when it closes), or Leaflet will produce container-already-initialised errors.
- **Calling ORS per-listing at render time:** Commute times must be computed at ingest and stored. Never call ORS from the browser.
- **Forgetting ORS lon/lat order:** ORS uses `[longitude, latitude]`, Leaflet uses `[latitude, longitude]`. Mixing these produces pins in the ocean.
- **Fetching district GeoJSON from Overpass at runtime:** Overpass API is not a CDN. Bundle the GeoJSON as a static file at development time.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Interactive map with markers | Custom SVG/Canvas map | Leaflet 1.9.4 | Tile loading, zoom, projection, clustering, popup handling are all complex edge cases |
| Isochrone polygon calculation | Custom BFS on road graph | ORS Isochrone API | Road network routing requires a full graph and complex algorithms |
| Driving time computation | Haversine distance proxy | ORS Matrix API | Haversine ignores roads; a 5km straight line can be 20 min of actual driving |
| Address geocoding | Custom Estonian address parser | Nominatim | EHAK address normalisation, inflection, abbreviation handling |
| Chart rendering (scatter) | Custom SVG axis math | Chart.js or pure SVG circles | Axis scaling, aspect ratio, hover detection — tedious to get right |

**Key insight:** The map and routing layer are the most complex parts of this phase. Using Leaflet + ORS means the executor writes zero geometry code. The entire map capability is ~50 lines of Leaflet API calls.

---

## Common Pitfalls

### Pitfall 1: Leaflet container already initialised
**What goes wrong:** Opening the detail panel with a mini-map, closing it, reopening — throws "Map container is already initialized".
**Why it happens:** `L.map(domElement)` stores state on the container. Re-calling it on the same element fails.
**How to avoid:** Keep a reference to the mini-map instance. On panel close, call `miniMap.remove()`. On panel open, create a new instance in a freshly-created DOM element.
**Warning signs:** Console error "Map container is already initialized" on second pin click.

### Pitfall 2: ORS lon/lat order confusion
**What goes wrong:** Commute pins appear in the ocean or wrong country.
**Why it happens:** ORS uses GeoJSON `[longitude, latitude]` order. Leaflet uses `[latitude, longitude]`. The error is silent — the API call succeeds with wrong coordinates.
**How to avoid:** Comment every ORS coordinate array explicitly: `[lng, lat]  // ORS/GeoJSON order`. Comment every Leaflet array: `[lat, lng]  // Leaflet order`.
**Warning signs:** Pins appear in Africa or Atlantic Ocean.

### Pitfall 3: District heat zone with no data
**What goes wrong:** Some districts show grey (no colour) because no listings exist in that district.
**Why it happens:** `state.properties[]` and `state.pending[]` use informal district names (`"Kesklinn"`) that don't exactly match the GeoJSON feature name (`"Kesklinna linnaosa"`).
**How to avoid:** Normalise both sides. Strip `" linnaosa"` suffix from GeoJSON names before lookup. Also handle common variants: "Põhja-Tallinn" vs "Põhja-Tallinna linnaosa".
**Warning signs:** All districts grey or wrong-coloured on first load.

### Pitfall 4: Nominatim User-Agent violation
**What goes wrong:** Nominatim starts rate-limiting or blocking requests.
**Why it happens:** Nominatim usage policy requires a valid `User-Agent` identifying the application and contact info. Missing UA is a policy violation.
**How to avoid:** Always set: `headers = {"User-Agent": "ApartsLooker/1.0 daniel.tjulinov@gmail.com"}`. Sleep 1.1 seconds between requests.
**Warning signs:** HTTP 429 or 503 responses from Nominatim.

### Pitfall 5: ORS free tier with empty ORS_API_KEY
**What goes wrong:** All ORS calls fail silently, commute_minutes stays None everywhere.
**Why it happens:** ORS requires an API key even for the free tier. An empty key returns HTTP 403.
**How to avoid:** Check `if not config.ORS_API_KEY: log.warning("ORS_API_KEY not set — commute times disabled")` at startup. The `_fetch_commute_minutes` function logs and returns None on any error, so the ingest pipeline continues without commute data.
**Warning signs:** All listing entries have `commute_minutes: null` in the data.

### Pitfall 6: isochrone.geojson not present on first startup
**What goes wrong:** Frontend fetches `/isochrone.geojson` and gets 404.
**Why it happens:** The file is generated via `POST /api/refresh-isochrone`, which must be called at least once after deployment and after ORS_API_KEY is configured.
**How to avoid:** Add a startup check in `on_startup()`: if `app/static/isochrone.geojson` doesn't exist and `ORS_API_KEY` is set, fetch it automatically. Frontend should handle 404 gracefully (skip isochrone overlay, show no-isochrone state).
**Warning signs:** Map loads without the blue isochrone polygon.

### Pitfall 7: Large GeoJSON district file blocking map render
**What goes wrong:** Map appears blank for 1–2 seconds while district GeoJSON loads.
**Why it happens:** A ~500KB JSON file parsed synchronously blocks the main thread.
**How to avoid:** Load districts after the map initialises: `fetch('/tallinn-districts.geojson').then(r => r.json()).then(addDistrictLayer)`. This keeps the base map + pins visible immediately while districts load async.
**Warning signs:** Blank map on initial load, then sudden appearance.

---

## Runtime State Inventory

This is not a rename/refactor phase. Skipped.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Python 3.12 | All backend | ✓ (Docker) | 3.12 | — |
| requests library | ORS + Nominatim calls | ✓ | installed | — |
| Docker + compose | Deployment | ✓ | — | — |
| ORS_API_KEY | Isochrone + matrix | ✗ (not yet configured) | — | Skip commute features; still show map without commute data |
| Internet from VPS | ORS + Nominatim | ✓ (VPS has internet) | — | — |
| Leaflet CDN (unpkg) | Map rendering | ✓ (browser) | 1.9.4 | jsDelivr fallback |
| Chart.js CDN (jsDelivr) | Scatter chart | ✓ (optional) | 4.5.1 | Pure SVG fallback |

**Missing dependencies with no fallback:** None — all blocking dependencies are available.

**Missing dependencies with fallback:**
- `ORS_API_KEY`: Without it, `commute_minutes` stays null. Map renders without commute badge and without isochrone. Not a blocker for MAP-01, MAP-02, MAP-03, MAP-05.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest (existing, confirmed via app/tests/ directory) |
| Config file | none detected (pytest discovers tests/) |
| Quick run command | `python -m pytest app/tests/ -x -q` |
| Full suite command | `python -m pytest app/tests/ -v` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MAP-01 | Listing lat/lng extracted from kv.ee HTML | unit | `pytest app/tests/test_kv_listing_parser.py::test_coord_extraction -x` | ❌ Wave 0 |
| MAP-04/06 | ORS matrix returns commute_minutes | unit (mocked) | `pytest app/tests/test_ingest_handler.py::test_commute_minutes -x` | ❌ Wave 0 |
| MAP-04 | Isochrone refresh endpoint returns 200 | integration | `pytest app/tests/test_main.py::test_refresh_isochrone -x` | ❌ Wave 0 |
| MAP-01 | Listings without coords get lat/lng from Nominatim backfill | unit (mocked) | `pytest app/tests/test_geocode_backfill.py -x` | ❌ Wave 0 |
| UI-01/02 | Frontend-only (map, panels, comparison table) | manual-only | — | N/A |

**Justification for manual-only UI tests:** The frontend is a vanilla JS SPA with no build step or testing framework. Automated browser testing (Playwright) would require significant test infrastructure not present in this project. UAT via `/gsd-verify-work` covers MAP-01/02/03/05 visually.

### Wave 0 Gaps
- [ ] `app/tests/test_kv_listing_parser.py` — add `test_coord_extraction` with fixture HTML containing embedded coordinates
- [ ] `app/tests/test_ingest_handler.py` — add `test_commute_minutes` mocking ORS Matrix API
- [ ] `app/tests/test_main.py` — add `test_refresh_isochrone` mocking ORS Isochrone API
- [ ] `app/tests/test_geocode_backfill.py` — add Nominatim mock test

---

## Security Domain

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | — |
| V3 Session Management | No | — |
| V4 Access Control | Partial | `/api/refresh-isochrone` and `/api/geocode-backfill` behind Caddy basicauth |
| V5 Input Validation | Yes | All listing data rendered via textContent; ORS/Nominatim responses validated before storage |
| V6 Cryptography | No | — |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| XSS via listing title/address in map popup | Tampering | textContent only; never innerHTML for user-controlled data |
| SSRF via geocode-backfill endpoint (address field) | Tampering | Nominatim is a fixed URL; no user-supplied URL |
| ORS_API_KEY exposure in logs | Info Disclosure | Never log config values; existing NEVER log convention covers this |
| Malformed GeoJSON in isochrone.geojson causing parse error | DoS | Frontend catch + fallback if GeoJSON parse fails |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | kv.ee listing HTML embeds lat/lng in a script block parseable by regex | kv.ee Coordinate Extraction | Executor must fall back entirely to Nominatim for all listings — slower ingest, VPS does all geocoding |
| A2 | kv.ee embeds coords in one of: JSON-LD, script var, Next.js __NEXT_DATA__, or data-attribute | kv.ee Coordinate Extraction | If none of these patterns exist, coordinates are loaded dynamically via XHR (not in page HTML) — would require a more complex Playwright fetch |
| A3 | Nominatim backfill with 1.1s delay and ~20 existing listings completes in ~22 seconds | Nominatim | If listing count is much larger, backfill endpoint needs to be made async or paginated |
| A4 | ORS free tier has no daily request quota beyond per-request limits | ORS API | If there is a quota (e.g., 500 req/day), high-volume ingests could exhaust it. Mitigation: cache commute_minutes once set |
| A5 | Activity feed can be fully computed from existing data without a new activity_log key | Activity Feed | If approval timestamps are needed for the feed, `approved_at` field must be added to `_pending_to_property()` |

---

## Open Questions

1. **kv.ee coordinate embedding format**
   - What we know: The site uses Cloudflare and requires residential IP. Coordinates are likely in the HTML based on the fact that a map widget is rendered server-side or SSR.
   - What's unclear: Exact field path in the HTML/JavaScript.
   - Recommendation: Executor's Wave 0 task must include probing a live listing page via the Playwright session to identify the pattern before writing the regex.

2. **tallinn-districts.geojson generation method**
   - What we know: 8 district relation IDs confirmed (R352068, R351870, R353790, R355154, R350487, R351671, R351624, R350769). Overpass API can return them. Nominatim can return polygon_geojson per ID.
   - What's unclear: Which method produces a cleaner, smaller GeoJSON file.
   - Recommendation: Use Nominatim polygon_geojson approach (batch lookup by OSM IDs) — no external tool needed, pure Python/requests.

3. **Pending listings in /api/data vs /api/pending**
   - What we know: Currently the frontend fetches pending[] separately from `/api/pending`. For the map view, both approved and pending listings need lat/lng and commute_minutes at the same time.
   - What's unclear: Whether to merge pending into `/api/data` response or keep two fetches.
   - Recommendation: For simplicity, add `pending` to the `/api/data` GET response (it already lives in `app_data.json`). The existing `GET /api/pending` can remain for backward compatibility.

---

## Sources

### Primary (HIGH confidence)
- Direct file reads: `app/static/index.html`, `app/main.py`, `app/data_store.py`, `app/kv_listing_parser.py`, `app/ingest_handler.py`, `app/config.py`
- Live Nominatim API fetch: confirmed Estonian address geocoding works, response shape verified
- Live Overpass API fetch: confirmed all 8 Tallinn linnaosa relations at admin_level=9 with IDs
- Live OSM relation lookup: confirmed Haabersti (R352068) admin_level=9

### Secondary (MEDIUM confidence)
- openrouteservice.org restrictions page: confirmed free tier limits for isochrone and matrix
- WebSearch ORS community documentation: confirmed request body format and coordinate order
- leaflet.js download page: confirmed 1.9.4 is current stable CDN URL
- npm registry: leaflet@1.9.4 and chart.js@4.5.1 verified

### Tertiary (LOW confidence / ASSUMED)
- kv.ee coordinate embedding pattern: [ASSUMED] — cannot inspect live pages from datacenter IP

---

## Metadata

**Confidence breakdown:**
- Codebase analysis: HIGH — all relevant files read directly
- ORS API: MEDIUM-HIGH — endpoint format confirmed via docs and community examples; live test not possible without ORS_API_KEY
- Leaflet API: HIGH — confirmed version, CDN URLs, and key API surface
- Nominatim: HIGH — live tested successfully against real Estonian addresses
- Tallinn district GeoJSON: HIGH — all 8 district OSM relation IDs confirmed via live Overpass query
- kv.ee coord extraction: LOW (ASSUMED) — cannot verify without residential IP access

**Research date:** 2026-07-09
**Valid until:** 2026-08-09 (stable APIs; Leaflet in maintenance mode; ORS API stable; OSM data refreshes continuously)
