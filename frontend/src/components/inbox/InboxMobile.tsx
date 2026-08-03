/**
 * InboxMobile — single-card swipe triage for mobile (≤767px).
 *
 * SPEC §2.3 mobile layout + mockup 3a. This is the primary triage surface.
 *
 * Motion: Framer Motion drag="x" for horizontal swipe. Handles iOS Safari
 * bounce-scroll correctly (no manual touch event handlers needed).
 *
 * Sheet: vaul Drawer for skip reason picker.
 *
 * Layout:
 *   - Top: "N of M" progress bar (6 segment)
 *   - Middle: card stack (peek card behind + front card)
 *   - Bottom: Look closer / Skip / Later buttons (pinned)
 *   - Directional hint pills: "Look closer" (right) + "Skip" (left)
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, useMotionValue, useTransform, AnimatePresence } from 'framer-motion'
import { Drawer } from 'vaul'
import { useQueryClient } from '@tanstack/react-query'
import type { Entry } from '../../types/api'
import { approveEntry, rejectEntry, triggerCheck } from '../../lib/api'
import { QUERY_KEYS } from '../../lib/queries'
import { ScoreBadge } from '../shared/ScoreBadge'
import { scoreColor } from '../../lib/score'
import { fmtEur } from '../../lib/format'
import { useAppStore, useInboxSession } from '../../lib/state'

// ── Constants ──────────────────────────────────────────────────────────────

const SWIPE_THRESHOLD_PX = 100
const SWIPE_VELOCITY_THRESHOLD = 500
const SKIP_REASON_TIMEOUT_S = 8

const SKIP_REASONS = ['Price', 'Location', 'Condition', 'Layout', 'Building', 'Other']

// ── Helpers ────────────────────────────────────────────────────────────────

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

// ── Progress bar ────────────────────────────────────────────────────────────

interface ProgressBarProps {
  current: number  // 1-indexed (current card being triaged)
  total: number
}

function ProgressBar({ current, total }: ProgressBarProps) {
  const segments = Math.min(total, 6)
  const filledCount = Math.round((current / total) * segments)

  return (
    <div className="flex flex-col gap-1.5 px-3 pt-3 pb-2 flex-shrink-0">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] text-muted">
          {current} of {total}
        </span>
      </div>
      <div className="flex gap-1">
        {Array.from({ length: segments }).map((_, i) => (
          <div
            key={i}
            className={[
              'flex-1 h-[2px] rounded-full transition-colors duration-base',
              i < filledCount ? 'bg-accent' : 'bg-border',
            ].join(' ')}
          />
        ))}
      </div>
    </div>
  )
}

// ── Skip reason drawer ──────────────────────────────────────────────────────

interface SkipDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (reason: string | null) => void
  onUndo: () => void
}

function SkipDrawer({ open, onOpenChange, onConfirm, onUndo }: SkipDrawerProps) {
  const [selected, setSelected] = useState<string | null>(null)
  const [countdown, setCountdown] = useState(SKIP_REASON_TIMEOUT_S)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Auto-close after SKIP_REASON_TIMEOUT_S seconds
  useEffect(() => {
    if (!open) {
      setSelected(null)
      setCountdown(SKIP_REASON_TIMEOUT_S)
      return
    }

    setCountdown(SKIP_REASON_TIMEOUT_S)

    timerRef.current = setTimeout(() => {
      onConfirm(selected)
    }, SKIP_REASON_TIMEOUT_S * 1000)

    intervalRef.current = setInterval(() => {
      setCountdown((c) => Math.max(0, c - 1))
    }, 1000)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  function clearTimers() {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (intervalRef.current) clearInterval(intervalRef.current)
  }

  function handleUndo() {
    clearTimers()
    onUndo()
  }

  function handleChipSelect(reason: string) {
    clearTimers()
    setSelected(reason)
    // Chip selection does NOT auto-close — user can still hit Undo or just wait
    // Restart timer after chip selection
    timerRef.current = setTimeout(() => {
      onConfirm(reason)
    }, SKIP_REASON_TIMEOUT_S * 1000)
    intervalRef.current = setInterval(() => {
      setCountdown((c) => Math.max(0, c - 1))
    }, 1000)
    setCountdown(SKIP_REASON_TIMEOUT_S)
  }

  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-black/60 z-[3000]" />
        <Drawer.Content
          className="fixed bottom-0 left-0 right-0 z-[3001] bg-surface rounded-t-xl p-4 pb-10 shadow-lg"
          style={{ outline: 'none' }}
        >
          {/* Grab handle */}
          <div className="mx-auto w-9 h-1 bg-border-strong rounded-full mb-4" />

          <h3 className="font-sans font-medium text-[16px] text-text mb-1">
            Skipped — what put you off?
          </h3>
          <p className="text-[12px] text-text-3 mb-4">
            Optional. It only tunes future scoring.
          </p>

          {/* Reason chips */}
          <div className="flex flex-wrap gap-2">
            {SKIP_REASONS.map((r) => (
              <button
                key={r}
                onClick={() => handleChipSelect(r)}
                className={[
                  'px-3 py-2 rounded-sm text-[13px] font-sans border transition-colors duration-fast cursor-pointer',
                  selected === r
                    ? 'bg-accent/20 border-accent/50 text-accent-lt'
                    : 'bg-sunken border-border-strong text-text-3 hover:border-border hover:text-text',
                ].join(' ')}
              >
                {r}
              </button>
            ))}
          </div>

          {/* Footer: undo + countdown */}
          <div className="mt-6 flex items-center gap-3">
            <button
              onClick={handleUndo}
              className="h-9 px-4 rounded-md font-sans text-[13px] font-normal border border-border-strong bg-transparent text-text-3 hover:bg-white/[0.06] hover:text-text transition-colors duration-fast cursor-pointer"
            >
              Undo
            </button>
            <span className="font-mono text-[11px] text-faint">
              auto-closes {countdown}s
            </span>
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
  onLookCloser: () => void
  onSkip: () => void
}

