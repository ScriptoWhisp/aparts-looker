/**
 * CalibrationPanel — AI vs your score calibration panel.
 *
 * Only rendered when ≥5 entries have own_score set in viewing_history.
 * Shows:
 * - Scatter SVG: AI predicted score (x 0-100) vs own_score (y 0-100)
 * - Dashed y=x reference line
 * - Dots colored by scoreColor
 * - MAE + bias stats
 * - Nudge sentence if bias > 5 points
 */

import { useState } from 'react'
import type { Entry } from '../../types/api'
import { scoreColor } from '../../lib/score'

export const MIN_RATED_VIEWINGS = 5

interface CalibrationPoint {
  id: string
  title: string
  aiScore: number
  ownScore: number
}

function getCalibrationPoints(entries: Entry[]): CalibrationPoint[] {
  const points: CalibrationPoint[] = []
  for (const entry of entries) {
    if (entry.score == null) continue
    // own_score can be on viewing_history events or directly on entry
    const ownScore = entry.own_score ??
      entry.viewing_history?.find((ev) => ev.own_score != null)?.own_score
    if (ownScore == null) continue
    points.push({
      id: entry.id,
      title: entry.title || entry.address || entry.id,
      aiScore: entry.score,
      ownScore,
    })
  }
  return points
}

function computeStats(points: CalibrationPoint[]) {
  if (points.length === 0) return { mae: 0, bias: 0 }
  const errors = points.map((p) => p.aiScore - p.ownScore)
  const mae = Math.round(errors.reduce((acc, e) => acc + Math.abs(e), 0) / errors.length)
  const bias = Math.round(errors.reduce((acc, e) => acc + e, 0) / errors.length)
  return { mae, bias }
}

// SVG dims
const W = 160
const H = 120
const PAD = 12

export function CalibrationPanel({ entries }: { entries: Entry[] }) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)
  const points = getCalibrationPoints(entries)

  if (points.length < MIN_RATED_VIEWINGS) return null

  const { mae, bias } = computeStats(points)
  const chartW = W - PAD * 2
  const chartH = H - PAD * 2

  function cx(ai: number) { return PAD + (ai / 100) * chartW }
  function cy(own: number) { return PAD + chartH - (own / 100) * chartH }

  return (
    <div className="bg-sunken rounded-lg shadow-hairline p-3.5 flex-none">
      {/* Header */}
      <p className="font-sans font-semibold text-[9.5px] uppercase tracking-[0.1em] text-muted mb-2">
        Calibration
      </p>

      <div className="flex gap-3 items-start">
        {/* Scatter SVG */}
        <svg width={W} height={H} className="flex-none">
          {/* Frame */}
          <rect
            x={PAD} y={PAD}
            width={chartW} height={chartH}
            fill="none"
            stroke="#292b31"
            strokeWidth="1"
          />

          {/* y=x reference line (dashed) */}
          <line
            x1={PAD} y1={PAD + chartH}
            x2={PAD + chartW} y2={PAD}
            stroke="#595d6c"
            strokeWidth="1"
            strokeDasharray="3 4"
          />

          {/* Axis labels */}
          <text x={PAD + chartW / 2} y={H - 1} textAnchor="middle" fontSize={7} fill="#595d6c" fontFamily="sans-serif">AI score</text>
          <text
            x={3}
            y={PAD + chartH / 2}
            textAnchor="middle"
            fontSize={7}
            fill="#595d6c"
            fontFamily="sans-serif"
            transform={`rotate(-90, 3, ${PAD + chartH / 2})`}
          >
            Your score
          </text>

          {/* Dots */}
          {points.map((p, i) => {
            const color = scoreColor(p.aiScore)
            const isHovered = hoveredIdx === i
            return (
              <g
                key={p.id}
                onMouseEnter={() => setHoveredIdx(i)}
                onMouseLeave={() => setHoveredIdx(null)}
              >
                {isHovered && (
                  <circle
                    cx={cx(p.aiScore)}
                    cy={cy(p.ownScore)}
                    r={8}
                    fill={color}
                    fillOpacity={0.2}
                  />
                )}
                <circle
                  cx={cx(p.aiScore)}
                  cy={cy(p.ownScore)}
                  r={4}
                  fill={color}
                  fillOpacity={0.85}
                  className="cursor-default"
                />
              </g>
            )
          })}
        </svg>

        {/* Stats + hover info */}
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          {hoveredIdx !== null ? (
            <div className="text-[11px] text-text-2 leading-snug">
              <p className="font-medium truncate">{points[hoveredIdx].title}</p>
              <p className="text-muted mt-0.5">
                AI: <span style={{ color: scoreColor(points[hoveredIdx].aiScore) }}>{points[hoveredIdx].aiScore}</span>
                {' · '}
                Yours: {points[hoveredIdx].ownScore}
              </p>
            </div>
          ) : (
            <p className="text-[11px] text-muted leading-relaxed">
              AI vs your score across {points.length} viewings — MAE {mae} pts
            </p>
          )}

          {Math.abs(bias) > 5 && hoveredIdx === null && (
            <p className="text-[11px] text-text-3 leading-relaxed mt-1">
              AI reads {Math.abs(bias)} pts too {bias > 0 ? 'high' : 'low'} on average
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
