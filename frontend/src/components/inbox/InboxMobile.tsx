/**
 * InboxMobile — Tinder-style swipe triage for mobile (≤767px).
 *
 * Wave 8A rework — behavior changes:
 *   1. After approve/skip: STAY on Inbox, advance to next card (no hash change)
 *   2. Skip flow: card slides off first → sheet appears → explicit Next button (no auto-close)
 *   3. Swipe indicators: full-card color-tinted overlay with big centered text
 *   4. All-in cost line in card body
 *   5. Cleared state: decision list with score, title, outcome tag
 *
 * Motion: Framer Motion drag="x" for swipe. AnimatePresence for enter/exit.
 * Sheet: vaul Drawer for skip reason picker.
 *
 * Layout:
 *   - Header: "Inbox" title + "N of M" right-aligned
 *   - Progress bar below header (N segments)
 *   - Card stack: front card (draggable) + peek card behind
 *   - Bottom action strip (pinned, above bottom-nav): Look closer / Skip / Later
 */

import { useState, useEffect, useCallback } from 'react'
import { motion, useMotionValue, useTransform, AnimatePresence } from 'framer-motion'
import { Drawer } from 'vaul'
import { useQueryClient } from '@tanstack/react-query'
import type { Entry } from '../../types/api'
import { approveEntry, rejectEntry, triggerCheck } from '../../lib/api'
import { QUERY_KEYS } from '../../lib/queries'
import { useSettings } from '../../lib/queries'
import { ScoreBadge } from '../shared/ScoreBadge'
import { scoreColor } from '../../lib/score'
import { fmtEur } from '../../lib/format'
import { computeAllIn } from '../../lib/cost'
import { useAppStore, useInboxSession } from '../../lib/state'

// ── Constants ──────────────────────────────────────────────────────────────

const SWIPE_THRESHOLD_PX = 80
const SWIPE_VELOCITY_THRESHOLD = 400

const SKIP_REASONS = ['Price', 'Location', 'Condition', 'Layout', 'Building', 'Other']

// ── Helpers ────────────────────────────────────────────────────────────────

function metaLine(e: Entry): string {
  const parts: string[] = []
  if (e.district) parts.push(e.district)
  if (e.rooms) parts.push(`${e.rooms} tuba`)
  if (e.area_sqm) parts.push(`${e.area_sqm} m²`)
  if (e.year_built) parts.push(`${e.year_built}`)
  if (e.floor != null && e.floors_total != null) parts.push(`${e.floor}/${e.floors_total}`)
  return parts.join(' · ')
}

function pricePerSqm(e: Entry): string {
  if (!e.price_eur || !e.area_sqm) return ''
  return `${Math.round(e.price_eur / e.area_sqm).toLocaleString('et-EE')} €/m²`
}

// ── Progress bar ────────────────────────────────────────────────────────────

interface ProgressBarProps {
  current: number  // 1-indexed position in triage
  total: number
}

function ProgressBar({ current, total }: ProgressBarProps) {
  const segments = Math.min(total, 8)
  const filledCount = Math.round((current / total) * segments)

  return (
    <div className="flex gap-1 px-3 pb-2">
      {Array.from({ length: segments }).map((_, i) => (
        <div
          key={i}
          className={[
            'flex-1 h-[2px] rounded-full transition-colors duration-base',
            i < filledCount ? 'bg-accent' : 'bg-border-strong',
          ].join(' ')}
        />
      ))}
    </div>
  )
}

// ── All-in cost line ────────────────────────────────────────────────────────

interface AllInLineProps {
  entry: Entry
}

function AllInLine({ entry }: AllInLineProps) {
  const { data: settings } = useSettings()
  const result = computeAllIn(entry, settings)

  if (result.noItems) {
    return (
      <p className="font-mono text-[11px] text-muted leading-none">
        all-in unknown
      </p>
    )
  }

  const allInK = Math.round(result.allIn / 1000)
  const district = entry.district ?? ''

  return (
    <p className="font-mono text-[11px] text-accent-lt leading-none">
      all-in ≈ {allInK}k{district ? ` · incl. reno est.` : ''}
    </p>
  )
}

