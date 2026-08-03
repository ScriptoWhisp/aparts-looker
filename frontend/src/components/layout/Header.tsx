/**
 * Header — 48px sticky nav bar with brand mark, tabs, and refresh controls.
 *
 * Per SPEC §2.1: 48px bar, #161826 bg, hairline bottom border.
 * Brand: 8×8 accent square + "Aparts Looker" Inter 500 13px.
 * Right: "scraped N min ago" mono meta + Refresh button.
 * Inbox tab badge in status.new color when pending count > 0.
 */

import { useAppStore, type TabId } from '../../lib/state'
import { useAppData, useRefreshAll, selectPendingCount } from '../../lib/queries'
import { fmtRelative } from '../../lib/format'
import { triggerCheck } from '../../lib/api'
import { useState } from 'react'

const TABS: { id: TabId; label: string }[] = [
  { id: 'overview',  label: 'Overview' },
  { id: 'inbox',     label: 'Inbox' },
  { id: 'shortlist', label: 'Shortlist' },
  { id: 'settings',  label: 'Settings' },
]

export function Header() {
  const { activeTab, setTab } = useAppStore()
  const { data } = useAppData()
  const refreshAll = useRefreshAll()
  const [checking, setChecking] = useState(false)

  const pendingCount = selectPendingCount(data)
  const lastCheck = data?.last_check ?? null

  async function handleRefresh() {
    setChecking(true)
    try {
      await triggerCheck()
      // Give the backend a moment to process, then refresh data
      setTimeout(() => {
        refreshAll()
        setChecking(false)
      }, 1500)
    } catch {
      refreshAll()
      setChecking(false)
    }
  }

  return (
    <header className="h-12 bg-app flex items-center gap-6 px-6 shadow-[inset_0_-1px_0_#292b31] sticky top-0 z-[2500] flex-shrink-0">
      {/* Brand mark */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <div className="w-2 h-2 rounded-[2px] bg-accent flex-shrink-0" />
        <span className="font-sans font-medium text-[13px] tracking-tight text-text">
          Aparts Looker
        </span>
      </div>

      {/* Tab navigation */}
      <nav className="flex gap-0.5 flex-1">
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => setTab(tab.id)}
              className={[
                'inline-flex items-center gap-1.5 border-none rounded-md px-2.5 py-1.5',
                'font-sans text-[13px] font-normal cursor-pointer whitespace-nowrap',
                'transition-[background,color] duration-fast ease-spec',
                isActive
                  ? 'bg-accent/[0.14] text-accent-lt font-medium'
                  : 'bg-transparent text-text-3 hover:text-text',
              ].join(' ')}
            >
              {tab.label}
              {tab.id === 'inbox' && pendingCount > 0 && (
                <span className="font-mono text-[10px] px-[5px] py-[1px] rounded-sm bg-status-new/20 text-status-new border border-status-new/30">
                  {pendingCount}
                </span>
              )}
            </button>
          )
        })}
      </nav>

      {/* Right side: scrape meta + refresh */}
      <div className="flex items-center gap-4 ml-auto flex-shrink-0">
        <span className="font-mono text-[11px] text-faint whitespace-nowrap hidden sm:block">
          {fmtRelative(lastCheck)}
        </span>
        <button
          onClick={() => void handleRefresh()}
          disabled={checking}
          className={[
            'btn bg-transparent text-text-3 border border-border-strong rounded-md',
            'px-2.5 py-[5px] text-[12px] font-mono cursor-pointer',
            'transition-[background,color] duration-fast ease-spec',
            'hover:bg-white/[0.07] hover:text-text',
            'disabled:opacity-45 disabled:cursor-not-allowed',
          ].join(' ')}
        >
          {checking ? 'Checking…' : 'Refresh'}
        </button>
      </div>
    </header>
  )
}
