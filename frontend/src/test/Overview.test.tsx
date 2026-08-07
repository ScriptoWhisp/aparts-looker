/**
 * Overview.test.tsx — route smoke tests.
 *
 * Tests:
 * - Renders BEST hero when at least one approved entry
 * - Renders empty BEST state when no approved
 * - Renders "This week" stats
 * - Renders Next up list
 * - CalibrationPanel renders when ≥5 rated viewings
 * - CalibrationPanel is hidden when <5 rated viewings
 * - No crash with malformed settings (fields=undefined)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from './mocks/server'
import { renderWithProviders } from './renderWithProviders'
import { Overview } from '@/routes/Overview'
import {
  mockEmptyAppData,
  mockAppDataWithShortlisted,
  mockAppDataFull,
  mockSettingsFull,
  mockSettingsMalformed,
  viewedEntry,
} from './mocks/fixtures'
import { QUERY_KEYS } from '@/lib/queries'
import type { AppData } from '@/types/api'

// Mock Leaflet-dependent components (can't render in jsdom)
vi.mock('@/components/overview/ListingsMap', () => ({
  ListingsMap: () => <div data-testid="listings-map">Map</div>,
}))

// ── Render helper ──────────────────────────────────────────────────────────

function renderOverview(appData: AppData = mockAppDataFull, settingsData = mockSettingsFull) {
  return renderWithProviders(<Overview />, {
    queryCache: [
      { queryKey: QUERY_KEYS.appData, data: appData },
      { queryKey: QUERY_KEYS.settings, data: settingsData },
      { queryKey: QUERY_KEYS.isochrone, data: { type: 'FeatureCollection', features: [] } },
      { queryKey: QUERY_KEYS.districts, data: { districts: [] } },
    ],
  })
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Overview — BEST hero card', () => {
  it('renders "BEST TODAY" kicker when there are approved entries', () => {
    renderOverview(mockAppDataWithShortlisted)
    expect(screen.getByText(/BEST TODAY/i)).toBeInTheDocument()
  })

  it('renders "No shortlisted entries yet" when properties is empty', () => {
    renderOverview(mockEmptyAppData)
    // Text appears in both BEST hero and Next up empty states — use getAllByText
    const matches = screen.getAllByText(/No shortlisted entries yet/i)
    expect(matches.length).toBeGreaterThanOrEqual(1)
  })

  it('shows the title of the best entry', () => {
    renderOverview(mockAppDataWithShortlisted)
    // approvedEntry has score=88, the highest — it should be the BEST
    // Title may appear in both hero card and Next up list — use getAllByText
    const matches = screen.getAllByText('Top pick: sunny corner flat')
    expect(matches.length).toBeGreaterThanOrEqual(1)
  })
})

describe('Overview — This week stats', () => {
  it('renders "This week" section header', () => {
    renderOverview(mockAppDataFull)
    expect(screen.getByText(/This week/i)).toBeInTheDocument()
  })

  it('renders In Inbox / To view / Viewed labels', () => {
    renderOverview(mockAppDataFull)
    expect(screen.getByText(/In Inbox/i)).toBeInTheDocument()
    // "To view" and "Viewed" appear multiple times (stats + Next up list) — use getAllByText
    expect(screen.getAllByText(/To view/i).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(/Viewed/i).length).toBeGreaterThanOrEqual(1)
  })
})

describe('Overview — Next up list', () => {
  it('renders "Next up" section header when there are approved entries', () => {
    renderOverview(mockAppDataWithShortlisted)
    expect(screen.getByText(/Next up/i)).toBeInTheDocument()
  })

  it('shows entries in Next up list', () => {
    renderOverview(mockAppDataWithShortlisted)
    // The approved entry and viewing_scheduled entry should appear
    expect(screen.getByText('Viewing booked: Mustamäe gem')).toBeInTheDocument()
  })

  it('renders "No shortlisted entries yet" link in Next up when empty', () => {
    renderOverview(mockEmptyAppData)
    expect(screen.getByText(/Check Inbox/i)).toBeInTheDocument()
  })
})

describe('Overview — CalibrationPanel gating', () => {
  it('does NOT render CalibrationPanel with <5 rated viewings', () => {
    renderOverview(mockAppDataFull)
    // mockAppDataFull has viewedEntry with own_score=70 — only 1 rated viewing
    // CalibrationPanel requires ≥5 → should not appear
    expect(screen.queryByText(/Calibration/i)).toBeNull()
  })

  it('renders CalibrationPanel when ≥5 rated viewings', () => {
    // Create 5 entries each with own_score set
    const ratedEntries = Array.from({ length: 5 }, (_, i) => ({
      ...viewedEntry,
      id: `rated-${i}`,
      own_score: 60 + i,
      score: 70 + i,
    }))
    const dataWith5Rated: AppData = {
      ...mockAppDataFull,
      properties: ratedEntries,
    }
    renderOverview(dataWith5Rated)
    expect(screen.getByText(/Calibration/i)).toBeInTheDocument()
  })
})

describe('Overview — malformed settings regression', () => {
  it('renders without crash when settings.fields is undefined', () => {
    // This is the exact class of bug that hit production
    expect(() => renderOverview(mockAppDataFull, mockSettingsMalformed)).not.toThrow()
  })

  it('does not show "Route crash" fallback with malformed settings', () => {
    renderOverview(mockAppDataFull, mockSettingsMalformed)
    // ErrorBoundary text — should NOT appear
    expect(screen.queryByText(/Route crash/i)).toBeNull()
  })
})

describe('Overview — map component mounts', () => {
  it('renders the map container', () => {
    renderOverview(mockAppDataFull)
    expect(screen.getByTestId('listings-map')).toBeInTheDocument()
  })
})
