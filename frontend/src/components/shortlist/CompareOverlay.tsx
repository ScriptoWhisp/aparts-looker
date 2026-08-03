/**
 * CompareOverlay — side-by-side comparison of 2 shortlisted entries.
 *
 * Opens via Compare button in SidebarFunnel or keyboard shortcut C.
 * Width 1000px modal. Grid: 172px label col + 1col per entry.
 * Only renders rows where values differ.
 * Winner cell gets text-status-short (green). Better = lower for cost/commute,
 * higher for score, fewer flags.
 * Per-column footer: Draft offer / Drop this one.
 * Esc + backdrop click close.
 */

import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Entry, SettingsData } from '../../types/api'
import { fmtEur } from '../../lib/format'
import { computeAllIn } from '../../lib/cost'
import { useAppStore } from '../../lib/state'
import { QUERY_KEYS } from '../../lib/queries'
import { viewingDecision, regenerateBrief } from '../../lib/api'

interface CompareOverlayProps {
  entries: [Entry, Entry]
  settings: SettingsData | undefined
  onClose: () => void
}

type Winner = 'left' | 'right' | 'tie'

function winnerClass(side: 'left' | 'right', winner: Winner): string {
  if (winner === 'tie') return ''
  return winner === side ? 'text-status-short font-medium' : ''
}

interface Row {
  label: string
  leftVal: string
  rightVal: string
  winner: Winner
}

function buildRows(a: Entry, b: Entry, settings: SettingsData | undefined): Row[] {
  const rows: Row[] = []

  // Helper to add a row only when values differ
  function add(label: string, aVal: string, bVal: string, lowerIsBetter: boolean) {
    const aNum = parseFloat(aVal.replace(/[^0-9.-]/g, ''))
    const bNum = parseFloat(bVal.replace(/[^0-9.-]/g, ''))
    let winner: Winner = 'tie'
    if (!isNaN(aNum) && !isNaN(bNum) && aNum !== bNum) {
      winner = lowerIsBetter
        ? (aNum < bNum ? 'left' : 'right')
        : (aNum > bNum ? 'left' : 'right')
    }
    if (aVal !== bVal) {
      rows.push({ label, leftVal: aVal, rightVal: bVal, winner })
    }
  }

  // All-in cost
  const aCost = computeAllIn(a, settings)
  const bCost = computeAllIn(b, settings)
  add('All-in cost', fmtEur(aCost.allIn), fmtEur(bCost.allIn), true)

  // Area
  add('Area',
    a.area_sqm ? `${a.area_sqm} m²` : '—',
    b.area_sqm ? `${b.area_sqm} m²` : '—',
    false, // more area = better
  )

  // Price
  add('Ask price', fmtEur(a.price_eur), fmtEur(b.price_eur), true)

  // Monthly
  const aMonthly = (a.cost_of_ownership as { monthly_total_eur?: number } | null)?.monthly_total_eur
  const bMonthly = (b.cost_of_ownership as { monthly_total_eur?: number } | null)?.monthly_total_eur
  if (aMonthly != null || bMonthly != null) {
    add('Monthly',
      aMonthly != null ? fmtEur(aMonthly) : '—',
      bMonthly != null ? fmtEur(bMonthly) : '—',
      true,
    )
  }

  // €/m² vs district (price_per_sqm)
  if (a.price_per_sqm != null || b.price_per_sqm != null) {
    add('Price/m²',
      a.price_per_sqm != null ? `${Math.round(a.price_per_sqm).toLocaleString()} €/m²` : '—',
      b.price_per_sqm != null ? `${Math.round(b.price_per_sqm).toLocaleString()} €/m²` : '—',
      true,
    )
  }

  // Score
  add('Score',
    String(a.score ?? '—'),
    String(b.score ?? '—'),
    false, // higher score = better
  )

  // Commute
  if (a.commute_minutes != null || b.commute_minutes != null) {
    add('Commute',
      a.commute_minutes != null ? `${a.commute_minutes} min` : '—',
      b.commute_minutes != null ? `${b.commute_minutes} min` : '—',
      true,
    )
  }

  // Year built
  add('Year built', String(a.year_built ?? '—'), String(b.year_built ?? '—'), false)

  // Rooms
  add('Rooms', String(a.rooms ?? '—'), String(b.rooms ?? '—'), false)

  return rows
}

