/**
 * ChecklistCard.test.tsx — Wave 10 interactive checklist rewrite.
 *
 * Tests:
 * - Renders ALL 13 registry items once their groups are expanded (not just the
 *   ones ai_checklist_fills happened to fill in) — the reported bug.
 * - user_marks in entry override the AI-derived state (merge precedence).
 * - Clicking a state chip cycles ok -> flag -> unknown -> skip -> back to AI default.
 * - PATCH fires with the expected body when a state chip is clicked.
 * - Typing in a note textarea debounces and PATCHes.
 * - Group counts + signal strip reflect the merged (not raw AI) state.
 *
 * Group open/closed defaults still apply (open iff a flag or any user_mark is
 * present in that group) — tests that need a closed group's items expand it
 * first via its header button, same as a real user would.
 */

import { describe, it, expect, vi } from 'vitest'
import { screen, fireEvent, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from './mocks/server'
import { renderWithProviders } from './renderWithProviders'
import { ChecklistCard } from '@/components/shortlist/ChecklistCard'
import { approvedEntry } from './mocks/fixtures'
import { CHECKLIST_ALL_KEYS } from '@/lib/checklistMeta'
import type { Entry } from '@/types/api'

// Mock framer-motion (AnimatePresence + motion.div) — same pattern as other
// shortlist component tests; jsdom cannot run the real height animation.
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

const GROUP_KEYS = ['building_fund', 'risk', 'finance', 'quality', 'location']

/** Expand every rendered, currently-closed group header (skips already-open
 * groups so a flag/mark-driven open-by-default group isn't toggled shut). */
function expandAllGroups() {
  for (const key of GROUP_KEYS) {
    const header = screen.queryByTestId(`checklist-group-header-${key}`)
    if (header && header.getAttribute('aria-expanded') === 'false') fireEvent.click(header)
  }
}

describe('ChecklistCard — always renders the full registry', () => {
  it('bottom summary counts all 13 registry items regardless of group open state', () => {
    renderWithProviders(<ChecklistCard entry={makeBareEntry()} />)
    const summary = screen.getByText((_, el) => el?.tagName === 'P' && el.textContent === '13 items · 13 unmarked')
    expect(summary).toBeInTheDocument()
  })

  it('renders all 13 registry item chips once every group is expanded', () => {
    renderWithProviders(<ChecklistCard entry={makeBareEntry()} />)
    expandAllGroups()
    for (const key of CHECKLIST_ALL_KEYS) {
      expect(screen.getByTestId(`checklist-chip-${key}`)).toBeInTheDocument()
    }
  })

  it('every item defaults to state=unknown with no AI fill and no user mark', () => {
    renderWithProviders(<ChecklistCard entry={makeBareEntry()} />)
    expandAllGroups()
    for (const key of CHECKLIST_ALL_KEYS) {
      expect(screen.getByTestId(`checklist-chip-${key}`)).toHaveAttribute('data-state', 'unknown')
    }
  })
})

describe('ChecklistCard — merge precedence (user_marks overrides AI state)', () => {
  it('a user_marks state overrides the AI-derived state', () => {
    // approvedEntry: s14_01/s14_02 AI-filled (-> ok), s09_01 user-flagged (risk auto-opens).
    renderWithProviders(<ChecklistCard entry={approvedEntry} />)
    expandAllGroups()
    expect(screen.getByTestId('checklist-chip-s09_01')).toHaveAttribute('data-state', 'flag')
    expect(screen.getByTestId('checklist-chip-s14_01')).toHaveAttribute('data-state', 'ok')
  })

  it('flag group (Risk) is open by default; a group with no flag/mark starts collapsed', () => {
    renderWithProviders(<ChecklistCard entry={approvedEntry} />)
    // s09_01 (risk group, flagged) label should already be visible without a click.
    expect(screen.getByText('Plumbing / electrical replacement year')).toBeInTheDocument()
    // s16_01 (location group — no flag, no mark) should not be visible until expanded.
    expect(screen.queryByText('Distance to public transit')).toBeNull()
  })

  it('header counts reflect the merged state, not the raw fill count', () => {
    renderWithProviders(<ChecklistCard entry={approvedEntry} />)
    // 2 ok (AI fills) + 1 flag (user mark) + 10 unknown = 13 total.
    const cardHeader = screen.getByText('Checklist').closest('div')!
    expect(within(cardHeader).getByText(/^1 flag/)).toBeInTheDocument()
    expect(within(cardHeader).getByText(/^10 unknown/)).toBeInTheDocument()
    expect(within(cardHeader).getByText(/^2 ok/)).toBeInTheDocument()
  })
})

describe('ChecklistCard — state chip cycling + persistence', () => {
  it('clicking a state chip cycles ok -> flag -> unknown -> skip -> AI default', async () => {
    renderWithProviders(<ChecklistCard entry={makeBareEntry()} />)
    expandAllGroups()
    const chip = screen.getByTestId(`checklist-chip-${CHECKLIST_ALL_KEYS[0]}`)
    expect(chip).toHaveAttribute('data-state', 'unknown') // AI default (no fill)

    fireEvent.click(chip)
    await waitFor(() => expect(chip).toHaveAttribute('data-state', 'ok'))

    fireEvent.click(chip)
    await waitFor(() => expect(chip).toHaveAttribute('data-state', 'flag'))

    fireEvent.click(chip)
    await waitFor(() => expect(chip).toHaveAttribute('data-state', 'unknown'))

    fireEvent.click(chip)
    await waitFor(() => expect(chip).toHaveAttribute('data-state', 'skip'))

    // 5th click clears the override -> back to the AI default (unknown, since no fill).
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

    const key = CHECKLIST_ALL_KEYS[0]
    renderWithProviders(<ChecklistCard entry={makeBareEntry({ id: 'chip-patch-test' })} />)
    expandAllGroups()
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

    const key = CHECKLIST_ALL_KEYS[0]
    renderWithProviders(<ChecklistCard entry={makeBareEntry({ id: 'note-patch-test' })} />)
    expandAllGroups()

    fireEvent.click(screen.getByTestId(`checklist-note-toggle-${key}`))
    const textarea = screen.getByTestId(`checklist-note-textarea-${key}`)
    fireEvent.change(textarea, { target: { value: 'Asked agent, waiting on reply' } })

    // Debounce is 800ms — wait for the PATCH.
    await waitFor(
      () => {
        expect(patchBody).toEqual({ key, note: 'Asked agent, waiting on reply' })
      },
      { timeout: 2000 },
    )
  })

  it('an existing user note renders the textarea open by default (group auto-opens too)', () => {
    const entry = makeBareEntry({
      id: 'existing-note-test',
      checklist: { user_marks: { [CHECKLIST_ALL_KEYS[0]]: { note: 'Already checked' } } },
    })
    renderWithProviders(<ChecklistCard entry={entry} />)
    expect(screen.getByTestId(`checklist-note-textarea-${CHECKLIST_ALL_KEYS[0]}`)).toHaveValue('Already checked')
  })
})

describe('ChecklistCard — does not crash on edge cases', () => {
  it('does not crash when entry.checklist is null', () => {
    expect(() => renderWithProviders(<ChecklistCard entry={makeBareEntry()} />)).not.toThrow()
  })

  it('does not crash when checklist.user_marks is an empty object', () => {
    const entry = makeBareEntry({ checklist: { user_marks: {} } })
    expect(() => renderWithProviders(<ChecklistCard entry={entry} />)).not.toThrow()
  })

  it('drops empty-string ai_checklist_fills values back to unknown, not a blank ok item', () => {
    const entry = makeBareEntry({ ai_checklist_fills: { [CHECKLIST_ALL_KEYS[0]]: '' } })
    renderWithProviders(<ChecklistCard entry={entry} />)
    expandAllGroups()
    expect(screen.getByTestId(`checklist-chip-${CHECKLIST_ALL_KEYS[0]}`)).toHaveAttribute('data-state', 'unknown')
  })
})
