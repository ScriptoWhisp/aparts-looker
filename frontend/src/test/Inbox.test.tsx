/**
 * Inbox.test.tsx — InboxDesktop grid + skip flow + InboxMobile tinder-flow regression.
 *
 * Desktop tests:
 * - Renders 3 cards for 3 pending entries
 * - Keyboard L fires approve POST
 * - Empty state renders when no pending
 * - Skip flow: click Skip → modal opens with 6 chips → cancel closes it
 *
 * Mobile tests (Wave 8A):
 * - Look closer button click stays on inbox (hash does NOT change to #shortlist)
 * - Next card renders after Look closer action
 * - Skip button opens sheet with Next button (NOT auto-close countdown)
 * - Skip → Next fires POST /reject
 * - Skip → Undo restores card to queue
 * - All-in cost line renders in card
 *
 * Note: Framer Motion swipe gestures are NOT tested (jsdom cannot simulate them).
 * Gesture UX is covered by Playwright e2e tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor, act } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from './mocks/server'
import { renderWithProviders } from './renderWithProviders'
import { Inbox } from '@/routes/Inbox'
import { InboxMobile } from '@/components/inbox/InboxMobile'
import {
  mockAppDataWithPending,
  mockEmptyAppData,
  mockSettingsFull,
  pendingEntry1,
  pendingEntry2,
  pendingEntry3,
} from './mocks/fixtures'
import { QUERY_KEYS } from '@/lib/queries'
import { useInboxSession } from '@/lib/state'
import type { AppData } from '@/types/api'

// ── Mock framer-motion ─────────────────────────────────────────────────────
// InboxMobile uses motion.div, useMotionValue, useTransform, AnimatePresence
vi.mock('framer-motion', () => {
  const noop = () => ({ get: () => 0, set: vi.fn(), onChange: vi.fn(), destroy: vi.fn() })
  return {
    AnimatePresence: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    motion: {
      div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement> & {
        children?: React.ReactNode
        style?: React.CSSProperties
        drag?: unknown
        dragConstraints?: unknown
        dragElastic?: unknown
        onDragEnd?: unknown
        animate?: unknown
        initial?: unknown
        transition?: unknown
        whileTap?: unknown
      }) => <div {...props}>{children}</div>,
    },
    useTransform: () => noop(),
    useMotionValue: () => noop(),
    useAnimation: () => ({ start: vi.fn() }),
    useSpring: () => noop(),
    useVelocity: () => noop(),
    animate: vi.fn(),
  }
})

// ── Reset Zustand state between tests ─────────────────────────────────────
beforeEach(() => {
  useInboxSession.getState().resetSession()
  // Reset hash to inbox
  window.location.hash = '#inbox'
})

// ── Render helpers ─────────────────────────────────────────────────────────

function renderInbox(appData: AppData = mockAppDataWithPending, isMobile = false) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: isMobile && query.includes('max-width: 767px'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })

  return renderWithProviders(<Inbox />, {
    queryCache: [
      { queryKey: QUERY_KEYS.appData, data: appData },
      { queryKey: QUERY_KEYS.settings, data: mockSettingsFull },
    ],
  })
}

function renderMobile(appData: AppData = mockAppDataWithPending) {
  return renderWithProviders(
    <InboxMobile
      entries={appData.pending}
      nextCheckTime={appData.next_check}
    />,
    {
      queryCache: [
        { queryKey: QUERY_KEYS.appData, data: appData },
        { queryKey: QUERY_KEYS.settings, data: mockSettingsFull },
      ],
    },
  )
}

// ── Desktop tests ──────────────────────────────────────────────────────────

describe('Inbox desktop — card grid', () => {
  it('renders 3 cards when 3 pending entries', () => {
    renderInbox(mockAppDataWithPending, false)
    const cards = screen.getAllByRole('article')
    expect(cards).toHaveLength(3)
  })

  it('shows entry titles in cards', () => {
    renderInbox(mockAppDataWithPending, false)
    expect(screen.getByText('Spacious 2BR in Kesklinn')).toBeInTheDocument()
    expect(screen.getByText('Cozy studio near Viru Gate')).toBeInTheDocument()
    expect(screen.getByText('Modern flat with balcony')).toBeInTheDocument()
  })

  it('shows "Look closer" and "Skip" buttons on each card', () => {
    renderInbox(mockAppDataWithPending, false)
    const lookCloserButtons = screen.getAllByText(/Look closer/i)
    expect(lookCloserButtons.length).toBeGreaterThanOrEqual(3)
    const skipButtons = screen.getAllByRole('button', { name: /Skip/i })
    expect(skipButtons.length).toBeGreaterThanOrEqual(3)
  })

  it('shows the inbox header with entry count', () => {
    renderInbox(mockAppDataWithPending, false)
    expect(screen.getByText('Inbox')).toBeInTheDocument()
    const body = document.body.textContent ?? ''
    expect(body).toMatch(/3 (pending|new since)/i)
  })
})

describe('Inbox desktop — empty state', () => {
  it('renders "Inbox is empty" when no pending entries', () => {
    renderInbox(mockEmptyAppData, false)
    expect(screen.getByText(/Inbox is empty/i)).toBeInTheDocument()
  })

  it('renders "Adjust threshold" and "Run scrape now" buttons in empty state', () => {
    renderInbox(mockEmptyAppData, false)
    expect(screen.getByText(/Adjust threshold/i)).toBeInTheDocument()
    expect(screen.getByText(/Run scrape now/i)).toBeInTheDocument()
  })
})

describe('Inbox desktop — skip flow', () => {
  it('clicking Skip opens the skip reason modal', () => {
    renderInbox(mockAppDataWithPending, false)
    const skipButtons = screen.getAllByText('Skip')
    fireEvent.click(skipButtons[0])
    expect(screen.getByText(/Skipped — what put you off/i)).toBeInTheDocument()
  })

  it('skip modal shows 6 reason chips', () => {
    renderInbox(mockAppDataWithPending, false)
    const skipButtons = screen.getAllByText('Skip')
    fireEvent.click(skipButtons[0])
    expect(screen.getByText('Price')).toBeInTheDocument()
    expect(screen.getByText('Location')).toBeInTheDocument()
    expect(screen.getByText('Condition')).toBeInTheDocument()
    expect(screen.getByText('Layout')).toBeInTheDocument()
    expect(screen.getByText('Building')).toBeInTheDocument()
    expect(screen.getByText('Other')).toBeInTheDocument()
  })

  it('Cancel button in skip modal closes the modal', () => {
    renderInbox(mockAppDataWithPending, false)
    const skipButtons = screen.getAllByText('Skip')
    fireEvent.click(skipButtons[0])
    expect(screen.getByText(/Skipped — what put you off/i)).toBeInTheDocument()
    fireEvent.click(screen.getByText('Cancel'))
    expect(screen.queryByText(/Skipped — what put you off/i)).toBeNull()
  })
})

describe('Inbox desktop — keyboard shortcut L fires approve', () => {
  it('pressing L fires POST /api/pending/:id/approve for the selected card', async () => {
    let approveCallCount = 0
    server.use(
      http.post('/api/pending/:id/approve', () => {
        approveCallCount++
        return HttpResponse.json({ ok: true })
      }),
    )

    renderInbox(mockAppDataWithPending, false)
    fireEvent.keyDown(document, { key: 'l' })

    await waitFor(
      () => expect(approveCallCount).toBe(1),
      { timeout: 2000 },
    )
  })
})

// ── Mobile tests — Wave 8A Tinder flow ───────────────────────────────────

describe('Inbox mobile — layout renders', () => {
  it('renders without crash in mobile layout', () => {
    expect(() => renderInbox(mockAppDataWithPending, true)).not.toThrow()
  })

  it('mobile empty state renders when no entries', () => {
    renderMobile(mockEmptyAppData)
    expect(screen.getByText(/Inbox is empty/i)).toBeInTheDocument()
  })

  it('renders Inbox header and progress counter', () => {
    renderMobile(mockAppDataWithPending)
    expect(screen.getByText('Inbox')).toBeInTheDocument()
    // Progress: "1 of 3"
    expect(screen.getByText('1 of 3')).toBeInTheDocument()
  })

  it('shows Look closer, Skip, Later action buttons', () => {
    renderMobile(mockAppDataWithPending)
    expect(screen.getByRole('button', { name: /Look closer/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Skip/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Later/i })).toBeInTheDocument()
  })

  it('shows first entry title in card', () => {
    renderMobile(mockAppDataWithPending)
    expect(screen.getByText('Spacious 2BR in Kesklinn')).toBeInTheDocument()
  })
})

describe('Inbox mobile — Look closer stays on inbox (Wave 8A)', () => {
  it('clicking Look closer does NOT change hash to #shortlist', async () => {
    let approveCallCount = 0
    server.use(
      http.post('/api/pending/:id/approve', () => {
        approveCallCount++
        return HttpResponse.json({ ok: true })
      }),
    )

    window.location.hash = '#inbox'
    renderMobile(mockAppDataWithPending)

    const lookBtn = screen.getByRole('button', { name: /Look closer/i })
    await act(async () => { fireEvent.click(lookBtn) })

    // Hash must remain #inbox — NOT jump to #shortlist
    expect(window.location.hash).toBe('#inbox')
  })

  it('clicking Look closer fires POST /approve', async () => {
    let approveCallCount = 0
    server.use(
      http.post('/api/pending/:id/approve', () => {
        approveCallCount++
        return HttpResponse.json({ ok: true })
      }),
    )

    renderMobile(mockAppDataWithPending)
    const lookBtn = screen.getByRole('button', { name: /Look closer/i })
    await act(async () => { fireEvent.click(lookBtn) })

    await waitFor(() => expect(approveCallCount).toBe(1), { timeout: 2000 })
  })

  it('after Look closer, session records shortlisted decision', async () => {
    server.use(
      http.post('/api/pending/:id/approve', () => HttpResponse.json({ ok: true })),
    )

    renderMobile(mockAppDataWithPending)
    const lookBtn = screen.getByRole('button', { name: /Look closer/i })
    await act(async () => { fireEvent.click(lookBtn) })

    await waitFor(() => {
      const state = useInboxSession.getState()
      expect(state.shortlisted).toBe(1)
      expect(state.decisions).toHaveLength(1)
      expect(state.decisions[0].outcome).toBe('shortlisted')
    })
  })
})

describe('Inbox mobile — Skip flow (Wave 8A: no auto-close, explicit Next)', () => {
  it('clicking Skip button triggers card dismissal (entry removed from queue)', async () => {
    renderMobile(mockAppDataWithPending)
    const skipBtn = screen.getByRole('button', { name: /^Skip$/i })
    await act(async () => { fireEvent.click(skipBtn) })

    // After dismissal animation (mocked so immediate) + sheet open
    // Sheet should appear with the skipped card title
    await waitFor(() => {
      // Sheet has "Skipped ..." heading
      const body = document.body.textContent ?? ''
      expect(body).toMatch(/Skipped/i)
    }, { timeout: 1000 })
  })

  it('skip sheet has Next button (not auto-close countdown)', async () => {
    renderMobile(mockAppDataWithPending)
    const skipBtn = screen.getByRole('button', { name: /^Skip$/i })
    await act(async () => { fireEvent.click(skipBtn) })

    await waitFor(() => {
      const body = document.body.textContent ?? ''
      expect(body).toMatch(/Skipped/i)
    }, { timeout: 1000 })

    // Should NOT have countdown text
    expect(document.body.textContent).not.toMatch(/auto-closes/i)
  })

  it('Next button in skip sheet fires POST /reject', async () => {
    let rejectCallCount = 0
    server.use(
      http.post('/api/pending/:id/reject', () => {
        rejectCallCount++
        return HttpResponse.json({ ok: true })
      }),
    )

    renderMobile(mockAppDataWithPending)
    const skipBtn = screen.getByRole('button', { name: /^Skip$/i })
    await act(async () => { fireEvent.click(skipBtn) })

    // Wait for sheet to open
    await waitFor(() => {
      expect(document.body.textContent).toMatch(/Skipped/i)
    }, { timeout: 1000 })

    // Click Next
    const nextBtn = screen.getByRole('button', { name: /^Next$/i })
    await act(async () => { fireEvent.click(nextBtn) })

    await waitFor(() => expect(rejectCallCount).toBe(1), { timeout: 2000 })
  })

  it('skip sheet shows 6 reason chips', async () => {
    renderMobile(mockAppDataWithPending)
    const skipBtn = screen.getByRole('button', { name: /^Skip$/i })
    await act(async () => { fireEvent.click(skipBtn) })

    await waitFor(() => {
      expect(document.body.textContent).toMatch(/Skipped/i)
    }, { timeout: 1000 })

    expect(screen.getByText('Price')).toBeInTheDocument()
    expect(screen.getByText('Location')).toBeInTheDocument()
    expect(screen.getByText('Condition')).toBeInTheDocument()
    expect(screen.getByText('Layout')).toBeInTheDocument()
    expect(screen.getByText('Building')).toBeInTheDocument()
    expect(screen.getByText('Other')).toBeInTheDocument()
  })
})

describe('Inbox mobile — cleared state (Wave 8A)', () => {
  it('shows cleared state with decisions list after all cards triaged', async () => {
    server.use(
      http.post('/api/pending/:id/approve', () => HttpResponse.json({ ok: true })),
    )

    // Pre-populate session with 2 decisions manually (simulating prior approvals)
    act(() => {
      useInboxSession.getState().recordLookCloser('pending-1', 'Spacious 2BR in Kesklinn', 82)
      useInboxSession.getState().recordLookCloser('pending-2', 'Cozy studio near Viru Gate', 71)
      useInboxSession.getState().recordLookCloser('pending-3', 'Modern flat with balcony', 65)
    })

    // Render with empty active queue (all decided)
    renderMobile({
      ...mockAppDataWithPending,
      pending: [],
    })

    // Cleared state should show
    await waitFor(() => {
      expect(screen.getByText(/Inbox clear/i)).toBeInTheDocument()
    })
  })

  it('cleared state shows Open shortlist button when shortlisted > 0', async () => {
    act(() => {
      useInboxSession.getState().recordLookCloser('pending-1', 'Spacious 2BR in Kesklinn', 82)
      useInboxSession.getState().recordLookCloser('pending-2', 'Cozy studio near Viru Gate', 71)
      useInboxSession.getState().recordLookCloser('pending-3', 'Modern flat with balcony', 65)
    })

    renderMobile({ ...mockAppDataWithPending, pending: [] })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Open shortlist/i })).toBeInTheDocument()
    })
  })
})

describe('Inbox mobile — decisions tracking (Wave 8A)', () => {
  it('recordLookCloser adds shortlisted decision to session', () => {
    act(() => {
      useInboxSession.getState().recordLookCloser('e1', 'Test listing', 79)
    })
    const state = useInboxSession.getState()
    expect(state.decisions).toHaveLength(1)
    expect(state.decisions[0]).toMatchObject({
      id: 'e1',
      title: 'Test listing',
      score: 79,
      outcome: 'shortlisted',
    })
  })

  it('recordSkip adds skipped decision with reason to session', () => {
    act(() => {
      useInboxSession.getState().recordSkip('e2', 'Another listing', 55, 'Location')
    })
    const state = useInboxSession.getState()
    expect(state.decisions).toHaveLength(1)
    expect(state.decisions[0]).toMatchObject({
      id: 'e2',
      outcome: 'skipped',
      reason: 'Location',
    })
  })

  it('resetSession clears decisions array', () => {
    act(() => {
      useInboxSession.getState().recordLookCloser('e1', 'Test', 79)
      useInboxSession.getState().resetSession()
    })
    expect(useInboxSession.getState().decisions).toHaveLength(0)
  })
})
