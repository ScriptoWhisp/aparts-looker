# Aparts Looker — Frontend

React 18 + TypeScript + Vite frontend for the Aparts Looker apartment hunting system.

## Development

```bash
# Backend must be running on :8000 first
docker compose up -d

# Install dependencies (first time)
npm install

# Start dev server with HMR (proxies /api/* to localhost:8000)
npm run dev
# → http://localhost:5173
```

## Build

```bash
npm run build   # produces dist/ for Docker COPY
npm run preview # preview the production build locally
```

## Running tests

The test suite uses Vitest + @testing-library/react + MSW.

```bash
# One-shot run (use this for CI and after every commit)
npm test

# Watch mode — re-runs affected tests on save (dev feedback loop)
npm run test:watch

# Browser UI — interactive test explorer at http://localhost:51204/
npm run test:ui

# Coverage report (HTML + text)
npm run test:coverage
```

### What the tests catch

| Class | Example | Caught by |
|-------|---------|-----------|
| Runtime crash on undefined | `settings?.fields?.find(...)` when `fields` is undefined | `cost.test.ts`, `ScatterSVG.test.tsx`, `HeroRow.test.tsx` |
| API contract regression | Old backend returns `{schema: [...]}` instead of `{fields: [...]}` | `mockSettingsMalformed` fixture + all component tests |
| Routing breakage | Hash backward compat `#pending → inbox` | `App.test.tsx` |
| Missed error boundary | Component throws without being caught | `App.test.tsx` ErrorBoundary test |
| Logic bugs | `computeAllIn` uses wrong contingency rate | `cost.test.ts` |
| Empty state rendering | No pending entries — shows correct empty state | `Inbox.test.tsx`, `Overview.test.tsx` |
| Checklist shape variants | `groups` shape vs `ai_checklist_fills` fallback | `ChecklistCard.test.tsx` |

### What tests do NOT catch

| Class | Why | How to test instead |
|-------|-----|---------------------|
| Visual layout / styling | jsdom has no CSS engine | Manual review / Playwright visual snapshot |
| Framer Motion swipe gestures | jsdom cannot simulate pointer drag events | Playwright with real browser |
| Leaflet map rendering | Leaflet needs a real DOM + Canvas/SVG | Playwright + screenshots |
| Animation timing | CSS transitions not applied in jsdom | Visual QA |
| Mobile touch interactions | Touch event simulation is unreliable in jsdom | Playwright on a mobile viewport |

### Adding tests for new components

1. Create `src/test/YourComponent.test.tsx`
2. Import the component + fixtures:
   ```tsx
   import { YourComponent } from '@/components/YourComponent'
   import { renderWithProviders } from './renderWithProviders'
   import { mockAppDataFull, mockSettingsFull } from './mocks/fixtures'
   import { QUERY_KEYS } from '@/lib/queries'
   ```
3. Seed the query cache if the component uses `useAppData()` or `useSettings()`:
   ```tsx
   renderWithProviders(<YourComponent />, {
     queryCache: [
       { queryKey: QUERY_KEYS.appData, data: mockAppDataFull },
       { queryKey: QUERY_KEYS.settings, data: mockSettingsFull },
     ],
   })
   ```
4. Always write a `does not crash when settings.fields is undefined` test — use `mockSettingsMalformed`
5. Mock framer-motion if the component uses `AnimatePresence` or `motion.*`:
   ```ts
   vi.mock('framer-motion', () => ({
     AnimatePresence: ({ children }) => <>{children}</>,
     motion: { div: ({ children, ...props }) => <div {...props}>{children}</div> },
   }))
   ```
6. Override MSW handlers for specific scenarios:
   ```ts
   server.use(
     http.get('/api/data', () => HttpResponse.json(mockEmptyAppData)),
   )
   ```

### Fixture pattern

All fixture data lives in `src/test/mocks/fixtures.ts`. Four shapes are available:

| Export | Description |
|--------|-------------|
| `mockEmptyAppData` | `{properties: [], pending: []}` |
| `mockAppDataWithPending` | 3 pending (inbox) entries |
| `mockAppDataWithShortlisted` | 4 approved/viewed/dropped entries |
| `mockAppDataFull` | All 7 entries across all statuses |
| `mockSettingsEmpty` | `{fields: [], groups: []}` |
| `mockSettingsFull` | All 15 settings fields |
| `mockSettingsMalformed` | Old `{schema: [...]}` shape — regression guard |

