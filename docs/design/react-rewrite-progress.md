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

## Wave 7D — Map + Charts + Overview + Settings + Compare (COMPLETE)

**Date:** 2026-08-04
**Status:** Complete. Build passes (clean TS + Vite), 166 backend tests passed.

### What shipped

| Area | Detail |
|------|--------|
| ListingsMap | react-leaflet@4, OSM tiles, DivIcon pins colored by scoreColor (solid=approved/dashed=pending), filter pills (All/Approved/Pending), layer toggles (Districts €/m² + 30-min commute), score-ramp legend, district polygon layer from /tallinn-districts.geojson + /api/districts, isochrone ring from /api/isochrone, pin click → shortlist tab |
| HistogramSVG | Hand-rolled SVG, 10 bins 0-100, scoreColor fills, 75-approve tick label, median · n= header, hover tooltip |
| ScatterSVG | Hand-rolled SVG, score(x) vs price(y-inverted), shortlisted halo, dashed budget line, click navigates, hover card |
| Overview route | Full 2-col grid replaces Wave 7A placeholders. Left: map (flex-1) + charts row. Right: BEST hero + stats + calibration (≥5) + Next up |
| CalibrationPanel | SVG scatter AI vs own_score, dashed y=x reference, MAE + bias stats, nudge sentence if |bias|>5 pts |
| Settings route | 5-category sidebar, custom sliders (with ramp variant for threshold keys), toggle switches, text inputs, Save → POST /api/settings, toast |
| CompareOverlay | 1000px modal, differing-rows-only, winner tinting (text-status-short), Draft offer / Drop per column, Esc+backdrop close |
| SidebarRow multi-select | cmd/ctrl-click toggles compare selection, ring-2 ring-accent inset visual, checkbox overlay |
| SidebarFunnel compare | compareIds state (max 2 FIFO), header bar with count + Compare button, keyboard C shortcut |
| own_score slider | In HeroRow for viewed/thinking/offer_drafted/dropped; debounced 800ms POST to /api/entry/{id}/cost-override |

### Key decisions

1. **PinsLayer uses imperative Leaflet API** — react-leaflet `Marker` components cause full re-render on every entry change. Using `useEffect` + `L.layerGroup` + `L.marker` directly avoids this and is the standard pattern for large datasets.
2. **Charts are pure SVG, no chart lib** — HistogramSVG + ScatterSVG are ~100 lines each. No recharts/visx dep. Hover state via onMouseEnter/Leave on SVG elements.
3. **Compare overlay is not a shadcn Dialog** — built inline with fixed+backdrop pattern. shadcn Dialog was not initialized in Wave 7B (shadcn-generated files were deleted). Inline pattern is simpler and avoids react-portal footgun with Zustand state.
4. **CalibrationPanel gated at MIN_RATED_VIEWINGS=5** — constant exported for future use. Panel returns null below threshold.
5. **Settings sidebar uses `useState` for active category** — no route change needed (hash routing is tab-level only). Category switch is instant.

### Commits

| Hash | Message |
|------|---------|
| `179036e` | `feat(overview): react-leaflet map with pins, districts, isochrone, filter pills` |
| `4762f35` | `feat(charts): hand-rolled SVG histogram + scatter` |
| `c376175` | `feat(overview): BEST hero + This week + Next up list — full Overview route` |
| `bfd8980` | `feat(overview): calibration panel at >=5 rated viewings` |
| `c20508b` | `feat(settings): 5-category layout with sliders, chips, toggles, threshold ramp` |
| `8cf5141` | `feat(compare): multi-select in shortlist sidebar + C keyboard shortcut` |
| `d297701` | `feat(compare): dialog overlay — differing rows, winner tinting, per-column actions` |
| `8836441` | `feat(shortlist): own_score slider in hero for viewed listings` |

---

## React rewrite complete

All 4 tabs (Overview / Inbox / Shortlist / Settings) are fully implemented in React across Waves 7A–7D.

### What's in production per tab

| Tab | Route | Features |
|-----|-------|---------|
| Overview | `#overview` | Leaflet map (pins, districts, isochrone, filter pills), SVG histogram, SVG scatter, BEST hero card, This week stats, Calibration panel (≥5 rated), Next up list |
| Inbox | `#inbox` | Desktop 3-col card grid, mobile swipe stack (Framer Motion), keyboard shortcuts L/S/arrows, vaul skip drawer, progress bar, AnimatePresence transitions |
| Shortlist | `#shortlist` | SidebarFunnel with 3 collapsible groups, multi-select compare, HeroRow with own_score slider, VerdictBand, AfterViewingBar, ChecklistCard accordion, AskAtViewing, NegotiationCard (gated), CompareOverlay |
| Settings | `#settings` | 5-category sidebar, sliders + ramp variants + toggles + text inputs, save → POST /api/settings, toast notification |

