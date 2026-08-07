/**
 * Overview tab — Wave 7D full build.
 *
 * Layout: grid grid-cols-[1fr_372px] gap-3 p-4 h-[calc(100dvh-48px)]
 *
 * Left column (flex-1 min-h-0):
 *   - Map card (flex-1): Leaflet map — ListingsMap component
 *   - Charts row (flex-none grid grid-cols-2 gap-3): HistogramSVG + ScatterSVG
 *
 * Right column (w-[372px] flex flex-col gap-3):
 *   - BEST hero card
 *   - This week stats card
 *   - Calibration panel (≥5 rated viewings only)
 *   - Next up list card (flex-1)
 */

import { useAppData, selectBestEntry, selectShortlisted, selectInbox } from '../lib/queries'
import { useSettings } from '../lib/queries'
import { fmtEur, fmtDate } from '../lib/format'
import { scoreColor, scoreTextClass } from '../lib/score'
import { useAppStore } from '../lib/state'
import { useMediaQuery } from '../hooks/useMediaQuery'
import type { Entry } from '../types/api'
import { ListingsMap } from '../components/overview/ListingsMap'
import { HistogramSVG } from '../components/overview/HistogramSVG'
import { ScatterSVG } from '../components/overview/ScatterSVG'
import { CalibrationPanel } from '../components/overview/CalibrationPanel'

// ── BEST hero card ─────────────────────────────────────────────────────────

