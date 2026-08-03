/**
 * VerdictBand — AI verdict display with score-colored left border.
 *
 * SPEC §2.4: below hero, mt-3 mx-4 p-3 bg-sunken rounded-md border-l-2.
 * Kicker "VERDICT" + verdict text + right-side tag counts.
 *
 * Tag counts come from checklist groups: flags / unknown / ok.
 */

import type { Entry } from '../../types/api'
import { scoreColor } from '../../lib/score'
import { motion } from 'framer-motion'

interface VerdictBandProps {
  entry: Entry
}

function countChecklistStates(entry: Entry): { flags: number; unknown: number; ok: number } {
  const groups = entry.checklist?.groups ?? []
  let flags = 0, unknown = 0, ok = 0
  for (const group of groups) {
    for (const item of group.items) {
      if (item.state === 'flag') flags++
      else if (item.state === 'unknown') unknown++
      else if (item.state === 'ok') ok++
    }
  }
  return { flags, unknown, ok }
}

export function VerdictBand({ entry }: VerdictBandProps) {
  if (!entry.verdict) return null

  const borderColor = scoreColor(entry.score)
  const { flags, unknown, ok } = countChecklistStates(entry)

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: 0.05 }}
      className="mt-3 mx-4 p-3 bg-sunken rounded-md border-l-2 flex items-start gap-3"
      style={{ borderLeftColor: borderColor }}
    >
      {/* Left: kicker + verdict */}
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-mono uppercase text-muted tracking-widest mb-1.5">
          Verdict
        </p>
        <p className="text-[15px] text-text-2 leading-[1.55]" style={{ textWrap: 'pretty' } as React.CSSProperties}>
          {entry.verdict}
        </p>
      </div>

      {/* Right: tag counts (only shown when checklist has data) */}
      {(flags > 0 || unknown > 0 || ok > 0) && (
        <div className="flex flex-col gap-1 flex-none text-right">
          {flags > 0 && (
            <span className="text-[11px] font-mono bg-score-bad/15 text-score-bad px-1.5 py-0.5 rounded-sm">
              {flags} flag{flags !== 1 ? 's' : ''}
            </span>
          )}
          {unknown > 0 && (
            <span className="text-[11px] font-mono bg-muted/10 text-muted px-1.5 py-0.5 rounded-sm">
              {unknown} unknown
            </span>
          )}
          {ok > 0 && (
            <span className="text-[11px] font-mono bg-status-short/15 text-status-short px-1.5 py-0.5 rounded-sm">
              {ok} ok
            </span>
          )}
        </div>
      )}
    </motion.div>
  )
}
