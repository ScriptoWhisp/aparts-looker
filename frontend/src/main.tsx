/**
 * React application entry point.
 *
 * TanStack Query wraps the App for server state management.
 * No Redux, no Context for state — Zustand handles UI state, TanStack Query handles server state.
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import 'leaflet/dist/leaflet.css'
import './index.css'
import { App } from './App'
import { init as initConsoleCapture } from './lib/consoleCapture'

// Must run before React renders so early console activity (React warnings,
// query errors during first load) is captured into the feedback ring buffer.
initConsoleCapture()

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      // Show stale data while refetching (no loading flash on background refresh)
      staleTime: 20_000,
    },
  },
})

const rootEl = document.getElementById('root')
if (!rootEl) {
  throw new Error('Root element #root not found in index.html')
}

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