function BestHeroCard({ entry }: { entry: Entry | null }) {
  const setTab = useAppStore((s) => s.setTab)
  const setSelected = useAppStore((s) => s.setSelectedListingId)

  if (!entry) {
    return (
      <div className="bg-surface rounded-xl shadow-[0_0_0_1px_rgba(79,185,141,0.35),0_10px_30px_rgba(0,0,0,0.5)] overflow-hidden flex-none">
        <div className="p-4 text-center text-text-3 text-[13px]">
          No shortlisted entries yet.
        </div>
      </div>
    )
  }

  const scoreCol = scoreColor(entry.score)
  const perSqm = entry.price_eur && entry.area_sqm
    ? Math.round(entry.price_eur / entry.area_sqm)
    : null

  function openInShortlist() {
    setSelected(entry!.id)
    setTab('shortlist')
  }

  return (
    <div
      className="bg-surface rounded-xl overflow-hidden flex-none cursor-pointer"
      style={{ boxShadow: `0 0 0 1px rgba(79,185,141,0.35), 0 10px 30px rgba(0,0,0,0.5)` }}
      onClick={openInShortlist}
    >
      {/* Photo */}
      <div className="relative h-[150px] bg-gradient-to-br from-[#2a2d3d] to-[#191b28] overflow-hidden">
        {entry.image_url ? (
          <img
            src={entry.image_url}
            alt={entry.title}
            className="w-full h-full object-cover block"
            draggable={false}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-[11px] text-faint">
            No photo
          </div>
        )}
        {/* BEST kicker */}
        <span
          className="absolute left-3 top-3 font-sans font-semibold text-[9.5px] tracking-[0.12em] uppercase rounded-sm px-2 py-1"
          style={{ color: scoreCol, background: 'rgba(22,24,38,0.75)' }}
        >
          BEST TODAY
        </span>
        {/* Score badge */}
        <div
          className="absolute right-3 bottom-3 flex items-baseline gap-1 px-2.5 py-[5px] rounded-[6px]"
          style={{ background: 'rgba(22,24,38,0.8)' }}
        >
          <span className="font-mono text-[22px] font-medium" style={{ color: scoreCol }}>
            {entry.score ?? '—'}
          </span>
          <span className="font-mono text-[10px] text-muted">/100</span>
        </div>
      </div>

      {/* Body */}
      <div className="px-4 pt-3.5 pb-4">
        <h3 className="font-sans font-medium text-[17px] leading-[1.2] tracking-[-0.015em] text-text m-0">
          {entry.title}
        </h3>
        <p className="font-sans text-[12px] text-text-3 mt-0.5">
          {entry.district ?? entry.address ?? '—'}
        </p>

        {/* Price row */}
        <div className="flex items-baseline gap-2.5 mt-3">
          <span className="font-mono text-[28px] font-medium tracking-[-0.02em] text-text whitespace-nowrap">
            {fmtEur(entry.price_eur)}
          </span>
          {perSqm != null && (
            <span className="font-mono text-[12px] text-muted">
              {perSqm.toLocaleString()} €/m²
            </span>
          )}
        </div>

        {/* Verdict excerpt */}
        {entry.verdict && (
          <div
            className="mt-3 px-3 py-2.5 rounded-md bg-sunken text-[13px] leading-[1.5] text-text-2"
            style={{ borderLeft: `2px solid ${scoreCol}` }}
          >
            {entry.verdict.slice(0, 180)}{entry.verdict.length > 180 ? '…' : ''}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 mt-3.5">
          <button
            onClick={(e) => { e.stopPropagation(); openInShortlist() }}
            className="flex-1 text-center font-sans font-medium text-[12.5px] py-2 rounded-md border border-accent text-accent-lt bg-transparent cursor-pointer hover:bg-accent/[0.12] transition-colors duration-fast"
          >
            Open in Shortlist
          </button>
        </div>
      </div>
    </div>
  )
}

// ── This week stats ────────────────────────────────────────────────────────

function ThisWeekStats({ data }: { data: ReturnType<typeof useAppData>['data'] }) {
  const pending   = data?.pending?.length ?? 0
  const shortlist = data?.properties?.filter(
    (e) => e.status === 'approved' || e.status === 'viewing_scheduled',
  ).length ?? 0
  const viewed = data?.properties?.filter(
    (e) => e.status === 'viewed' || e.status === 'thinking' || e.status === 'offer_drafted',
  ).length ?? 0

  return (
    <div className="bg-sunken rounded-lg shadow-hairline p-3.5 flex-none">
      <p className="font-sans font-semibold text-[9.5px] uppercase tracking-[0.1em] text-muted mb-3">
        This week
      </p>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <div className="font-mono text-[24px] font-medium leading-none text-status-new">
            {pending}
          </div>
          <div className="font-sans text-[11px] text-muted mt-1">In Inbox</div>
        </div>
        <div>
          <div className="font-mono text-[24px] font-medium leading-none text-text">
            {shortlist}
          </div>
          <div className="font-sans text-[11px] text-muted mt-1">To view</div>
        </div>
        <div>
          <div className="font-mono text-[24px] font-medium leading-none text-status-viewing">
            {viewed}
          </div>
          <div className="font-sans text-[11px] text-muted mt-1">Viewed</div>
        </div>
      </div>
    </div>
  )
}

// ── Next up list ───────────────────────────────────────────────────────────

function NextUpList({ entries }: { entries: Entry[] }) {
  const setTab = useAppStore((s) => s.setTab)
  const setSelected = useAppStore((s) => s.setSelectedListingId)

  const sorted = [...entries]
    .filter((e) => ['approved', 'viewing_scheduled'].includes(e.status))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 6)

  if (sorted.length === 0) {
    return (
      <div className="bg-sunken rounded-lg shadow-hairline p-4 pb-1.5 flex-1 flex flex-col min-h-0">
        <div className="flex justify-between items-baseline px-0 pb-2.5">
          <span className="font-sans font-semibold text-[9.5px] uppercase tracking-[0.1em] text-muted">
            Next up
          </span>
        </div>
        <div className="flex-1 flex items-center justify-center py-5 text-center">
          <p className="font-sans text-[12px] text-muted">
            No shortlisted entries yet.{' '}
            <button
              onClick={() => setTab('inbox')}
              className="text-accent-lt underline bg-transparent border-none cursor-pointer"
            >
              Check Inbox
            </button>
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-sunken rounded-lg shadow-hairline pt-3.5 flex-1 flex flex-col min-h-0">
      <div className="flex justify-between items-baseline px-4 pb-2.5">
        <span className="font-sans font-semibold text-[9.5px] uppercase tracking-[0.1em] text-muted">
          Next up
        </span>
        <span className="font-sans text-[11px] text-muted">
          {sorted.length} to view
        </span>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {sorted.map((entry, i) => {
          const scoreCol = scoreColor(entry.score)
          const perSqm = entry.price_eur && entry.area_sqm
            ? Math.round(entry.price_eur / entry.area_sqm)
            : null

          return (
            <div
              key={entry.id}
              onClick={() => { setSelected(entry.id); setTab('shortlist') }}
              className={[
                'flex items-center gap-[11px] px-4 py-[9px] cursor-pointer',
                'transition-[background] duration-fast hover:bg-white/[0.025]',
                i % 2 === 1 ? 'bg-white/[0.02]' : '',
              ].join(' ')}
              style={{ borderLeft: `2px solid ${scoreCol}` }}
            >
              <span
                className={['font-mono text-[14px] w-[22px] flex-shrink-0', scoreTextClass(entry.score)].join(' ')}
              >
                {entry.score ?? '?'}
              </span>

              <div className="flex-1 min-w-0">
                <div className="font-sans text-[13px] text-text whitespace-nowrap overflow-hidden text-ellipsis">
                  {entry.title}
                </div>
                <div className="font-mono text-[10.5px] text-muted mt-[1px]">
                  {fmtEur(entry.price_eur)}
                  {perSqm != null ? ` · ${perSqm} €/m²` : ''}
                  {entry.area_sqm ? ` · ${entry.area_sqm} m²` : ''}
                </div>
              </div>

              {entry.scheduled_at ? (
                <span className="font-sans text-[10.5px] text-status-viewing flex-shrink-0">
                  {fmtDate(entry.scheduled_at)}
                </span>
              ) : (
                <span className="font-sans text-[10.5px] text-muted flex-shrink-0">unbooked</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Overview main component ────────────────────────────────────────────────

export function Overview() {
  const { data, isLoading, error } = useAppData()
  const { data: settings } = useSettings()
  const best = selectBestEntry(data)
  const allShortlisted = selectShortlisted(data)
  const inboxEntries = selectInbox(data)
  const isMobile = useMediaQuery('(max-width: 767px)')

  // All entries for map and charts
  const allEntries = [...allShortlisted, ...inboxEntries]

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <span className="font-mono text-[13px] text-muted">Loading…</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <span className="font-mono text-[13px] text-score-bad">
          Failed to load data. Is the backend running?
        </span>
      </div>
    )
  }

  // ── Mobile layout (< 768px): single-column stack, no map ──────────────────
  if (isMobile) {
    return (
      <div className="flex flex-col gap-3 p-3 overflow-y-auto" style={{ minHeight: 'calc(100dvh - 48px)' }}>
        {/* BEST hero card — full width */}
        <BestHeroCard entry={best} />

        {/* This week stats */}
        <ThisWeekStats data={data} />

        {/* Charts — stacked, full width, reduced height */}
        <div className="flex flex-col gap-3">
          <div className="bg-sunken rounded-lg shadow-hairline p-3.5" style={{ height: '120px' }}>
            <HistogramSVG entries={allEntries} />
          </div>
          <div className="bg-sunken rounded-lg shadow-hairline p-3.5" style={{ height: '120px' }}>
            <ScatterSVG entries={allEntries} settings={settings} />
          </div>
        </div>

        {/* Calibration panel */}
        <CalibrationPanel entries={allEntries} />

        {/* Next up list — reduced height for scroll comfort */}
        <div style={{ minHeight: '200px' }}>
          <NextUpList entries={allShortlisted} />
        </div>
      </div>
    )
  }

  // ── Desktop layout (≥ 768px): two-column grid with map ────────────────────
  return (
    <div
      className="grid gap-3 p-4"
      style={{
        gridTemplateColumns: '1fr 372px',
        height: 'calc(100dvh - 48px)',
        alignItems: 'start',
      }}
    >
      {/* ── Left column ─────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 min-h-0" style={{ height: 'calc(100dvh - 48px - 32px)' }}>
        {/* Map card — flex-1 */}
        <div className="flex-1 min-h-0 rounded-lg overflow-hidden">
          <ListingsMap
            entries={allShortlisted}
            pendingEntries={inboxEntries}
          />
        </div>

        {/* Charts row — flex-none */}
        <div className="grid grid-cols-2 gap-3 flex-none">
          <div className="bg-sunken rounded-lg shadow-hairline p-3.5" style={{ height: '160px' }}>
            <HistogramSVG entries={allEntries} />
          </div>
          <div className="bg-sunken rounded-lg shadow-hairline p-3.5" style={{ height: '160px' }}>
            <ScatterSVG entries={allEntries} settings={settings} />
          </div>
        </div>
      </div>

      {/* ── Right column ────────────────────────────────────────────────── */}
      <div
        className="flex flex-col gap-3 min-h-0 overflow-y-auto"
        style={{ height: 'calc(100dvh - 48px - 32px)' }}
      >
        <BestHeroCard entry={best} />
        <ThisWeekStats data={data} />
        <CalibrationPanel entries={allEntries} />
        <NextUpList entries={allShortlisted} />
      </div>
    </div>
  )
}