### Delete `frontend-legacy/` after 1 week of stable production

After confirming Wave 7D is stable on the deployed VPS (approx 2026-08-11), run:
```bash
rm -rf frontend-legacy/
git add -A && git commit -m "chore: delete frontend-legacy/ (vanilla JS, superseded by React rewrite)"
```

The vanilla JS frontend has been fully superseded. The `frontend-legacy/` directory is kept for 1 week as a reference in case rollback is needed.

---

## Testing — Vitest QA Setup

**Date:** 2026-08-07
**Status:** Complete. 106 tests passing, 0 failing.

### Toolchain

| Package | Purpose |
|---------|---------|
| `vitest` | Test runner (uses Vite config, fast ESM-native) |
| `@testing-library/react` | Component rendering + querying |
| `@testing-library/jest-dom` | DOM matchers (`toBeInTheDocument`, etc.) |
| `@testing-library/user-event` | Realistic user interactions |
| `jsdom` | DOM environment for Vitest |
| `@vitest/ui` | Browser-based test explorer (`npm run test:ui`) |
| `msw` (v2) | Mock Service Worker — intercepts `/api/*` fetch calls |

### Test commands

```bash
npm test               # one-shot run (CI + post-commit hook)
npm run test:watch     # watch mode for dev feedback
npm run test:ui        # browser-based interactive explorer
npm run test:coverage  # v8 coverage report
```

### Test files

| File | Tests | What it covers |
|------|-------|----------------|
| `cost.test.ts` | 17 | `computeAllIn`, `settingNum`, `rankByAllIn` — pure logic, no DOM |
| `App.test.tsx` | 18 | Hash routing, tab mount under empty/full/malformed data, ErrorBoundary |
| `ScatterSVG.test.tsx` | 11 | Crash guards for undefined settings, dot rendering, budget line |
| `ChecklistCard.test.tsx` | 14 | groups shape, ai_checklist_fills fallback, empty state, flag-first open |
| `HeroRow.test.tsx` | 12 | Render shapes, own_score slider POST, cost display |
| `SidebarFunnel.test.tsx` | 9 | Group counts, Dropped collapsed, filter input, onSelect callback |
| `Overview.test.tsx` | 13 | BEST hero, This week stats, Next up, CalibrationPanel gating |
| `Inbox.test.tsx` | 12 | Desktop 3-col grid, skip flow (6 chips + cancel), keyboard L fires approve |

**Total: 106 tests, 8 test files.**

### What Vitest catches

- **Runtime crashes on undefined** — the `.find()` on `settings.fields` bug (the original production crash) is caught by `settingNum` and all component tests using `mockSettingsMalformed`
- **API contract regressions** — `mockSettingsMalformed` has `{schema: [...]}` instead of `{fields: [...]}`. Any component that does `.fields.find()` without optional chaining will throw and fail the test
- **Routing breakage** — `#pending → inbox`, `#detail → shortlist` backward compat is regression-tested
- **Logic bugs** — `computeAllIn`: wrong contingency rate, missing `applies=false` guard, per-sqm vs flat rate confusion
- **Empty state correctness** — each route has tests for zero-data inputs
- **Uncaught component throws** — ErrorBoundary integration test verifies the fallback UI

### What Vitest does NOT catch (requires Playwright or manual QA)

- **Visual layout and Tailwind styling** — jsdom does not evaluate CSS; pixel-level layout bugs are invisible
- **Framer Motion swipe gestures** — drag events cannot be realistically simulated in jsdom
- **Leaflet map rendering** — ListingsMap is mocked out entirely; pin placement, district overlays, isochrone ring need a real browser
- **Animation timing** — CSS transitions/animations do not run in jsdom
- **Mobile touch interactions** — `matchMedia` is stubbed; actual iOS viewport behavior needs Playwright on a mobile profile

### How to add tests for new components

See `frontend/README.md` — "Adding tests for new components" section.

The key pattern:
1. Use `mockSettingsMalformed` to prove graceful degradation on old API shapes
2. Use `renderWithProviders()` with `queryCache` to skip async loading in tests
3. Mock framer-motion with the standard stub if the component uses `AnimatePresence`
4. Override MSW handlers per-test with `server.use(http.get(...))` for edge cases

### Commits

| Hash | Message |
|------|---------|
| `2ee0e6b` | `chore(frontend): install vitest + testing-library + msw devDeps` |
| `a4ae49d` | `feat(test): vitest config + jsdom setup + MSW server` |
| `9243df0` | `feat(test): fixture data (empty / partial / full / malformed)` |
| `c986b0e` | `test(app): route mount regression net across empty/full/malformed data` |
| `a2cfff1` | `test(cost): pure logic — computeAllIn + settingNum + rankByAllIn` |
| `442e05e` | `test(shortlist): SidebarFunnel + HeroRow + ChecklistCard` |
| `0e5607a` | `test(overview): route smoke + ScatterSVG + calibration gating` |
| `39d6d0e` | `test(inbox): desktop grid + skip flow + keyboard approve` |
| `522f3c5` | `docs(frontend): README with test workflow + exclude test/ from tsc build` |

