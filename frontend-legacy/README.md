# frontend-legacy — Vanilla JS Reference (Waves 1–6D)

This directory is the complete Nocturne v3 vanilla-JS/HTML/CSS frontend shipped in Waves 1–6D.

**Do not modify this directory during the React rewrite (Waves 7A–7D).**

It is preserved so that:
1. Each new React component can be built against the exact vanilla behavior reference.
2. If Wave 7A or later fails catastrophically, the Docker build can be reverted by pointing
   `COPY frontend-legacy/ ./static/` back in `backend/Dockerfile`.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Full app — tab structure, CSS, all vanilla JS |
| `css/tokens.css` | Nocturne design token system (ported to Tailwind in Wave 7A) |
| `js/ui.js` | Overview + shared render helpers |
| `js/detail-panel.js` | Shortlist tab (sidebar + main pane) |
| `js/map.js` | Leaflet map integration |
| `js/charts.js` | Hand-rolled SVG histogram + scatter |
| `js/comparison.js` | Compare overlay (cmd-click multi-select) |
| `js/cost.js` | Client-side all-in cost calculator |
| `tallinn-districts.geojson` | District polygon data for map layer |

## When to delete

Delete this directory after Wave 7D ships **and** the React app has been stable in production
for at least 1 week. Before deleting: verify `docker compose up -d` runs the React build
cleanly and all four tabs (Overview, Inbox, Shortlist, Settings) are functional.

## React rewrite progress

| Wave | Status | Scope |
|------|--------|-------|
| 7A | In progress | Toolchain + shell + Overview proof-of-life |
| 7B | Planned | Inbox tab (mobile swipe cards via Framer Motion) |
| 7C | Planned | Shortlist tab |
| 7D | Planned | Settings + Compare overlay + Map (Leaflet via react-leaflet) |