function SwipeCard({ entry: e, onLookCloser, onSkip }: SwipeCardProps) {
  const x = useMotionValue(0)
  const rotate = useTransform(x, [-200, 0, 200], [-15, 0, 15])

  // Hint pill opacities
  const lookCloserHintOpacity = useTransform(x, [0, 80, 160], [0, 0.7, 1])
  const skipHintOpacity = useTransform(x, [-160, -80, 0], [1, 0.7, 0])

  // Background color tint on drag
  const lookCloserTint = useTransform(x, [0, 160], ['rgba(79,185,141,0)', 'rgba(79,185,141,0.12)'])
  const skipTint = useTransform(x, [-160, 0], ['rgba(196,99,95,0.12)', 'rgba(196,99,95,0)'])

  const [dismissed, setDismissed] = useState<DismissDirection>(null)

  // Screen width for fling animation
  const W = typeof window !== 'undefined' ? window.innerWidth + 200 : 600

  function handleDragEnd(_event: unknown, info: { offset: { x: number }; velocity: { x: number } }) {
    const { offset, velocity } = info
    if (offset.x > SWIPE_THRESHOLD_PX || velocity.x > SWIPE_VELOCITY_THRESHOLD) {
      setDismissed('right')
    } else if (offset.x < -SWIPE_THRESHOLD_PX || velocity.x < -SWIPE_VELOCITY_THRESHOLD) {
      setDismissed('left')
    }
    // else: snap back (framer-motion handles this automatically with dragConstraints)
  }

  // Trigger callbacks after dismiss animation
  useEffect(() => {
    if (dismissed === 'right') {
      const t = setTimeout(onLookCloser, 280)
      return () => clearTimeout(t)
    }
    if (dismissed === 'left') {
      const t = setTimeout(onSkip, 280)
      return () => clearTimeout(t)
    }
  }, [dismissed, onLookCloser, onSkip])

  return (
    <div className="absolute inset-0">
      {/* Hint pills — absolute, behind card during drag */}
      <motion.div
        className="absolute top-5 left-3 z-10 px-3 py-1.5 rounded-full bg-score-best/20 border border-score-best/40 pointer-events-none"
        style={{ opacity: lookCloserHintOpacity }}
      >
        <span className="font-sans text-[12px] font-medium text-score-best">Look closer</span>
      </motion.div>

      <motion.div
        className="absolute top-5 right-3 z-10 px-3 py-1.5 rounded-full bg-status-skip/20 border border-status-skip/40 pointer-events-none"
        style={{ opacity: skipHintOpacity }}
      >
        <span className="font-sans text-[12px] font-medium text-status-skip">Skip</span>
      </motion.div>

      {/* Card */}
      <motion.div
        drag={dismissed ? false : 'x'}
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.7}
        onDragEnd={handleDragEnd}
        style={{
          x,
          rotate,
          backgroundColor: dismissed === 'right' ? 'rgba(79,185,141,0.08)'
            : dismissed === 'left' ? 'rgba(196,99,95,0.08)'
            : undefined,
        }}
        animate={
          dismissed === 'right' ? { x: W, opacity: 0 }
          : dismissed === 'left' ? { x: -W, opacity: 0 }
          : { x: 0, opacity: 1 }
        }
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        className="absolute inset-0 bg-sunken rounded-xl overflow-hidden flex flex-col cursor-grab active:cursor-grabbing touch-none select-none z-20"
      >
        {/* Drag tint overlays */}
        <motion.div
          className="absolute inset-0 pointer-events-none z-10 rounded-xl"
          style={{ backgroundColor: lookCloserTint }}
        />
        <motion.div
          className="absolute inset-0 pointer-events-none z-10 rounded-xl"
          style={{ backgroundColor: skipTint }}
        />

        {/* Photo */}
        <div className="relative flex-shrink-0 h-[200px] bg-bg overflow-hidden">
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
          {/* Score badge */}
          <div className="absolute top-2 right-2 z-20">
            <ScoreBadge score={e.score} size="lg" />
          </div>
        </div>

        {/* Content */}
        <div className="flex flex-col flex-1 p-4 gap-2 overflow-hidden">
          {/* Title */}
          <p className="font-sans font-medium text-[15px] text-text leading-snug line-clamp-2">
            {e.title || e.address || 'Untitled listing'}
          </p>

          {/* Meta */}
          <p className="font-mono text-[11px] text-muted">
            {metaLine(e) || '—'}
          </p>

          {/* Price */}
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-[24px] font-semibold text-text leading-none">
              {fmtEur(e.price_eur)}
            </span>
            {pricePerSqm(e) && (
              <span className="font-mono text-[11px] text-muted">{pricePerSqm(e)}</span>
            )}
          </div>

          {/* Verdict */}
          {e.verdict && (
            <p
              className="text-[12px] text-text-2 leading-snug line-clamp-4 pl-2 border-l-2"
              style={{ borderColor: scoreColor(e.score) }}
            >
              {e.verdict}
            </p>
          )}
        </div>
      </motion.div>
    </div>
  )
}

