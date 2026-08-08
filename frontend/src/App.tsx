/**
 * App — router + layout root.
 *
 * Hash routing — uses window.location.hash to determine active tab.
 * Preserves existing hash URLs: #overview, #inbox, #shortlist, #settings.
 * Backward compat: #pending → inbox, #detail → shortlist, #rejected → shortlist, #compare → overview.
 *
 * Hash routing is implemented via a custom useHashRoute hook (no react-router needed
 * for this simple tab model). This keeps bundle size minimal and avoids the
 * BrowserRouter/HashRouter mismatch when served via FastAPI StaticFiles.
 */

import { useEffect } from 'react'
import { Shell } from './components/layout/Shell'
import { ErrorBoundary } from './components/layout/ErrorBoundary'
import { Overview } from './routes/Overview'
import { Inbox } from './routes/Inbox'
import { Shortlist } from './routes/Shortlist'
import { Settings } from './routes/Settings'
import { Feedback } from './routes/Feedback'
import { useAppStore, type TabId } from './lib/state'

const ROUTES: Record<TabId, { label: string; Component: () => JSX.Element }> = {
  overview:  { label: 'Overview',  Component: Overview },
  inbox:     { label: 'Inbox',     Component: Inbox },
  shortlist: { label: 'Shortlist', Component: Shortlist },
  settings:  { label: 'Settings',  Component: Settings },
  feedback:  { label: 'Feedback',  Component: Feedback },
}

export function App() {
  const { activeTab, syncFromHash } = useAppStore()

  // Sync Zustand state when the user navigates with browser back/forward
  useEffect(() => {
    const handler = () => syncFromHash()
    window.addEventListener('hashchange', handler)
    return () => window.removeEventListener('hashchange', handler)
  }, [syncFromHash])

  const route = ROUTES[activeTab]
  const RouteComponent = route.Component

  return (
    <Shell>
      {/* Keyed on activeTab so switching tabs resets the boundary — a fresh
          error state per tab instead of a sticky "Retry" that doesn't remount. */}
      <ErrorBoundary key={activeTab} label={route.label}>
        <RouteComponent />
      </ErrorBoundary>
    </Shell>
  )
}
