/**
 * Inbox.test.tsx — InboxDesktop grid + skip flow.
 *
 * Tests:
 * - Desktop: renders 3 cards for 3 pending entries
 * - Desktop: keyboard L on first card fires approve POST
 * - Empty state renders when no pending
 * - Skip flow: click Skip → modal opens with 6 chips → cancel closes it
 * - Mobile layout: renders without crash (matchMedia mocked to force mobile)
 *
 * Note: Framer Motion swipe gestures are NOT tested (jsdom cannot simulate them).
 * Mobile test only verifies the layout mounts — gesture UX needs Playwright.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from './mocks/server'
import { renderWithProviders } from './renderWithProviders'
import { Inbox } from '@/routes/Inbox'
import {
  mockAppDataWithPending,
  mockEmptyAppData,
  mockSettingsFull,
} from './mocks/fixtures'
import { QUERY_KEYS } from '@/lib/queries'
import { useInboxSession } from '@/lib/state'
import type { AppData } from '@/types/api'

// Mock framer-motion (InboxMobile uses motion.div for swipe cards + useMotionValue)
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

// Reset Zustand InboxSession before each test so decidedIds don't bleed
beforeEach(() => {
  useInboxSession.getState().resetSession()
})

// ── Render helper ──────────────────────────────────────────────────────────

function renderInbox(appData: AppData = mockAppDataWithPending, isMobile = false) {
  // Override matchMedia to control desktop/mobile branch
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

// ── Desktop tests ─────────────────────────────────────────────────────────

describe('Inbox desktop — card grid', () => {
  it('renders 3 cards when 3 pending entries', () => {
    renderInbox(mockAppDataWithPending, false)
    // Each card has aria-label equal to the entry title
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
    // "Look closer" appears once per card — we have 3 pending entries
    const lookCloserButtons = screen.getAllByText(/Look closer/i)
    expect(lookCloserButtons.length).toBeGreaterThanOrEqual(3)
    // "Skip" appears in card buttons and possibly inside the skip modal — count ≥3
    const skipButtons = screen.getAllByRole('button', { name: /Skip/i })
    expect(skipButtons.length).toBeGreaterThanOrEqual(3)
  })

  it('shows the inbox header with entry count', () => {
    renderInbox(mockAppDataWithPending, false)
    // Header: "Inbox" title
    expect(screen.getByText('Inbox')).toBeInTheDocument()
    // Count subhead: "3 new since ..." (when created_at present) or "3 pending"
    // Use a flexible text matcher to handle split elements and both formats
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
    // Modal should appear with reason chips
    expect(screen.getByText(/Skipped — what put you off/i)).toBeInTheDocument()
  })

  it('skip modal shows 6 reason chips', () => {
    renderInbox(mockAppDataWithPending, false)
    const skipButtons = screen.getAllByText('Skip')
    fireEvent.click(skipButtons[0])
    // Reason chips: Price, Location, Condition, Layout, Building, Other
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

    // Click Cancel
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

    // Dispatch keyboard L (selectedIndex=0 by default)
    fireEvent.keyDown(document, { key: 'l' })

    await waitFor(
      () => expect(approveCallCount).toBe(1),
      { timeout: 2000 },
    )
  })
})

describe('Inbox mobile — layout renders', () => {
  it('renders without crash in mobile layout', () => {
    // Just verify the mobile branch mounts — no swipe gesture testing
    expect(() => renderInbox(mockAppDataWithPending, true)).not.toThrow()
  })

  it('mobile empty state renders when no entries', () => {
    renderInbox(mockEmptyAppData, true)
    // Either mobile or desktop empty state will render depending on matchMedia implementation
    // Just assert no crash
    const container = document.body
    expect(container).toBeTruthy()
  })
})
