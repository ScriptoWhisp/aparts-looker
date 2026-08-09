/**
 * Shortlist tab — Wave 7C + Wave 7D.
 *
 * Layout: grid grid-cols-[284px_1fr] h-[calc(100vh-48px)]
 * - Left: 284px SidebarFunnel (To view / Viewed / Dropped)
 * - Right: main pane with hero row, verdict band, checklist + right column
 *
 * Wave 7D additions:
 * - Multi-select for Compare via cmd/ctrl-click in SidebarRow
 * - CompareOverlay dialog with differing-rows-only and winner tinting
 * - own_score slider in HeroRow (for viewed listings)
 *
 * Responsive: sidebar hidden on mobile (md:block), main pane full width.
 */

import { useState, useMemo } from 'react'
import { useAppData, useSettings, selectShortlisted } from '../lib/queries'
import { useAppStore } from '../lib/state'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { rankByAllIn } from '../lib/cost'
import type { Entry } from '../types/api'
import { SidebarFunnel } from '../components/shortlist/SidebarFunnel'
import { HeroRow } from '../components/shortlist/HeroRow'
import { VerdictBand } from '../components/shortlist/VerdictBand'
import { AfterViewingBar } from '../components/shortlist/AfterViewingBar'
import { ChecklistCard } from '../components/shortlist/ChecklistCard'
import { NegotiationCard } from '../components/shortlist/NegotiationCard'
import { FinanceCard } from '../components/shortlist/FinanceCard'
import { CompareOverlay } from '../components/shortlist/CompareOverlay'

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
          Back
        </button>
      )}

      {/* Hero row (includes own_score slider for viewed) */}
      <HeroRow entry={entry} settings={settings} />

      {/* Verdict band */}
      <VerdictBand entry={entry} />

      {/* After-viewing bar */}
      <AfterViewingBar entry={entry} />

      {/* Main content: checklist (left) + finance/negotiation (right).
          The whole MainPane scrolls as one page (outer overflow-y-auto). The
          grid sizes to its content, NOT to remaining viewport — previous
          fixed-viewport `md:flex-1 md:min-h-0` combined with inner
          overflow-y-auto on both columns produced a two-independent-scrollbars
          setup that trapped Negotiation below FinanceCard on desktop with no
          way to reach it via natural page scroll.
          Checklist gets a bounded max-height so its 96-item list still scrolls
          internally rather than dominating the page. */}
      <div className="flex flex-col md:grid md:grid-cols-[1fr_280px] gap-3 p-4 pt-3">
        {/* Left: Checklist — keyed by entry.id so per-listing open/override/note
            state doesn't leak across listing switches. */}
        <ChecklistCard key={entry.id} entry={entry} />

        {/* Right: Finance (Wave B) + Negotiation — flows naturally, no inner
            scroll trap; if total right-column height exceeds viewport, the
            outer MainPane scroll picks it up. */}
        <div className="flex flex-col gap-3">
          <FinanceCard key={entry.id} entry={entry} />
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

  // Compare overlay state: null = closed, [id, id] = open
  const [compareIds, setCompareIds] = useState<[string, string] | null>(null)

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

  function handleSelect(id: string) {
    setSelectedListingId(id)
  }

  function handleBack() {
    setSelectedListingId(null)
  }

  function handleCompare(ids: [string, string]) {
    setCompareIds(ids)
  }

  function handleCloseCompare() {
    setCompareIds(null)
  }

  // Resolve compare entries
  const compareEntries = useMemo(() => {
    if (!compareIds) return null
    const a = allEntries.find((e) => e.id === compareIds[0])
    const b = allEntries.find((e) => e.id === compareIds[1])
    if (!a || !b) return null
    return [a, b] as [Entry, Entry]
  }, [compareIds, allEntries])

  // Hooks MUST come before any conditional return per Rules of Hooks (React #310).
  const isMobile = useMediaQuery('(max-width: 767px)')

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-48px)]">
        <p className="text-[13px] text-faint">Loading…</p>
      </div>
    )
  }

  // Mobile: show EITHER sidebar OR main pane — never both side by side.
  // Desktop: always show both in the two-column grid.
  const showSidebar = !isMobile || !selectedEntry
  const showMain   = !isMobile || !!selectedEntry

  return (
    <>
      {isMobile ? (
        /* ── Mobile: full-width single pane ─────────────────────────── */
        <div className="h-[calc(100vh-48px)] overflow-hidden">
          {showSidebar && (
            <SidebarFunnel
              entries={allEntries}
              selectedId={selectedListingId}
              onSelect={handleSelect}
              onCompare={handleCompare}
            />
          )}
          {showMain && (
            selectedEntry ? (
              <MainPane
                entry={selectedEntry}
                settings={settings}
                onBack={handleBack}
              />
            ) : allEntries.length === 0 ? (
              <EmptySidebar />
            ) : (
              <NoSelection />
            )
          )}
        </div>
      ) : (
        /* ── Desktop: two-column grid ────────────────────────────────── */
        <div className="grid grid-cols-[284px_1fr] h-[calc(100vh-48px)]">
          {/* Sidebar */}
          <div className="h-full overflow-hidden">
            <SidebarFunnel
              entries={allEntries}
              selectedId={selectedListingId}
              onSelect={handleSelect}
              onCompare={handleCompare}
            />
          </div>

          {/* Main pane */}
          <div className="h-full overflow-hidden">
            {selectedEntry ? (
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
      )}

      {/* Compare overlay — rendered outside the grid (portal-like fixed positioning) */}
      {compareEntries && (
        <CompareOverlay
          entries={compareEntries}
          settings={settings}
          onClose={handleCloseCompare}
        />
      )}
    </>
  )
}
