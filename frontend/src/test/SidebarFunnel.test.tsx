/**
 * SidebarFunnel.test.tsx
 *
 * Tests:
 * - renders 3 groups with correct counts
 * - Dropped section collapsed by default, click to expand
 * - does NOT crash when entries is empty
 * - does NOT crash when called with edge-case entry data
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SidebarFunnel } from '@/components/shortlist/SidebarFunnel'
import {
  approvedEntry,
  viewingScheduledEntry,
  viewedEntry,
  droppedEntry,
  pendingEntry1,
} from './mocks/fixtures'
import type { Entry } from '@/types/api'

// Framer Motion uses CSS animations that don't exist in jsdom.
// Mock AnimatePresence to render children immediately.
vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement> & { children?: React.ReactNode }) => (
      <div {...props}>{children}</div>
    ),
  },
}))

const noop = () => {}

describe('SidebarFunnel — group rendering', () => {
  it('renders 3 section headers (To view / Viewed / Dropped)', () => {
    render(
      <SidebarFunnel
        entries={[approvedEntry, viewingScheduledEntry, viewedEntry, droppedEntry]}
        selectedId={null}
        onSelect={noop}
      />,
    )
    // Use getAllByText for "Viewed" since the entry title also contains "Viewed:"
    expect(screen.getByText('To view')).toBeInTheDocument()
    // At least one element with exact text "Viewed" (the group header span)
    expect(screen.getAllByText('Viewed').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Dropped')).toBeInTheDocument()
  })

  it('shows correct count for each group', () => {
    render(
      <SidebarFunnel
        entries={[approvedEntry, viewingScheduledEntry, viewedEntry, droppedEntry]}
        selectedId={null}
        onSelect={noop}
      />,
    )
    // "To view" = approved + viewing_scheduled = 2
    // "Viewed" = viewed = 1
    // "Dropped" = dropped = 1
    // Count badges are the number text nodes inside each group header
    const counts = screen.getAllByText(/^\d+$/)
    const numberValues = counts.map((el) => Number(el.textContent))
    expect(numberValues).toContain(2)
    expect(numberValues).toContain(1)
  })

  it('shows "Nothing shortlisted yet" when entries array is empty', () => {
    render(
      <SidebarFunnel
        entries={[]}
        selectedId={null}
        onSelect={noop}
      />,
    )
    expect(screen.getByText(/Nothing shortlisted yet/i)).toBeInTheDocument()
  })

  it('Dropped section is collapsed by default', () => {
    render(
      <SidebarFunnel
        entries={[droppedEntry]}
        selectedId={null}
        onSelect={noop}
      />,
    )
    // The dropped group header should be present
    expect(screen.getByText(/Dropped/i)).toBeInTheDocument()
    // The entry title should NOT be visible (section collapsed)
    expect(screen.queryByText(droppedEntry.title)).toBeNull()
  })

  it('clicking Dropped header expands it to show entries', () => {
    render(
      <SidebarFunnel
        entries={[droppedEntry]}
        selectedId={null}
        onSelect={noop}
      />,
    )
    const droppedHeader = screen.getByText(/Dropped/i).closest('button')!
    fireEvent.click(droppedHeader)
    // After click, dropped entry should be visible
    expect(screen.getByText(droppedEntry.title)).toBeInTheDocument()
  })

  it('does not crash when entries contain pending status (filtered to 0 groups)', () => {
    // pendingEntry has status 'pending' which is not in any of the 3 frozensets
    expect(() =>
      render(
        <SidebarFunnel
          entries={[pendingEntry1]}
          selectedId={null}
          onSelect={noop}
        />,
      ),
    ).not.toThrow()
  })

  it('filter input narrows visible entries', () => {
    render(
      <SidebarFunnel
        entries={[approvedEntry, viewingScheduledEntry]}
        selectedId={null}
        onSelect={noop}
      />,
    )
    const input = screen.getByPlaceholderText(/Filter listings/i)
    fireEvent.change(input, { target: { value: 'sunny corner' } })
    // approvedEntry.title contains "sunny corner" — should still be visible
    expect(screen.getByText(approvedEntry.title)).toBeInTheDocument()
    // viewingScheduledEntry should show "No matches" or not be visible
    expect(screen.queryByText(viewingScheduledEntry.title)).toBeNull()
  })

  it('calls onSelect when a listing row is clicked', () => {
    const onSelect = vi.fn()
    // Expand "To view" group (it's open by default) and click an entry
    render(
      <SidebarFunnel
        entries={[approvedEntry]}
        selectedId={null}
        onSelect={onSelect}
      />,
    )
    // approvedEntry is in "To view" (status=approved) which is open by default
    const entryRow = screen.getByText(approvedEntry.title)
    fireEvent.click(entryRow)
    expect(onSelect).toHaveBeenCalledWith(approvedEntry.id)
  })
})

describe('SidebarFunnel — does not crash with undefined/malformed data', () => {
  it('does not crash when entries array has entries with null fields', () => {
    const sparseEntry: Entry = {
      id: 'sparse',
      url: 'https://kv.ee/sparse',
      status: 'approved',
      score: null,
      title: 'Sparse entry',
      price_eur: null,
      area_sqm: null,
      rooms: null,
      floor: null,
      floors_total: null,
      year_built: null,
      district: null,
      address: null,
      image_url: null,
      verdict: null,
      rejection_reason: null,
      scheduled_at: null,
      shortlisted_at: null,
      approved_at: null,
      created_at: null,
      viewing_history: [],
      cost_of_ownership: null,
      own_score: null,
      checklist: null,
      ai_checklist_fills: null,
      negotiation_brief: null,
      negotiation_brief_generated_at: null,
      energy_class: null,
      material: null,
      dropped_at: null,
      drop_reason: null,
      lat: null,
      lng: null,
      price_per_sqm: null,
      commute_minutes: null,
    }
    expect(() =>
      render(
        <SidebarFunnel entries={[sparseEntry]} selectedId={null} onSelect={noop} />,
      ),
    ).not.toThrow()
  })
})