// ── Skip reason drawer ──────────────────────────────────────────────────────

interface SkipDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  skippedTitle: string | null
  onConfirm: (reason: string | null) => void
  onUndo: () => void
}

function SkipDrawer({ open, onOpenChange, skippedTitle, onConfirm, onUndo }: SkipDrawerProps) {
  const [selected, setSelected] = useState<string | null>(null)

  // Reset chip selection when drawer opens for a new card
  useEffect(() => {
    if (open) setSelected(null)
  }, [open])

  function handleUndo() {
    onUndo()
  }

  function handleNext() {
    onConfirm(selected)
  }

  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        {/* No full-screen overlay — next card visible behind sheet */}
        <Drawer.Overlay className="fixed inset-0 z-[3000]" style={{ background: 'rgba(0,0,0,0.3)' }} />
        <Drawer.Content
          className="fixed bottom-0 left-0 right-0 z-[3001] bg-surface rounded-t-xl p-4 shadow-lg"
          style={{ outline: 'none', paddingBottom: 'calc(16px + env(safe-area-inset-bottom))' }}
        >
          {/* Grab handle */}
          <div className="mx-auto w-9 h-1 bg-border-strong rounded-full mb-4" />

          <h3 className="font-sans font-medium text-[16px] text-text mb-1">
            Skipped {skippedTitle}
          </h3>
          <p className="text-[12px] text-text-3 mb-4">
            What put you off? Optional — it only tunes what gets scored high next time.
          </p>

          {/* Reason chips */}
          <div className="flex flex-wrap gap-2 mb-6">
            {SKIP_REASONS.map((r) => (
              <button
                key={r}
                onClick={() => setSelected(selected === r ? null : r)}
                className={[
                  'px-4 py-2 rounded-sm text-[13px] font-sans transition-colors duration-fast cursor-pointer',
                  selected === r
                    ? 'bg-accent text-white border-transparent'
                    : 'bg-sunken border border-border-strong text-text-3 hover:border-border hover:text-text',
                ].join(' ')}
              >
                {r}
              </button>
            ))}
          </div>

          {/* Actions: Undo (left) + Next (right) */}
          <div className="flex gap-2">
            <button
              onClick={handleUndo}
              className="flex-1 h-11 rounded-md font-sans text-[14px] font-normal border border-border-strong bg-transparent text-text-3 hover:bg-white/[0.06] hover:text-text transition-colors duration-fast cursor-pointer"
            >
              Undo
            </button>
            <button
              onClick={handleNext}
              className="flex-1 h-11 rounded-md font-sans text-[14px] font-medium bg-transparent border border-accent text-accent-lt hover:bg-accent/10 transition-colors duration-fast cursor-pointer"
            >
              Next
            </button>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}

// ── Swipe card ──────────────────────────────────────────────────────────────

type DismissDirection = 'left' | 'right' | null

interface SwipeCardProps {
  entry: Entry
  exitDirection: DismissDirection
  onDismiss: (direction: 'left' | 'right') => void
}

