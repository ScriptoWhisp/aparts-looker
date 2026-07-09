# Phase 5: Map & Overview UI - Pattern Map

**Mapped:** 2026-07-09
**Files analyzed:** 8 new/modified files
**Analogs found:** 7 / 8 (1 file — tallinn-districts.geojson — has no code analog; it is a data artifact)

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `app/kv_listing_parser.py` | parser/model | transform | self (existing file, extend) | exact |
| `app/data_store.py` | data-store | CRUD | self (existing file, extend) | exact |
| `app/ingest_handler.py` | service | request-response + external API | self (existing file, extend) | exact |
| `app/config.py` | config | config | self (existing file, extend) | exact |
| `app/main.py` | controller/route | request-response | self (existing file, extend) | exact |
| `app/static/index.html` | frontend SPA shell | n/a | self (existing file, redesign) | exact |
| `app/static/isochrone.geojson` | static data artifact | file-I/O | none | no analog |
| `app/static/tallinn-districts.geojson` | static data artifact | file-I/O | none | no analog |

All Phase 5 backend work is extensions/modifications of existing files. The patterns below are extracted from those files so the planner can specify exactly which lines to copy, extend, or follow.

---

## Pattern Assignments

### `app/kv_listing_parser.py` — add `lat` and `lng` to Listing dataclass + coord extraction

**Analog:** self (`app/kv_listing_parser.py`, lines 31–46 for regex block; lines 50–72 for dataclass; lines 114–166 for extraction pattern)

**Existing module-level regex pattern** (lines 31–46) — follow this style for coord regexes:
```python
OBJECT_ID_RE = re.compile(r"-(\d{6,8})\.html")
PRICE_RE = re.compile(r"([\d]{2,3}(?:\s\d{3})*)\s?€\s+([\d]{1,2}(?:\s\d{3})?)\s?€/m")
ROOMS_RE = re.compile(r"Tube\s*\|?\s*\n?\s*\|?\s*(\d+)")
# ... etc.
PARKING_FREE_RE = re.compile(r"parkimine\s+tasuta|parkimiskoht\s+olemas", re.IGNORECASE)
```
New coord regexes go at the bottom of this block. Naming convention: `COORD_LAT_RE`, `COORD_LNG_RE`.

**Existing Listing dataclass** (lines 50–72) — add `lat` and `lng` as Optional[float] = None at the bottom, matching the `Optional[int] = None` pattern used for all nullable fields:
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
    # Phase 5 additions appended here:
    # lat: Optional[float] = None
    # lng: Optional[float] = None
```

**Existing extraction pattern inside `fetch_listing()`** (lines 114–166) — copy this m-group pattern for coord extraction. Note: coord extraction must search `resp.text` (raw HTML), NOT `text` (the `soup.get_text()` output), because coordinates are in `<script>` blocks that BeautifulSoup strips:
```python
# Existing pattern (e.g., lines 114-117) — replicate for coords:
price_m = PRICE_RE.search(text)       # <-- text = soup.get_text(); fine for visible fields
if price_m:
    listing.price_eur = _to_int(price_m.group(1))
    listing.price_per_sqm = _to_int(price_m.group(2))

# For coords, search resp.text (raw HTML) not text:
# lat_m = COORD_LAT_RE.search(resp.text)
# lng_m = COORD_LNG_RE.search(resp.text)
# if lat_m and lng_m:
#     listing.lat = float(lat_m.group(1))
#     listing.lng = float(lng_m.group(1))
```

**Never-raise guard** (lines 100–106) — the entire `fetch_listing()` function body is guarded. Coord extraction should follow the same guard-free inline pattern (not add its own try/except), since the outer `try` at line 100 already wraps everything in the HTTP-response block:
```python
    try:
        getter = session if session else requests
        resp = getter.get(url, headers=HEADERS, timeout=timeout)
        resp.raise_for_status()
    except requests.RequestException:
        listing.raw_ok = False
        return listing
    # Everything below this line can assume resp.text is available.
```

---

### `app/data_store.py` — add `lat`, `lng`, `commute_minutes` to entries + `update_listing_coords()` helper

**Analog:** self (`app/data_store.py`)

**setdefault migration pattern** (lines 83–92) — copy exactly for per-entry field migration:
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
        # Phase 5: add per-entry setdefault for new fields after the top-level setdefaults:
        # for entry in data.get("properties", []) + data.get("pending", []):
        #     entry.setdefault("lat", None)
        #     entry.setdefault("lng", None)
        #     entry.setdefault("commute_minutes", None)
        return data
```