---

## Testing — Playwright E2E Setup

**Date:** 2026-08-07
**Status:** Complete. Test suite written; runs against Docker stack.

### What was added

| File | Purpose |
|------|---------|
| `frontend/playwright.config.ts` | Config: 2 projects (chromium-desktop 1440×900, webkit-mobile iPhone 13), baseURL from `E2E_BASE_URL` env |
| `frontend/e2e/fixtures/seed.ts` | Route mock helpers (`mockAppData`, `mockSettings`, `mockGeoEndpoints`) + realistic fixture data |
| `frontend/e2e/smoke.spec.ts` | 4 tabs × 2 projects — no console errors, active tab styling, no ErrorBoundary crash |
| `frontend/e2e/inbox.spec.ts` | Look closer (POST /approve), Skip flow (modal+reason+POST), keyboard L, empty state, mobile layout |
| `frontend/e2e/shortlist.spec.ts` | Sidebar groups, hero pane click, verdict band, after-viewing decision bar, dropped row, empty state |
| `frontend/e2e/settings.spec.ts` | All category tabs render, slider enables Save, POST /api/settings fires, toast "Saved" |
| `frontend/e2e/compare.spec.ts` | Ctrl-click multi-select, Compare button, dialog opens, Esc closes, backdrop closes |

### Testing pyramid (complete picture)

| Layer | Command | Speed | Scope |
|-------|---------|-------|-------|
| Vitest unit | `npm test` | ~2s | Logic, API shapes, routing, empty states, component render |
| Playwright E2E | `npm run e2e` | ~40–90s | Real browser flows, user interactions, keyboard, POST verification, screenshots |
| Both | `npm run qa` | ~100s | Full pre-push gate |

### Bug class ownership

| Bug class | Vitest | Playwright |
|-----------|:------:|:----------:|
| Runtime crash on undefined | Yes | Yes |
| Wrong API shape regression | Yes | No (mocked) |
| Visual layout / CSS | No | Yes (screenshot) |
| Keyboard shortcut (L, S, C, Esc) | No | Yes |
| POST request fired on click | No | Yes (route intercept) |
| Mobile viewport sizing | No | Yes (webkit-mobile) |
| Toast / notification appears | No | Yes |
| Framer Motion swipe | No | Partial |

### Data strategy

All E2E tests use **Playwright route interception** — no live DB writes:

```ts
await mockAppData(page, fullAppData)    // intercepts GET /api/data
await mockSettings(page, fullSettings)  // intercepts GET /api/settings
await mockGeoEndpoints(page)            // intercepts /api/isochrone, /api/districts, .geojson
await page.goto('/#inbox')
```

POST endpoints (approve, reject, viewing-decision, settings) are intercepted per-test and return `{ ok: true }` — verifying requests fire without mutating any real data.

### Commits

| Hash | Message |
|------|---------|
| `03b91c3` | `chore(frontend): install @playwright/test + browsers` |
| `06996f3` | `feat(e2e): playwright config with desktop + mobile projects` |
| `a5e32b8` | `feat(e2e): seed + mock fixtures for API routes` |
| `17e93eb` | `test(e2e): smoke — 4 tabs load without console errors` |
| `6cda23c` | `test(e2e): inbox — approve/skip/keyboard flows` |
| `fd6bb6e` | `test(e2e): shortlist — sidebar navigation + after-viewing decisions + all-in cost` |
| `5a87511` | `test(e2e): settings — form save + persistence` |
| `9f022c4` | `test(e2e): compare — multi-select + differing-rows overlay` |
| `d986bab` | `docs(frontend): testing pyramid + post-commit QA workflow` |

---

## Wave 8A — Mobile Inbox Tinder-flow rework (COMPLETE)

**Date:** 2026-08-07
**Status:** Complete. 121 Vitest tests passing. Playwright tests updated.

### What shipped