function SwipeCard({ entry: e, exitDirection, onDismiss }: SwipeCardProps) {
  const x = useMotionValue(0)
  const rotate = useTransform(x, [-200, 0, 200], [-10, 0, 10])

  // Overlay opacity: 0 at center, 1 at ±120px drag
  const lookCloserOpacity = useTransform(x, [30, 120], [0, 1])
  const skipOpacity = useTransform(x, [-120, -30], [1, 0])

  const W = typeof window !== 'undefined' ? window.innerWidth + 300 : 700

  function handleDragEnd(_event: unknown, info: { offset: { x: number }; velocity: { x: number } }) {
    const { offset, velocity } = info
    if (offset.x > SWIPE_THRESHOLD_PX || velocity.x > SWIPE_VELOCITY_THRESHOLD) {
      onDismiss('right')
    } else if (offset.x < -SWIPE_THRESHOLD_PX || velocity.x < -SWIPE_VELOCITY_THRESHOLD) {
      onDismiss('left')
    }
  }

  const isDismissed = exitDirection !== null
  const exitX = exitDirection === 'right' ? W : exitDirection === 'left' ? -W : 0

  return (
    <motion.div
      drag={isDismissed ? false : 'x'}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.6}
      onDragEnd={handleDragEnd}
      style={{ x, rotate }}
      animate={isDismissed ? { x: exitX, opacity: 0, rotate: exitDirection === 'right' ? 15 : -15 } : { x: 0, opacity: 1 }}
      initial={{ x: 0, opacity: 1 }}
      transition={
        isDismissed
          ? { type: 'tween', duration: 0.22 }
          : { type: 'spring', stiffness: 400, damping: 30 }
      }
      className="absolute inset-0 bg-sunken rounded-xl overflow-hidden flex flex-col cursor-grab active:cursor-grabbing touch-none select-none z-20"
    >
      {/* Look-closer tint overlay (drag right) */}
      <motion.div
        className="absolute inset-0 pointer-events-none z-30 rounded-xl flex items-center justify-center"
        style={{ opacity: lookCloserOpacity, backgroundColor: 'rgba(79,185,141,0.18)' }}
      >
        <span className="font-sans font-semibold text-[22px] text-score-best drop-shadow">
          Look closer
        </span>
      </motion.div>

      {/* Skip tint overlay (drag left) */}
      <motion.div
        className="absolute inset-0 pointer-events-none z-30 rounded-xl flex items-center justify-center"
        style={{ opacity: skipOpacity, backgroundColor: 'rgba(196,99,95,0.18)' }}
      >
        <span className="font-sans font-semibold text-[22px] text-score-bad drop-shadow">
          Skip
        </span>
      </motion.div>

      {/* Photo */}
      <div className="relative flex-shrink-0 bg-bg overflow-hidden" style={{ height: '55%' }}>
        {e.image_url ? (
          <img
            src={e.image_url}
            alt={e.title}
            className="w-full h-full object-cover pointer-events-none"
            draggable={false}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-faint text-[12px] font-mono">no photo</span>
          </div>
        )}
        {/* Score badge top-right */}
        <div className="absolute top-2 right-2 z-20">
          <ScoreBadge score={e.score} size="lg" />
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-col flex-1 p-4 gap-2 overflow-hidden">
        {/* Title */}
        <p className="font-sans font-medium text-[17px] text-text leading-snug line-clamp-2">
          {e.title || e.address || 'Untitled listing'}
        </p>

        {/* Meta */}
        <p className="font-mono text-[12px] text-text-3">
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

        {/* All-in line */}
        <AllInLine entry={e} />

        {/* Verdict */}
        {e.verdict && (
          <p
            className="text-[13px] text-text-2 leading-snug line-clamp-3 pl-2 border-l-2 mt-1"
            style={{ borderColor: scoreColor(e.score) }}
          >
            {e.verdict}
          </p>
        )}
      </div>
    </motion.div>
  )
}

// ── Peek card (behind front card) ──────────────────────────────────────────
//
// Renders the SAME full-content shape as SwipeCard (photo + title + meta +
// price + all-in + verdict) but is dimmed (opacity-40) and slightly scaled
// down / offset so it reads as a "card behind". When the front card exits,
// AnimatePresence unmounts it and the next SwipeCard mounts in its place —
// the transition reads as "stack promotes cleanly" rather than showing a
// dim placeholder with no text.

interface PeekCardProps {
  entry: Entry
}

