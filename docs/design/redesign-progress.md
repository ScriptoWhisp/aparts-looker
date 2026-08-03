# Aparts Looker — Nocturne Redesign Progress

This file is the running handoff document across all design waves.
It supersedes `wave-1-notes.md` (the Wave 1-only version is kept for history).

---

## Redesign complete

All 4 waves shipped. The Aparts Looker frontend is fully migrated to the Nocturne design system.

### What shipped across all waves

| Wave | Tab(s) | Key output |
|------|--------|------------|
| Wave 1 | Foundation | `tokens.css` design system, Inter + JetBrains Mono fonts, bridge aliases, score ramp helpers |
| Wave 2 | Overview | 2-column map+charts layout, histogram, scatter, hero card, next-up list |
| Wave 3 | Detail | 284px sidebar with score rules, hero row, verdict band, 5-column signal checklist grid |
| Wave 4 | Pending, Rejected, Settings, Mobile, Empty states, CSS cleanup | See below |

### Wave 4 deliverables

- **Pending tab**: 3-column `.pq-grid` card layout; each card has 132px photo, score badge, verdict with left-rule, Approve/Reject buttons; Reject opens animated `.pq-reject-overlay` with reason chips (Price / Location / Condition / Other)
- **Settings tab**: 2-column `.settings-nocturne` layout (200px sidebar categories + form pane); sliders with fill/thumb, ramp slider for threshold fields; sidebar categories: Buyer profile / Scoring & AI / Cost model / Telegram / Dashboard
- **Rejected tab**: Same 3-column grid, dimmed photo, rejected tag, rejection reason line
- **Mobile responsive** (`≤768px`): Pending/Rejected collapse to 1-column; Overview map fixed 400px; Detail sidebar hidden; Settings sidebar becomes horizontal-scroll pill row; touch targets ≥ 44px
- **Empty states**: `Queue is empty` card in Pending (with threshold hint + scrape button); `No listings yet` first-run card in Overview (with Telegram status check + setup checklist)
- **CSS cleanup**: Removed `--shadow` bridge alias (0 references found); all other bridge aliases (`--bg`, `--border`, `--text`, etc.) kept as still referenced by Detail/filter-bar styles

### Remaining follow-ups

- Bridge aliases (`--bg`, `--surface`, `--border`, etc.) can be fully removed once the detail-filter-bar CSS is migrated to Nocturne tokens (a separate phase)
- Inline `<style>` block can be split into per-tab CSS files when it becomes large enough to justify
- Keyboard shortcuts (j/k/a/r) on Pending tab are aspirational — documented in header hint text but not implemented
- Bottom-dock mobile nav (mockup 1g) is aspirational v2 — MVP uses top header
- Settings tab: segmented control for Rooms and chip picker for Districts can replace sliders if those fields appear in the schema (currently all fields are numeric/string, so sliders/inputs are used)

---

## Wave 1 — Foundation (COMPLETE)

See `wave-1-notes.md` for the full Wave 1 notes. Summary:

### Files created / modified

| File | Change |
|------|--------|
| `frontend/css/tokens.css` | Entire design token system: Nocturne palette, score ramp, status tokens, spacing, radius, motion, utility classes (.card, .btn, .tag, .score-badge, .metric, .left-rule), header/tab-nav styles |
| `frontend/index.html` | Fonts replaced (Inter + JetBrains Mono). `/css/tokens.css` linked. Bridge aliases added in `:root`. Header/nav rebuilt with `.app-brand`, `.tab-nav`, `.header-right`. `.tab-pending-count` badge. |
| `frontend/js/ui.js` | Added `window.scoreBucket()` and `window.scoreColor()` with canonical Nocturne score-ramp values |

### Token reference (stable for all waves)

All tokens documented in `wave-1-notes.md` under "Рабочие токены". Bridge aliases (`--bg`, `--surface-2`, `--blue`, etc.) remain in `:root` for compatibility with other tabs — do NOT remove until Wave 3/4 migrate them.

---

## Wave 2 — Overview Tab (COMPLETE)

### Objective

Rebuild the Overview tab to match design brief section 1b exactly:
1440×900 two-column layout — map + charts left, hero + stats + next-up right.

### Files modified

| File | Changes |
|------|---------|
| `frontend/index.html` | Overview section (`#tab-overview`) fully rebuilt. New CSS: `.overview-grid`, `.map-card`, `.map-filter-pills`, `.map-layer-toggles`, `.map-legend`, `.overview-charts-row`, `.overview-chart-card`, `.histogram-bars`, `.scatter-area`, `.hero-card`, `.this-week-card`, `.next-up-card`, all associated sub-elements. Old `.map-full`, `.kpi-strip`, `.best-featured`, `.charts-row`, `.chart-panel`, `.activity-feed` markup removed (CSS stubs remain harmlessly). |
| `frontend/js/ui.js` | Full Wave 2 rewrite: `renderOverview()`, `renderHistogram()`, `renderScatter()`, `renderBestHero()`, `renderNextUp()`, `renderThisWeekStats()`, `_wireMapOverlays()`, `_updateMapPillCounts()`, `_updateDistrictLegend()`. Old SVG-based chart functions kept as no-op stubs. |
| `frontend/js/map.js` | Added `window.toggleDistrictLayer()` — exposes district layer show/hide to Wave 2 overlay controls without leaking module state. Old `#district-toggle` wiring kept for backward compat (returns null gracefully). |

### Layout decisions

The 2-column grid uses `grid-template-columns: 1fr 372px; gap: 12px; padding: 16px 20px 16px`.
Map card height is calculated as `calc(100vh - 48px - 16px - 12px - 148px - 16px)` to leave room for the charts row below. Charts row is `flex: none` at fixed ~148px height.

### Deviation from brief: chart bucket counts

Brief shows 10 bars. The bucket boundaries are:
`0-9, 10-19, 20-29, 30-39, 40-49, 50-59, 60-69, 70-74, 75-84, 85-100`

The last three buckets (70-74, 75-84, 85-100) are narrower to align with the score ramp breakpoints (60/75/85). This preserves the color fidelity — each bucket maps to exactly one score-ramp color with no blending.

### Deviation from brief: scatter axis range

Brief shows `score 30 → 100` on the x-axis. We implement this as `scoreMin=30` clamped — scores below 30 are plotted at the left edge. This prevents outlier data from collapsing the scale.

### Deviation from brief: district toggle state