// ── Cleared state ───────────────────────────────────────────────────────────

interface ClearedStateProps {
  triaged: number
  shortlisted: number
  skipped: number
}

function ClearedState({ triaged, shortlisted, skipped }: ClearedStateProps) {
  const { setTab } = useAppStore()

  return (
    <div className="flex flex-col items-center justify-center flex-1 px-6 text-center">
      <div className="bg-sunken rounded-xl p-8 w-full max-w-xs flex flex-col items-center gap-4">
        <p className="font-mono text-[10px] text-faint uppercase tracking-widest">Done</p>
        <h2 className="font-sans font-medium text-[18px] text-text leading-snug">
          You triaged {triaged} in this session
        </h2>
        <p className="text-[13px] text-text-3">
          {shortlisted} shortlisted · {skipped} skipped
        </p>
        {shortlisted > 0 && (
          <button
            onClick={() => setTab('shortlist')}
            className="mt-2 w-full h-12 rounded-md font-sans text-[15px] font-medium bg-accent text-white hover:bg-accent/80 transition-colors duration-fast border-none cursor-pointer"
          >
            Open shortlist · {shortlisted}
          </button>
        )}
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
}

export function InboxMobile({ entries }: InboxMobileProps) {
  const client = useQueryClient()
  const { setTab, setSelectedListingId } = useAppStore()
  const session = useInboxSession()

  // Local queue: starts as sorted entries, Later'd cards go to end
  const [localQueue, setLocalQueue] = useState<Entry[]>(() => {
    // Put later'd ids at back, keep everything else
    const later = session.laterIds
    const withoutLater = entries.filter((e) => !later.includes(e.id))
    const laterEntries = later
      .map((id) => entries.find((e) => e.id === id))
      .filter(Boolean) as Entry[]
    return [...withoutLater, ...laterEntries]
  })

  // Current index in localQueue (cursor advances as entries are decided)
  const [cursor] = useState(0)

  // Sync localQueue when entries prop changes (e.g. TanStack Query re-fetch)
  // Only add new entries that aren't already in our local queue
  useEffect(() => {
    setLocalQueue((prev) => {
      const prevIds = new Set(prev.map((e) => e.id))
      const newEntries = entries.filter((e) => !prevIds.has(e.id))
      if (newEntries.length === 0) return prev
      return [...prev, ...newEntries]
    })
  }, [entries])

  // Skip drawer state
  const [showSkipSheet, setShowSkipSheet] = useState(false)
  const [pendingSkipId, setPendingSkipId] = useState<string | null>(null)

  // Filter out already-decided entries
  const active = localQueue.filter((e) => !session.decidedIds.has(e.id))
  const currentEntry = active[cursor] ?? null

  // When cursor is at end of active queue, if there are Later'd entries,
  // they're already at end of active — keep showing them
  const isCleared = active.length === 0 && session.triaged > 0
  const isEmpty = entries.length === 0 && session.triaged === 0

  // Peek entry (card behind current)
  const peekEntry = active[cursor + 1] ?? null

  const handleLookCloser = useCallback(async () => {
    if (!currentEntry) return
    const id = currentEntry.id
    try {
      await approveEntry(id)
      session.recordLookCloser(id)
      void client.invalidateQueries({ queryKey: QUERY_KEYS.appData })
      setSelectedListingId(id)
      setTab('shortlist')
    } catch (err) {
      console.error('approve failed', err)
    }
  }, [currentEntry, session, client, setSelectedListingId, setTab])

  function handleSkip() {
    if (!currentEntry) return
    setPendingSkipId(currentEntry.id)
    setShowSkipSheet(true)
  }

  async function confirmSkip(reason: string | null) {
    const id = pendingSkipId
    if (!id) return
    setShowSkipSheet(false)
    try {
      await rejectEntry(id, reason ?? undefined)
      session.recordSkip(id)
      void client.invalidateQueries({ queryKey: QUERY_KEYS.appData })
    } catch (err) {
      console.error('reject failed', err)
    }
    setPendingSkipId(null)
  }

  function handleUndo() {
    // Undo: cancel the skip, remove from decided, keep in queue
    setShowSkipSheet(false)
    setPendingSkipId(null)
    // Don't record anything — the entry stays in queue
  }

  function handleLater() {
    if (!currentEntry) return
    session.recordLater(currentEntry.id)
    // Move to back of localQueue
    setLocalQueue((prev) => {
      const without = prev.filter((e) => e.id !== currentEntry.id)
      return [...without, currentEntry]
    })
    // Advance cursor (next card comes forward)
    // cursor stays same — the queue shifted around us
    // If we were at the last card, we go back to 0 (the card was moved to end)
    // Since we filter by decidedIds, advancing isn't needed — just let re-render handle it
  }

  if (isEmpty) return (
    <div className="flex flex-col h-[calc(100dvh-48px)]">
      <EmptyState />
    </div>
  )

  if (isCleared) return (
    <div className="flex flex-col h-[calc(100dvh-48px)]">
      <ClearedState
        triaged={session.triaged}
        shortlisted={session.shortlisted}
        skipped={session.skipped}
      />
    </div>
  )

  // Queue length for progress bar (total = original entries + any new, minus decided)
  const totalForProgress = active.length + session.triaged
  const currentProgress = session.triaged + 1

  return (
    <div className="flex flex-col h-[calc(100dvh-48px)] overflow-hidden">
      {/* Progress bar */}
      {totalForProgress > 0 && (
        <ProgressBar current={currentProgress} total={totalForProgress} />
      )}

      {/* Card stack */}
      <div className="relative flex-1 mx-3 mb-3 min-h-0">
        {/* Peek card (behind) */}
        {peekEntry && (
          <div className="absolute top-1.5 left-0 right-0 bottom-[-6px] bg-sunken rounded-xl z-10 overflow-hidden">
            <div className="h-full opacity-40">
              {peekEntry.image_url && (
                <img
                  src={peekEntry.image_url}
                  alt=""
                  className="w-full h-[200px] object-cover"
                  draggable={false}
                />
              )}
            </div>
          </div>
        )}

        {/* Front card — keyed by id so Framer Motion resets on card change */}
        <AnimatePresence mode="wait">
          {currentEntry && (
            <SwipeCard
              key={currentEntry.id}
              entry={currentEntry}
              onLookCloser={handleLookCloser}
              onSkip={handleSkip}
            />
          )}
        </AnimatePresence>
      </div>

      {/* Action bar */}
      <div className="flex-shrink-0 p-3 flex gap-2">
        <button
          onClick={() => void handleLookCloser()}
          disabled={!currentEntry}
          className="flex-1 h-12 rounded-md font-sans text-[15px] font-medium bg-accent text-white hover:bg-accent/80 transition-colors duration-fast border-none cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
        >
          Look closer
        </button>
        <button
          onClick={handleSkip}
          disabled={!currentEntry}
          className="flex-1 h-12 rounded-md font-sans text-[14px] font-normal border border-border-strong bg-transparent text-text-3 hover:bg-white/[0.06] hover:text-text transition-colors duration-fast cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
        >
          Skip
        </button>
        <button
          onClick={handleLater}
          disabled={!currentEntry}
          className="px-4 h-12 rounded-md font-sans text-[13px] font-normal bg-transparent text-faint hover:text-text-3 transition-colors duration-fast border-none cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
        >
          Later
        </button>
      </div>

      {/* Skip reason drawer */}
      <SkipDrawer
        open={showSkipSheet}
        onOpenChange={(open) => {
          if (!open && showSkipSheet) {
            // Drawer dismissed without undo — treat as confirm with no reason
            void confirmSkip(null)
          }
          setShowSkipSheet(open)
        }}
        onConfirm={(reason) => void confirmSkip(reason)}
        onUndo={handleUndo}
      />
    </div>
  )
}
