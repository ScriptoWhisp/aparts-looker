/**
 * HistogramSVG — "Where the scores land" hand-rolled SVG chart.
 *
 * 10 bins of width 10 (0-9, 10-19, … 90-100).
 * Each bin: <rect> filled with scoreColor(binMidpoint), rx=2.
 * 1px baseline. Ticks at 0/25/50/75/100.
 * "75 · approve" label on the 75 tick in text-3.
 * Header right: "median N · n=M" mono.
 * Hover: tooltip showing "N listings, 60-69".
 */

import { useState } from 'react'
import { scoreColor } from '../../lib/score'
import type { Entry } from '../../types/api'

interface HistogramSVGProps {
  entries: Entry[]
}

export function HistogramSVG({ entries: allEntries }: HistogramSVGProps) {
  const [hoveredBin, setHoveredBin] = useState<number | null>(null)

  // Build 10 bins [0,10), [10,20), ..., [90,100]
  const bins = Array.from({ length: 10 }, () => 0)
  const scores = allEntries
    .map((e) => e.score)
    .filter((s): s is number => s != null)

  for (const s of scores) {
    const bin = Math.min(9, Math.floor(s / 10))
    bins[bin]++
  }

  const n = scores.length
  const sortedScores = [...scores].sort((a, b) => a - b)
  const median = n === 0 ? null : sortedScores[Math.floor(n / 2)]
  const maxCount = Math.max(...bins, 1)

  // SVG dimensions
  const W = 220
  const H = 80
  const PAD_L = 4
  const PAD_R = 4
  const PAD_T = 4
  const PAD_B = 18 // space for x-axis ticks
  const chartW = W - PAD_L - PAD_R
  const chartH = H - PAD_T - PAD_B

  const binW = chartW / 10
  const tickXs = [0, 25, 50, 75, 100]

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-baseline justify-between px-0 pb-1.5">
        <span className="font-sans font-semibold text-[9.5px] uppercase tracking-[0.1em] text-muted">
          Where scores land
        </span>
        {n > 0 && (
          <span className="font-mono text-[10px] text-muted">
            median {median} · n={n}
          </span>
        )}
      </div>

      {/* Tooltip */}
      {hoveredBin !== null && (
        <div className="absolute z-10 pointer-events-none bg-surface rounded-md shadow-md px-2 py-1 text-[11px] font-sans text-text border border-border">
          {bins[hoveredBin]} listing{bins[hoveredBin] !== 1 ? 's' : ''}, {hoveredBin * 10}–{hoveredBin * 10 + 9}
        </div>
      )}

      {n === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <span className="font-sans text-[12px] text-faint">No data</span>
        </div>
      ) : (
        <svg
          width="100%"
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="xMidYMid meet"
          className="flex-1"
        >
          {/* Baseline */}
          <line
            x1={PAD_L}
            y1={PAD_T + chartH}
            x2={PAD_L + chartW}
            y2={PAD_T + chartH}
            stroke="#292b31"
            strokeWidth="1"
          />

          {/* Bars */}
          {bins.map((count, i) => {
            const barH = count === 0 ? 0 : Math.max(2, (count / maxCount) * chartH)
            const x = PAD_L + i * binW + 1
            const y = PAD_T + chartH - barH
            const midScore = i * 10 + 5
            const fill = scoreColor(midScore)
            const isHovered = hoveredBin === i

            return (
              <rect
                key={i}
                x={x}
                y={y}
                width={binW - 2}
                height={barH}
                rx={2}
                fill={fill}
                fillOpacity={isHovered ? 1 : 0.8}
                onMouseEnter={() => setHoveredBin(i)}
                onMouseLeave={() => setHoveredBin(null)}
                className="cursor-default"
              />
            )
          })}

          {/* X-axis ticks */}
          {tickXs.map((tick) => {
            const x = PAD_L + (tick / 100) * chartW
            const isApprove = tick === 75
            return (
              <g key={tick}>
                <line
                  x1={x}
                  y1={PAD_T + chartH}
                  x2={x}
                  y2={PAD_T + chartH + 4}
                  stroke={isApprove ? '#9397ab' : '#595d6c'}
                  strokeWidth="1"
                />
                <text
                  x={x}
                  y={PAD_T + chartH + 13}
                  textAnchor="middle"
                  fontSize={8}
                  fill={isApprove ? '#9397ab' : '#595d6c'}
                  fontFamily="'JetBrains Mono',monospace"
                >
                  {isApprove ? '75 · approve' : tick}
                </text>
              </g>
            )
          })}
        </svg>
      )}
    </div>
  )
}