function PeekCard({ entry: e }: PeekCardProps) {
  const scoreCol = scoreColor(e.score)

  return (
    <motion.div
      initial={{ scale: 0.94, opacity: 0.3, y: 6 }}
      animate={{ scale: 0.95, opacity: 0.4, y: 0 }}
      exit={{ scale: 0.92, opacity: 0, y: 10 }}
      transition={{ type: 'spring', stiffness: 300, damping: 28 }}
      className="absolute top-1.5 left-0 right-0 bottom-[-6px] bg-sunken rounded-xl z-10 overflow-hidden flex flex-col pointer-events-none select-none"
    >
      {/* Photo */}
      <div className="relative flex-shrink-0 bg-bg overflow-hidden" style={{ height: '55%' }}>
        {e.image_url ? (
          <img
            src={e.image_url}
            alt=""
            className="w-full h-full object-cover"
            draggable={false}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-faint text-[12px] font-mono">no photo</span>
          </div>
        )}
        {/* Score badge */}
        <div className="absolute top-2 right-2 z-20">
          <ScoreBadge score={e.score} size="lg" />
        </div>
      </div>

      {/* Content — mirrors SwipeCard body */}
      <div className="flex flex-col flex-1 p-4 gap-2 overflow-hidden">
        <p className="font-sans font-medium text-[17px] text-text leading-snug line-clamp-2">
          {e.title || e.address || 'Untitled listing'}
        </p>
        <p className="font-mono text-[12px] text-text-3">
          {metaLine(e) || '—'}
        </p>
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[22px] font-semibold text-text leading-none">
            {fmtEur(e.price_eur)}
          </span>
          {pricePerSqm(e) && (
            <span className="font-mono text-[11px] text-muted">{pricePerSqm(e)}</span>
          )}
        </div>
        {e.verdict && (
          <p
            className="text-[13px] text-text-2 leading-snug line-clamp-2 pl-2 border-l-2 mt-1"
            style={{ borderColor: scoreCol }}
          >
            {e.verdict}
          </p>
        )}
      </div>
    </motion.div>
  )
}

// ── Cleared state ───────────────────────────────────────────────────────────

import type { InboxDecision } from '../../lib/state'

interface ClearedStateProps {
  decisions: InboxDecision[]
  nextCheckTime: string | null
  startEpoch: number
}

