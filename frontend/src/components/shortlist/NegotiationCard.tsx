/**
 * NegotiationCard — gated negotiation brief card (SPEC §2.4).
 *
 * Gated: if status IN {approved, viewing_scheduled}, render at
 *   opacity-45 pointer-events-none with "unlocks after viewing" kicker.
 *
 * Unlocked: shows offer range, brief_ru text, action buttons (Draft broker email, KÜ).
 * Regenerate link triggers /api/entry/{id}/regenerate-brief (fire-and-forget).
 */

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Entry } from '../../types/api'
import { regenerateBrief } from '../../lib/api'
import { QUERY_KEYS } from '../../lib/queries'
import { fmtEur } from '../../lib/format'

interface NegotiationCardProps {
  entry: Entry
}

const GATED_STATUSES = new Set(['approved', 'viewing_scheduled'])

function fmtK(n: number | undefined | null): string {
  if (n == null) return '?'
  return `${Math.round(n / 1000)}k`
}

export function NegotiationCard({ entry }: NegotiationCardProps) {
  const qc = useQueryClient()
  const [regenerating, setRegenerating] = useState(false)

  const isGated = GATED_STATUSES.has(entry.status)
  const brief = entry.negotiation_brief

  async function handleRegenerate() {
    setRegenerating(true)
    try {
      await regenerateBrief(entry.id)
      // Brief generates in background — invalidate after a short delay so UI shows "generating"
      setTimeout(() => {
        void qc.invalidateQueries({ queryKey: QUERY_KEYS.appData })
        setRegenerating(false)
      }, 3000)
    } catch {
      setRegenerating(false)
    }
  }

  const offerText =
    brief?.offer_low != null && brief?.offer_high != null
      ? `${fmtEur(brief.offer_low)} – ${fmtEur(brief.offer_high)}`
      : null

  return (
    <div
      className={[
        'bg-sunken rounded-lg overflow-hidden flex flex-col flex-1 min-h-0',
        isGated ? 'opacity-45 pointer-events-none' : '',
      ].join(' ')}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border flex-none">
        <p className="text-[10px] font-mono uppercase text-muted tracking-widest">
          Negotiation
        </p>
        {isGated ? (
          <span className="text-[11px] text-faint">unlocks after viewing</span>
        ) : (
          <button
            type="button"
            onClick={handleRegenerate}
            disabled={regenerating}
            className="text-[11px] text-accent hover:text-accent-lt disabled:opacity-50 transition-colors"
          >
            {regenerating ? 'generating…' : 'regenerate'}
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 p-3">
        {!brief ? (
          <p className="text-[12px] text-faint italic">
            {isGated
              ? 'Complete the viewing to unlock the negotiation brief.'
              : 'No brief yet — click regenerate to generate one.'}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {/* Offer range */}
            {offerText && (
              <div>
                <p className="font-mono text-[22px] text-accent-lt leading-none">
                  {offerText}
                </p>
                {brief.target != null && brief.ask != null && (
                  <p className="text-[11px] text-muted mt-1 font-mono">
                    target {fmtK(brief.target)} · ask {fmtK(brief.ask)}
                  </p>
                )}
                {/* Progress bar: offer range vs ask */}
                {brief.ask != null && brief.offer_low != null && brief.offer_high != null && (
                  <div className="mt-2 h-[4px] bg-surface rounded-full overflow-hidden">
                    <div
                      className="h-full bg-accent/60 rounded-full"
                      style={{
                        width: `${Math.min(
                          100,
                          ((brief.offer_high - brief.offer_low) / (brief.ask * 0.3)) * 100,
                        )}%`,
                      }}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Brief text (Russian or English) */}
            {(brief.brief_ru ?? brief.brief) && (
              <p className="text-[13px] text-text-2 leading-[1.55]">
                {brief.brief_ru ?? brief.brief}
              </p>
            )}

            {/* Action buttons */}
            <div className="flex gap-2 flex-wrap">
              <button
                type="button"
                className="px-3 py-1.5 text-[12px] bg-accent/20 text-accent-lt rounded-md hover:bg-accent/30 transition-colors"
              >
                Draft broker email
              </button>
              <button
                type="button"
                className="px-3 py-1.5 text-[12px] border border-border text-text-3 rounded-md hover:text-text hover:border-border-strong transition-colors"
              >
                KÜ · price history
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
