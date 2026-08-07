/**
 * MobileBottomNav — fixed bottom navigation dock, mobile only.
 *
 * 4 items: Overview · Inbox · Shortlist · Settings.
 * Active item: accent-lt text + 2px top-border in accent.
 * Inactive: text-3.
 *
 * Only renders on mobile viewport (≤767px).
 * Should NOT overlap bottom action strip when Inbox cards are active —
 * the parent layout must add pb-14 when both are shown.
 */

import { useAppStore, type TabId } from '../../lib/state'
import { useAppData, selectPendingCount } from '../../lib/queries'

interface NavItem {
  id: TabId
  label: string
  icon: React.ReactNode
}

function HomeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M3 8.5L10 2l7 6.5V17a1 1 0 01-1 1H4a1 1 0 01-1-1V8.5z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M7.5 18V12h5v6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function InboxIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="2" y="4" width="16" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M2 9.5h4l2 2.5h4l2-2.5h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function StarIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M10 2.5l2.2 4.5 5 .7-3.6 3.5.85 4.9L10 13.7l-4.45 2.4.85-4.9L2.8 7.7l5-.7L10 2.5z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function GearIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M10 3v1.5M10 15.5V17M3 10h1.5M15.5 10H17M4.9 4.9l1.1 1.1M14 14l1.1 1.1M15.1 4.9L14 6M6 14l-1.1 1.1"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}

const NAV_ITEMS: NavItem[] = [
  { id: 'overview',  label: 'Overview',  icon: <HomeIcon /> },
  { id: 'inbox',     label: 'Inbox',     icon: <InboxIcon /> },
  { id: 'shortlist', label: 'Shortlist', icon: <StarIcon /> },
  { id: 'settings',  label: 'Settings',  icon: <GearIcon /> },
]

export function MobileBottomNav() {
  const { activeTab, setTab } = useAppStore()
  const { data } = useAppData()
  const pendingCount = selectPendingCount(data)

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 h-14 flex items-center justify-around bg-app border-t border-border z-[2000]"
      aria-label="Main navigation"
    >
      {NAV_ITEMS.map((item) => {
        const isActive = activeTab === item.id
        return (
          <button
            key={item.id}
            onClick={() => setTab(item.id)}
            className={[
              'flex flex-col items-center justify-center gap-0.5 flex-1 h-full cursor-pointer border-none bg-transparent',
              'transition-colors duration-fast',
              isActive ? 'text-accent-lt border-t-[2px] border-t-accent' : 'text-text-3',
            ].join(' ')}
            aria-label={item.label}
            aria-current={isActive ? 'page' : undefined}
          >
            {item.icon}
            <span className="font-sans font-medium text-[11px] leading-none relative">
              {item.label}
              {item.id === 'inbox' && pendingCount > 0 && (
                <span className="absolute -top-1 -right-2 w-2 h-2 rounded-full bg-status-new" aria-label={`${pendingCount} pending`} />
              )}
            </span>
          </button>
        )
      })}
    </nav>
  )
}
