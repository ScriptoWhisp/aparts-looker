/**
 * HeroRow — hero section at the top of the main pane for a shortlisted entry.
 *
 * Layout: grid grid-cols-[300px_1fr] gap-3 p-4 pb-0
 * Left: 184px photo with pagination dots overlay + fallback gradient
 * Right: status pill + meta + title + metric strip (all-in, area, score, monthly)
 *
 * SPEC §2.4 §1 §4: all-in cost cell shows price + work → all-in in accent-lt mono 34px
 */

import { useState, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import type { Entry, SettingsData } from '../../types/api'
import { StatusPill } from './StatusPill'
import { scoreColor, scoreTextClass } from '../../lib/score'
import { fmtEur } from '../../lib/format'
import { scheduleViewing, markViewed, saveOwnScore } from '../../lib/api'
import { QUERY_KEYS } from '../../lib/queries'
import { computeAllIn } from '../../lib/cost'
import { ExternalLink } from 'lucide-react'

interface HeroRowProps {
  entry: Entry
  settings: SettingsData | undefined
}

function fmtShortAge(iso: string | null | undefined): string {
  if (!iso) return ''
  try {
    const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
    if (days === 0) return 'today'
    if (days === 1) return '1 day ago'
    return `${days} days ago`
  } catch {
    return ''
  }
}

function fmtMonoNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`
  return String(n)
}

// ── Own Score Slider ──────────────────────────────────────────────────────

const VIEWED_STATUSES = new Set(['viewed', 'thinking', 'offer_drafted', 'dropped'])

interface OwnScoreSliderProps {
  entry: Entry
}

function OwnScoreSlider({ entry }: OwnScoreSliderProps) {
  // Derive current own_score: entry.own_score or last viewing_history event with own_score
  const initial = entry.own_score ??
    [...(entry.viewing_history ?? [])].reverse().find((ev) => ev.own_score != null)?.own_score ??
    null
  const [localScore, setLocalScore] = useState<number>(initial ?? 50)
  const [saved, setSaved] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const qc = useQueryClient()

  if (!VIEWED_STATUSES.has(entry.status)) return null

  const color = scoreColor(localScore)

  function handleChange(v: number) {
    setLocalScore(v)
    setSaved(false)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      try {
        await saveOwnScore(entry.id, v)
        void qc.invalidateQueries({ queryKey: QUERY_KEYS.appData })
        setSaved(true)
        setTimeout(() => setSaved(false), 1500)
      } catch {
        // silently ignore — next change will retry
      }
    }, 800)
  }

  const pct = localScore

  return (
    <div className="flex flex-col gap-1 mt-2">
      <div className="flex items-baseline justify-between">
        <span className="font-sans text-[11px] text-muted">Your score</span>
        <div className="flex items-baseline gap-1.5">
          <span className="font-mono text-[14px]" style={{ color }}>
            {localScore}
          </span>
          {saved && (
            <span className="font-sans text-[10px] text-score-best">saved</span>
          )}
        </div>
      </div>
      <div className="relative h-4 flex items-center">
        <div className="absolute inset-x-0 h-1 rounded-full bg-border" />
        <div
          className="absolute h-1 rounded-full"
          style={{ width: `${pct}%`, background: color, opacity: 0.7 }}
        />
        <div
          className="absolute w-3 h-3 rounded-full border-2 shadow-sm"
          style={{
            left: `calc(${pct}% - 6px)`,
            background: color,
            borderColor: 'rgba(22,24,38,0.6)',
          }}
        />
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={localScore}
          onChange={(e) => handleChange(Number(e.target.value))}
          className="absolute inset-0 w-full opacity-0 cursor-pointer"
        />
      </div>
    </div>
  )
}

// ── Schedule Viewing Inline Picker ─────────────────────────────────────────

interface SchedulePickerProps {
  entryId: string
  onScheduled: () => void
  onCancel: () => void
}

function SchedulePicker({ entryId, onScheduled, onCancel }: SchedulePickerProps) {
  const [dt, setDt] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  async function handleConfirm() {
    if (!dt) { setErr('Pick a date and time'); return }
    setLoading(true)
    setErr('')
    try {
      // Convert datetime-local to UTC ISO (browser timezone → UTC)
      const utcIso = new Date(dt).toISOString()
      await scheduleViewing(entryId, utcIso)
      onScheduled()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error scheduling')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <input
        type="datetime-local"
        value={dt}
        onChange={(e) => setDt(e.target.value)}
        className={[
          'bg-sunken text-text text-[12px] px-2 py-1.5 rounded-md',
          'border border-border focus:outline-none focus:border-accent/60',
        ].join(' ')}
      />
      <button
        type="button"
        onClick={handleConfirm}
        disabled={loading}
        className="px-3 py-1.5 text-[12px] bg-accent text-bg rounded-md font-medium hover:bg-accent/80 disabled:opacity-50"
      >
        {loading ? 'Saving…' : 'Confirm'}
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="px-3 py-1.5 text-[12px] text-muted hover:text-text-3 rounded-md"
      >
        Cancel
      </button>
      {err && <span className="text-[11px] text-score-bad">{err}</span>}
    </div>
  )
}

// ── Main HeroRow ──────────────────────────────────────────────────────────

export function HeroRow({ entry, settings }: HeroRowProps) {
  const qc = useQueryClient()
  const [showSchedulePicker, setShowSchedulePicker] = useState(false)
  const [markingViewed, setMarkingViewed] = useState(false)

  const cost = computeAllIn(entry, settings)

  async function handleMarkViewed() {
    setMarkingViewed(true)
    try {
      await markViewed(entry.id)
      void qc.invalidateQueries({ queryKey: QUERY_KEYS.appData })
    } catch {
      // silently log
    } finally {
      setMarkingViewed(false)
    }
  }

  function handleScheduled() {
    setShowSchedulePicker(false)
    void qc.invalidateQueries({ queryKey: QUERY_KEYS.appData })
  }

  // ── Render ──────────────────────────────────────────────────────────────
  const shortlistedDate = entry.shortlisted_at ?? entry.approved_at

  // Monthly cost
  const monthly = (entry.cost_of_ownership as { monthly_total_eur?: number } | null)
    ?.monthly_total_eur

  // Meta line
  const metaParts: string[] = []
  if (entry.district) metaParts.push(entry.district)
  if (entry.rooms) metaParts.push(`${entry.rooms} tuba`)
  if (entry.floor != null && entry.floors_total != null)
    metaParts.push(`${entry.floor}/${entry.floors_total} korrus`)
  if (entry.year_built) metaParts.push(String(entry.year_built))
  if (entry.energy_class) metaParts.push(`energiaklass ${entry.energy_class}`)

  // All-in label
  const allInText = cost.noItems
    ? fmtEur(entry.price_eur)
    : fmtEur(cost.allIn)

  const allInSub = cost.noItems
    ? 'all-in unknown — waiting for AI'
    : `+${fmtEur(cost.work)} work · ±${fmtEur(cost.band)}`

  const pricePerSqmAllIn =
    !cost.noItems && entry.area_sqm && entry.area_sqm > 0
      ? `${Math.round(cost.allIn / entry.area_sqm).toLocaleString('et-EE')} €/m² all-in`
      : null

  return (
    <div className="grid grid-cols-1 md:grid-cols-[300px_1fr] gap-3 p-4 pb-0">
      {/* Left: Photo */}
      <div
        className="rounded-lg overflow-hidden flex-none relative"
        style={{ height: 184 }}
      >
        {entry.image_url ? (
          <img
            src={entry.image_url}
            alt={entry.title}
            className="w-full h-full object-cover"
            draggable={false}
          />
        ) : (
          <div
            className="w-full h-full"
            style={{
              background: `linear-gradient(135deg, ${scoreColor(entry.score)}33, #1d1f2d)`,
            }}
          />
        )}
        {/* "1 / N" overlay placeholder */}
        <div className="absolute bottom-2 right-2 text-[11px] font-mono text-white/70 bg-black/40 px-1.5 py-0.5 rounded-sm">
          1
        </div>
      </div>

      {/* Right: Header block */}
      <div className="flex flex-col min-w-0">
        {/* Top row: status pill + age + actions */}
        <div className="flex items-start gap-2 flex-wrap">
          <StatusPill status={entry.status} scheduledAt={entry.scheduled_at} />
          {shortlistedDate && (
            <span className="text-[11px] text-muted self-center">
              shortlisted {fmtShortAge(shortlistedDate)}
            </span>
          )}
          {/* Actions right */}
          <div className="ml-auto flex items-center gap-2 flex-none">
            <a
              href={entry.url}
              target="_blank"
              rel="noopener noreferrer"
              className={[
                'flex items-center gap-1 px-2.5 py-1.5 text-[12px]',
                'text-text-3 hover:text-text border border-border rounded-md',
                'transition-colors duration-fast',
              ].join(' ')}
            >
              kv.ee <ExternalLink size={11} className="opacity-60" />
            </a>

            {entry.status === 'viewing_scheduled' && (
              <button
                type="button"
                onClick={handleMarkViewed}
                disabled={markingViewed}
                className="px-3 py-1.5 text-[12px] font-medium bg-accent text-bg rounded-md hover:bg-accent/80 disabled:opacity-50 transition-colors"
              >
                {markingViewed ? 'Saving…' : 'Mark viewed'}
              </button>
            )}

            {entry.status === 'approved' && !showSchedulePicker && (
              <button
                type="button"
                onClick={() => setShowSchedulePicker(true)}
                className="px-3 py-1.5 text-[12px] font-medium bg-status-viewing/20 text-status-viewing rounded-md hover:bg-status-viewing/30 transition-colors"
              >
                Schedule viewing
              </button>
            )}
          </div>
        </div>

        {/* Schedule picker (inline, below top row) */}
        <AnimatePresence>
          {showSchedulePicker && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.15 }}
              className="overflow-hidden mt-2"
            >
              <SchedulePicker
                entryId={entry.id}
                onScheduled={handleScheduled}
                onCancel={() => setShowSchedulePicker(false)}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Title */}
        <h2 className="mt-1.5 text-[26px] font-medium leading-tight tracking-tight text-text" style={{ letterSpacing: '-0.02em' }}>
          {entry.title || entry.address || `Listing ${entry.id}`}
        </h2>

        {/* Meta line */}
        <p className="text-[13px] text-text-3 mt-0.5">
          {metaParts.join(' · ') || '—'}
        </p>

        {/* Metric strip — mt-auto pushes to bottom of the header block.
            flex-wrap prevents horizontal overflow on narrow (mobile) viewports,
            where 4 fixed-width 34px-mono columns don't fit in ~360px content width. */}
        <div
          className="mt-auto pt-3 flex flex-wrap items-end gap-y-2 divide-x divide-border/50"
        >
          {/* 1. All-in cost */}
          <div className="flex flex-col gap-0.5 pr-4">
            <span className="font-mono text-[34px] leading-none text-accent-lt">
              {allInText}
            </span>
            <span className="text-[11px] text-muted">{allInSub}</span>
            {pricePerSqmAllIn && (
              <span className="text-[11px] text-faint">{pricePerSqmAllIn}</span>
            )}
          </div>

          {/* 2. Area */}
          {entry.area_sqm && (
            <div className="flex flex-col gap-0.5 px-4">
              <span className="font-mono text-[34px] leading-none text-text">
                {entry.area_sqm}
              </span>
              <span className="text-[11px] text-muted">
                m² · {entry.rooms ?? '?'} tuba
              </span>
            </div>
          )}

          {/* 3. Score */}
          <div className="flex flex-col gap-0.5 px-4">
            <span
              className={['font-mono text-[34px] leading-none', scoreTextClass(entry.score)].join(' ')}
            >
              {entry.score ?? '—'}
            </span>
            <span className="text-[11px] text-muted">score</span>
          </div>

          {/* 4. Monthly */}
          {monthly != null && (
            <div className="flex flex-col gap-0.5 pl-4">
              <span className="font-mono text-[34px] leading-none text-text">
                {fmtMonoNumber(monthly)}
              </span>
              <span className="text-[11px] text-muted">monthly, all-in</span>
            </div>
          )}
        </div>

        {/* Own score slider (viewed entries only) */}
        <OwnScoreSlider entry={entry} />
      </div>
    </div>
  )
}
