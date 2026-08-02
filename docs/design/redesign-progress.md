# Aparts Looker — Nocturne Redesign Progress

This file is the running handoff document across all design waves.
It supersedes `wave-1-notes.md` (the Wave 1-only version is kept for history).

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

## Handoff to Wave 3 — Detail Tab

Wave 3 should:

1. Rebuild the Detail tab split layout to match brief 1c (verdict band + collapsible checklist groups with flag-first ordering).
2. Migrate bridge aliases used in `.detail-*`, `.sidebar-*`, `.ai-*`, `.coo-*`, `.brief-*`, `.ku-*` styles to canonical Nocturne tokens (replacing `var(--bg)`, `var(--surface-2)`, `var(--blue)`, etc.).
3. Add `window.getDistrictLayerVisible()` to map.js to sync the Nocturne district toggle pill initial state with map.js's internal `districtsVisible` flag.
4. If inline scheduling on the hero card is desired, add the datetime-local picker flow to `renderBestHero()` in ui.js (pattern: copy from `_renderMainPane` in detail-panel.js, POST to `/api/listings/{id}/schedule-viewing`).
5. Do NOT touch the `.overview-*` or `.map-*` classes introduced in Wave 2.

## Handoff to Wave 4 — Pending Tab

Wave 4 should:

1. Rebuild Pending tab with the Nocturne card pattern (each pending listing as a `.card` with photo, score badge `.score-badge[data-score-bucket]`, verdict, approve/reject actions).
2. Replace `.pending-card`, `.pending-card-title`, `.pending-card-meta` legacy styles.
3. Migrate bridge aliases used in `.pending-*` styles.

## Final bridge-alias cleanup (Wave 5+)

After Wave 3 + 4 complete their migrations, the bridge-alias block in `:root` inside `<style>` in `index.html` can be removed:

```css
/* TO REMOVE after Wave 3+4 complete */
--bg, --surface, --surface-2, --border, --text, --text-muted,
--blue, --green, --amber, --red, --font-mono, --font-sans, --radius, --shadow
```

The inline `<style>` block can then be replaced with a `<link rel="stylesheet" href="/css/overview.css">` and similar per-tab CSS files. The `tokens.css` file stays as-is.
