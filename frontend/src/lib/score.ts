/**
 * Score → colour/bucket helpers.
 *
 * Single source of truth — matches scoreColor() / scoreBucket() in the
 * vanilla frontend-legacy/js/ui.js. Keep these in sync when thresholds change.
 *
 * SPEC §1: "One function, used by map pins, sidebar rules, badges, charts, everything."
 * Never use score colour as a large background fill — only 2px rules, badges,
 * chart fills, pin fills, or numeral colours.
 */

export type ScoreBucket = 'bad' | 'weak' | 'mid' | 'good' | 'best'

/**
 * Map a numeric score to a Tailwind class-compatible bucket name.
 * Maps directly to tailwind.config.ts score.{bucket} colors.
 */
export function scoreBucket(score: number | null | undefined): ScoreBucket {
  if (score == null) return 'bad'
  if (score >= 85) return 'best'
  if (score >= 75) return 'good'
  if (score >= 60) return 'mid'
  if (score >= 40) return 'weak'
  return 'bad'
}

/**
 * Map a score to a CSS color value (Nocturne score ramp).
 * Used for inline styles where Tailwind JIT can't help (e.g. Leaflet, SVG charts).
 */
export function scoreColor(score: number | null | undefined): string {
  if (score == null) return '#75798c' // --muted
  if (score >= 85) return '#4fb98d'   // --s-best
  if (score >= 75) return '#7fbf7a'   // --s-good
  if (score >= 60) return '#c9b455'   // --s-mid
  if (score >= 40) return '#c98b52'   // --s-weak
  return '#c4635f'                     // --s-bad
}

/**
 * Tailwind text color class for a given score bucket.
 * Use this in JSX className for score numerals and labels.
 */
export function scoreTextClass(score: number | null | undefined): string {
  const bucket = scoreBucket(score)
  const map: Record<ScoreBucket, string> = {
    best: 'text-score-best',
    good: 'text-score-good',
    mid:  'text-score-mid',
    weak: 'text-score-weak',
    bad:  'text-score-bad',
  }
  return map[bucket]
}

/**
 * Tailwind background color class for score badges.
 * Per SPEC: score color appears as badge with dark text on the greens.
 */
export function scoreBgClass(score: number | null | undefined): string {
  const bucket = scoreBucket(score)
  const map: Record<ScoreBucket, string> = {
    best: 'bg-score-best',
    good: 'bg-score-good',
    mid:  'bg-score-mid',
    weak: 'bg-score-weak',
    bad:  'bg-score-bad',
  }
  return map[bucket]
}