To override a handler for a single test, use `server.use(...)` inside the test (MSW resets after each test automatically).

---

## Testing pyramid

Three layers, each catching different bug classes:

| Layer | Command | Speed | What it catches |
|-------|---------|-------|----------------|
| Vitest unit/component | `npm test` | ~2s | Logic bugs, API contract regressions, routing breakage, crash-on-undefined, empty states |
| Playwright E2E | `npm run e2e` | ~40–90s | Real browser flows, visual layout, user interactions, keyboard shortcuts, cross-device viewports |
| Both | `npm run qa` | ~100s | Full confidence gate before push |

### E2E test suite

Playwright tests live in `frontend/e2e/`. Two browser projects:
- **chromium-desktop** — 1440×900 Chrome. All desktop flows.
- **webkit-mobile** — iPhone 13 WebKit. Mobile inbox layout + button sizing.

```bash
# Run all E2E tests (Docker stack must be up)
docker compose up -d && sleep 4
npm run e2e

# Run specific project
npm run e2e:desktop
npm run e2e:mobile

# Debug with headed browser
npm run e2e:headed

# Interactive Playwright UI (time-travel debugging)
npm run e2e:ui
```

### E2E test files

| File | Tests | What it covers |
|------|-------|----------------|
| `e2e/smoke.spec.ts` | 4×2=8 | Each tab loads without console errors, active tab styling, no ErrorBoundary crash |
| `e2e/inbox.spec.ts` | 4 | Look closer (POST /approve), Skip (modal + reason), keyboard L, empty state |
| `e2e/shortlist.spec.ts` | 5 | Sidebar groups, hero pane click, verdict band, after-viewing decision bar, dropped row |
| `e2e/settings.spec.ts` | 4 | Category tabs, slider enables Save, POST /api/settings, toast "Saved" |
| `e2e/compare.spec.ts` | 4 | Multi-select ring, Compare button, dialog open, Esc/backdrop close |

**Total: ~25 test cases across 2 browser projects.**

### Data strategy

All E2E tests use **Playwright route interception** — no live DB writes:

```ts
import { mockAppData, mockSettings, fullAppData, fullSettings } from './fixtures/seed'

// Before page.goto():
await mockAppData(page, fullAppData)
await mockSettings(page, fullSettings)
await page.goto('/#inbox')
```

For mutation tests (approve, reject, viewing-decision), Playwright intercepts the POST and returns `{ ok: true }` — verifying the request was made without modifying any real data.

### Screenshot artifacts

Every test that verifies a critical UI state takes a screenshot:

```
e2e/fixtures/screenshots/
  smoke-overview.png
  smoke-inbox.png
  smoke-shortlist.png
  smoke-settings.png
  inbox-look-closer.png
  inbox-skip-confirmed.png
  inbox-empty-state.png
  shortlist-sidebar-groups.png
  shortlist-hero-pane.png
  shortlist-verdict-band.png
  shortlist-after-viewing-bar.png
  shortlist-dropped-row.png
  settings-categories.png
  settings-slider-changed.png
  settings-saved-toast.png
  compare-multi-select.png
  compare-dialog-open.png
  ...
```

Screenshots are gitignored (artifacts, not source). After a run, open any `.png` to visually confirm no layout regression.

### Post-commit QA workflow (for autonomous Claude runs)

1. Make change
2. `docker compose build app && docker compose up -d`
3. `cd frontend && npm test` — fast fail on unit regressions
4. `npm run e2e` — E2E on real stack
5. If red: `e2e/fixtures/screenshots/` is the debugging entry point; `playwright-report/index.html` has full trace
6. If green: commit + push

### Bug class coverage matrix

| Bug class | Caught by Vitest | Caught by Playwright |
|-----------|:----------------:|:-------------------:|
| Runtime crash on undefined | Yes | Yes |
| Wrong API shape (fields vs schema) | Yes | No (mocked) |
| Visual layout / Tailwind CSS | No | Yes (screenshot) |
| Hash routing breakage | Yes | Yes |
| Keyboard shortcut (L, S, C, Esc) | No | Yes |
| Framer Motion swipe gestures | No | Partial (drag sim) |
| Mobile viewport sizing | No | Yes (webkit-mobile) |
| POST fired on user action | No | Yes (route intercept) |
| Toast notification appears | No | Yes |
| Empty state text | Yes | Yes |
| Sidebar group counts | Yes | Yes |
| After-viewing decision bar | Partial | Yes |
