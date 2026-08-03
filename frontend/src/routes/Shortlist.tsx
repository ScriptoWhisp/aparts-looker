/**
 * Shortlist tab — Wave 7C implementation.
 *
 * Layout: grid grid-cols-[284px_1fr] h-[calc(100vh-48px)]
 * - Left: 284px SidebarFunnel (To view / Viewed / Dropped)
 * - Right: main pane with hero row, verdict band, checklist + right column
 *
 * Responsive: sidebar hidden on mobile (md:block), main pane full width.
 * Desktop-first; mobile shows main pane only with "← Back" button when a
 * listing is selected.
 *
 * Entries sorted by score desc (or all-in asc if rank_by_all_in setting active).
 */

import { useMemo } from 'react'
import { useAppData, useSettings, selectShortlisted } from '../lib/queries'
import { useAppStore } from '../lib/state'
import { rankByAllIn } from '../lib/cost'
import type { Entry } from '../types/api'
import { SidebarFunnel } from '../components/shortlist/SidebarFunnel'
import { HeroRow } from '../components/shortlist/HeroRow'
import { VerdictBand } from '../components/shortlist/VerdictBand'
import { AfterViewingBar } from '../components/shortlist/AfterViewingBar'
import { ChecklistCard } from '../components/shortlist/ChecklistCard'
import { AskAtViewing } from '../components/shortlist/AskAtViewing'
import { NegotiationCard } from '../components/shortlist/NegotiationCard'

// ── Empty / no-selection states ────────────────────────────────────────────

function EmptySidebar() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-6">
      <p className="text-[14px] font-medium text-text mb-1">Nothing shortlisted yet</p>
      <p className="text-[12px] text-faint">Approve listings in Inbox first</p>
    </div>
  )
}

function NoSelection() {
  return (
    <div className="flex items-center justify-center h-full text-center px-6">
      <p className="text-[14px] text-muted">
        Select a listing from the sidebar
      </p>
    </div>
  )
}

// ── Main pane for a selected entry ─────────────────────────────────────────

interface MainPaneProps {
  entry: Entry
  settings: ReturnType<typeof useSettings>['data']
  onBack?: () => void
}

function MainPane({ entry, settings, onBack }: MainPaneProps) {
  return (
    <div className="flex flex-col h-full overflow-y-auto min-h-0">
      {/* Mobile back button */}
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="md:hidden flex items-center gap-1 px-4 pt-3 text-[13px] text-muted hover:text-text transition-colors"
        >
          ← Back
        </button>
      )}

      {/* Hero row */}
      <HeroRow entry={entry} settings={settings} />

      {/* Verdict band */}
      <VerdictBand entry={entry} />

      {/* After-viewing bar */}
      <AfterViewingBar entry={entry} />

      {/* Main content: checklist (left) + ask/negotiation (right) */}
      <div className="grid grid-cols-[1fr_340px] gap-3 p-4 pt-3 flex-1 min-h-0">
        {/* Left: Checklist accordion */}
        <ChecklistCard entry={entry} />

        {/* Right: Ask at viewing + Negotiation */}
        <div className="flex flex-col gap-3 min-h-0">
          <AskAtViewing entry={entry} />
          <NegotiationCard entry={entry} />
        </div>
      </div>
    </div>
  )
}

// ── Main Shortlist component ───────────────────────────────────────────────

export function Shortlist() {
  const { data: appData, isLoading } = useAppData()
  const { data: settings } = useSettings()
  const { selectedListingId, setSelectedListingId } = useAppStore()

  // All shortlisted entries sorted by score (or all-in)
  const allEntries = useMemo(() => {
    const raw = selectShortlisted(appData)
    return rankByAllIn(raw, settings)
  }, [appData, settings])

  // Selected entry
  const selectedEntry = useMemo(
    () => allEntries.find((e) => e.id === selectedListingId) ?? null,
    [allEntries, selectedListingId],
  )

  // Auto-select first entry if none selected and entries exist
  const effectiveSelected = selectedEntry ?? (allEntries.length > 0 ? null : null)

  function handleSelect(id: string) {
    setSelectedListingId(id)
  }

  function handleBack() {
    setSelectedListingId(null)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-48px)]">
        <p className="text-[13px] text-faint">Loading…</p>
      </div>
    )
  }

  // Mobile: show sidebar OR main pane (not both)
  // Desktop: always show both (grid 284px + flex-1)
  const showSidebarOnMobile = !selectedEntry
  const showMainOnMobile = !!selectedEntry

  return (
    <div className="grid grid-cols-[284px_1fr] h-[calc(100vh-48px)]">
      {/* Sidebar — always visible on desktop, toggles on mobile */}
      <div
        className={[
          'h-full overflow-hidden',
          showSidebarOnMobile ? 'block' : 'hidden',
          'md:block',
        ].join(' ')}
      >
        <SidebarFunnel
          entries={allEntries}
          selectedId={selectedListingId}
          onSelect={handleSelect}
        />
      </div>

      {/* Main pane */}
      <div
        className={[
          'h-full overflow-hidden',
          showMainOnMobile ? 'block' : 'hidden',
          'md:block',
        ].join(' ')}
      >
        {effectiveSelected ? (
          <MainPane
            entry={effectiveSelected}
            settings={settings}
            onBack={handleBack}
          />
        ) : selectedEntry ? (
          <MainPane
            entry={selectedEntry}
            settings={settings}
            onBack={handleBack}
          />
        ) : allEntries.length === 0 ? (
          <EmptySidebar />
        ) : (
          <NoSelection />
        )}
      </div>
    </div>
  )
}
