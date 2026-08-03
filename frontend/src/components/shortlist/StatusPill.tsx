/**
 * StatusPill — coloured pill showing listing lifecycle state.
 *
 * Matches the tag system from the SPEC § 1 palette:
 *   approved      → status-short (green)
 *   viewing_scheduled → status-viewing (blue) + date
 *   viewed        → status-viewed (muted)
 *   thinking      → status-viewed (muted)
 *   offer_drafted → status-short (green) bold
 *   dropped       → status-skip (red)
 */

import type { ListingStatus } from '../../types/api'

interface StatusPillProps {
  status: ListingStatus
  scheduledAt?: string | null
  className?: string
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

const STATUS_CONFIG: Record<
  ListingStatus,
  { label: (scheduledAt?: string | null) => string; className: string }
> = {
  pending: {
    label: () => 'pending',
    className: 'bg-status-new/15 text-status-new',
  },
  approved: {
    label: () => 'approved',
    className: 'bg-status-short/15 text-status-short',
  },
  rejected: {
    label: () => 'rejected',
    className: 'bg-status-skip/15 text-status-skip',
  },
  viewing_scheduled: {
    label: (at) => (at ? `viewing ${fmtShortDate(at)}` : 'viewing scheduled'),
    className: 'bg-status-viewing/15 text-status-viewing',
  },
  viewed: {
    label: () => 'viewed',
    className: 'bg-status-viewed/15 text-status-viewed',
  },
  thinking: {
    label: () => 'thinking',
    className: 'bg-status-viewed/15 text-status-viewed',
  },
  offer_drafted: {
    label: () => 'offer drafted',
    className: 'bg-status-short/20 text-status-short font-medium',
  },
  dropped: {
    label: () => 'dropped',
    className: 'bg-status-skip/15 text-status-skip',
  },
  withdrawn: {
    label: () => 'withdrawn',
    className: 'bg-faint/20 text-faint',
  },
}

export function StatusPill({ status, scheduledAt, className = '' }: StatusPillProps) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending
  return (
    <span
      className={[
        'inline-flex items-center px-2 py-[3px]',
        'text-[11px] font-mono rounded-sm whitespace-nowrap',
        cfg.className,
        className,
      ].join(' ')}
    >
      {cfg.label(scheduledAt)}
    </span>
  )
}
