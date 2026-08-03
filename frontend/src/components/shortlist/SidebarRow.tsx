/**
 * SidebarRow — single entry in the Shortlist sidebar funnel.
 *
 * Visual spec (SPEC §2.4):
 * - 2px score-colored left border rule
 * - Mono score numeral 15px
 * - Title Inter 400 13px, single-line ellipsis
 * - Price · area meta in muted 11px
 * - Right-side status indicator (mono, compact)
 * - Dropped: strikethrough title, opacity 40%
 * - Selected: bg-accent/10
 */

import type { Entry, ListingStatus } from '../../types/api'
import { scoreColor } from '../../lib/score'
import { fmtEur } from '../../lib/format'

interface SidebarRowProps {
  entry: Entry
  isSelected: boolean
  onClick: () => void
}

function fmtShortDate(iso: string | null | undefined): string {
  if (!iso) return ''
  try {
    return new Intl.DateTimeFormat('et-EE', {
      day: 'numeric',
      month: 'short',
    }).format(new Date(iso))
  } catch {
    return ''
  }
}

function rightLabel(entry: Entry): { text: string; className: string } {
  const s = entry.status as ListingStatus
  switch (s) {
    case 'approved':
      return { text: 'unbooked', className: 'font-mono text-faint' }
    case 'viewing_scheduled':
      return {
        text: fmtShortDate(entry.scheduled_at) || 'scheduled',
        className: 'font-mono text-status-viewing',
      }
    case 'viewed':
      return { text: 'viewed', className: 'font-mono text-muted' }
    case 'thinking':
      return { text: 'thinking', className: 'font-mono text-muted' }
    case 'offer_drafted':
      return { text: 'offer', className: 'font-medium text-status-short' }
    case 'dropped':
      return {
        text: entry.drop_reason ? entry.drop_reason.slice(0, 12) : 'dropped',
        className: 'text-muted',
      }
    default:
      return { text: '', className: '' }
  }
}

export function SidebarRow({ entry, isSelected, onClick }: SidebarRowProps) {
  const isDropped = entry.status === 'dropped'
  const borderColor = scoreColor(entry.score)
  const right = rightLabel(entry)

  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'w-full text-left pl-3 pr-2 py-2.5 flex items-start gap-2',
        'border-l-2 transition-colors duration-fast',
        isSelected ? 'bg-accent/10' : 'hover:bg-surface/50',
        isDropped ? 'opacity-40' : '',
      ].join(' ')}
      style={{ borderLeftColor: borderColor }}
    >
      {/* Score numeral */}
      <span className="font-mono text-[15px] leading-none mt-[1px] flex-none text-text-3 w-7 text-right">
        {entry.score ?? '—'}
      </span>

      {/* Title + meta */}
      <div className="flex-1 min-w-0">
        <p
          className={[
            'text-[13px] leading-snug text-text truncate',
            isDropped ? 'line-through' : '',
          ].join(' ')}
        >
          {entry.title || entry.address || `Listing ${entry.id}`}
        </p>
        <p className="text-[11px] text-muted mt-0.5 truncate">
          {entry.price_eur ? fmtEur(entry.price_eur) : '—'}
          {entry.area_sqm ? ` · ${entry.area_sqm} m²` : ''}
        </p>
      </div>

      {/* Right status indicator */}
      {right.text && (
        <span className={['text-[11px] leading-none mt-[3px] flex-none', right.className].join(' ')}>
          {right.text}
        </span>
      )}
    </button>
  )
}
