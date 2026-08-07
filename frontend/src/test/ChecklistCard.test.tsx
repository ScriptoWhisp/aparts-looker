/**
 * ChecklistCard.test.tsx
 *
 * Tests:
 * - renders with entry.checklist.groups shape
 * - renders with ai_checklist_fills fallback shape (old entries)
 * - renders with empty checklist (0 items)
 * - flagged group open by default; non-flagged group closed
 * - toggle opens a closed group
 * - item counts show in header (flags / unknown / ok)
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ChecklistCard } from '@/components/shortlist/ChecklistCard'
import { approvedEntry } from './mocks/fixtures'
import type { Entry, ChecklistData } from '@/types/api'

// Mock framer-motion
vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement> & { children?: React.ReactNode }) => (
      <div {...props}>{children}</div>
    ),
  },
}))

// ── Helpers ────────────────────────────────────────────────────────────────

function makeEntry(checklistOverride: ChecklistData | null, fillsOverride?: Record<string, unknown> | null): Entry {
  return {
    ...approvedEntry,
    checklist: checklistOverride,
    ai_checklist_fills: fillsOverride ?? null,
  }
}

describe('ChecklistCard — checklist.groups shape', () => {
  it('renders checklist header "Checklist"', () => {
    render(<ChecklistCard entry={approvedEntry} />)
    expect(screen.getByText('Checklist')).toBeInTheDocument()
  })

  it('renders group labels from checklist.groups', () => {
    render(<ChecklistCard entry={approvedEntry} />)
    // approvedEntry has groups: building_fund + risk
    expect(screen.getByText('Building fund')).toBeInTheDocument()
    expect(screen.getByText('Risk')).toBeInTheDocument()
  })

  it('flag group is open by default (risk has a flag item)', () => {
    render(<ChecklistCard entry={approvedEntry} />)
    // Risk group has 1 flag item — should be open, showing the item label
    expect(screen.getByText('No moisture damage')).toBeInTheDocument()
  })

  it('non-flag group is closed by default (building_fund has no flags)', () => {
    render(<ChecklistCard entry={approvedEntry} />)
    // building_fund has ok + unknown items, no flags → closed
    // "Fund exists" item should NOT be visible initially
    expect(screen.queryByText('Fund exists')).toBeNull()
  })

  it('clicking closed group header opens it', () => {
    render(<ChecklistCard entry={approvedEntry} />)
    // building_fund is closed initially — find its header and click
    const buildingFundHeader = screen.getByText('Building fund').closest('button')!
    fireEvent.click(buildingFundHeader)
    // Now the items should be visible
    expect(screen.getByText('Fund exists')).toBeInTheDocument()
  })

  it('shows flag count in header when flags exist', () => {
    render(<ChecklistCard entry={approvedEntry} />)
    // The global header shows "1 flag" — may appear multiple places (header + group header)
    // Use getAllByText to allow for multiple matches
    const flagTexts = screen.getAllByText(/1 flag/i)
    expect(flagTexts.length).toBeGreaterThanOrEqual(1)
  })

  it('shows item count at bottom when items exist', () => {
    render(<ChecklistCard entry={approvedEntry} />)
    // approvedEntry has 2+1 = 3 total items
    expect(screen.getByText(/3 items/i)).toBeInTheDocument()
  })
})

describe('ChecklistCard — empty checklist', () => {
  it('shows "No checklist data yet" when groups is empty and no fills', () => {
    const entry = makeEntry(null, null)
    render(<ChecklistCard entry={entry} />)
    expect(screen.getByText(/No checklist data yet/i)).toBeInTheDocument()
  })

  it('shows "No checklist data yet" when checklist.groups is empty array', () => {
    const entry = makeEntry({ groups: [] }, null)
    render(<ChecklistCard entry={entry} />)
    expect(screen.getByText(/No checklist data yet/i)).toBeInTheDocument()
  })
})

describe('ChecklistCard — ai_checklist_fills fallback', () => {
  it('renders synthetic groups from ai_checklist_fills when checklist.groups absent', () => {
    const fills: Record<string, unknown> = {
      'risk_moisture':  { state: 'flag',    label: 'Moisture risk',  pts: -10, note: null },
      'quality_finish': { state: 'ok',      label: 'Good finish',    pts: 0,   note: null },
      'finance_loan':   { state: 'unknown', label: 'Loan status',    pts: 0,   note: null },
    }
    const entry = makeEntry(null, fills)
    render(<ChecklistCard entry={entry} />)
    // Should NOT show "No checklist data" since fills exist
    expect(screen.queryByText(/No checklist data yet/i)).toBeNull()
    // The component builds groups from key prefixes; at least one group should render
    const header = screen.getByText('Checklist')
    expect(header).toBeInTheDocument()
  })
})

describe('ChecklistCard — does not crash with edge cases', () => {
  it('does not crash when entry.checklist is null', () => {
    expect(() => render(<ChecklistCard entry={makeEntry(null)} />)).not.toThrow()
  })

  it('does not crash when entry.checklist has no groups property', () => {
    // checklist object exists but no groups key — only renovation_items
    const entry = makeEntry(
      { renovation_items: [{ key: 'kitchen_full', applies: true, confidence: 2, qty: null, note: null }] },
      null,
    )
    expect(() => render(<ChecklistCard entry={entry} />)).not.toThrow()
  })

  it('does not crash when a group has zero items', () => {
    const entry = makeEntry({
      groups: [
        { key: 'building_fund', label: 'Building fund', label_et: 'Remondifond', items: [] },
      ],
    })
    expect(() => render(<ChecklistCard entry={entry} />)).not.toThrow()
  })

  it('renders correctly with items that have null notes', () => {
    const entry = makeEntry({
      groups: [{
        key: 'risk',
        label: 'Risk',
        label_et: 'Riskid',
        items: [
          { key: 'risk_a', label: 'Risk A', state: 'flag', pts: -5, note: null },
          { key: 'risk_b', label: 'Risk B', state: 'ok',   pts: 0,  note: null },
        ],
      }],
    })
    expect(() => render(<ChecklistCard entry={entry} />)).not.toThrow()
    expect(screen.getByText('Risk A')).toBeInTheDocument()
  })
})
