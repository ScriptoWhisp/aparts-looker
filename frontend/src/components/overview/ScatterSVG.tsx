/**
 * ScatterSVG — "Is a good score expensive?" hand-rolled SVG scatter chart.
 *
 * X = score 30→100, Y = price (inverted — lower price at top)
 * <circle r=4.5> per listing colored by scoreColor.
 * Shortlisted get r=5.5 + halo circle at 16% alpha.
 * Horizontal dashed line at budget ceiling (265k or from settings).
 * 2-line frame: right + bottom only.
 * Hover card: positioned via transform, clamped to container.
 * Click = navigate to shortlist + select entry.
 */

import { useState, useRef } from 'react'
import type { Entry, SettingsData } from '../../types/api'
import { scoreColor } from '../../lib/score'
import { useAppStore } from '../../lib/state'
import { fmtEur } from '../../lib/format'

interface ScatterSVGProps {
  entries: Entry[]        // combined pending + shortlisted
  settings: SettingsData | undefined
}

const SHORTLISTED_STATUSES = new Set([
  'approved', 'viewing_scheduled', 'viewed', 'thinking', 'offer_drafted',
])

const W = 220
const H = 90
const PAD_L = 4
const PAD_R = 32 // space for budget label
const PAD_T = 8
const PAD_B = 16 // space for x-axis
const CHART_W = W - PAD_L - PAD_R
const CHART_H = H - PAD_T - PAD_B

const SCORE_MIN = 30
const SCORE_MAX = 100

function scaleX(score: number): number {
  const t = (score - SCORE_MIN) / (SCORE_MAX - SCORE_MIN)
  return PAD_L + t * CHART_W
}

function scaleY(price: number, priceMin: number, priceMax: number): number {
  if (priceMax === priceMin) return PAD_T + CHART_H / 2
  const t = (price - priceMin) / (priceMax - priceMin)
  // Invert: high price → top
  return PAD_T + (1 - t) * CHART_H
}

interface HoveredEntry {
  entry: Entry
  svgX: number
  svgY: number
}

export function ScatterSVG({ entries, settings }: ScatterSVGProps) {
  const setTab      = useAppStore((s) => s.setTab)
  const setSelected = useAppStore((s) => s.setSelectedListingId)
  const [hovered, setHovered] = useState<HoveredEntry | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  const plotEntries = entries.filter(
    (e) => e.score != null && e.price_eur != null && e.score >= SCORE_MIN,
  )

  if (plotEntries.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <div className="pb-1.5">
          <span className="font-sans font-semibold text-[9.5px] uppercase tracking-[0.1em] text-muted">
            Score vs price
          </span>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <span className="font-sans text-[12px] text-faint">No data</span>
        </div>
      </div>
    )
  }

  const prices = plotEntries.map((e) => e.price_eur!)
  const priceMin = Math.min(...prices)
  const priceMax = Math.max(...prices)

  // Budget ceiling from settings or default 265k
  const budgetField = settings?.fields?.find((f) => f.key === 'max_price_eur')
  const budget = typeof budgetField?.value === 'number' ? budgetField.value : 265_000
  const budgetY = scaleY(budget, priceMin, priceMax)
  const showBudgetLine = budget >= priceMin && budget <= priceMax * 1.1

  function handleClick(entry: Entry) {
    setSelected(entry.id)
    setTab('shortlist')
  }

  return (
    <div className="flex flex-col h-full relative">
      {/* Header */}
      <div className="pb-1.5">
        <span className="font-sans font-semibold text-[9.5px] uppercase tracking-[0.1em] text-muted">
          Score vs price
        </span>
      </div>

      {/* Hover card */}
      {hovered && (
        <div
          className="absolute z-20 pointer-events-none bg-surface rounded-md shadow-md px-2.5 py-2 text-[11px] font-sans text-text border border-border max-w-[160px]"
          style={{
            left: Math.min(hovered.svgX + 8, W - 170),
            top: Math.max(hovered.svgY - 40, 0),
          }}
        >
          <div className="font-medium text-[12px] truncate">{hovered.entry.title}</div>
          <div className="text-muted mt-0.5">
            Score: <span style={{ color: scoreColor(hovered.entry.score) }}>{hovered.entry.score}</span>
          </div>
          <div className="text-muted">{fmtEur(hovered.entry.price_eur)}</div>
        </div>
      )}

      <svg
        ref={svgRef}
        width="100%"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        className="flex-1"
      >
        {/* Frame: right + bottom only */}
        <line x1={PAD_L + CHART_W} y1={PAD_T} x2={PAD_L + CHART_W} y2={PAD_T + CHART_H} stroke="#292b31" strokeWidth="1" />
        <line x1={PAD_L} y1={PAD_T + CHART_H} x2={PAD_L + CHART_W} y2={PAD_T + CHART_H} stroke="#292b31" strokeWidth="1" />

        {/* Budget line */}
        {showBudgetLine && (
          <>
            <line
              x1={PAD_L}
              y1={budgetY}
              x2={PAD_L + CHART_W}
              y2={budgetY}
              stroke="#75798c"
              strokeWidth="1"
              strokeDasharray="3 4"
            />
            <text
              x={PAD_L + CHART_W + 3}
              y={budgetY + 3}
              fontSize={8}
              fill="#75798c"
              fontFamily="'JetBrains Mono',monospace"
            >
              {Math.round(budget / 1000)}k
            </text>
            <text
              x={PAD_L + CHART_W + 3}
              y={budgetY + 11}
              fontSize={7}
              fill="#595d6c"
              fontFamily="'JetBrains Mono',monospace"
            >
              budget
            </text>
          </>
        )}

        {/* X-axis score ticks */}
        {[30, 50, 75, 100].map((tick) => (
          <text
            key={tick}
            x={scaleX(tick)}
            y={PAD_T + CHART_H + 11}
            textAnchor="middle"
            fontSize={8}
            fill="#595d6c"
            fontFamily="'JetBrains Mono',monospace"
          >
            {tick}
          </text>
        ))}

        {/* Dots */}
        {plotEntries.map((entry) => {
          const cx = scaleX(entry.score!)
          const cy = scaleY(entry.price_eur!, priceMin, priceMax)
          const isShortlisted = SHORTLISTED_STATUSES.has(entry.status)
          const color = scoreColor(entry.score)
          const r = isShortlisted ? 5.5 : 4.5

          return (
            <g
              key={entry.id}
              onClick={() => handleClick(entry)}
              onMouseEnter={() => setHovered({ entry, svgX: cx, svgY: cy })}
              onMouseLeave={() => setHovered(null)}
              className="cursor-pointer"
            >
              {/* Halo for shortlisted */}
              {isShortlisted && (
                <circle cx={cx} cy={cy} r={r + 4} fill={color} fillOpacity={0.16} />
              )}
              <circle cx={cx} cy={cy} r={r} fill={color} fillOpacity={0.9} />
            </g>
          )
        })}
      </svg>
    </div>
  )
}
