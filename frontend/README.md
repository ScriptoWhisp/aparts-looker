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