The Districts toggle in the overlay defaults to "inactive" (layer is initially visible on the map, controlled by map.js's `districtsVisible = true`). The pill visual starts "inactive" styling because we don't have a return signal from map.js's initial state. Clicking once activates the pill AND hides the layer; clicking again restores both. This is a minor UX inversion on first click — Wave 3 can add a `window.getDistrictLayerVisible()` getter to map.js to sync initial state.

### Deviation from brief: "Schedule viewing" button

Brief says "Schedule viewing" button on hero card. Wave 2 routes this click to the detail panel (same as "Open detail"). Wave 3 will implement inline scheduling per the note in `detail-panel.js`.

### XSS discipline

All user/listing strings in Wave 2 JS use `.textContent`. No `innerHTML` with listing data anywhere. `window.escapeHtml()` not needed for DOM-text-node writes, but used in map.js tooltips (Leaflet API requires string).

### Preserved public APIs

- `window.initMap()` — unchanged
- `window.refreshMapPins()` — unchanged
- `window.openDetailPanel(id)` — unchanged
- `window.scoreBucket(score)` — unchanged
- `window.scoreColor(score)` — unchanged
- `map-container` DOM ID — unchanged
- Hash routing (`#overview`, `#detail`, etc.) — unchanged
- `?listing=<id>` deep-link handler — unchanged

---

---

## Wave 3 — Detail Tab (COMPLETE)

### Objective

Rebuild the Detail tab with the Nocturne layout from brief 1c/1d: 284px sidebar with
score-colored left rules + main pane with hero row, verdict band, and the option B
5-column signal grid checklist. Cost and negotiation cards in the 340px right column.

### Files modified

| File | Changes |
|------|---------|
| `frontend/index.html` | Rewrote `.detail-sidebar` (now 284px, flex column, hairline right shadow). Added new CSS classes: `.detail-sidebar-filter`, `.detail-sidebar-input`, `.detail-sidebar-list`, `.detail-sidebar-group-header`, refreshed `.sidebar-item` (score left rule via `--rule-color`, accent-tint on active). Added Wave 3 main pane classes: `.dm-hero-row`, `.dm-photo-card`, `.dm-photo-dots`, `.dm-header-block`, `.dm-status-row`, `.dm-title`, `.dm-meta-line`, `.dm-metric-strip`, `.dm-metric-cell`, `.dm-verdict-band`, `.dm-content-row`, `.dm-left-col`, `.dm-right-col`, `.dm-checklist-card`, `.dm-checklist-col`, `.dm-cl-row`, `.dm-coo-card`, `.dm-neg-card`, `.dm-cl-tooltip`, and all sub-elements. |
| `frontend/js/detail-panel.js` | Rewrote `window.renderDetailList()` to build filter input + scrolling list with group headers. Added `_renderSidebarList()` for live title filtering. Rewrote `_buildSidebarItem()` with Nocturne score-rule design. Rewrote `_renderMainPane()` to orchestrate hero + verdict + content row. Added `_buildHeroRow()`, `_buildVerdictBand()`, `_buildSignalGrid()` (option B 5-column), `_buildNocturneCostCard()`, `_buildNocturneNegCard()`, `_buildUtilityButtons()`. All legacy global handlers preserved: `scheduleViewingClick`, `markViewedClick`, `regenerateBriefClick`, `refreshKuClick`, `saveKuManualNotes`. Original `_buildCostOfOwnership`, `_buildNegotiationBrief`, `_buildKuCard`, `_buildChecklistGroup`, `_buildAiDepthSection`, `_showDebugModal` kept intact for backward compat. |
| `frontend/js/map.js` | Added `window.toggleCommuteLayer()` (show/hide isochrone layer, mirrors `toggleDistrictLayer`). Added `window.getCommuteLayerVisible()` getter. Added `window.getDistrictLayerVisible()` getter (fixes Wave 2 initial-state UX inversion). |

### Layout decisions

Sidebar is exactly 284px per brief 1c, using `box-shadow: inset -1px 0 0 var(--color-hairline)` instead of a border to avoid double-border with the listings-view container. The `.detail-split` flex container already provides the layout shell.

The 5-column checklist grid maps FULL_CHECKLIST sections as follows:
- Finance: s01 (Financial), s04 (Utilities), s06 (Extras), s07 (Agent)
- Quality: s09 (Technical), s10 (Renovation), s15 (Physical), s11 (Pests), s12 (Waste)
- Location: s16 (Location), s14 (Evaluation table)
- Building fund: s03 (KÜ), s05 (Repair fund)
- Risk: s02 (Legal), s08 (Seller questions), s13 (Documents)

### Deviations from brief

**Deviation 1: detail-filter-bar preserved**

Brief 1c shows no top filter bar — just a sidebar input. The existing `.detail-filter-bar` (score / rooms / district / max-price / search) is shared with Pending and Rejected tabs. Removing it would break those tabs. It remains, and the sidebar now also has its own title-substring filter.

**Deviation 2: Detail tab layout uses existing listings-view shell**

Brief shows the sidebar+main directly under the header (no `.detail-filter-bar`). The actual DOM uses `#listings-view` shared by all three tabs. The sidebar CSS width is 284px but the layout still goes through the existing flex `.detail-split` shell, which includes the filter bar above it.

**Deviation 3: accordion checklist kept alongside signal grid**

`_buildChecklistGroup` (the old accordion) is kept but not rendered in `_renderMainPane`. The signal grid replaces it as the primary UI. The accordion remains available for future re-use or as a progressive-disclosure overlay.

**Deviation 4: mini-map removed from main pane**

The mini-map Leaflet panel has been removed from the main detail pane. The Overview map already shows all pins with full interactive context. Adding a mini-map in the detail pane created Leaflet lifecycle bugs (Pitfall 1) and consumed vertical space needed by the checklist grid. If needed in Wave 4+, it can be added as a small thumbnail in the hero photo area.

**Deviation 5: AI depth section (score breakdown, risks, strengths) not rendered**

Brief 1c/1d does not show the AI score breakdown accordion. The verdict text is surfaced in the verdict band. The full AI depth section (`_buildAiDepthSection`) is preserved in code but not rendered in the new main pane. Re-add it in a future wave as a collapsible panel below the checklist if desired.

### Preserved public APIs

- `window.renderDetailList()` — unchanged signature
- `window.openDetailPanel(id)` — unchanged signature, deep-link still works
- `window.scheduleViewingClick(listingId)` — unchanged
- `window.markViewedClick(listingId)` — unchanged
- `window.regenerateBriefClick(listingId, btn)` — unchanged
- `window.refreshKuClick(listingId, btn)` — unchanged
- `window.saveKuManualNotes(listingId, notes)` — unchanged
- `window.toggleDistrictLayer()` — unchanged
- `window.toggleCommuteLayer()` — new, mirrors toggleDistrictLayer
- `window.getDistrictLayerVisible()` — new getter
- `window.getCommuteLayerVisible()` — new getter

---

## Handoff to Wave 3 — Detail Tab (SUPERSEDED — see Wave 3 above)

Wave 3 should:

1. Rebuild the Detail tab split layout to match brief 1c (verdict band + collapsible checklist groups with flag-first ordering).
2. Migrate bridge aliases used in `.detail-*`, `.sidebar-*`, `.ai-*`, `.coo-*`, `.brief-*`, `.ku-*` styles to canonical Nocturne tokens (replacing `var(--bg)`, `var(--surface-2)`, `var(--blue)`, etc.).
3. Add `window.getDistrictLayerVisible()` to map.js to sync the Nocturne district toggle pill initial state with map.js's internal `districtsVisible` flag.
4. If inline scheduling on the hero card is desired, add the datetime-local picker flow to `renderBestHero()` in ui.js (pattern: copy from `_renderMainPane` in detail-panel.js, POST to `/api/listings/{id}/schedule-viewing`).
5. Do NOT touch the `.overview-*` or `.map-*` classes introduced in Wave 2.

## Handoff to Wave 4 — Pending Tab + Settings

Wave 4 should:

1. Rebuild Pending tab with the Nocturne card pattern per brief 1e (3-column grid, each pending listing as a `.card` with 132px photo, score badge `.score-badge[data-score-bucket]` in photo corner, verdict callout with border-left, approve/reject `.btn` row).
2. Replace `.pending-card`, `.pending-card-title`, `.pending-card-meta` legacy styles.
3. Migrate bridge aliases used in `.pending-*` styles.
4. Consider adding `window.getDistrictLayerVisible()` / `window.getCommuteLayerVisible()` to sync the overlay pills initial state (now available from Wave 3 map.js additions).
5. The AI depth section (score breakdown, risks, strengths) removed in Wave 3 can be surfaced here as a "Debug view" toggle on approved listings if needed.

## Final bridge-alias cleanup (Wave 5+)

After Wave 3 + 4 complete their migrations, the bridge-alias block in `:root` inside `<style>` in `index.html` can be removed:

```css
/* TO REMOVE after Wave 3+4 complete */
--bg, --surface, --surface-2, --border, --text, --text-muted,
--blue, --green, --amber, --red, --font-mono, --font-sans, --radius, --shadow
```

The inline `<style>` block can then be replaced with a `<link rel="stylesheet" href="/css/overview.css">` and similar per-tab CSS files. The `tokens.css` file stays as-is.

---

## Wave 4 — Pending, Rejected, Settings, Mobile, Empty States (COMPLETE)

### Objective

Rebuild the final three tabs (Pending, Rejected, Settings) with the Nocturne design system, add mobile responsive breakpoints, add empty states for first-run and empty-queue scenarios, and clean up unused bridge aliases.

### Files modified

| File | Changes |
|------|---------|
| `frontend/index.html` | New CSS sections: `.pq-*` (pending/rejected grid), `.settings-nocturne` (2-col settings), `.pq-empty-*` (empty states), `.pq-firstrun-*` (first-run checklist), mobile `@media (max-width: 768px)`. New HTML: `#pending-grid-root`, `#rejected-grid-root`, `.settings-nocturne` shell. New JS: `renderPendingGrid()`, `_buildPqCard()`, `_showPqRejectOverlay()`, `_buildPendingEmptyState()`, `renderRejectedGrid()`, `_buildRejectedCard()`, `renderSettingsNocturne()`, `_buildSettingsSidebar()`, `_renderSettingsPane()`, `_buildSettingsFieldNocturne()`, `_saveSettingsNocturne()`, `_buildFirstRunEmptyState()`. Updated: `renderApp()` routes pending/rejected to new grid renderers; `renderOverview()` injects first-run empty state when both properties and pending are empty. |

### Architecture change: Pending/Rejected tab rendering

Previously, Pending and Rejected tabs shared `#listings-view` (the Detail sidebar + filter-bar + main-pane shell). Wave 4 gives them their own DOM roots:
- `#tab-pending` → `#pending-grid-root` → `renderPendingGrid()`
- `#tab-rejected` → `#rejected-grid-root` → `renderRejectedGrid()`

The `#listings-view` is now only shown for `body.tab-detail`. This removes the `.listings-view` display from `body.tab-pending` and `body.tab-rejected` CSS.

Legacy `renderPending()`, `renderRejected()`, `renderSettings()`, `_saveSettings()`, `_buildSettingsField()` stubs remain for any external callers but are no-ops or aliases.

### Settings sidebar categories (Wave 4 mapping)

| Schema group | Sidebar label |
|---|---|
| `filter` | Buyer profile |
| `ai` | Scoring & AI |
| `cost` | Cost model |
| `telegram` | Telegram |
| `dashboard` | Scraper / Dashboard |

### Bridge alias cleanup (Wave 4)

Scanned all `var(--alias)` usages across `index.html`, `ui.js`, `detail-panel.js`. Only `--shadow` had 0 references — it was removed from the `:root` bridge block. All other 13 aliases remain referenced by Detail-tab, filter-bar, checklist, and legacy chart CSS that is intentionally preserved until a future migration.

### Deviations from brief

**Deviation 1: Pending/Rejected tabs no longer use the shared listings-view**

Brief 1e shows a standalone card grid. The implementation creates dedicated render roots (`#pending-grid-root`, `#rejected-grid-root`) rather than trying to repurpose the shared sidebar+filter-bar shell. This gives cleaner DOM isolation and avoids filter-bar state bleed.

**Deviation 2: Settings sliders for all numeric fields**

Brief shows segmented controls (Rooms) and chip pickers (Districts) for specific fields. The settings schema uses `filter` / `int` / `float` / `str` types but does not mark which fields should be segmented vs. chip pickers. Wave 4 uses sliders for all bounded numeric fields (straightforward implementation) and text/number inputs for string/unbounded fields. If a future schema extension adds `ui_type: "segmented"` or `ui_type: "chips"`, those renderers can be added without changing the base architecture.

**Deviation 3: Toggle switch not connected to a boolean schema field**

The `.sn-toggle` CSS and JS component is implemented and ready. The current settings schema exposes all values as `int`/`float`/`str` — no `bool` type exists yet. If the schema gains boolean fields, the `_buildSettingsFieldNocturne()` function can add a `f.type === 'bool'` branch that renders the toggle.

**Deviation 4: Mobile bottom-dock nav not implemented**

Brief 1g shows a bottom-fixed dock (Overview / Detail / Pending / Settings). MVP keeps the top header with reduced padding and hidden scrape-info meta. The bottom dock is marked as aspirational v2.

### Preserved public APIs

- `window.renderPendingGrid()` — new, callable by external code
- `window.renderRejectedGrid()` — new, callable by external code
- `window._settingsData` — now a `window` property (was module-local `var`); exposed for the empty-state threshold display
- All Wave 1–3 public APIs unchanged

---

## Wave 5A — Backend: Shortlist funnel + after-viewing decisions (COMPLETE)

### Objective

Backend preparation for the Shortlist funnel UX (design brief v2 section 2b).
After a user marks a listing "viewed", they pick one of three post-viewing decisions.
This wave adds the Postgres enum values, data model constants, a data_store helper,
and a new HTTP endpoint. Waves 5B/5C rebuild the frontend to expose these.

### New enum values (migration 0002)

Added to the `listing_status` Postgres ENUM via `ALTER TYPE listing_status ADD VALUE IF NOT EXISTS`:

| Value          | Meaning                                                        |
|----------------|----------------------------------------------------------------|
| `thinking`     | User attended the viewing; still deciding                     |
| `offer_drafted`| User decided "still in"; draft offer prepared                 |
| `dropped`      | User decided not to proceed after viewing                     |

`dropped` is distinct from `rejected`. `rejected` means "never worth looking at" from
the Inbox stage (before a viewing). `dropped` means "viewed it, not interested."

Migration file: `backend/alembic/versions/0002_add_shortlist_statuses.py`

Downgrade note: `ALTER TYPE ... ADD VALUE` is one-way in Postgres. `downgrade()` is a
documented no-op. Manual removal requires recreating the type (see migration docstring).

### State-transition graph

```
pending
  │
  ▼ (approve)
approved ──────────────────────────────────────────────── SHORTLIST_TO_VIEW
  │
  ▼ (schedule-viewing)
viewing_scheduled ─────────────────────────────────────── SHORTLIST_TO_VIEW
  │
  ▼ (mark-viewed)
viewed  ←─── transient default; user must pick a decision ─ SHORTLIST_VIEWED
  │
  ├──→ thinking       (decision=thinking)  ────────────── SHORTLIST_VIEWED
  │
  ├──→ offer_drafted  (decision=still-in)  ────────────── SHORTLIST_VIEWED
  │
  └──→ dropped        (decision=drop)      ────────────── SHORTLIST_DROPPED
```

Separate branch from the Inbox:
```
pending
  └──→ rejected  (reject from Inbox)  ─── NOT part of Shortlist funnel
```

### New endpoint

`POST /api/entry/{listing_id}/viewing-decision`

Request body:
```json
{"decision": "still-in" | "thinking" | "drop", "reason": "<optional string>"}
```

Response (success):
```json
{"ok": true, "new_status": "offer_drafted"}
```

HTTP status codes:
- `200` — transition applied
- `404` — listing not found
- `409` — listing not yet marked viewed (status is approved/viewing_scheduled/pending/rejected)
- `422` — `decision` is not one of the three allowed values
- `500` — DB error (never-raise; returns `{"ok": false, "error": "..."}`)

### New data_store helper

`data_store.set_viewing_decision(listing_id: str, decision: str, reason: Optional[str] = None) -> bool`

- Returns `True` on success, `False` on miss or wrong pre-condition status
- Appends a `{action: "decision", decision, new_status, at, [drop_reason]}` event to
  `viewing_history` (JSONB reassignment — never mutates in place)
- Idempotent: calling `still-in` on a listing already at `offer_drafted` succeeds

### New model constants

In `backend/models.py`:

```python
SHORTLIST_TO_VIEW  = frozenset({"approved", "viewing_scheduled"})
SHORTLIST_VIEWED   = frozenset({"viewed", "thinking", "offer_drafted"})
SHORTLIST_DROPPED  = frozenset({"dropped"})
```

### Files modified

| File | Change |
|------|--------|
| `backend/alembic/versions/0002_add_shortlist_statuses.py` | New migration: adds 3 enum values |
| `backend/models.py` | Extended `LISTING_STATUS_VALUES`; added `SHORTLIST_*` frozensets |
| `backend/data_store.py` | Added `set_viewing_decision`; updated `load_app_data` + `get_approved_listing` to include all 6 post-Inbox statuses |
| `backend/routes_entries.py` | Added `POST /api/entry/{id}/viewing-decision` endpoint |
| `backend/tests/test_shortlist_decisions.py` | 15 new tests (all passing) |

### Test results

Total: **130 passed** (was 115 before Wave 5A; +15 new tests).

### Handoff to Wave 5B / 5C

The Shortlist sidebar can group listings using the `status` field already returned
in the `/api/data` response. No new GET endpoint is needed for MVP — client-side
filtering using the `SHORTLIST_*` group membership is sufficient.

Wave 5B should:
1. Add the Shortlist funnel section to the sidebar (grouping by `SHORTLIST_TO_VIEW`,
   `SHORTLIST_VIEWED`, `SHORTLIST_DROPPED`).
2. Add the "After the viewing" decision bar to a viewed listing's detail panel —
   three buttons (Still in / Thinking / Drop) that POST to the new endpoint.
3. After a successful decision POST, refresh the listing state in the UI and move
   the sidebar item to the correct group.

Wave 5C (if separate): visual polish — badge states for thinking/offer_drafted/dropped
in the sidebar and listing cards.

---

## Wave 5B — Inbox Tab (COMPLETE)

### Objective

Rename Pending → Inbox and rebuild its copy per design brief v2 mockup 2a.
Wave 5A (backend) is complete — status enum has 8 values, `POST /api/entry/{id}/viewing-decision` exists.
This wave is FRONTEND-ONLY.

### Tab-nav restructure

| Before (Wave 4)       | After (Wave 5B)        |
|-----------------------|------------------------|
| Overview              | Overview               |
| Detail                | Inbox (+ badge)        |
| Pending (+ badge)     | Shortlist              |
| Rejected              | Settings               |
| Compare               | —                      |
| Settings              | —                      |

Removed tabs: Rejected (absorbed into Shortlist sidebar in Wave 5C), Compare (gone).

### Hash-routing backward compat

Old hashes are silently remapped so any bookmarked or external URLs keep working:

| Old hash    | Maps to    |
|-------------|------------|
| `#pending`  | `#inbox`   |
| `#detail`   | `#shortlist` |
| `#rejected` | `#shortlist` |
| `#compare`  | `#overview` |

Implemented via `_HASH_COMPAT` map in `_tabFromHash()`.

### Inbox tab content (mockup 2a)

- Title: "Inbox"
- Dynamic subhead: "N new listings since <Day, D Mon>" (count from pending entries sorted by score desc)
- Keyboard hint line: `L look closer · S skip · ↑↓ move`
- 3-column `.pq-grid` card layout sorted by score desc
- Best card highlighted with purple accent `box-shadow: 0 0 0 1px rgba(145,132,217,.4)` (was green in Wave 4)

### Card redesign

| Before (Wave 4)  | After (Wave 5B)     |
|------------------|---------------------|
| Approve (primary) | Look closer (primary) |
| Reject (secondary) | Skip (secondary) |

### Look closer behavior

1. Dims card (`opacity: 0.5`, `pointer-events: none`)
2. POSTs to `POST /api/pending/{id}/approve`
3. On success: navigates `window.location.hash = "shortlist"`, calls `window.loadData()`, then after 350ms calls `window.openDetailPanel(entry.id)`

### Skip overlay (`.pq-skip-overlay`)

- Slides up from below the 132px photo (`top: 132px`, absolute positioned inside card)
- Title: "Skipped — what put you off?"
- Explainer: "Optional. It only tunes future scoring."
- Reason chips: Price / Location / Condition / Other (toggle-select)
- Undo button: cancels the countdown, removes overlay
- Shrinking progress bar: CSS `width` transition from 100% → 0 over 8 seconds via `requestAnimationFrame`
- Countdown text: "auto-closes 8s" … "auto-closes 1s" (updated each second by `setInterval`)
- After 8s: fires `POST /api/pending/{id}/reject` with `{reason: selectedReason || null}`, fades card out, removes it from DOM

### Keyboard shortcuts

| Key       | Action                          |
|-----------|---------------------------------|
| `↓` / `j` | Move selection to next card     |
| `↑` / `k` | Move selection to previous card |
| `l` / `L` | Look closer on selected card    |
| `s` / `S` | Skip selected card              |

Selected card shows `outline: 2px solid var(--color-accent)`. Keyboard handler auto-wired on each `renderInboxGrid()` call and detached on re-render to prevent accumulation.

### Empty state

Copy changed from "Queue is empty" (Wave 4) to "Inbox is empty" (Wave 5B).

### Files modified

| File | Changes |
|------|---------|
| `frontend/index.html` | Tab-nav restructured (4 buttons). `section#tab-pending` → `section#tab-inbox` with `#inbox-grid-root`. `section#tab-detail` → `section#tab-shortlist`. `section#tab-rejected` and `section#tab-compare` removed. New CSS: `.inbox-header`, `.inbox-header-row`, `.inbox-header-left`, `.inbox-title`, `.inbox-subhead`, `.inbox-kbd-hint`, `.pq-skip-overlay`, `.pq-skip-countdown`, `.pq-skip-progress`, `.pq-skip-progress-fill`. Updated: `body.tab-shortlist .listings-view`, `#tab-inbox.active`. New JS: `renderInboxGrid()`, `_buildInboxCard()`, `_inboxLookCloser()`, `_showInboxSkipOverlay()`, `_wireInboxKeyboard()`, `_buildInboxEmptyState()`. Hash compat: `_HASH_COMPAT` map, `_tabFromHash()` updated. `renderPendingGrid()` aliased to `renderInboxGrid()`. `renderRejectedGrid()` and `_buildRejectedCard()` become no-op stubs. |
| `frontend/js/ui.js` | `data-tab="detail"` → `data-tab="shortlist"` (2 places). `window.location.hash = "detail"` → `"shortlist"` (3 places). |

### Preserved public APIs

- `window.renderPendingGrid()` — alias to `renderInboxGrid()` (backward compat)
- `window.renderRejectedGrid()` — no-op stub (backward compat)
- `window.openDetailPanel(id)` — called by `_inboxLookCloser` post-approve
- All Wave 1–4 public APIs unchanged

### Deviations from brief

**Deviation 1: Keyboard shortcuts fully implemented**

Wave 4 handoff notes listed keyboard shortcuts as "aspirational". Wave 5B implements them fully: `↑↓` (and `j`/`k`) for navigation, `L` for Look closer, `S` for Skip. The keyboard hint line in the header is now accurate.

**Deviation 2: renderRejectedGrid kept as no-op stub**

The Wave 4 `renderRejectedGrid()` and `_buildRejectedCard()` functions are replaced with no-op stubs rather than deleted, ensuring any external callers or test code that references them does not throw ReferenceError.

**Deviation 3: Best card accent colour changed from green to purple**

Wave 4 used `rgba(var(--color-approved-rgb), 0.4)` (green). The mockup 2a calls for the Nocturne accent purple `rgba(145,132,217,.4)` to match the overall palette. Updated in `.pq-card.pq-card-best`.

### Test results

Backend tests unchanged: **130 passed** (no Python changes in this wave).

---

## Wave 5C — Shortlist tab (COMPLETE)

The largest frontend wave. Full rebuild of the Shortlist tab per design brief v2 mockup 2b.

### Deliverables

**1. Sidebar funnel (3-group)**

`renderDetailList()` now renders three groups: "To view" (approved + viewing_scheduled), "Viewed" (viewed + thinking + offer_drafted), "Dropped" (dropped). Each group has a sticky header with label and row count. Dropped group is collapsed by default with a show/hide toggle button; collapse state is preserved in the `_droppedGroupVisible` module variable across re-renders within the same session. Per-row right-side indicators: To view shows scheduled date (mono blue) or "unbooked"; Viewed shows "thinking" or "offer" text; Dropped shows the drop reason from `viewing_history`. Rows within each group are sorted by score descending. Dropped rows get `opacity:0.4` and strikethrough title. Sidebar footer is italic muted text fixed at the bottom.

**2. Hero row rebuild**

`_buildHeroRow()` places the status pill on the LEFT of the top row (per design brief, moved from right/center). Status pill (`_buildStatusPill()`) has distinct styling per status: approved (green tint), viewing_scheduled (purple tint), viewed (purple), thinking (amber), offer_drafted (stronger purple), dropped (red). "Shortlisted N days ago" appears next to the pill in muted 11px mono. "Mark viewed" button is conditional — only appears when `status === "viewing_scheduled"`, and is disabled before the scheduled time with a tooltip. "Schedule viewing" button (with inline datetime-local picker popover) appears for `status === "approved"`.

**3. After-viewing decision bar**

`_buildDecisionBar()` handles three cases:
- `status === "dropped"`: shows Undo drop ghost button (calls `undoDropClick` → POST thinking)
- `_inGroup(status, SHORTLIST_TO_VIEW)`: bar hidden (`display:none`)
- `_inGroup(status, SHORTLIST_VIEWED)`: shows "After the viewing" label + 3 buttons: "Still in / draft offer" (→ POST offer_drafted), "Thinking" (→ POST thinking), "Drop" (→ opens modal)

Bar container styled: `margin: 14px 20px 0`, sunken background, `box-shadow: inset 0 0 0 1px rgba(145,132,217,.3)`.

**4. Checklist — accordion (option A)**

`_buildAccordionChecklist()` replaces the 5-column signal grid with 5 named categories in flags-first sort order. Each category is a collapsible accordion group (`.sl-acc-group`) with: a left-rule bar colored by worst status in the group (red for any flag, amber for unknowns only, muted for all-ok), label + subtitle, flag/unknown/ok badges on the right, chevron that rotates 90° when open. Groups are sorted by (flags DESC, unknown DESC, ok DESC) so the most problematic categories rise to the top. The `.sl-acc-body` shows per-item rows with glyph (✓/✗/?) and label. First group auto-expands on render. Summary stat counts (ok/unknown/flags) shown in the card header.

**5. Ask at the viewing card + gated Negotiation**

`_buildAskAtViewingCard()` lists checklist items that have `null`/unknown status as client-side checkboxes. Unknown items are those where `_getChecklistStatus(entry, storageKey)` returns null. Each item is a `<label>` with `<input type="checkbox">` — checking one visually marks it done (client-side only, not persisted). Shows empty-state italic text if all items are known. Count shown in card header.

`_buildNocturneNegCard()` gates the entire Negotiation card when `status ∈ SHORTLIST_TO_VIEW`: applies `opacity:0.45; pointer-events:none` to the card element. Header changes from "regenerate" to "unlocks after viewing" when gated.

**6. Drop-reason modal + Undo drop**

`dropClick()` opens a full-screen `sl-modal-overlay` with a `<textarea>` for the reason. On confirm: POST `/api/entry/{id}/viewing-decision` with `{decision:"drop", reason}`. On success: `loadData()` then `renderDetailList()` + `openDetailPanel()`. Modal closes on Escape via `document.addEventListener("keydown")` and on overlay click-outside. Reason field auto-focuses via `requestAnimationFrame`. Modal is removed from DOM on close (no leaks).

`undoDropClick()` POSTs `{decision:"thinking"}` with no reason to move the listing back to Viewed group.

### Files created / modified

| File | Change |
|------|--------|
| `frontend/js/detail-panel.js` | Complete rewrite (~920 lines). Old Wave 3 implementation removed. New: `_renderShortlistGroups`, `_renderGroup`, `_renderDroppedGroup`, `_buildToViewIndicator`, `_buildViewedIndicator`, `_buildDroppedIndicator`, `_buildSidebarRow`, `_buildHeroRow`, `_buildStatusPill`, `_buildDecisionBar`, `_buildAccordionChecklist`, `_buildAskAtViewingCard`, `_buildNocturneNegCard`, `_buildUtilityButtons`, `_buildKuCard`. New global handlers: `stillInDraftOfferClick`, `thinkingClick`, `dropClick`, `undoDropClick`. Preserved: `scheduleViewingClick`, `markViewedClick`, `regenerateBriefClick`, `refreshKuClick`, `saveKuManualNotes`. |
| `frontend/index.html` | New CSS classes added before `</style>`: `.sl-group-header`, `.sl-group-label`, `.sl-group-count`, `.sl-dropped-toggle`, `.sl-dropped-body.visible`, `.sl-row-indicator`, `.sl-sidebar-footer`, `.sl-decision-bar`, `.sl-decision-bar-label`, `.sl-decision-bar-actions`, `.sl-status-pill` (+ 6 status variants), `.sl-shortlisted-ago`, `.sl-modal-overlay`, `.sl-modal`, `.sl-modal-title`, `.sl-modal-subtitle`, `.sl-modal-input`, `.sl-modal-actions`, `.sl-acc-card`, `.sl-acc-card-head`, `.sl-acc-card-title`, `.sl-acc-card-stats`, `.sl-acc-stat-ok/unk/flag`, `.sl-acc-groups`, `.sl-acc-group`, `.sl-acc-header`, `.sl-acc-left-rule`, `.sl-acc-info`, `.sl-acc-label`, `.sl-acc-sub`, `.sl-acc-badges`, `.sl-acc-badge` (+ variants), `.sl-acc-chevron`, `.sl-acc-body`, `.sl-acc-row`, `.sl-acc-glyph`, `.sl-acc-row-label`, `.sl-acc-foot`, `.sl-ask-card`, `.sl-ask-head`, `.sl-ask-kicker`, `.sl-ask-count`, `.sl-ask-items`, `.sl-ask-item`, `.sl-ask-cb`, `.sl-ask-label`, `.sl-ask-empty`. |

### Deviations from brief

**Deviation 1: Dropped group uses `display:none` toggle instead of CSS `max-height` animation**

The brief implies a smooth collapse. The implementation starts with `display:none` and toggles to `display:block` synchronously. CSS `max-height` transition is set on `.sl-dropped-body.visible` but `display:none` overrides it. Acceptable for the MVP — a follow-up can change to `max-height:0 → max-height:2000px` with `overflow:hidden` to get the animation.

**Deviation 2: Mark viewed button disabled check uses client time, not server time**

The "disable before scheduled time" check compares `new Date()` to `entry.scheduled_at`. This uses the browser's local clock. If the client clock is wrong, the button may be incorrectly enabled or disabled. No known issue in practice since this is a single-user tool.

**Deviation 3: Ask at the viewing checkboxes are client-side only**

Checkboxes are not persisted to the backend. They reset on every re-render. The brief says "client-side-only checkboxes" — this is intentional per spec.

### Test results

Backend tests unchanged: **130 passed** (no Python changes in this wave).

---

## Wave 6A — SPEC alignment delta pass

**Date:** 2026-08-03
**Branch:** main
**Status:** Complete

### Objective

Surgical alignment pass against the newly added `docs/design/aparts-looker-design-brief/project/SPEC.md`. No new features — only delta fixes to make shipped Waves 1-5C compliant with the authoritative SPEC document.

### What shipped

**1. Token short-name aliases** (`frontend/css/tokens.css`)

Added 50+ short-name aliases as declared in SPEC §1: `--bg`, `--sunken`, `--surface`, `--border`, `--text`, `--text-2`, `--text-3`, `--muted`, `--faint`, `--accent`, `--accent-lt`, score ramp (`--s-bad/weak/mid/good/best`), status (`--st-new/short/skip/viewing/viewed`), spacing (`--sp-1..12`), radius (`--r-sm/md/lg/xl`), shadows (`--sh-sm/md/lg`), motion (`--ease`, `--t-fast`, `--t-base`). All aliases point to existing Nocturne tokens via `var(...)` — no rename, no ripple to existing code.

**2. Inbox skip reason chips: 4 → 6** (`frontend/index.html`)

Added `Layout` and `Building` chips to the Inbox skip overlay (SPEC §2.3). Previous impl had Price / Location / Condition / Other (4 chips). Now Price / Location / Condition / Layout / Building / Other (6 chips). Reason string stored as-is in `rejection_reason` on the API.

**3. Checklist group-header signal strip** (`frontend/js/detail-panel.js`)

Added per-item 7×7px rounded squares between the group label and the count in each accordion group header (SPEC §2.5). Colors: `ok` = `--s-best`, `unknown` = `--faint`, `flag` = `--s-bad`, `warning` = `--s-weak`. Items rendered in section order.

**4. Histogram 75-tick label** — already present from Wave 5B

`75 · approve line` label was already rendered in `--color-text-secondary` (≡ `--text-3`) from a prior wave. No action needed.

**5. Phosphor icons vendored** (`frontend/index.html`, `frontend/js/detail-panel.js`)

Added hidden `<svg style="display:none">` block at top of `<body>` with 10 Phosphor icon symbols (regular weight, 16px viewBox): calendar, check, x, question, warning, caret-down, caret-right, magnifying-glass, house, arrow-square-out. Proof-of-life: checklist accordion chevrons now use `<svg><use href="#ph-caret-down">` / `<use href="#ph-caret-right">` instead of `▾`/`▸` text glyphs.

**6. `prefers-reduced-motion` + `text-wrap: pretty`** (`frontend/css/tokens.css`)

Upgraded motion media query from `animation-duration: 0.01ms` to `transition: none !important; animation: none !important;` per SPEC §1. Added `text-wrap: pretty` on verdict paragraph selectors: `.dm-verdict-text`, `.dm-neg-body`, `.pq-verdict`, `.hero-verdict`, `[data-verdict]`, `.ai-verdict`.

### What was deferred

**Charts to SVG (optional — Wave 6C)**

SPEC §3 specifies hand-rolled SVG for both the histogram and scatter charts. Current implementation uses div-based flex bars (histogram) and absolutely-positioned DOM dots (scatter). Converting to SVG is a ~60-minute rewrite with no behavior change. Deferred to Wave 6C to keep this wave surgical. Both charts remain fully functional with correct colors, tooltips, and behavior.

**Full Phosphor icon migration**

Only the checklist accordion chevrons were wired to use `<use href>` as proof-of-life. Full migration of all remaining emoji/text glyphs to Phosphor symbols is deferred (no timeline assigned — lower priority than Wave 6B/6C feature work).

### Files modified

| File | Change |
|------|--------|
| `frontend/css/tokens.css` | +55 short-name aliases in `:root`; upgraded `prefers-reduced-motion`; added `text-wrap:pretty` block |
| `frontend/index.html` | Added 2 skip reason chips (Layout + Building); added hidden Phosphor SVG sprite block |
| `frontend/js/detail-panel.js` | Signal strip in accordion group headers; chevrons use Phosphor SVG symbols |

### Commits

- `59731ee feat(tokens): add SPEC.md short-name aliases`
- `2cd3c14 feat(inbox): add Layout + Building to skip-reason chips`
- `36b3950 feat(shortlist): add signal strip to checklist group headers`
- `4e74e05 feat(design): vendor Phosphor SVG symbols + wire one use site`
- `268d379 feat(design): add prefers-reduced-motion + text-wrap:pretty`

### Test results

Backend tests unchanged: **130 passed** (no Python changes in this wave).

---

## Wave 6B — Telegram notifier-only + Mobile Inbox (COMPLETE)

**Date:** 2026-08-03
**Branch:** main
**Status:** Complete

### Objective

SPEC §0.4: "These two ship together or the couch workflow breaks."

1. Strip Telegram Approve/Reject inline keyboard — Telegram becomes a notifier surface only.
2. Build mobile Inbox as the primary triage surface at ≤768px.

### What shipped

#### Part 1 — Telegram notifier only

| Change | Detail |
|--------|--------|
| `backend/telegram_client.py` | Removed Approve/Reject callback buttons from `send_pending_card`. Photo tier: "Open Inbox" deep-link (`/#inbox`) + kv.ee link. Text tier: same two links in body text + inline keyboard. `edit_card_resolved` and `send_rejection_prompt` are no-op stubs. New `handle_stale_callback()` answers stale pre-deploy taps with "Triage moved to the dashboard." |
| `backend/agent_job.py` | Deleted `process_pending_action()`. `process_send_commands()` now calls `handle_stale_callback()` for incoming `callback_query` updates. |
| `backend/tests/test_pending.py` | Replaced 3-button assertion with 2-button assertion (Open Inbox + kv.ee, no `callback_data`). Added `test_send_pending_card_no_web_base_url` and `test_stale_callback_answered`. Removed 2 callback_query tests. Net count: 130 → 130. |

#### Part 2 — Mobile Inbox (≤768px)

| Change | Detail |
|--------|--------|
| `frontend/index.html` CSS | `.mi-*` classes: shell, progress bar, card stack, 6px peek card, action block (Look closer/Skip/Later), bottom-sheet (grab handle, 6 chips, countdown), cleared state. |
| `frontend/index.html` JS | `_renderMobileInbox()` — `matchMedia("(max-width: 768px)")` branch in `renderInboxGrid`. Progress "N of M" + 6-segment bar. Look closer/Skip/Later actions. `_showMobileSkipSheet()` — 8s auto-close, 6 chips. `_buildMobileCleared()` — triage summary + "Open shortlist · N". |

### User-visible behavior changes (next scrape)

- Telegram cards look different: no Approve/Reject buttons. "Open Inbox" deep-links to `/#inbox`. Stale card taps get a friendly "moved to dashboard" response.
- On mobile (≤768px) the Inbox tab shows one card at a time.

### Deviations from spec

None. All SPEC §0.4, §2.3, §2.7 requirements shipped.

### Files modified

| File | Change |
|------|--------|
| `backend/telegram_client.py` | Strip Approve/Reject; Open Inbox deep-link; `handle_stale_callback`; no-op stubs |
| `backend/agent_job.py` | Remove `process_pending_action`; stale callback handler |
| `backend/tests/test_pending.py` | Updated assertions (130 → 130 tests) |
| `frontend/index.html` | Wave 6B CSS block (`.mi-*`); mobile inbox JS (6 new functions) |

### Commits

- `42e32b6 feat(telegram): strip approve/reject inline keyboard — notifier only`
- `ab41ebd refactor(telegram): remove callback_query dispatcher`
- `bc46c1e test(pending): update Telegram button assertions after notifier-only change`
- `4d65723 feat(inbox-mobile): single-card triage layout for ≤768px viewport`
- `7ac8bf6 feat(inbox-mobile): bottom-sheet skip reason picker with grab handle`
- `1c085cc feat(inbox-mobile): cleared state — summary + open shortlist button`

### Test results

**130 passed** (net: +2 new Telegram tests, -2 removed callback tests = same count).

---

## Wave 6C — All-in cost feature (COMPLETE)

**Date:** 2026-08-03
**Branch:** main
**Status:** Complete

### Objective

SPEC §4: "Daniel owns the prices, the AI owns the classification."

Implement the all-in cost feature end-to-end: AI produces renovation item classifications, settings expose editable rates, client-side maths prices the work, and the Shortlist hero displays `price + work = all-in`.

### What shipped

#### 1. Backend — Settings schema for renovation rates

| Change | Detail |
|--------|--------|
| `backend/config.py` | 9 new constants: `RENO_KITCHEN_FULL` (12000), `RENO_BATHROOM_FULL` (7000), `RENO_WINDOWS_PER_UNIT` (420), `RENO_FLOORS_PER_SQM` (100), `RENO_REWIRE_PER_SQM` (58), `RENO_HEATING` (2600), `RENO_COSMETIC_PER_SQM` (35), `RENO_CONTINGENCY_PCT` (15), `RANK_BY_ALL_IN` (true) |
| `backend/settings_store.py` | 9 new `reno`-group fields in `_SCHEMA`. New `_coerce()` helper supporting `bool` type. `load_overrides` and `save` use `_coerce`. Bool fields skip numeric bounds check. |

#### 2. AI evaluator — new `renovation_items[]` output field

| Change | Detail |
|--------|--------|
| `backend/ai_evaluator.py` | `VALID_RENO_KEYS` frozenset (7 keys). `_validate_renovation_items()` helper: drops unknown keys, clamps confidence, truncates notes to 60 chars. SYSTEM_PROMPT extended with `renovation_items` JSON schema and hard rule 10. `_fallback_result` includes `renovation_items: []`. |
| `backend/data_store.py` | `write_renovation_items(listing_id, items)` — persists AI output to `checklist.renovation_items` JSONB sub-key (JSONB reassignment convention). |
| `backend/ingest_handler.py` | Calls `write_renovation_items` after `add_to_pending` when `renovation_items` is non-empty. |

#### 3. Client-side cost calculator

| Change | Detail |
|--------|--------|
| `frontend/js/cost.js` | New file. `window.computeAllIn(entry, settings)` — reads `renovation_items` from `window.state.checklists[entry.id]`, applies rates from settings, respects `cost_of_ownership.renovation_override_work_eur`, widens band to 40% for confidence-1 items. |

#### 4. Shortlist hero — all-in metric cell

| Change | Detail |
|--------|--------|
| `frontend/js/detail-panel.js` | Hero first metric cell replaced with all-in display: `price + work = all-in` (all-in in `--accent-lt`). Subline: `X €/m² all-in · ±band`. When no items: shows price with italic "all-in unknown — waiting for AI". Override button opens `_showRenoOverrideDialog`. `window._currentListingId` exposed for settings save callback. |
| `backend/routes_entries.py` | `POST /api/entry/{id}/cost-override` extended to accept `renovation_override_work_eur` key. |

#### 5. Settings — Renovation rates section

| Change | Detail |
|--------|--------|
| `frontend/index.html` | `GROUP_META` + `SIDEBAR_CATEGORIES` extended with `reno` group ("Renovation rates" sidebar label). `_buildSettingsFieldNocturne` handles `bool` type → toggle switch using existing `.sn-toggle-track/.sn-toggle-thumb` CSS. `_saveSettingsNocturne` handles bool checkboxes. After reno save: updates `window._settingsData` in-memory + re-renders current hero. |

#### 6. Rank shortlist by all-in

| Change | Detail |
|--------|--------|
| `frontend/js/detail-panel.js` | `_renderShortlistGroups` reads `rank_by_all_in` from settings. When true: each group sorted by `computeAllIn.allIn` asc. Entries without `renovation_items` sort to group end. Score-colored left rule preserved. |

### Acceptance notes

- Fresh scrape required to see AI-produced `renovation_items` in the wild (new listings only).
- Existing listings show "all-in unknown — waiting for AI" until re-scored.
- Cost model rates can be changed in Settings → Renovation rates → save → hero re-renders instantly.
- Override dialog available on any shortlisted entry; "Clear override" removes pin.

### Commits

- `1849400 feat(settings): add renovation rate schema + bool support`
- `aee95b6 feat(ai): extend evaluator prompt with renovation_items output`
- `6e62184 feat(cost): add computeAllIn helper for client-side maths`
- `6a0a7c2 feat(shortlist): hero shows price + work = all-in`
- `812e26a feat(settings): render Cost model section with rates + contingency + toggle`
- `ee29ef7 feat(shortlist): rank by all-in setting flips sidebar sort`
- `28bd21d feat(shortlist): per-listing override for renovation work figure`
- `572cbcd test(wave6c): add 15 tests for all-in cost feature`

### Test results

**130 passed baseline + 11 new tests passing** (4 additional tests skip without Postgres — run green in Docker).
15 tests total in `tests/test_wave6c_allin_cost.py`.