**Helper function pattern with _lock + load → modify → save** (lines 133–155) — the `add_property_if_new` and `add_to_pending` functions show the exact lock + load + mutate + save shape. The new `update_listing_coords()` must follow the same pattern:
```python
def add_to_pending(entry: dict) -> bool:
    """Write a pending listing entry. Returns False if already in pending or properties (per D-05)."""
    with _lock:
        data = load_app_data()
        listing_id = entry.get("id")
        if any(e.get("id") == listing_id for e in data["pending"]):
            return False
        if any(p.get("id") == listing_id for p in data["properties"]):
            return False
        data["pending"].append(entry)
        save_app_data(data)
        return True
```

**Boolean return on not-found** — all helpers return `bool`. `update_listing_coords()` returns `True` if found and updated, `False` if listing_id not found. Match `approve_listing` (line 164–175) for this shape:
```python
def approve_listing(listing_id: str) -> bool:
    with _lock:
        data = load_app_data()
        pending = data.get("pending", [])
        entry = next((e for e in pending if e.get("id") == listing_id), None)
        if entry is None:
            return False
        # ... mutate ...
        save_app_data(data)
        return True
```

**`_pending_to_property()` extension** (lines 204–240) — when `lat`, `lng`, `commute_minutes` are set on a pending entry, they must also be carried over into the properties[] entry at approval time. Follow the existing carry-over pattern for `draft_body`, `contact_email`, `draft_subject` (lines 233–238):
```python
prop = {
    ...
    "draft_body": entry.get("draft_body", ""),
    "contact_email": entry.get("contact_email", ""),
    "draft_subject": entry.get("draft_subject", ""),
    # Phase 5: also carry over:
    # "lat": entry.get("lat"),
    # "lng": entry.get("lng"),
    # "commute_minutes": entry.get("commute_minutes"),
}
```

---

### `app/ingest_handler.py` — add `_fetch_commute_minutes()` helper + ORS call after lat/lng set

**Analog:** self (`app/ingest_handler.py`)

**Private helper never-raise pattern** (lines 54–70 for `_whitelist_checklist`, lines 144–181 for `_record_and_check_price_drop`) — all private helpers wrap their body in `try/except Exception` and log with `log.exception(...)`. New `_fetch_commute_minutes()` must follow exactly:
```python
def _whitelist_checklist(raw: dict) -> dict:
    try:
        result = {}
        for key in EXPECTED_CHECKLIST_KEYS:
            value = raw.get(key)
            result[key] = value if isinstance(value, str) and value in ALLOWED_CHECKLIST_VALUES else "unknown"
        return result
    except Exception:
        log.exception("_whitelist_checklist failed — returning all-unknown checklist")
        return {key: "unknown" for key in EXPECTED_CHECKLIST_KEYS}
```

**External HTTP call pattern** — `ai_evaluator.py` (not read here, but referenced in ingest_handler line 22) follows `requests.post(..., json=payload, headers=headers, timeout=N)` + `resp.raise_for_status()` inside a `try/except Exception`. The new `_fetch_commute_minutes` follows this same shape. See RESEARCH.md section 10 for the exact function body to implement.

**In-place dict mutation of app_data within `process_ingest_batch`** (lines 215–229 in `_handle_price_drop`) — when patching commute_minutes onto a pending entry, mutate in-place rather than calling `update_listing_coords()` (which would re-acquire `_lock`). Follow `_handle_price_drop`'s pattern:
```python
prop_entry = next((e for e in app_data.get("properties", []) if e.get("id") == listing.id), None)
if prop_entry is not None:
    prop_entry["score"] = new_score
    prop_entry["verdict"] = evaluation.get("verdict", "")
    # ... more mutations ...
```

**ORS_API_KEY guard at call site** — check `if not config.ORS_API_KEY: return None` at the top of `_fetch_commute_minutes()`. Mirror the pattern used for INGEST_TOKEN in main.py (lines 44–53):
```python
def _verify_ingest_token(...):
    if not config.INGEST_TOKEN:
        raise HTTPException(...)
```
For `_fetch_commute_minutes` the guard is a soft skip (return None), not a raise, per the never-raise convention.

---

### `app/config.py` — add `ORS_API_KEY` + Bolt HQ constants

**Analog:** self (`app/config.py`)

