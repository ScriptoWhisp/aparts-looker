/**
 * ChecklistCard.test.tsx — Wave A section-based checklist rewrite.
 *
 * The registry (13-item representative slice of backend/checklist_registry.py's
 * ~96 items — see mockChecklistRegistry in mocks/fixtures.ts) is served from
 * GET /api/checklist-registry via MSW, exactly as production fetches it.
 *
 * Tests:
 * - Renders all 4 sections + bottom summary reflecting the fetched registry.
 * - Expanding sections/onsite sub-groups reveals every item chip.
 * - user_marks overrides the AI-derived state (merge precedence) — including
 *   via the frontend legacy-key fallback (s09_01/s14_xx/s16_xx -> new key).
 * - Flag-containing sections/sub-groups open by default; others start closed.
 * - State chip cycle: unknown -> ok -> flag -> skip -> unknown, PATCHing each step.
 * - Note textarea debounces and PATCHes.
 * - Filter chips (All/To do/OK/Flagged) narrow visible items and force-expand
 *   only the sections/sub-groups that contain a match.
 * - Does not crash on null/empty checklist shapes.
 */

import { describe, it, expect } from 'vitest'
import { screen, fireEvent, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from './mocks/server'
import { renderWithProviders } from './renderWithProviders'
import { ChecklistCard } from '@/components/shortlist/ChecklistCard'
import { approvedEntry, mockChecklistRegistry } from './mocks/fixtures'
import type { Entry } from '@/types/api'

// Mock framer-motion (AnimatePresence + motion.div) — jsdom cannot run the
// real height animation.
vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement> & { children?: React.ReactNode }) => (
      <div {...props}>{children}</div>
    ),
  },
}))

function makeBareEntry(overrides: Partial<Entry> = {}): Entry {
  return { ...approvedEntry, checklist: null, ai_checklist_fills: null, ...overrides }
}

const SECTION_IDS = ['evaluation', 'ask_seller', 'request_docs', 'onsite']
const ONSITE_GROUP_IDS = ['first_impression', 'structure', 'neighborhood']
const ALL_KEYS = mockChecklistRegistry.sections.flatMap((s) =>
  s.groups.flatMap((g) => g.items.map((i) => i.key)),
)

/** Expand every currently-closed section header (skips already-open ones so
 * a flag-driven open-by-default section isn't toggled shut). */
async function expandAllSections() {
  for (const id of SECTION_IDS) {
    const header = await screen.findByTestId(`checklist-section-header-${id}`)
    if (header.getAttribute('aria-expanded') === 'false') fireEvent.click(header)
  }
}

/** Expand every onsite sub-group (assumes the onsite section is already open). */
function expandAllOnsiteGroups() {
  for (const id of ONSITE_GROUP_IDS) {
    const header = screen.queryByTestId(`checklist-group-header-${id}`)
    if (header && header.getAttribute('aria-expanded') === 'false') fireEvent.click(header)
  }
}

async function expandEverything() {
  await expandAllSections()
  expandAllOnsiteGroups()
}

describe('ChecklistCard — fetches and renders the full registry', () => {
  it('shows a loading state before the registry resolves, then renders sections', async () => {
    renderWithProviders(<ChecklistCard entry={makeBareEntry()} />)
    expect(screen.getByText('Loading checklist…')).toBeInTheDocument()
    await screen.findByTestId('checklist-section-header-evaluation')
  })

  it('renders all 4 section headers with their Russian labels', async () => {
    renderWithProviders(<ChecklistCard entry={makeBareEntry()} />)
    await screen.findByTestId('checklist-section-header-evaluation')
    expect(screen.getByText('Оценка по критериям')).toBeInTheDocument()
    expect(screen.getByText('Вопросы продавцу')).toBeInTheDocument()
    expect(screen.getByText('Документы к запросу')).toBeInTheDocument()
    expect(screen.getByText('На месте')).toBeInTheDocument()
  })

  it('bottom summary counts every registry item, 0 marked for a bare entry', async () => {
    renderWithProviders(<ChecklistCard entry={makeBareEntry()} />)
    await screen.findByTestId('checklist-section-header-evaluation')
    expect(screen.getByText(`${ALL_KEYS.length} items · 0 marked`)).toBeInTheDocument()
  })

  it('renders every registry item chip once everything is expanded', async () => {
    renderWithProviders(<ChecklistCard entry={makeBareEntry()} />)
    await expandEverything()
    for (const key of ALL_KEYS) {
      expect(screen.getByTestId(`checklist-chip-${key}`)).toBeInTheDocument()
    }
  })

  it('every item defaults to state=unknown with no AI fill and no user mark', async () => {
    renderWithProviders(<ChecklistCard entry={makeBareEntry()} />)
    await expandEverything()
    for (const key of ALL_KEYS) {
      expect(screen.getByTestId(`checklist-chip-${key}`)).toHaveAttribute('data-state', 'unknown')
    }
  })

  it('onsite items are hidden until both the section and its sub-group are expanded', async () => {
    renderWithProviders(<ChecklistCard entry={makeBareEntry()} />)
    await screen.findByTestId('checklist-section-header-evaluation')
    expect(screen.queryByTestId('checklist-chip-sec5_2_corners')).toBeNull()

    fireEvent.click(screen.getByTestId('checklist-section-header-onsite'))
    // Section open, but the 'structure' sub-group is still collapsed.
    expect(screen.queryByTestId('checklist-chip-sec5_2_corners')).toBeNull()

    fireEvent.click(screen.getByTestId('checklist-group-header-structure'))
    expect(screen.getByTestId('checklist-chip-sec5_2_corners')).toBeInTheDocument()
  })
})

