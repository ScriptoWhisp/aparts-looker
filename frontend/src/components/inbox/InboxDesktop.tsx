/**
 * InboxDesktop — 3-column card grid for triage on ≥768px.
 *
 * SPEC §2.3 desktop layout:
 * - "Inbox" title + dynamic subhead + keyboard hint
 * - Grid: 1 col default → 2 col md → 3 col xl
 * - Cards: photo thumbnail, score badge, meta line, verdict, action buttons
 * - Highest-score card has ring accent
 * - Keyboard: L=look closer, S=skip, ↑↓=navigate, Enter=look closer
 */

import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Entry } from '../../types/api'
import { approveEntry, rejectEntry, triggerCheck } from '../../lib/api'
import { QUERY_KEYS } from '../../lib/queries'
import { ScoreBadge } from '../shared/ScoreBadge'
import { scoreColor } from '../../lib/score'
import { fmtEur } from '../../lib/format'
import { useAppStore } from '../../lib/state'
import { useInboxSession } from '../../lib/state'

// ── Utils ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return ''
  try {
    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric', month: 'short',
    }).format(new Date(iso))
  } catch {
    return ''
  }
}

function metaLine(e: Entry): string {
  const parts: string[] = []
  if (e.district) parts.push(e.district)
  if (e.area_sqm) parts.push(`${e.area_sqm} m²`)
  if (e.year_built) parts.push(`${e.year_built}`)
  if (e.floor != null && e.floors_total != null) parts.push(`fl ${e.floor}/${e.floors_total}`)
  return parts.join(' · ')
}

function pricePerSqm(e: Entry): string {
  if (!e.price_eur || !e.area_sqm) return ''
  return `${Math.round(e.price_eur / e.area_sqm).toLocaleString('et-EE')} €/m²`
}

function oldestPendingDate(entries: Entry[]): string | null {
  const dates = entries
    .map((e) => e.created_at)
    .filter(Boolean)
    .sort() as string[]
  return dates[0] ?? null
}

// ── Sub-components ──────────────────────────────────────────────────────────

interface CardProps {
  entry: Entry
  isSelected: boolean
  isBest: boolean
  onLookCloser: (id: string) => Promise<void>
  onSkip: (id: string) => void
}