**Env var pattern** (lines 8–33) — all env vars follow `VARNAME = os.environ.get("VARNAME", "default")`. Add `ORS_API_KEY` after `ANTHROPIC_MODEL` (line 15), using empty string as default (same as all token env vars):
```python
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
ANTHROPIC_MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-haiku-4-5-20251001")
# Add here:
# ORS_API_KEY = os.environ.get("ORS_API_KEY", "")
```

**Hard-coded constants** — `IMAP_HOST`, `SMTP_HOST`, `SMTP_PORT` (lines 19–21) show the pattern for non-env constants. Bolt HQ coordinates are known constants, not env vars:
```python
IMAP_HOST = "imap.gmail.com"
SMTP_HOST = "smtp.gmail.com"
SMTP_PORT = 465
# Add Bolt HQ coords here (after ORS_API_KEY):
# BOLT_HQ_LNG = 24.7205  # Veerenni 28, Tallinn — [lon, lat] ORS order
# BOLT_HQ_LAT = 59.4203
```

---

### `app/main.py` — add `POST /api/refresh-isochrone` and `POST /api/geocode-backfill`

**Analog:** self (`app/main.py`)

**Synchronous admin endpoint pattern** (lines 61–63, `get_data`) — simple sync endpoints that call a data_store or handler function and return dict:
```python
@app.get("/api/data")
def get_data():
    return data_store.load_app_data()
```

**Background thread pattern** (lines 75–79, `check_now`) — for the geocode-backfill endpoint which may take 20+ seconds (1.1s sleep per listing), spawn a background daemon thread identical to check_now:
```python
@app.post("/api/check-now")
def check_now():
    """Manually trigger the scheduler tick instead of waiting for the schedule."""
    threading.Thread(target=scheduler.run_once_now, daemon=True).start()
    return {"ok": True, "message": "Scheduler tick started in background — watch Telegram in a moment."}
```

**JSON body parse pattern** (lines 101–108, `reject_pending`) — for any endpoint needing a request body:
```python
@app.post("/api/pending/{listing_id}/reject")
async def reject_pending(listing_id: str, request: Request):
    body = await request.json()
    reason = body.get("reason", "other")
    ...
    return {"ok": True}
```

**HTTPException 404 pattern** (lines 96–97, 148–149) — return 404 when resource not found:
```python
ok = data_store.approve_listing(listing_id)
if not ok:
    raise HTTPException(status_code=404, detail="Not found in pending queue")
```

**Static file placement constraint** (line 174) — all new `/api/*` routes must be declared BEFORE the `app.mount("/", StaticFiles(...))` line. This is the last line in the file and must remain last.

---

### `app/static/index.html` — full redesign + JS module split

**Analog:** self (entire `app/static/index.html`)

**CSS variable system** (lines 11–36) — executor must keep `--green`, `--amber`, `--red` (and their `-bg` variants), `--radius`, and the three font vars. These are used by score-tier logic and badge rendering. Executor may replace all other colours per D-13:
```css
:root{
  --paper:#E9ECE5;
  --paper-panel:#DEE2D8;
  --paper-card:#F4F5F0;
  --ink:#1E2A22;
  --ink-soft:#57624F;
  --ink-faint:#8A9282;
  --blueprint:#2B4A63;
  --blueprint-soft:#5D7C93;
  --line:#C4CBB9;
  --line-soft:#D5DACB;
  --red:#A6392E;   --red-bg:#F3E1DD;
  --green:#3C6B4A; --green-bg:#E1EBE1;
  --amber:#A8763A; --amber-bg:#F1E6D3;
  --blue:#2B4A63;  --blue-bg:#DEE6EB;
  --grey:#8A9282;  --grey-bg:#E4E6DD;
  --radius:3px;
  --font-display:'Space Grotesk', sans-serif;
  --font-body:'Inter', sans-serif;
  --font-mono:'IBM Plex Mono', monospace;
}
```

