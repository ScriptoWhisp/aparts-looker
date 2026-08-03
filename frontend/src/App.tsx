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
import { Overview } from './routes/Overview'
import { Inbox } from './routes/Inbox'
import { Shortlist } from './routes/Shortlist'
import { Settings } from './routes/Settings'
import { useAppStore } from './lib/state'

export function App() {
  const { activeTab, syncFromHash } = useAppStore()

  // Sync Zustand state when the user navigates with browser back/forward
  useEffect(() => {
    const handler = () => syncFromHash()
    window.addEventListener('hashchange', handler)
    return () => window.removeEventListener('hashchange', handler)
  }, [syncFromHash])

  // Render the active tab's route
  const RouteComponent = {
    overview:  Overview,
    inbox:     Inbox,
    shortlist: Shortlist,
    settings:  Settings,
  }[activeTab]

  return (
    <Shell>
      <RouteComponent />
    </Shell>
  )
}
