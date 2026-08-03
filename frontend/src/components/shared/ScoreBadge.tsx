/**
 * ScoreBadge — displays a numeric score with Nocturne score-ramp color.
 *
 * Per SPEC §1: score color appears only as small badges, 2px left rules,
 * map pin fills, chart fills, or numeral colors. Never as a large fill.
 *
 * Text colors: #0f160f on the two greens (best, good), #160f0f on the three
 * warm stops (mid, weak, bad) — these are the SPEC-specified dark text colors.
 */

import { scoreColor, scoreBucket } from '../../lib/score'

interface ScoreBadgeProps {
  score: number | null | undefined
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

// Dark text colors per SPEC §1 for readable badges
function badgeTextColor(score: number | null | undefined): string {
  const bucket = scoreBucket(score)
  if (bucket === 'best' || bucket === 'good') return '#0f160f'
  return '#160f0f'
}

const sizeClasses = {
  sm: 'text-[11px] px-2 py-[3px]',
  md: 'text-[13px] px-2.5 py-[4px]',
  lg: 'text-[18px] px-3 py-[5px]',
}

export function ScoreBadge({ score, size = 'md', className = '' }: ScoreBadgeProps) {
  const bg = scoreColor(score)
  const color = badgeTextColor(score)

  return (
    <span
      className={[
        'inline-flex items-center justify-center',
        'font-mono font-semibold rounded-sm flex-none',
        sizeClasses[size],
        className,
      ].join(' ')}
      style={{ background: bg, color }}
    >
      {score ?? '—'}
    </span>
  )
}
