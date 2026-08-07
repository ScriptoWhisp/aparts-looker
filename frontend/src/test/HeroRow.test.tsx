/**
 * HeroRow.test.tsx
 *
 * Tests:
 * - renders with pending entry (no viewing_history, no own_score slider)
 * - renders with viewed entry (own_score slider shown)
 * - own_score slider fires debounced POST
 * - does NOT crash when entry.checklist is undefined
 * - does NOT crash when settings is undefined/malformed
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from './mocks/server'
import { renderWithProviders } from './renderWithProviders'
import { HeroRow } from '@/components/shortlist/HeroRow'
import {
  approvedEntry,
  viewingScheduledEntry,
  viewedEntry,
  mockSettingsFull,
  mockSettingsMalformed,
} from './mocks/fixtures'

// Mock framer-motion (AnimatePresence + motion.div)
vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement> & { children?: React.ReactNode }) => (
      <div {...props}>{children}</div>
    ),
  },
}))

describe('HeroRow — render shapes', () => {
  it('renders with an approved entry (no viewing_history, no own_score slider)', () => {
    const { container } = renderWithProviders(
      <HeroRow entry={approvedEntry} settings={mockSettingsFull} />,
    )
    expect(container.firstChild).toBeTruthy()
    // Title is rendered
    expect(screen.getByText(approvedEntry.title)).toBeInTheDocument()
    // OwnScoreSlider should NOT appear for approved status
    expect(screen.queryByText(/Your score/i)).toBeNull()
  })

  it('renders with a viewed entry — shows own_score slider', () => {
    renderWithProviders(
      <HeroRow entry={viewedEntry} settings={mockSettingsFull} />,
    )
    expect(screen.getByText(viewedEntry.title)).toBeInTheDocument()
    // OwnScoreSlider appears for viewed status
    expect(screen.getByText(/Your score/i)).toBeInTheDocument()
  })

  it('shows "Schedule viewing" button for approved status', () => {
    renderWithProviders(
      <HeroRow entry={approvedEntry} settings={mockSettingsFull} />,
    )
    expect(screen.getByText(/Schedule viewing/i)).toBeInTheDocument()
  })

  it('shows "Mark viewed" button for viewing_scheduled status', () => {
    renderWithProviders(
      <HeroRow entry={viewingScheduledEntry} settings={mockSettingsFull} />,
    )
    expect(screen.getByText(/Mark viewed/i)).toBeInTheDocument()
  })

  it('does NOT crash when entry.checklist is null', () => {
    const entryNoChecklist = { ...approvedEntry, checklist: null }
    expect(() =>
      renderWithProviders(
        <HeroRow entry={entryNoChecklist} settings={mockSettingsFull} />,
      ),
    ).not.toThrow()
  })

  it('does NOT crash when entry.checklist.renovation_items is undefined', () => {
    const entryNoItems = {
      ...approvedEntry,
      checklist: { groups: [] },  // no renovation_items field
    }
    expect(() =>
      renderWithProviders(
        <HeroRow entry={entryNoItems} settings={mockSettingsFull} />,
      ),
    ).not.toThrow()
  })

  it('does NOT crash when settings is undefined', () => {
    expect(() =>
      renderWithProviders(
        <HeroRow entry={approvedEntry} settings={undefined} />,
      ),
    ).not.toThrow()
  })

  it('does NOT crash when settings.fields is undefined (malformed contract)', () => {
    expect(() =>
      renderWithProviders(
        <HeroRow entry={approvedEntry} settings={mockSettingsMalformed} />,
      ),
    ).not.toThrow()
  })

  it('renders entry with null price_eur without crashing', () => {
    const noPriceEntry = { ...approvedEntry, price_eur: null }
    expect(() =>
      renderWithProviders(
        <HeroRow entry={noPriceEntry} settings={mockSettingsFull} />,
      ),
    ).not.toThrow()
  })
})

describe('HeroRow — own_score slider fires POST', () => {
  it('fires POST /api/entry/:id/cost-override when slider is changed (debounced)', async () => {
    let postBody: unknown = null
    server.use(
      http.post('/api/entry/:id/cost-override', async ({ request }) => {
        postBody = await request.json()
        return HttpResponse.json({ ok: true })
      }),
    )

    // viewedEntry has status=viewed so slider appears
    renderWithProviders(
      <HeroRow entry={viewedEntry} settings={mockSettingsFull} />,
    )

    // Find the range input (own score slider)
    const slider = screen.getByRole('slider')
    fireEvent.change(slider, { target: { value: '85' } })

    // Debounce is 800ms — wait for the POST
    await waitFor(
      () => {
        expect(postBody).toEqual({ own_score: 85 })
      },
      { timeout: 2000 },
    )
  })
})

describe('HeroRow — all-in cost display', () => {
  it('shows all-in cost when renovation_items are present', () => {
    // approvedEntry has renovation_items in checklist
    renderWithProviders(
      <HeroRow entry={approvedEntry} settings={mockSettingsFull} />,
    )
    // Should show the "+X work" sub-label (not "all-in unknown")
    expect(screen.queryByText(/all-in unknown/i)).toBeNull()
  })

  it('shows "all-in unknown" sub-label when no renovation_items', () => {
    const entryNoReno = { ...approvedEntry, checklist: null }
    renderWithProviders(
      <HeroRow entry={entryNoReno} settings={mockSettingsFull} />,
    )
    expect(screen.getByText(/all-in unknown/i)).toBeInTheDocument()
  })
})