**CDN load pattern** (lines 7–9) — Google Fonts already loaded via `<link>` from CDN. Leaflet CSS/JS and optional Chart.js follow the same pattern, added in `<head>`:
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk..." rel="stylesheet">
```

**state object** (line 472) — Phase 5 must extend `state` to include `pending` and the new geo fields. Extend in the new `app-core.js`:
```javascript
var state = { properties:[], checklists:{}, selectedId:null, priceHistory:{} };
// Phase 5 extends to:
// var state = { properties:[], pending:[], checklists:{}, selectedId:null,
//               priceHistory:{}, compareIds:[] };
```

**loadData() pattern** (lines 496–510) — follow this fetch → parse → state populate → renderApp() shape in `app-core.js`. Phase 5 adds `pending` extraction:
```javascript
async function loadData(){
  try{
    var resp = await fetch("/api/data");
    if(!resp.ok) throw new Error("HTTP " + resp.status);
    var parsed = await resp.json();
    state.properties = (parsed.properties && parsed.properties.length) ? parsed.properties : [];
    state.checklists = parsed.checklists || {};
    state.priceHistory = parsed.price_history || {};
    // Phase 5: also extract state.pending = parsed.pending || [];
  } catch(e){
    console.error("load failed", e);
    setGlobalNotice("Failed to load from server.", "err");
  }
  ...
  renderApp();
}
```

**escapeHtml() utility** (lines 540–543) — copy verbatim into `app-core.js`; used by every tab that needs to interpolate strings into innerHTML:
```javascript
function escapeHtml(s){
  return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
  });
}
```

**fmtEur() utility** (lines 545–548) — copy verbatim into `app-core.js`:
```javascript
function fmtEur(n){
  n = Number(n)||0;
  return n.toLocaleString("et-EE", {maximumFractionDigits:0}) + " €";
}
```

**textContent-only DOM write convention** (enforced throughout — e.g., lines 1113, 1136, 1154, 1161, 1198, 1248, 1280, 1297) — never use `innerHTML` for any value that comes from listing data. Pin tooltips, detail panel text, activity feed labels, comparison table cells — all must use `textContent`. Use `innerHTML` only for static template structure (no user data interpolated):
```javascript
// Correct — user data via textContent:
badge.textContent = prefix + dot + " " + (LABELS[key] || key);

// Wrong — never do this with listing data:
// badge.innerHTML = `<b>${entry.title}</b>`;
```

**buildAiChecklistEl() function** (lines 1208–1253) — copy verbatim into `detail-panel.js`. Reads `state.checklists[listingId].ai_checklist`, renders pass/fail/unknown badge strip. The badge rendering pattern is the model for all other score-tier badges:
```javascript
function buildAiChecklistEl(listingId) {
  var cl = state.checklists[listingId];
  if (!cl || !cl.ai_checklist) return null;
  var ai_checklist = cl.ai_checklist;
  if (!Object.keys(ai_checklist).length) return null;
  var wrap = document.createElement("div");
  wrap.style.marginTop = "8px";
  wrap.style.display = "flex";
  wrap.style.flexWrap = "wrap";
  wrap.style.gap = "4px";
  // ... per-key badge loop using textContent only ...
  return wrap;
}
```

**daysOnMarket() function** (lines 1174–1181) — copy verbatim into `detail-panel.js`:
```javascript
function daysOnMarket(listingId) {
  var hist = state.priceHistory[listingId];
  if (!hist || !hist.length) return null;
  var first = new Date(hist[0].date);
  var now = new Date();
  var days = Math.floor((now - first) / 86400000);
  return days >= 0 ? days : null;
}
```

**buildPriceHistoryEl() function** (lines 1186–1203) — copy into `detail-panel.js` as the basis for the Phase 5 SVG sparkline variant. The existing plain-text version can serve as fallback:
```javascript
function buildPriceHistoryEl(listingId) {
  var hist = state.priceHistory[listingId];
  if (!hist || !hist.length) return null;
  var wrap = document.createElement("div");
  wrap.style.fontFamily = "var(--font-mono)";
  wrap.style.fontSize = "11px";
  wrap.style.color = "var(--ink-soft)";
  wrap.style.marginTop = "8px";
  hist.forEach(function(entry) {
    var row = document.createElement("div");
    row.textContent = entry.date + " — " + Number(entry.price).toLocaleString("et-EE") + " €";
    wrap.appendChild(row);
  });
  return wrap;
}
```

**buildPendingCard() structure** (lines 1256–1337) — the card structure (image → header → meta → AI checklist → action buttons) is the model for the detail panel layout. Copy and adapt into `detail-panel.js`. The approve/reject action fetch calls (lines 1313–1369) are reusable verbatim for the side panel's action buttons.

**Fetch + error handling pattern** (lines 1117–1141 in `renderPendingTab`) — standard fetch pattern with `.then()` success and `.catch()` error branch, no async/await (consistent with the surrounding IIFE code style):
```javascript
fetch("/api/pending")
  .then(function(r) {
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  })
  .then(function(data) {
    renderPendingList(main, data.pending || []);
  })
  .catch(function() {
    // ... render error state with textContent only ...
  });