export function CompareOverlay({ entries, settings, onClose }: CompareOverlayProps) {
  const [entryA, entryB] = entries
  const setTab      = useAppStore((s) => s.setTab)
  const setSelected = useAppStore((s) => s.setSelectedListingId)
  const qc          = useQueryClient()

  // Close on Esc
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const rows = buildRows(entryA, entryB, settings)

  async function handleDrop(entry: Entry) {
    try {
      await viewingDecision(entry.id, 'drop')
      void qc.invalidateQueries({ queryKey: QUERY_KEYS.appData })
    } catch {
      // silently ignore
    }
    onClose()
  }

  async function handleDraftOffer(entry: Entry) {
    try {
      await regenerateBrief(entry.id)
      void qc.invalidateQueries({ queryKey: QUERY_KEYS.appData })
    } catch {
      // silently ignore
    }
    setSelected(entry.id)
    setTab('shortlist')
    onClose()
  }

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(15,17,28,0.78)' }}
      onClick={onClose}
    >
      {/* Dialog */}
      <div
        className="bg-app rounded-xl shadow-lg w-[1000px] max-w-[96vw] max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-none">
          <h2 className="font-sans font-medium text-[18px] text-text">Compare</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:text-text transition-colors text-[20px] leading-none w-7 h-7 flex items-center justify-center rounded-md hover:bg-surface"
          >
            ×
          </button>
        </div>

        {/* Entry header row */}
        <div
          className="grid flex-none border-b border-border"
          style={{ gridTemplateColumns: '172px 1fr 1fr' }}
        >
          {/* Label column header */}
          <div className="p-4" />

          {/* Entry A */}
          <div className="p-4 border-l border-border">
            {entryA.image_url && (
              <img
                src={entryA.image_url}
                alt={entryA.title}
                className="w-full h-[104px] object-cover rounded-lg mb-3"
                draggable={false}
              />
            )}
            <p className="font-sans font-medium text-[14px] text-text leading-snug truncate">
              {entryA.title || entryA.address || entryA.id}
            </p>
            <p className="font-sans text-[12px] text-muted mt-0.5">
              {entryA.district ?? '—'} · {fmtEur(entryA.price_eur)}
            </p>
          </div>

          {/* Entry B */}
          <div className="p-4 border-l border-border">
            {entryB.image_url && (
              <img
                src={entryB.image_url}
                alt={entryB.title}
                className="w-full h-[104px] object-cover rounded-lg mb-3"
                draggable={false}
              />
            )}
            <p className="font-sans font-medium text-[14px] text-text leading-snug truncate">
              {entryB.title || entryB.address || entryB.id}
            </p>
            <p className="font-sans text-[12px] text-muted mt-0.5">
              {entryB.district ?? '—'} · {fmtEur(entryB.price_eur)}
            </p>
          </div>
        </div>

        {/* Rows — only differing */}
        <div className="flex-1 overflow-y-auto">
          {rows.length === 0 ? (
            <div className="flex items-center justify-center h-24">
              <p className="text-[13px] text-muted">All visible values are identical.</p>
            </div>
          ) : (
            rows.map((row, i) => (
              <div
                key={row.label}
                className={[
                  'grid items-center border-b border-border/50',
                  i % 2 === 0 ? 'bg-sunken/30' : '',
                ].join(' ')}
                style={{ gridTemplateColumns: '172px 1fr 1fr' }}
              >
                {/* Label */}
                <div className="px-4 py-3">
                  <span className="font-sans text-[12px] text-muted">{row.label}</span>
                </div>

                {/* Left value */}
                <div className={['px-4 py-3 border-l border-border/50 font-mono text-[13px]', winnerClass('left', row.winner)].join(' ')}>
                  {row.leftVal}
                </div>

                {/* Right value */}
                <div className={['px-4 py-3 border-l border-border/50 font-mono text-[13px]', winnerClass('right', row.winner)].join(' ')}>
                  {row.rightVal}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer actions */}
        <div
          className="grid border-t border-border flex-none"
          style={{ gridTemplateColumns: '172px 1fr 1fr' }}
        >
          <div className="p-4" />

          {/* Entry A actions */}
          <div className="p-4 border-l border-border flex flex-col gap-2">
            <button
              type="button"
              onClick={() => void handleDraftOffer(entryA)}
              className="w-full py-2 text-[12.5px] font-medium rounded-md bg-accent text-bg hover:bg-accent/80 transition-colors"
            >
              Draft offer on this one
            </button>
            <button
              type="button"
              onClick={() => void handleDrop(entryA)}
              className="w-full py-2 text-[12.5px] text-muted hover:text-score-bad rounded-md border border-border hover:border-score-bad/50 transition-colors"
            >
              Drop this one
            </button>
          </div>

          {/* Entry B actions */}
          <div className="p-4 border-l border-border flex flex-col gap-2">
            <button
              type="button"
              onClick={() => void handleDraftOffer(entryB)}
              className="w-full py-2 text-[12.5px] font-medium rounded-md bg-accent text-bg hover:bg-accent/80 transition-colors"
            >
              Draft offer on this one
            </button>
            <button
              type="button"
              onClick={() => void handleDrop(entryB)}
              className="w-full py-2 text-[12.5px] text-muted hover:text-score-bad rounded-md border border-border hover:border-score-bad/50 transition-colors"
            >
              Drop this one
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