| Area | Detail |
|------|--------|
| Tinder flow — stay on inbox | After Look closer / swipe right: POST /approve fire-and-forget, card slides off right, next card promotes from peek. Hash stays `#inbox`. Previously jumped to `#shortlist`. |
| Skip flow — explicit Next | After Skip / swipe left: card slides off left first, skip sheet opens, next card visible behind. No auto-close countdown. Explicit `Next` button commits reject. `Undo` returns card to front of queue. |
| Swipe overlays — big tinted | Full-card color tint overlay (green right / red left) with large centered text "Look closer" / "Skip" scaling with drag distance. Replaced tiny corner pills. |
| Swipe animations | `exit: { type: 'tween', duration: 0.22 }` for fast fling. PeekCard: `initial={{ scale: 0.95, y: 8 }} animate={{ scale: 1, y: 0 }}` promote. |
| All-in cost line | `AllInLine` component below price row: `all-in ≈ Nk · incl. reno est.` in mono `text-accent-lt`. Shows `all-in unknown` when no renovation_items. Uses `computeAllIn` from `lib/cost.ts`. |
| Cleared state redesign | `ClearedState` shows decision list rows: score (color-coded) + title (strikethrough if skipped) + outcome tag (`shortlisted` green / `<reason>` muted). Summary sub-line with count, elapsed minutes, next scrape time. |
| decisions[] state tracking | `useInboxSession` extended with `decisions: InboxDecision[]` (id, title, score, outcome, reason). `recordLookCloser` / `recordSkip` now accept title+score args. `resetSession` clears decisions. |
| MobileBottomNav | New component: `fixed bottom h-14`, 4 items with icons + labels. Active: `text-accent-lt` + `border-t-2 border-t-accent`. Pending badge dot on Inbox. Mobile-only rendering. |
| Header tab hiding | Tab nav hidden on mobile viewport (`!isMobile` gate + spacer). Bottom nav takes over navigation on mobile. |
| Shell padding | `pb-14` on mobile main content to avoid bottom nav overlap. |
| Inbox header | "Inbox" title (Inter 500 22px) left + "N of M" mono right-aligned. Progress bar below. |
| Height | `h-[calc(100dvh-48px-56px)]` to account for header 48px + bottom nav 56px. |

### Behavior contract (canonical)

| Action | Old behavior | New behavior |
|--------|-------------|-------------|
| Tap "Look closer" | POST /approve → hash→`#shortlist` → detail opens | POST /approve (fire-and-forget) → card slides right → next card promotes → stays `#inbox` |
| Swipe right past threshold | Same as Look closer (jumped to shortlist) | Approve + advance, stays inbox |
| Tap "Skip" | Sheet opens → 8s countdown auto-closes | Card slides left → sheet opens → wait for explicit Next |
| Swipe left past threshold | Same as Skip | Card slides left → sheet opens |
| Tap "Next" in sheet | N/A (was auto-close) | POST /reject with selected reason → sheet closes |
| Tap "Undo" in sheet | Sheet closed, entry decided | Card restored to front of queue, sheet closes |
| All cards triaged | "You triaged N: X shortlisted · Y skipped" | Decision list with score/title/outcome, Open shortlist CTA |
| Tab navigation (mobile) | Header tabs | Fixed bottom dock, 4 items |

### Commits

| Hash | Message |
|------|---------|
| `e8c935a` | `feat(mobile-nav): bottom nav dock with 4 items` (state.ts decisions[]) |
| `e65756f` | `feat(mobile-nav): add MobileBottomNav component and wire into Shell/Header` |
| `16f5bd3` | `feat(inbox-mobile): tinder-flow — stay on inbox after approve/skip, advance to next` |
| `e1603ca` | `test(inbox-mobile): tinder-flow regression net (vitest + playwright)` |

### Test coverage added (Wave 8A)

**Vitest (15 new tests — 121 total):**

| Test | Assertion |
|------|-----------|
| Look closer stays `#inbox` | `window.location.hash === '#inbox'` after button click |
| Look closer fires POST /approve | `approveCallCount === 1` |
| Look closer records `shortlisted` decision | `session.decisions[0].outcome === 'shortlisted'` |
| Skip button triggers dismissal | body contains "Skipped" text |
| Skip sheet has Next button | `screen.getByRole('button', { name: /Next/ })` present |
| Skip sheet has no countdown | body does not match `/auto-closes/i` |
| Next button fires POST /reject | `rejectCallCount === 1` |
| Skip sheet shows 6 chips | all 6 reason chip labels present |
| Cleared state renders | `screen.getByText(/Inbox clear/)` present |
| Open shortlist button visible | `screen.getByRole('button', { name: /Open shortlist/ })` present |
| recordLookCloser adds decision | decisions array length/content |
| recordSkip with reason | decisions array outcome/reason |
| resetSession clears decisions | `decisions.length === 0` |
| Mobile layout renders Inbox header | "Inbox" title + "1 of 3" progress counter |
| Mobile action buttons visible | Look closer / Skip / Later buttons |

**Playwright E2E (5 new mobile tests):**

| Test | What it covers |
|------|---------------|
| Look closer on card 1 → hash `#inbox` + card 2 visible | Core Tinder flow regression |
| Skip → sheet with Next button (no countdown) | Explicit-Next skip flow |
| Skip → chip → Next → POST /reject with reason | Reason routing |
| Cleared state: 2 approvals → decision list + Open shortlist | Cleared state rendering |
| Bottom nav dock renders with 4 items | Mobile navigation |