```

**IIFE module wrapper** — each `<script>` block is wrapped in `(function(){ "use strict"; ... })();`. When splitting into external `.js` files, keep the IIFE + `"use strict"` per-file. Shared functions (escapeHtml, fmtEur, state) must be on `window.*` to be accessible cross-file:
```javascript
// In app-core.js, expose shared helpers:
// window.state = state;
// window.escapeHtml = escapeHtml;
// window.fmtEur = fmtEur;
```

**StaticFiles auto-serve** — FastAPI's `app.mount("/", StaticFiles(directory="static", html=True))` already serves all files in `app/static/`. New `.js` files placed in `app/static/` are immediately available as `/app-core.js`, `/map.js`, etc. No FastAPI route changes needed for the JS files themselves.

---

### `app/static/isochrone.geojson` and `app/static/tallinn-districts.geojson`

**No code analog.** These are data files, not code files. They are generated/assembled at development time (see RESEARCH.md sections 4 and 7 for the exact generation process). The planner should treat them as Wave 0 manual steps, not as auto-generated files.

---

## Shared Patterns

### Never-raise pattern
**Source:** `app/ingest_handler.py` (`_whitelist_checklist` lines 54–70; `_record_and_check_price_drop` lines 144–181)
**Apply to:** `_fetch_commute_minutes()`, `_geocode_with_nominatim()` (if added), `/api/refresh-isochrone` handler
```python
def _private_helper(...) -> Optional[...]:
    try:
        # ... actual work ...
        return result
    except Exception:
        log.exception("_private_helper failed for %s — skipping", identifier)
        return None  # or safe default
```

### Thread-safe load-modify-save
**Source:** `app/data_store.py` (`add_to_pending` lines 144–155; `approve_listing` lines 164–175)
**Apply to:** `update_listing_coords()`, any geocode-backfill helper that writes to app_data
```python
def mutating_helper(listing_id: str, ...) -> bool:
    with _lock:
        data = load_app_data()
        entry = next((e for e in data.get("properties", []) + data.get("pending", [])
                      if e.get("id") == listing_id), None)
        if entry is None:
            return False
        entry["field"] = value
        save_app_data(data)
        return True
```

### In-process setdefault migration
**Source:** `app/data_store.py` `load_app_data()` (lines 83–92)
**Apply to:** per-entry `lat`/`lng`/`commute_minutes` fields added in Phase 5
```python
data.setdefault("pending", [])
data.setdefault("price_history", {})
# Per-entry migration (Phase 5):
for entry in data.get("properties", []) + data.get("pending", []):
    entry.setdefault("lat", None)
    entry.setdefault("lng", None)
    entry.setdefault("commute_minutes", None)
```

### XSS-safe DOM writes
**Source:** `app/static/index.html` (enforced throughout all Phase 2–3 additions)
**Apply to:** ALL new JS files — map pin tooltips, detail panel, comparison table, activity feed, KPI strip
- Use `el.textContent = value` for any listing data (title, address, price, score, district, etc.)
- Use `document.createElement` + `appendChild` for DOM structure
- Use `innerHTML` only for completely static HTML with no user-data interpolation
- Use `escapeHtml()` when forced to use innerHTML with dynamic content (e.g., sidebar list rendering in the dossier tab — see line 623)

### env-var optional feature guard
**Source:** `app/main.py` `_verify_ingest_token` (lines 44–53); config.py (line 31–33)
**Apply to:** ORS_API_KEY guard in `_fetch_commute_minutes`, startup isochrone check
```python
# In _fetch_commute_minutes (soft guard — return None, not raise):
if not config.ORS_API_KEY:
    return None

# At startup (log warning once):
if not config.ORS_API_KEY:
    log.warning("ORS_API_KEY not set — commute times and isochrone disabled")
```

---

## No Analog Found

| File | Role | Reason |
|------|------|--------|
| `app/static/isochrone.geojson` | static data | Generated by ORS API call; no code analog. Must be created by calling `POST /api/refresh-isochrone` after deployment. Frontend should handle 404 gracefully. |
| `app/static/tallinn-districts.geojson` | static data | Assembled from Nominatim polygon_geojson or Overpass API at development time. See RESEARCH.md section 4. Bundle directly into `app/static/`. |

---

## Metadata

**Analog search scope:** `app/` directory (all .py files) and `app/static/index.html`
**Files scanned:** 6 source files read in full
**Pattern extraction date:** 2026-07-09
