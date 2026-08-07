/**
 * Inbox tab — Wave 7B.
 *
 * Responsive split:
 *   ≤767px  → InboxMobile (Framer Motion swipe cards, vaul drawer)
 *   ≥768px  → InboxDesktop (3-column card grid, keyboard shortcuts)
 *
 * Data: TanStack Query via useAppData → selectInbox (sorted score desc).
 * Session state: useInboxSession Zustand slice (resets on refresh).
 */

import { useAppData, selectInbox } from '../lib/queries'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { InboxDesktop } from '../components/inbox/InboxDesktop'
import { InboxMobile } from '../components/inbox/InboxMobile'

export function Inbox() {
  const { data, isLoading, error } = useAppData()
  const isMobile = useMediaQuery('(max-width: 767px)')

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <span className="font-mono text-[12px] text-faint">Loading…</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] px-6">
        <div className="bg-sunken rounded-lg p-6 max-w-sm w-full text-center">
          <p className="font-sans font-medium text-[14px] text-text mb-2">Failed to load inbox</p>
          <p className="font-mono text-[12px] text-status-skip">
            {error instanceof Error ? error.message : 'Unknown error'}
          </p>
        </div>
      </div>
    )
  }

  const entries = selectInbox(data)

  if (isMobile) {
    return <InboxMobile entries={entries} nextCheckTime={data?.next_check ?? null} />
  }

  return <InboxDesktop entries={entries} />
}