describe('ChecklistCard — merge precedence + legacy-key fallback', () => {
  it('a user_marks state overrides the AI-derived state (via legacy key s09_01 -> sec3_renovation_history)', async () => {
    // approvedEntry: s14_01/s14_02 AI-filled (-> sec2_address/sec2_price = ok),
    // s09_01 user-flagged (-> sec3_renovation_history = flag, legacy fallback).
    renderWithProviders(<ChecklistCard entry={approvedEntry} />)
    await expandEverything()
    expect(screen.getByTestId('checklist-chip-sec3_renovation_history')).toHaveAttribute('data-state', 'flag')
    expect(screen.getByTestId('checklist-chip-sec2_address')).toHaveAttribute('data-state', 'ok')
    expect(screen.getByTestId('checklist-chip-sec2_price')).toHaveAttribute('data-state', 'ok')
  })

  it('a legacy ai_checklist_fills key (s16_01) resolves onto its new-registry key (sec5_5_transit)', async () => {
    const entry = makeBareEntry({
      id: 'legacy-ai-fill',
      ai_checklist_fills: { s16_01: '5 минут пешком до остановки' },
    })
    renderWithProviders(<ChecklistCard entry={entry} />)
    await expandEverything()
    const chip = screen.getByTestId('checklist-chip-sec5_5_transit')
    expect(chip).toHaveAttribute('data-state', 'ok')
    expect(screen.getByText('5 минут пешком до остановки')).toBeInTheDocument()
  })

  it('section containing a flag opens by default; a section with no flag/mark starts collapsed', async () => {
    renderWithProviders(<ChecklistCard entry={approvedEntry} />)
    // ask_seller has the flagged item (sec3_renovation_history) -> open by default.
    await waitFor(() => {
      expect(screen.getByText('Что ремонтировалось и когда?')).toBeInTheDocument()
    })
    // evaluation has no flag/mark on approvedEntry's un-migrated view... it DOES
    // have 2 'ok' fills though, which don't force-open — still collapsed.
    expect(screen.queryByText('Тип отопления')).toBeNull()
  })

  it('header counts reflect the merged state, not the raw fill count (3/13 marked)', async () => {
    renderWithProviders(<ChecklistCard entry={approvedEntry} />)
    const cardHeader = await screen.findByText('Checklist')
    await waitFor(() => {
      expect(within(cardHeader.closest('div')!).getByText(`3/${ALL_KEYS.length} marked`)).toBeInTheDocument()
    })
  })
})

describe('ChecklistCard — state chip cycling + persistence', () => {
  it('clicking a state chip cycles unknown -> ok -> flag -> skip -> unknown', async () => {
    renderWithProviders(<ChecklistCard entry={makeBareEntry()} />)
    await expandEverything()
    const chip = screen.getByTestId(`checklist-chip-${ALL_KEYS[0]}`)
    expect(chip).toHaveAttribute('data-state', 'unknown')

    fireEvent.click(chip)
    await waitFor(() => expect(chip).toHaveAttribute('data-state', 'ok'))

    fireEvent.click(chip)
    await waitFor(() => expect(chip).toHaveAttribute('data-state', 'flag'))

    fireEvent.click(chip)
    await waitFor(() => expect(chip).toHaveAttribute('data-state', 'skip'))

    fireEvent.click(chip)
    await waitFor(() => expect(chip).toHaveAttribute('data-state', 'unknown'))
  })

  it('PATCH /api/entry/:id/checklist-item fires with the clicked key + state', async () => {
    let patchBody: unknown = null
    let patchUrl = ''
    server.use(
      http.patch('/api/entry/:id/checklist-item', async ({ request, params }) => {
        patchBody = await request.json()
        patchUrl = String(params.id)
        return HttpResponse.json({ ok: true, user_marks: {} })
      }),
    )

    const key = ALL_KEYS[0]
    renderWithProviders(<ChecklistCard entry={makeBareEntry({ id: 'chip-patch-test' })} />)
    await expandEverything()
    fireEvent.click(screen.getByTestId(`checklist-chip-${key}`))

    await waitFor(() => {
      expect(patchUrl).toBe('chip-patch-test')
      expect(patchBody).toEqual({ key, state: 'ok' })
    })
  })
})

