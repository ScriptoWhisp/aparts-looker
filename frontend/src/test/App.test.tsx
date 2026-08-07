/**
 * App.test.tsx — route mount regression net.
 *
 * Tests:
 * - Hash routing backward-compat (#pending → inbox, #detail → shortlist, etc.)
 * - Each tab renders without runtime crash under empty/full/malformed data
 * - ErrorBoundary catches a throwing component and shows the fallback UI
 *
 * Strategy: mock all leaf components that require browser APIs (Leaflet, maps)
 * so the test focuses on routing + data flow, not component-level rendering.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from './mocks/server'
import { renderWithProviders } from './renderWithProviders'
import { App } from '@/App'
import { useAppStore } from '@/lib/state'
import { ErrorBoundary } from '@/components/layout/ErrorBoundary'
import {
  mockEmptyAppData,
  mockAppDataFull,
  mockSettingsFull,
  mockSettingsMalformed,
} from './mocks/fixtures'
import { QUERY_KEYS } from '@/lib/queries'
import type { TabId } from '@/lib/state'

// ── Mock all leaf components that use browser-only APIs ────────────────────

vi.mock('@/components/overview/ListingsMap', () => ({
  ListingsMap: () => <div data-testid="listings-map">Map</div>,
}))

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="map-container">{children}</div>
  ),
  TileLayer: () => null,
  useMap: () => ({ addLayer: vi.fn(), removeLayer: vi.fn() }),
  useMapEvents: () => null,
}))

vi.mock('framer-motion', () => {
  const noop = () => ({ get: () => 0, set: vi.fn(), onChange: vi.fn(), destroy: vi.fn() })
  return {
    AnimatePresence: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    motion: {
      div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement> & { children?: React.ReactNode; style?: React.CSSProperties }) => (
        <div {...props}>{children}</div>
      ),
    },
    useTransform: () => noop(),
    useMotionValue: () => noop(),
    useAnimation: () => ({ start: vi.fn() }),
    useSpring: () => noop(),
    useVelocity: () => noop(),
    animate: vi.fn(),
  }
})

// ── Helper: set active tab and render App ─────────────────────────────────

function renderApp(tab: TabId, queryData?: { appData?: unknown; settings?: unknown }) {
  window.location.hash = `#${tab}`
  useAppStore.getState().syncFromHash()

  return renderWithProviders(<App />, {
    queryCache: [
      { queryKey: QUERY_KEYS.appData, data: queryData?.appData ?? mockAppDataFull },
      { queryKey: QUERY_KEYS.settings, data: queryData?.settings ?? mockSettingsFull },
      { queryKey: QUERY_KEYS.isochrone, data: { type: 'FeatureCollection', features: [] } },
      { queryKey: QUERY_KEYS.districts, data: { districts: [] } },
    ],
  })
}

// ── Hash routing backward compat ───────────────────────────────────────────

describe('App — hash routing backward compat', () => {
  it('#pending maps to inbox tab', () => {
    window.location.hash = '#pending'
    useAppStore.getState().syncFromHash()
    expect(useAppStore.getState().activeTab).toBe('inbox')
  })

  it('#detail maps to shortlist tab', () => {
    window.location.hash = '#detail'
    useAppStore.getState().syncFromHash()
    expect(useAppStore.getState().activeTab).toBe('shortlist')
  })

  it('#compare maps to overview tab', () => {
    window.location.hash = '#compare'
    useAppStore.getState().syncFromHash()
    expect(useAppStore.getState().activeTab).toBe('overview')
  })

  it('#rejected maps to shortlist tab', () => {
    window.location.hash = '#rejected'
    useAppStore.getState().syncFromHash()
    expect(useAppStore.getState().activeTab).toBe('shortlist')
  })

  it('#overview maps to overview tab', () => {
    window.location.hash = '#overview'
    useAppStore.getState().syncFromHash()
    expect(useAppStore.getState().activeTab).toBe('overview')
  })

  it('unknown hash maps to overview (default)', () => {
    window.location.hash = '#nonexistent'
    useAppStore.getState().syncFromHash()
    expect(useAppStore.getState().activeTab).toBe('overview')
  })
})

// ── Tab render under empty data ────────────────────────────────────────────

describe('App — tabs render without crash under empty data', () => {
  it('overview tab mounts without throwing', () => {
    expect(() => renderApp('overview', { appData: mockEmptyAppData })).not.toThrow()
  })

  it('inbox tab mounts without throwing', () => {
    expect(() => renderApp('inbox', { appData: mockEmptyAppData })).not.toThrow()
  })

  it('shortlist tab mounts without throwing', () => {
    expect(() => renderApp('shortlist', { appData: mockEmptyAppData })).not.toThrow()
  })

  it('settings tab mounts without throwing', () => {
    expect(() => renderApp('settings', { appData: mockEmptyAppData })).not.toThrow()
  })
})

// ── Tab render under full data ─────────────────────────────────────────────

describe('App — tabs render without crash under full data', () => {
  it('overview tab mounts with full data without throwing', () => {
    expect(() => renderApp('overview')).not.toThrow()
  })

  it('inbox tab mounts with full data without throwing', () => {
    expect(() => renderApp('inbox')).not.toThrow()
  })

  it('shortlist tab mounts with full data without throwing', () => {
    expect(() => renderApp('shortlist')).not.toThrow()
  })

  it('settings tab mounts with full data without throwing', () => {
    expect(() => renderApp('settings')).not.toThrow()
  })
})

// ── Tab render under malformed settings ───────────────────────────────────

describe('App — tabs render without crash under malformed settings', () => {
  it('overview tab does not crash when settings.fields is undefined', () => {
    expect(() =>
      renderApp('overview', { settings: mockSettingsMalformed }),
    ).not.toThrow()
    // ErrorBoundary should NOT fire
    expect(screen.queryByText(/Route crash/i)).toBeNull()
  })

  it('shortlist tab does not crash when settings.fields is undefined', () => {
    expect(() =>
      renderApp('shortlist', { settings: mockSettingsMalformed }),
    ).not.toThrow()
    expect(screen.queryByText(/Route crash/i)).toBeNull()
  })

  it('settings tab does not crash when settings.fields is undefined', () => {
    expect(() =>
      renderApp('settings', { settings: mockSettingsMalformed }),
    ).not.toThrow()
    expect(screen.queryByText(/Route crash/i)).toBeNull()
  })
})

// ── ErrorBoundary integration test ─────────────────────────────────────────

describe('App — ErrorBoundary catches a throwing route', () => {
  it('shows Route crash fallback when a child component throws', () => {
    // Suppress console.error for the expected throw
    const originalError = console.error
    console.error = vi.fn()

    function Bomb() {
      throw new Error('Intentional test crash')
    }

    renderWithProviders(
      <ErrorBoundary label="TestTab">
        <Bomb />
      </ErrorBoundary>,
    )

    // "Route crash" appears in both the badge span and header — use getAllByText
    expect(screen.getAllByText(/Route crash/i).length).toBeGreaterThanOrEqual(1)
    // "Intentional test crash" appears in error message + stack trace sections
    expect(screen.getAllByText(/Intentional test crash/i).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(/Retry/i)).toBeInTheDocument()

    console.error = originalError
  })
})