function InboxCard({ entry: e, isSelected, isBest, onLookCloser, onSkip }: CardProps) {
  const [loading, setLoading] = useState(false)

  async function handleLookCloser() {
    setLoading(true)
    await onLookCloser(e.id)
    setLoading(false)
  }

  return (
    <div
      className={[
        'bg-sunken rounded-lg overflow-hidden flex flex-col cursor-pointer',
        'transition-shadow duration-base',
        isSelected ? 'ring-2 ring-accent/50' : isBest ? 'ring-1 ring-accent/40' : '',
      ].join(' ')}
      role="article"
      aria-label={e.title}
    >
      {/* Photo */}
      <div className="relative h-[132px] bg-bg flex-shrink-0 overflow-hidden">
        {e.image_url ? (
          <img
            src={e.image_url}
            alt={e.title}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-faint text-[12px] font-mono">no photo</span>
          </div>
        )}
        {/* Score badge — top-right */}
        <div className="absolute top-2 right-2">
          <ScoreBadge score={e.score} size="md" />
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-col flex-1 p-3 gap-2">
        {/* Title */}
        <p className="font-sans font-medium text-[14px] text-text leading-snug line-clamp-2">
          {e.title || e.address || 'Untitled listing'}
        </p>

        {/* Meta line */}
        <p className="font-mono text-[11px] text-muted">
          {metaLine(e) || '—'}
        </p>

        {/* Price row */}
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[22px] font-semibold text-text leading-none">
            {fmtEur(e.price_eur)}
          </span>
          {pricePerSqm(e) && (
            <span className="font-mono text-[11px] text-muted">{pricePerSqm(e)}</span>
          )}
        </div>

        {/* Verdict */}
        {e.verdict && (
          <p
            className="text-[12px] text-text-2 leading-snug line-clamp-3 pl-2 border-l-2"
            style={{ borderColor: scoreColor(e.score) }}
          >
            {e.verdict}
          </p>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Actions */}
        <div className="flex gap-2 mt-1">
          <button
            onClick={() => void handleLookCloser()}
            disabled={loading}
            className={[
              'flex-1 h-9 rounded-md font-sans text-[13px] font-medium border-none cursor-pointer',
              'bg-accent text-white transition-[background,opacity] duration-fast',
              'hover:bg-accent/80 disabled:opacity-45 disabled:cursor-not-allowed',
            ].join(' ')}
          >
            {loading ? 'Moving…' : 'Look closer'}
          </button>
          <button
            onClick={() => onSkip(e.id)}
            disabled={loading}
            className={[
              'flex-1 h-9 rounded-md font-sans text-[13px] font-normal border border-border-strong cursor-pointer',
              'bg-transparent text-text-3 transition-[background,color] duration-fast',
              'hover:bg-white/[0.06] hover:text-text disabled:opacity-45 disabled:cursor-not-allowed',
            ].join(' ')}
          >
            Skip
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Empty state ─────────────────────────────────────────────────────────────

function EmptyState() {
  const [triggering, setTriggering] = useState(false)

  async function handleRunScrape() {
    setTriggering(true)
    try { await triggerCheck() } finally { setTriggering(false) }
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-6">
      <div className="bg-sunken rounded-xl p-10 max-w-sm w-full flex flex-col items-center gap-4 text-center">
        <p className="font-mono text-[10px] text-faint uppercase tracking-widest">Inbox</p>
        <h2 className="font-sans font-medium text-[18px] text-text">Inbox is empty</h2>
        <p className="text-[13px] text-text-3 leading-snug">
          No new listings waiting for review. Check back after the next scrape, or lower your
          score threshold to surface more candidates.
        </p>
        <div className="flex flex-col gap-2 w-full pt-2">
          <button
            className="h-9 rounded-md font-sans text-[13px] font-medium bg-accent text-white hover:bg-accent/80 transition-colors duration-fast border-none cursor-pointer"
            onClick={() => { window.location.hash = '#settings' }}
          >
            Adjust threshold
          </button>
          <button
            onClick={() => void handleRunScrape()}
            disabled={triggering}
            className="h-9 rounded-md font-sans text-[13px] font-normal border border-border-strong bg-transparent text-text-3 hover:bg-white/[0.06] hover:text-text transition-colors duration-fast cursor-pointer disabled:opacity-45"
          >
            {triggering ? 'Checking…' : 'Run scrape now'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main export ─────────────────────────────────────────────────────────────

interface InboxDesktopProps {
  entries: Entry[]
}

export function InboxDesktop({ entries }: InboxDesktopProps) {
  const client = useQueryClient()
  const { setTab, setSelectedListingId } = useAppStore()
  const { recordLookCloser, recordSkip, decidedIds } = useInboxSession()
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [skipId, setSkipId] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Filter out entries already decided in this session
  const queue = entries.filter((e) => !decidedIds.has(e.id))
  const best = queue[0] // queue is already sorted score desc from selectInbox

  // Keyboard navigation
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((document.activeElement as HTMLElement)?.tagName === 'INPUT') return
      if ((document.activeElement as HTMLElement)?.tagName === 'TEXTAREA') return

      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        e.preventDefault()
        setSelectedIndex((i) => Math.max(0, i - 1))
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        e.preventDefault()
        setSelectedIndex((i) => Math.min(queue.length - 1, i + 1))
      } else if (e.key === 'l' || e.key === 'L' || e.key === 'Enter') {
        e.preventDefault()
        const entry = queue[selectedIndex]
        if (entry) void handleLookCloser(entry.id)
      } else if (e.key === 's' || e.key === 'S') {
        e.preventDefault()
        const entry = queue[selectedIndex]
        if (entry) handleSkip(entry.id)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [queue, selectedIndex]) // eslint-disable-line react-hooks/exhaustive-deps

  // Clamp selected index when queue shrinks
  useEffect(() => {
    if (selectedIndex >= queue.length && queue.length > 0) {
      setSelectedIndex(queue.length - 1)
    }
  }, [queue.length, selectedIndex])

  async function handleLookCloser(id: string) {
    const entry = queue.find((e) => e.id === id)
    try {
      await approveEntry(id)
      recordLookCloser(id, entry?.title ?? id, entry?.score ?? null)
      void client.invalidateQueries({ queryKey: QUERY_KEYS.appData })
      setSelectedListingId(id)
      setTab('shortlist')
    } catch (err) {
      console.error('approve failed', err)
    }
  }

  function handleSkip(id: string) {
    setSkipId(id)
  }

  async function confirmSkip(id: string, reason: string | null) {
    const entry = queue.find((e) => e.id === id)
    try {
      await rejectEntry(id, reason ?? undefined)
      recordSkip(id, entry?.title ?? id, entry?.score ?? null, reason ?? undefined)
      void client.invalidateQueries({ queryKey: QUERY_KEYS.appData })
    } catch (err) {
      console.error('reject failed', err)
    } finally {
      setSkipId(null)
    }
  }

  // Header subhead
  const oldestDate = oldestPendingDate(entries)
  const subhead = oldestDate
    ? `${entries.length} new since ${fmtDate(oldestDate)}`
    : `${entries.length} pending`

  if (queue.length === 0) return <EmptyState />

  return (
    <div className="flex flex-col h-full" ref={containerRef}>
      {/* Header */}
      <div className="flex items-baseline justify-between px-6 py-4 flex-shrink-0">
        <div className="flex items-baseline gap-3">
          <h1 className="font-sans font-medium text-[22px] text-text">Inbox</h1>
          <span className="font-sans text-[13px] text-text-3">{subhead}</span>
        </div>
        <span className="font-mono text-[12px] text-faint hidden lg:block">
          L look closer · S skip · ↑↓ move
        </span>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto px-6 pb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {queue.map((entry, idx) => (
            <InboxCard
              key={entry.id}
              entry={entry}
              isSelected={idx === selectedIndex}
              isBest={entry === best && idx === 0}
              onLookCloser={handleLookCloser}
              onSkip={handleSkip}
            />
          ))}
        </div>
      </div>

      {/* Skip confirm modal (inline, simple) */}
      {skipId && (
        <SkipModal
          onConfirm={(reason) => void confirmSkip(skipId, reason)}
          onCancel={() => setSkipId(null)}
        />
      )}
    </div>
  )
}

// ── Skip reason modal (desktop) ─────────────────────────────────────────────

const SKIP_REASONS = ['Price', 'Location', 'Condition', 'Layout', 'Building', 'Other']

interface SkipModalProps {
  onConfirm: (reason: string | null) => void
  onCancel: () => void
}

function SkipModal({ onConfirm, onCancel }: SkipModalProps) {
  const [selected, setSelected] = useState<string | null>(null)

  return (
    <div className="fixed inset-0 z-[3000] flex items-end sm:items-center justify-center p-4 bg-black/60">
      <div className="bg-surface rounded-xl p-6 w-full max-w-sm shadow-lg">
        <h3 className="font-sans font-medium text-[16px] text-text mb-1">
          Skipped — what put you off?
        </h3>
        <p className="text-[12px] text-text-3 mb-4">
          Optional. Helps tune future scoring.
        </p>
        <div className="flex flex-wrap gap-2 mb-6">
          {SKIP_REASONS.map((r) => (
            <button
              key={r}
              onClick={() => setSelected(selected === r ? null : r)}
              className={[
                'px-3 py-1.5 rounded-sm text-[12px] font-sans border transition-colors duration-fast cursor-pointer',
                selected === r
                  ? 'bg-accent/20 border-accent/50 text-accent-lt'
                  : 'bg-transparent border-border-strong text-text-3 hover:border-border hover:text-text',
              ].join(' ')}
            >
              {r}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => onConfirm(selected)}
            className="flex-1 h-9 rounded-md font-sans text-[13px] font-medium bg-status-skip/20 text-status-skip border border-status-skip/30 hover:bg-status-skip/30 transition-colors duration-fast cursor-pointer"
          >
            Skip
          </button>
          <button
            onClick={onCancel}
            className="flex-1 h-9 rounded-md font-sans text-[13px] font-normal border border-border-strong bg-transparent text-text-3 hover:bg-white/[0.06] hover:text-text transition-colors duration-fast cursor-pointer"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