function ClearedState({ decisions, nextCheckTime, startEpoch }: ClearedStateProps) {
  const { setTab } = useAppStore()
  const shortlisted = decisions.filter((d) => d.outcome === 'shortlisted').length
  const totalCount = decisions.length
  const elapsedMin = Math.round((Date.now() - startEpoch) / 60_000)

  // Format next check time
  const nextCheckLabel = nextCheckTime
    ? new Date(nextCheckTime).toLocaleTimeString('et-EE', { hour: '2-digit', minute: '2-digit' })
    : null

  return (
    <div className="flex flex-col h-full px-4 pt-4 pb-2 overflow-auto">
      {/* Summary header */}
      <div className="mb-4">
        <h2 className="font-sans font-medium text-[22px] text-text leading-tight mb-1">
          Inbox clear
        </h2>
        <p className="font-sans text-[13px] text-text-3">
          {totalCount} decided in {elapsedMin || 1} minute{elapsedMin !== 1 ? 's' : ''}.
          {shortlisted > 0 ? ` ${shortlisted > 1 ? `${shortlisted} went` : 'One went'} to the shortlist.` : ''}
          {nextCheckLabel ? ` Next scrape ${nextCheckLabel}.` : ''}
        </p>
      </div>

      {/* Decision list */}
      <div className="flex flex-col gap-3 flex-1 min-h-0 overflow-auto mb-4">
        {decisions.map((d) => (
          <div
            key={d.id}
            className="flex items-center gap-3"
          >
            {/* Score */}
            <span
              className="font-mono text-[13px] font-semibold flex-none w-8 text-right"
              style={{ color: scoreColor(d.score) }}
            >
              {d.score ?? '—'}
            </span>

            {/* Title */}
            <span
              className={[
                'font-sans text-[14px] flex-1 min-w-0 truncate',
                d.outcome === 'skipped' ? 'line-through text-muted opacity-60' : 'text-text',
              ].join(' ')}
            >
              {d.title}
            </span>

            {/* Outcome tag */}
            <span
              className={[
                'font-mono text-[11px] flex-none px-2 py-0.5 rounded-sm',
                d.outcome === 'shortlisted'
                  ? 'text-status-short bg-status-short/10'
                  : 'text-muted bg-sunken',
              ].join(' ')}
            >
              {d.outcome === 'shortlisted' ? 'shortlisted' : (d.reason?.toLowerCase() ?? 'skipped')}
            </span>
          </div>
        ))}
      </div>

      {/* Open shortlist CTA */}
      {shortlisted > 0 && (
        <button
          onClick={() => setTab('shortlist')}
          className="w-full py-4 rounded-md font-sans text-[15px] font-medium bg-transparent border border-accent text-accent-lt hover:bg-accent/10 transition-colors duration-fast cursor-pointer flex-none"
        >
          Open shortlist · {shortlisted}
        </button>
      )}
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
    <div className="flex flex-col items-center justify-center flex-1 px-4 text-center">
      <div className="bg-sunken rounded-xl p-8 w-full max-w-xs flex flex-col items-center gap-4">
        <p className="font-mono text-[10px] text-faint uppercase tracking-widest">Inbox</p>
        <h2 className="font-sans font-medium text-[18px] text-text">Inbox is empty</h2>
        <p className="text-[13px] text-text-3 leading-snug">
          No new listings waiting. Lower your score threshold or run a scrape.
        </p>
        <div className="flex flex-col gap-2 w-full pt-2">
          <button
            className="h-11 rounded-md font-sans text-[14px] font-medium bg-accent text-white hover:bg-accent/80 transition-colors duration-fast border-none cursor-pointer"
            onClick={() => { window.location.hash = '#settings' }}
          >
            Adjust threshold
          </button>
          <button
            onClick={() => void handleRunScrape()}
            disabled={triggering}
            className="h-11 rounded-md font-sans text-[14px] font-normal border border-border-strong bg-transparent text-text-3 hover:bg-white/[0.06] hover:text-text transition-colors duration-fast cursor-pointer disabled:opacity-45"
          >
            {triggering ? 'Checking…' : 'Run scrape now'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main export ─────────────────────────────────────────────────────────────

interface InboxMobileProps {
  entries: Entry[]
  nextCheckTime?: string | null
}

export function InboxMobile({ entries, nextCheckTime = null }: InboxMobileProps) {
  const client = useQueryClient()
  const session = useInboxSession()

  // Track session start for elapsed time display
  const [sessionStartEpoch] = useState(() => Date.now())

  // Local queue starts as sorted entries; Later'd go to end
  const [localQueue, setLocalQueue] = useState<Entry[]>(() => {
    const later = session.laterIds
    const withoutLater = entries.filter((e) => !later.includes(e.id))
    const laterEntries = later
      .map((id) => entries.find((e) => e.id === id))
      .filter(Boolean) as Entry[]
    return [...withoutLater, ...laterEntries]
  })

  // Sync when entries prop changes (TanStack Query re-fetch)
  useEffect(() => {
    setLocalQueue((prev) => {
      const prevIds = new Set(prev.map((e) => e.id))
      const newEntries = entries.filter((e) => !prevIds.has(e.id))
      if (newEntries.length === 0) return prev
      return [...prev, ...newEntries]
    })
  }, [entries])

  // Active queue (undecided entries in order)
  const active = localQueue.filter((e) => !session.decidedIds.has(e.id))
  const currentEntry = active[0] ?? null
  const peekEntry = active[1] ?? null

  const isCleared = active.length === 0 && session.triaged > 0
  const isEmpty = entries.length === 0 && session.triaged === 0

  // Swipe direction tracking for front card exit animation
  const [exitDirection, setExitDirection] = useState<DismissDirection>(null)
  // Prevent multiple rapid triggers
  const [isTransitioning, setIsTransitioning] = useState(false)

  // Skip drawer state — card already dismissed when drawer opens
  const [showSkipSheet, setShowSkipSheet] = useState(false)
  const [pendingSkipId, setPendingSkipId] = useState<string | null>(null)
  const [pendingSkipTitle, setPendingSkipTitle] = useState<string | null>(null)
  const [pendingSkipScore, setPendingSkipScore] = useState<number | null>(null)

  // Track the dismissed entry so we can undo back into queue
  const [lastDismissedEntry, setLastDismissedEntry] = useState<Entry | null>(null)

  const advanceQueue = useCallback((dismissedId: string) => {
    // Remove from front of active — decidedIds handles exclusion or we splice localQueue
    setLocalQueue((prev) => prev.filter((e) => e.id !== dismissedId))
    setExitDirection(null)
    setIsTransitioning(false)
  }, [])

  const handleLookCloser = useCallback(async () => {
    if (!currentEntry || isTransitioning) return
    const entry = currentEntry
    const id = entry.id
    setIsTransitioning(true)
    setExitDirection('right')

    // Fire-and-forget approve — record optimistically
    approveEntry(id).catch((err) => console.error('approve failed', err))
    session.recordLookCloser(id, entry.title || entry.address || 'Untitled', entry.score)
    void client.invalidateQueries({ queryKey: QUERY_KEYS.appData })

    // Wait for slide-out animation then advance
    setTimeout(() => advanceQueue(id), 250)
  }, [currentEntry, isTransitioning, session, client, advanceQueue])

  const handleSwipeDismiss = useCallback((direction: 'left' | 'right') => {
    if (!currentEntry || isTransitioning) return
    const entry = currentEntry
    setIsTransitioning(true)
    setLastDismissedEntry(entry)
    setExitDirection(direction)

    if (direction === 'right') {
      // Approve flow — same as Look closer button
      approveEntry(entry.id).catch((err) => console.error('approve failed', err))
      session.recordLookCloser(entry.id, entry.title || entry.address || 'Untitled', entry.score)
      void client.invalidateQueries({ queryKey: QUERY_KEYS.appData })
      setTimeout(() => advanceQueue(entry.id), 250)
    } else {
      // Skip flow — card slides off, then sheet appears
      // Remove from local queue but don't record in session yet (Undo can revert)
      setTimeout(() => {
        setLocalQueue((prev) => prev.filter((e) => e.id !== entry.id))
        setExitDirection(null)
        setIsTransitioning(false)
        // Open sheet after card is gone
        setPendingSkipId(entry.id)
        setPendingSkipTitle(entry.title || entry.address || 'Untitled')
        setPendingSkipScore(entry.score)
        setShowSkipSheet(true)
      }, 250)
    }
  }, [currentEntry, isTransitioning, session, client, advanceQueue])

  const handleSkipButton = useCallback(() => {
    if (!currentEntry || isTransitioning) return
    handleSwipeDismiss('left')
  }, [currentEntry, isTransitioning, handleSwipeDismiss])

  const confirmSkip = useCallback(async (reason: string | null) => {
    const id = pendingSkipId
    const title = pendingSkipTitle
    const score = pendingSkipScore
    if (!id) return  // guard against double-fire from vaul onOpenChange
    // Clear FIRST so any secondary onOpenChange trigger sees pendingSkipId=null
    // and short-circuits without a second confirmSkip call.
    setPendingSkipId(null)
    setPendingSkipTitle(null)
    setPendingSkipScore(null)
    setLastDismissedEntry(null)
    // Record in session immediately (optimistic) so the next card is unblocked
    // even if the network call is slow.
    session.recordSkip(id, title ?? 'Untitled', score, reason ?? undefined)
    setShowSkipSheet(false)
    try {
      await rejectEntry(id, reason ?? undefined)
      void client.invalidateQueries({ queryKey: QUERY_KEYS.appData })
    } catch (err) {
      console.error('reject failed', err)
    }
  }, [pendingSkipId, pendingSkipTitle, pendingSkipScore, session, client])

  const handleUndo = useCallback(() => {
    // Clear pendingSkipId FIRST — this is the signal to onOpenChange that
    // the drawer's imminent close is a controlled Undo, not a swipe-down
    // dismiss. Without this, confirmSkip(null) also fires and races.
    setPendingSkipId(null)
    setPendingSkipTitle(null)
    setPendingSkipScore(null)
    // Restore the just-skipped card to the front of the queue
    if (lastDismissedEntry) {
      setLocalQueue((prev) => [lastDismissedEntry, ...prev.filter((e) => e.id !== lastDismissedEntry.id)])
    }
    setLastDismissedEntry(null)
    setShowSkipSheet(false)
  }, [lastDismissedEntry])

  const handleLater = useCallback(() => {
    if (!currentEntry || isTransitioning) return
    const entry = currentEntry
    session.recordLater(entry.id)
    setLocalQueue((prev) => {
      const without = prev.filter((e) => e.id !== entry.id)
      return [...without, entry]
    })
  }, [currentEntry, isTransitioning, session])

  if (isEmpty) return (
    <div className="flex flex-col h-[calc(100dvh-48px-56px)]">
      <EmptyState />
    </div>
  )

  if (isCleared) return (
    <div className="flex flex-col h-[calc(100dvh-48px-56px)]">
      <ClearedState
        decisions={session.decisions}
        nextCheckTime={nextCheckTime}
        startEpoch={sessionStartEpoch}
      />
    </div>
  )

  // Progress tracking
  const totalForProgress = active.length + session.triaged
  const currentProgress = session.triaged + 1

  return (
    <div className="flex flex-col h-[calc(100dvh-48px-56px)] overflow-hidden" data-testid="inbox-mobile">
      {/* Header row */}
      <div className="flex items-baseline justify-between px-3 pt-3 pb-1 flex-shrink-0">
        <h1 className="font-sans font-medium text-[22px] text-text">Inbox</h1>
        <span className="font-mono text-[12px] text-muted">
          {currentProgress} of {totalForProgress}
        </span>
      </div>

      {/* Progress bar */}
      {totalForProgress > 1 && (
        <ProgressBar current={currentProgress} total={totalForProgress} />
      )}

      {/* Card stack */}
      <div className="relative flex-1 mx-3 mb-2 min-h-0">
        {/* Peek card behind */}
        <AnimatePresence>
          {peekEntry && !showSkipSheet && (
            <PeekCard key={`peek-${peekEntry.id}`} entry={peekEntry} />
          )}
        </AnimatePresence>

        {/* Front card — keyed by id so state resets on card change */}
        <AnimatePresence mode="wait">
          {currentEntry && (
            <SwipeCard
              key={currentEntry.id}
              entry={currentEntry}
              exitDirection={exitDirection}
              onDismiss={handleSwipeDismiss}
            />
          )}
        </AnimatePresence>
      </div>

      {/* Action strip — pinned above bottom-nav */}
      <div className="flex-shrink-0 px-4 pt-2 pb-3 flex gap-2">
        <button
          onClick={() => void handleLookCloser()}
          disabled={!currentEntry || isTransitioning}
          className="flex-1 h-12 rounded-md font-sans text-[15px] font-medium bg-transparent border border-accent text-accent-lt hover:bg-accent/10 transition-colors duration-fast cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
        >
          Look closer
        </button>
        <button
          onClick={handleSkipButton}
          disabled={!currentEntry || isTransitioning}
          className="flex-1 h-12 rounded-md font-sans text-[14px] font-normal border border-border-strong bg-sunken text-text-3 hover:bg-white/[0.06] hover:text-text transition-colors duration-fast cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
        >
          Skip
        </button>
        <button
          onClick={handleLater}
          disabled={!currentEntry || isTransitioning}
          className="w-16 h-12 rounded-md font-sans text-[13px] font-normal bg-transparent text-faint hover:text-text-3 transition-colors duration-fast border-none cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
        >
          Later
        </button>
      </div>

      {/* Skip reason drawer. onOpenChange only closes the sheet visually —
         the commit paths are explicit: onConfirm (Next tap) or onUndo (Undo
         tap OR swipe-down dismiss). We treat swipe-down as Next-with-no-reason
         via onConfirm, but ONLY when we still have a pendingSkipId — the
         confirmSkip guard prevents double-fire when Undo already cleared
         state a moment ago. */}
      <SkipDrawer
        open={showSkipSheet}
        onOpenChange={(open) => {
          if (open) return  // opening is driven by handleSwipeDismiss; ignore
          // Closing: if pendingSkipId is still set, this is a swipe-down
          // dismissal (not a Next/Undo tap) — commit as skip-no-reason.
          if (pendingSkipId) {
            void confirmSkip(null)
          } else {
            setShowSkipSheet(false)
          }
        }}
        skippedTitle={pendingSkipTitle}
        onConfirm={(reason) => void confirmSkip(reason)}
        onUndo={handleUndo}
      />
    </div>
  )
}