describe('ChecklistCard — note field', () => {
  it('typing in a note textarea debounces and PATCHes with the note text', async () => {
    let patchBody: unknown = null
    server.use(
      http.patch('/api/entry/:id/checklist-item', async ({ request }) => {
        patchBody = await request.json()
        return HttpResponse.json({ ok: true, user_marks: {} })
      }),
    )

    const key = ALL_KEYS[0]
    renderWithProviders(<ChecklistCard entry={makeBareEntry({ id: 'note-patch-test' })} />)
    await expandEverything()

    fireEvent.click(screen.getByTestId(`checklist-note-toggle-${key}`))
    const textarea = screen.getByTestId(`checklist-note-textarea-${key}`)
    fireEvent.change(textarea, { target: { value: 'Asked agent, waiting on reply' } })

    await waitFor(
      () => {
        expect(patchBody).toEqual({ key, note: 'Asked agent, waiting on reply' })
      },
      { timeout: 2000 },
    )
  })

  it('an existing user note renders the textarea open by default', async () => {
    const entry = makeBareEntry({
      id: 'existing-note-test',
      checklist: { user_marks: { [ALL_KEYS[0]]: { note: 'Already checked' } } },
    })
    renderWithProviders(<ChecklistCard entry={entry} />)
    await expandEverything()
    expect(screen.getByTestId(`checklist-note-textarea-${ALL_KEYS[0]}`)).toHaveValue('Already checked')
  })
})

describe('ChecklistCard — filter chips', () => {
  it('Flagged filter shows only the flagged item and force-expands its section', async () => {
    renderWithProviders(<ChecklistCard entry={approvedEntry} />)
    await screen.findByTestId('checklist-section-header-evaluation')

    fireEvent.click(screen.getByTestId('checklist-filter-flagged'))

    await waitFor(() => {
      expect(screen.getByTestId('checklist-chip-sec3_renovation_history')).toBeInTheDocument()
    })
    // evaluation's 'ok' items should not render under the Flagged filter.
    expect(screen.queryByTestId('checklist-chip-sec2_address')).toBeNull()
    // request_docs has no flagged items -> its section should not render at all.
    expect(screen.queryByTestId('checklist-section-header-request_docs')).toBeNull()
  })

  it('OK filter shows only ok-state items', async () => {
    renderWithProviders(<ChecklistCard entry={approvedEntry} />)
    await screen.findByTestId('checklist-section-header-evaluation')

    fireEvent.click(screen.getByTestId('checklist-filter-ok'))

    await waitFor(() => {
      expect(screen.getByTestId('checklist-chip-sec2_address')).toBeInTheDocument()
      expect(screen.getByTestId('checklist-chip-sec2_price')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('checklist-chip-sec3_renovation_history')).toBeNull()
  })

  it('To do filter shows only unknown-state items (everything, for a bare entry)', async () => {
    renderWithProviders(<ChecklistCard entry={makeBareEntry()} />)
    await screen.findByTestId('checklist-section-header-evaluation')

    fireEvent.click(screen.getByTestId('checklist-filter-todo'))
    await expandEverything()

    for (const key of ALL_KEYS) {
      expect(screen.getByTestId(`checklist-chip-${key}`)).toBeInTheDocument()
    }
  })

  it('switching back to All restores the full, unfiltered view', async () => {
    renderWithProviders(<ChecklistCard entry={approvedEntry} />)
    await screen.findByTestId('checklist-section-header-evaluation')

    fireEvent.click(screen.getByTestId('checklist-filter-flagged'))
    await waitFor(() => {
      expect(screen.queryByTestId('checklist-section-header-request_docs')).toBeNull()
    })

    fireEvent.click(screen.getByTestId('checklist-filter-all'))
    await waitFor(() => {
      expect(screen.getByTestId('checklist-section-header-request_docs')).toBeInTheDocument()
    })
  })
})

describe('ChecklistCard — does not crash on edge cases', () => {
  it('does not crash when entry.checklist is null', async () => {
    renderWithProviders(<ChecklistCard entry={makeBareEntry()} />)
    await screen.findByTestId('checklist-section-header-evaluation')
  })

  it('does not crash when checklist.user_marks is an empty object', async () => {
    const entry = makeBareEntry({ checklist: {} })
    renderWithProviders(<ChecklistCard entry={entry} />)
    await screen.findByTestId('checklist-section-header-evaluation')
  })

  it('drops empty-string ai_checklist_fills values back to unknown, not a blank ok item', async () => {
    const entry = makeBareEntry({ ai_checklist_fills: { [ALL_KEYS[0]]: '' } })
    renderWithProviders(<ChecklistCard entry={entry} />)
    await expandEverything()
    expect(screen.getByTestId(`checklist-chip-${ALL_KEYS[0]}`)).toHaveAttribute('data-state', 'unknown')
  })
})
