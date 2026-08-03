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

## Wave 7B — Inbox tab (COMPLETE)

**Date:** 2026-08-04
**Status:** Complete. Build passes, backend tests 166 passed.

### What shipped

| Area | Detail |
|------|--------|
| shadcn/ui init | `npx shadcn@latest init` — style: base-nova, baseColor: neutral, CSS vars: true. Path alias @/* added to tsconfig + vite. |
| cn utility | `src/lib/cn.ts` — clsx + tailwind-merge (needed by shadcn components) |
| InboxSession Zustand | `state.ts` — triaged/shortlisted/skipped counters, decidedIds Set, laterIds. Tab-lifetime persistence. |
| useMediaQuery hook | `src/hooks/useMediaQuery.ts` — 10-line hook, no dep |
| InboxDesktop | 3-col grid (1→2→3 cols), photo 132px, ScoreBadge, meta, price mono 22px, verdict border-left, Look closer + Skip, ring-accent on best |
| Keyboard shortcuts | L/Enter=look closer, S=skip, ↑↓=navigate. Guarded by `activeElement.tagName` |
| Desktop skip modal | Inline overlay, 6 reason chips, Skip/Cancel |
| InboxMobile | `h-[calc(100dvh-48px)]` iOS-safe viewport, 6-segment 2px progress bar |
| Framer Motion swipe | `motion.div drag="x"`, dragElastic=0.7, fling thresholds ±100px/±500vel, spring stiffness=300 damping=30 |
| Direction hint pills | opacity useTransform left (Look closer green) + right (Skip red) |
| Drag tint overlays | green/red color wash during drag |
| Peek card behind | absolute below front card, opacity 0.4 preview |
| vaul skip drawer | Drawer.Root from vaul, grab handle, 6 chips, Undo button, 8s auto-close countdown |
| Later behavior | Cycle to end of local queue, no backend call |
| Cleared state | "You triaged N: X shortlisted · Y skipped" + Open shortlist button |
| Empty state | Both layouts: adjust threshold / run scrape now |
| AnimatePresence | mode="wait" on card stack for clean exit animations |

### shadcn config quirks

shadcn v4 (`shadcn@4.16.1`) uses `base-nova` style by default (not the old `default` + slate from v3).
It generated components that depend on `@base-ui/react` + CSS color variables that clash with Nocturne.
Resolution: deleted shadcn-generated component files entirely, built all components inline with
Nocturne design tokens. shadcn init was run only to generate `components.json` + path alias setup.
The `cn` utility from shadcn was recreated manually in `src/lib/cn.ts`.

### Framer Motion iOS notes for Wave 7C/7D

- Use `touch-none` CSS class on draggable elements to prevent iOS Safari's scroll bounce from
  intercepting the drag. Framer Motion handles pointer events internally — no manual `touchmove`
  prevention needed.
- `h-[calc(100dvh-48px)]` is required instead of `h-[calc(100vh-48px)]` for iOS Safari with
  dynamic viewport (URL bar appears/disappears). `100dvh` = dynamic viewport height.
- `dragConstraints={{ left: 0, right: 0 }}` with `dragElastic={0.7}` gives the rubber-band
  feeling during a soft drag — the spring snaps back cleanly on release below threshold.
- `select-none` on the card prevents iOS text selection during swipe.
- `draggable={false}` on `<img>` prevents native image drag conflicting with Framer drag.

### Commits

| Hash | Message |
|------|---------|
| `e5ba8f3` | `feat(frontend): init shadcn/ui + install framer-motion + vaul` |
| `fa0a929` | `feat(inbox): desktop 3-col card grid` |
| `7ac2831` | `feat(inbox): keyboard shortcuts L/S/arrows` |
| `56ab416` | `feat(inbox): mobile single-card layout with progress bar` |
| `8100134` | `feat(inbox): framer-motion swipe cards (drag + fling + snap-back)` |

Note: vaul drawer, cleared state, and empty state are all inside `InboxMobile.tsx`
committed in `8100134` (combined as one coherent mobile component).

---

## Wave 7C — Shortlist tab (COMPLETE)

**Date:** 2026-08-04
**Status:** Complete. Build passes, 166 backend tests passed.

### What shipped

| Area | Detail |
|------|--------|
| Layout | `grid grid-cols-[284px_1fr] h-[calc(100vh-48px)]` — sidebar + main pane |
| SidebarFunnel | 3 collapsible funnel groups: To view / Viewed / Dropped |
| SidebarRow | 2px score-colored left rule, mono score, title/meta, right status label |
| StatusPill | Coloured mono pill for all 9 ListingStatus values |
| SidebarFilter | Input narrows all groups by title substring |
| HeroRow | 300px photo (184px height) + header block + 4-cell metric strip |
| Metric strip | All-in cost (accent-lt 34px) · area · score-colored score · monthly |
| Schedule viewing | Inline datetime-local picker → UTC ISO POST /schedule-viewing |
| Mark viewed | Button only when viewing_scheduled, POSTs /mark-viewed |
| VerdictBand | bg-sunken, border-l-2 scoreColor, verdict text, tag counts (flags/unknown/ok) |
| AfterViewingBar | Renders for viewed/thinking/offer_drafted/dropped; 3 decision buttons |
| Drop drawer | vaul Drawer with optional reason text input, Confirm/Cancel |
| Undo drop | Ghost button shown when status=dropped, POST decision=thinking |
| ChecklistCard | Accordion, flag-first group ordering, AnimatePresence height animation |
| SignalStrip | One 7×7 rounded square per item colored by state |
| CollapsedOkRow | Trailing consecutive ok items collapsed: "label1 · label2 · +N more" |
| AskAtViewing | Unknown items as 11×11 checkbox questions, local state only |
| NegotiationCard | Gated (opacity-45) for approved/viewing_scheduled; offer range + brief_ru + action buttons |
| computeAllIn | `frontend/src/lib/cost.ts` — TS port of vanilla Wave 6C logic |
| rankByAllIn | Sidebar re-sorts when settings.rank_by_all_in === true |
| Mobile layout | Sidebar/main pane toggle on mobile; ← Back button in main pane |
| Empty states | "Nothing shortlisted yet" (no entries) + "Select a listing" (no selection) |

### TypeScript notes

- `entry.checklist.groups` typed as `ChecklistGroup[]` in `types/api.ts`. Old entries
  without `groups` fall through to `buildGroupsFromFills()` which synthesises groups
  from `ai_checklist_fills` key prefixes. This means no empty-checklist cards for legacy rows.
- `CostOfOwnership` extended as `CostOfOwnership & Record<string, unknown>` to allow
  `renovation_override_work_eur` sub-key without widening the named interface.
- `computeAllIn` reads `settings.fields.find(f => f.key === 'reno_kitchen_full')` — if
  the backend doesn't include a reno_* key in Settings, the rate silently falls back to 0
  (no TypeError). Safe for partial settings deploys.
- `textWrap: 'pretty'` needed a `as React.CSSProperties` cast — not in TS lib types yet
  but supported in modern browsers.

### Commits

| Hash | Message |
|------|---------|
| `5d63c40` | `feat(cost): port computeAllIn helper to TS` |
| `708bb8d` | `feat(shortlist): sidebar funnel (To view / Viewed / Dropped)` |
| `0738ad4` | `feat(shortlist): status pills + hero row with all-in cost cell` |
| `110fb93` | `feat(shortlist): verdict band with score-colored border` |
| `9b6483d` | `feat(shortlist): after-viewing decision bar (Still in / Thinking / Drop)` |
| `0c5d73f` | `feat(shortlist): accordion checklist with flag-first ordering + signal strip` |
| `84b0553` | `feat(shortlist): Ask at the viewing card` |
| `c3a63ce` | `feat(shortlist): gated Negotiation card` |
| `dedac5b` | `feat(shortlist): assemble Shortlist route — sidebar + main pane` |

---

## Wave 7D — Settings + Map + Charts + Compare (PLANNED)

**Scope:**
- Settings tab: renovation rates, score ramp slider, district chips, Telegram
- Map: `react-leaflet@4` — Leaflet with Nocturne DivIcon pins + district polygons
- SVG charts: histogram (score distribution) + scatter (score vs price)
- Compare overlay migration from vanilla to React
- Maa-amet sold-price delta display

**Delete `frontend-legacy/`** after Wave 7D ships and is stable in production for 1 week.
