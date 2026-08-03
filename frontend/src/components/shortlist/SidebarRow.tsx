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
 * - Compare-selected: ring-2 ring-accent inset
 *
 * Wave 7D: cmd/ctrl-click OR checkbox adds to compare selection.
 */

import type { Entry, ListingStatus } from '../../types/api'
import { scoreColor } from '../../lib/score'
import { fmtEur } from '../../lib/format'

interface SidebarRowProps {
  entry: Entry
  isSelected: boolean
  isCompareSelected: boolean
  onClick: () => void
  onCompareToggle: (id: string) => void
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

export function SidebarRow({ entry, isSelected, isCompareSelected, onClick, onCompareToggle }: SidebarRowProps) {
  const isDropped = entry.status === 'dropped'
  const borderColor = scoreColor(entry.score)
  const right = rightLabel(entry)

  function handleClick(e: React.MouseEvent) {
    if (e.metaKey || e.ctrlKey) {
      // cmd/ctrl-click → compare toggle (don't select)
      e.preventDefault()
      onCompareToggle(entry.id)
      return
    }
    onClick()
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className={[
        'w-full text-left pl-3 pr-2 py-2.5 flex items-start gap-2',
        'border-l-2 transition-colors duration-fast relative',
        isSelected ? 'bg-accent/10' : 'hover:bg-surface/50',
        isCompareSelected ? 'ring-2 ring-inset ring-accent' : '',
        isDropped ? 'opacity-40' : '',
      ].join(' ')}
      style={{ borderLeftColor: borderColor }}
    >
      {/* Compare checkbox indicator */}
      {isCompareSelected && (
        <div className="absolute top-1.5 right-1.5 w-3 h-3 rounded-sm bg-accent flex items-center justify-center">
          <svg width="7" height="5" viewBox="0 0 7 5" fill="none">
            <path d="M1 2.5L2.8 4.3L6 1" stroke="#0f111c" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      )}

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
        <span className={['text-[11px] leading-none mt-[3px] flex-none mr-4', right.className].join(' ')}>
          {right.text}
        </span>
      )}
    </button>
  )
}
