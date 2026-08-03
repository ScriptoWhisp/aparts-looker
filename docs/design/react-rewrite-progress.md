# React Rewrite Progress

Tracking document for the Wave 7A–7D frontend rewrite.

The vanilla JS frontend (Waves 1–6D) is preserved at `frontend-legacy/` and remains the
behavior reference for each new React component. The new React app lives at `frontend/`.

---

## Wave 7A — Toolchain + Shell + Overview (COMPLETE)

**Date:** 2026-08-04
**Status:** Complete. Build passes, Docker multi-stage build updated.

### What shipped

| Area | Detail |
|------|--------|
| Legacy preserved | `git mv frontend/ frontend-legacy/` — all vanilla JS/HTML/CSS intact |
| Vite 5 + React 18 + TypeScript 5 | Strict mode, noImplicitAny, bundler module resolution |
| Tailwind 3.4 | Nocturne palette ported to `tailwind.config.ts` — all SPEC §1 tokens as theme colors |
| Zustand 4 | UI state: activeTab, selectedListingId, hash sync, ?listing=<id> deep-link |
| TanStack Query 5 | Server state: `/api/data` (30s refresh), `/api/settings`, manual refresh |
| Hash routing | Custom useHashRoute via Zustand; backward compat: #pending→inbox, #detail→shortlist |
| App shell | Header (48px, brand, tabs, badge, refresh), Shell (flex frame) |
| Overview tab | BEST hero card (real data), This week stats (real data), Next up list (real data) |
| Placeholder tabs | Inbox/Shortlist/Settings each show "migrates in Wave 7B/7C/7D" notes |
| Docker multi-stage | Stage 1: node:20-alpine + npm ci + vite build. Stage 2: COPY dist/ → ./static/ |

### What's stubbed for later waves

| Stub | File | Resolves in |
|------|------|------------|
| Map placeholder | `Overview.tsx` — `<div>Map coming in Wave 7D</div>` | Wave 7D |
| Charts placeholders | `Overview.tsx` — two placeholder cards | Wave 7D |
| Inbox tab | `routes/Inbox.tsx` — placeholder | Wave 7B |
| Shortlist tab | `routes/Shortlist.tsx` — placeholder | Wave 7C |
| Settings tab | `routes/Settings.tsx` — placeholder | Wave 7D |
| ScoreBadge | `shared/ScoreBadge.tsx` — implemented, not yet used in Overview | Wave 7B+ |

### shadcn/ui

shadcn/ui was NOT initialized in Wave 7A — the shell and Overview don't need it yet.
The plan said `npx shadcn@latest init` for Button, Card, Badge, Tabs.
Since we use hash routing (not React Router's `<Tabs>`) and the components are simple enough
to build inline with Tailwind, shadcn init is deferred to Wave 7B when the Inbox card
components will benefit from shadcn's Sheet (vaul already included as a dep) and Button variants.
`lucide-react` is already installed as a dep for icon use in Wave 7B+.

### Key decisions

1. **No react-router-dom used** — hash routing is 4 lines of Zustand + a hashchange listener.
   BrowserRouter would require nginx/Caddy rewrite rules for `/inbox`, `/shortlist` etc.
   HashRouter keeps backward compat with existing Telegram deep-links (`/#inbox`).

2. **shadcn/ui deferred** — Wave 7B will run `npx shadcn@latest init` when it needs
   Sheet, Button, and Badge components for the Inbox swipe cards.

3. **TanStack Query 5 + Zustand 4** — server state and UI state are cleanly separated.
   Overview data flow works end-to-end: fetch → cache → render.

4. **Data layer commits consolidated** — api.ts, queries.ts, state.ts were created
   alongside the shell components in a single wave. The planned separate "data layer" commit
   was merged into the app shell commit for cleanliness (no functional difference).

### Commits

| Hash | Message |
|------|---------|
| `8d520c8` | `chore: move frontend/ to frontend-legacy/ (preserved during React rewrite)` |
| `73c04a6` | `feat(frontend): scaffold Vite + React + TS + Tailwind` |
| `25c8fe9` | `feat(frontend): port Nocturne tokens to tailwind config` |
| `de6bc63` | `feat(frontend): app shell — Header + TabNav with hash routing` |
| `709e452` | `feat(docker): multi-stage build — Node frontend + Python runtime` |

### Verify steps

```bash
# Local build
cd frontend && npm install && npm run build  # produces dist/

# Docker build
docker compose build app  # ~2-3 min (npm ci adds time)

# Run and smoke test
docker compose up -d && sleep 5
curl http://127.0.0.1:8000/  # 200, <div id="root">

# Open browser → http://127.0.0.1:8000/
# - Overview renders with Header (brand + 4 tabs + Refresh button)
# - BEST hero card shows highest-score shortlisted entry (or empty state)
# - This week stats shows pending/to-view/viewed counts
# - Next up list shows shortlisted entries sorted by score
# - Inbox/Shortlist/Settings tabs show placeholder messages
# - #pending hash → Inbox tab (backward compat)
# - #detail hash → Shortlist tab (backward compat)
```

### Local development

```bash
# Backend must be running on :8000 first:
docker compose up -d app postgres

# Then in a separate terminal:
cd frontend
npm install
npm run dev
# → http://localhost:5173 (proxies /api/* to localhost:8000)
```

Live reload works for all src/ files. Tailwind JIT rebuilds on every save.
No webpack, no babel — Vite's esbuild is fast (cold start < 300ms).

---

## Wave 7B — Inbox tab (PLANNED)

**Scope:**
- Desktop: 3-column card grid (Look closer / Skip actions)
- Mobile (≤768px): Framer Motion swipe cards (primary triage surface)
- Keyboard shortcuts: L=look closer, S=skip, ↑↓=navigate
- vaul bottom sheet for skip reason picker (6 chips)
- Cleared state after triage

**Key packages already installed:** `framer-motion@11`, `vaul@0.9`, `lucide-react`

**shadcn/ui init in Wave 7B:** `npx shadcn@latest init` — style: default, base: slate, CSS vars: true

---

## Wave 7C — Shortlist tab (PLANNED)

**Scope:**
- 284px sidebar: To view / Viewed / Dropped funnel groups
- Main pane: hero row + verdict band + accordion checklist
- After-viewing decision bar (Still in / Thinking / Drop)
- Drop reason modal
- Gated negotiation card (opacity 0.45 until viewed)
- Compare overlay (cmd-click multi-select)

---

## Wave 7D — Settings + Map + Charts + Compare (PLANNED)

**Scope:**
- Settings tab: renovation rates, score ramp slider, district chips, Telegram
- Map: `react-leaflet@4` — Leaflet with Nocturne DivIcon pins + district polygons
- SVG charts: histogram (score distribution) + scatter (score vs price)
- Compare overlay migration from vanilla to React
- Maa-amet sold-price delta display

**Delete `frontend-legacy/`** after Wave 7D ships and is stable in production for 1 week.
