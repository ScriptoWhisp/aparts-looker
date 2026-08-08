/**
 * Feedback — browse in-app bug/feature/ux/perf reports.
 *
 * Header (title + count) → filter row (status pills + type pills) → card
 * list (most recent first, thumbnail if a screenshot exists) → click opens
 * a detail modal with the full comment, screenshot, console logs, copy-URL
 * buttons for Claude triage, a status dropdown, and delete.
 *
 * Deep-link: on mount, if the hash carries "?id=<uuid>" (e.g.
 * "#feedback?id=abc"), the matching report's detail modal opens
 * automatically — useful when Daniel pastes a shared link.
 */

import { useEffect, useState } from 'react'
import { Camera, Copy, Trash2, X } from 'lucide-react'
import {
  useFeedback,
  useFeedbackOne,
  useInvalidateFeedback,
} from '../lib/queries'
import { patchFeedback, deleteFeedback, feedbackScreenshotUrl } from '../lib/api'
import { fmtDate } from '../lib/format'
import { feedbackIdFromHash } from '../lib/state'
import type { Feedback as FeedbackItem, FeedbackStatus, FeedbackType } from '../types/api'

// ── Pill config ──────────────────────────────────────────────────────────

const STATUS_PILLS: { id: FeedbackStatus | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'open', label: 'Open' },
  { id: 'in_progress', label: 'In Progress' },
  { id: 'fixed', label: 'Fixed' },
  { id: 'wontfix', label: "Won't fix" },
]

const TYPE_PILLS: { id: FeedbackType | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'bug', label: 'Bug' },
  { id: 'feature', label: 'Feature' },
  { id: 'ux', label: 'UX' },
  { id: 'perf', label: 'Perf' },
]

const STATUS_LABEL: Record<FeedbackStatus, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  fixed: 'Fixed',
  wontfix: "Won't fix",
}

const STATUS_COLOR: Record<FeedbackStatus, string> = {
  open: 'text-status-new border-status-new/30 bg-status-new/10',
  in_progress: 'text-accent-lt border-accent/30 bg-accent/10',
  fixed: 'text-score-best border-score-best/30 bg-score-best/10',
  wontfix: 'text-text-3 border-border-strong bg-sunken',
}

// ── Pill row ─────────────────────────────────────────────────────────────

function PillRow<T extends string>({
  options,
  active,
  onSelect,
}: {
  options: { id: T; label: string }[]
  active: T
  onSelect: (id: T) => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => (
        <button
          key={opt.id}
          type="button"
          onClick={() => onSelect(opt.id)}
          className={[
            'px-3 py-1.5 rounded-full text-[12px] font-sans transition-colors duration-fast cursor-pointer whitespace-nowrap',
            active === opt.id
              ? 'bg-accent/15 text-accent-lt font-medium border border-accent/30'
              : 'text-text-3 bg-sunken border border-border hover:border-border-strong hover:text-text',
          ].join(' ')}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

// ── Card ─────────────────────────────────────────────────────────────────

function FeedbackCard({ item, onClick }: { item: FeedbackItem; onClick: () => void }) {
  let urlFragment = item.url
  try {
    const u = new URL(item.url)
    urlFragment = u.pathname + u.hash
  } catch {
    // leave urlFragment as-is (malformed URL)
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left flex items-start gap-3 p-3 rounded-lg bg-surface border border-border hover:border-border-strong transition-colors duration-fast cursor-pointer"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-sm border border-border-strong text-text-3 uppercase">
            {item.type}
          </span>
          <span className={['font-mono text-[10px] px-1.5 py-0.5 rounded-sm border', STATUS_COLOR[item.status]].join(' ')}>
            {STATUS_LABEL[item.status]}
          </span>
        </div>
        <p className="font-sans text-[13px] text-text line-clamp-2 mb-1.5">{item.comment}</p>
        <p className="font-mono text-[11px] text-faint truncate">
          {fmtDate(item.created_at)} · {urlFragment} {item.viewport ? `· ${item.viewport}` : ''}
        </p>
      </div>
      {item.has_screenshot && (
        <img
          src={feedbackScreenshotUrl(item.id)}
          alt=""
          className="w-14 h-14 object-cover rounded-md border border-border-strong flex-shrink-0"
        />
      )}
    </button>
  )
}

// ── Console log line ─────────────────────────────────────────────────────

const LOG_LEVEL_COLOR: Record<string, string> = {
  error: 'text-score-bad',
  warn: 'text-status-new',
  onerror: 'text-score-bad',
  unhandledrejection: 'text-score-bad',
  info: 'text-accent-lt',
  log: 'text-text-3',
}

// ── Detail modal ─────────────────────────────────────────────────────────

function FeedbackDetailModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: item, isLoading } = useFeedbackOne(id)
  const invalidate = useInvalidateFeedback()
  const [logsOpen, setLogsOpen] = useState(false)
  const [copyMsg, setCopyMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopyMsg(`${label} copied`)
    } catch {
      setCopyMsg('Copy failed — clipboard unavailable')
    }
    setTimeout(() => setCopyMsg(null), 2000)
  }

  async function handleStatusChange(status: FeedbackStatus) {
    setBusy(true)
    try {
      await patchFeedback(id, { status })
      invalidate()
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete() {
    if (!window.confirm('Delete this feedback report? This cannot be undone.')) return
    setBusy(true)
    try {
      await deleteFeedback(id)
      invalidate()
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[3200] flex items-end sm:items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-lg max-h-[90vh] overflow-y-auto bg-surface sm:rounded-xl rounded-t-xl p-4 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-sans font-medium text-[16px] text-text">Feedback detail</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-text-3 hover:text-text cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {isLoading || !item ? (
          <p className="font-mono text-[12px] text-muted">Loading…</p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] px-1.5 py-0.5 rounded-sm border border-border-strong text-text-3 uppercase">
                {item.type}
              </span>
              <span className={['font-mono text-[11px] px-1.5 py-0.5 rounded-sm border', STATUS_COLOR[item.status]].join(' ')}>
                {STATUS_LABEL[item.status]}
              </span>
              <span className="font-mono text-[11px] text-faint ml-auto">{fmtDate(item.created_at)}</span>
            </div>

            <p className="font-sans text-[14px] text-text whitespace-pre-wrap">{item.comment}</p>

            <div className="flex flex-col gap-1 font-mono text-[11px] text-text-3">
              <div className="truncate">URL: {item.url}</div>
              {item.viewport && <div>Viewport: {item.viewport}</div>}
              {item.user_agent && <div className="truncate">UA: {item.user_agent}</div>}
            </div>

            {item.has_screenshot && (
              <div>
                <img
                  src={feedbackScreenshotUrl(item.id)}
                  alt="Full screenshot"
                  className="w-full rounded-md border border-border-strong"
                />
              </div>
            )}

            {/* Console logs — collapsible */}
            <div className="border border-border rounded-md overflow-hidden">
              <button
                type="button"
                onClick={() => setLogsOpen((v) => !v)}
                className="w-full flex items-center justify-between px-3 py-2 bg-sunken text-[12px] font-sans text-text-3 hover:text-text transition-colors duration-fast cursor-pointer"
              >
                Console logs ({item.console_logs.length})
              </button>
              {logsOpen && (
                <div className="p-3 flex flex-col gap-1 font-mono text-[11px] max-h-48 overflow-y-auto">
                  {item.console_logs.length === 0 && (
                    <span className="text-faint">No console activity captured.</span>
                  )}
                  {item.console_logs.map((log, i) => (
                    <div key={i} className={LOG_LEVEL_COLOR[log.level] ?? 'text-text-3'}>
                      [{log.level}] {log.args.join(' ')}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Copy-for-Claude buttons */}
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => void copy(`${window.location.origin}/#feedback?id=${item.id}`, 'Report URL')}
                className="flex items-center justify-center gap-2 h-10 rounded-md border border-border-strong text-[13px] font-sans text-text-2 hover:bg-white/[0.06] transition-colors duration-fast cursor-pointer"
              >
                <Copy size={14} /> Copy report URL for Claude
              </button>
              <button
                type="button"
                onClick={() => void copy(`${window.location.origin}/api/feedback/${item.id}`, 'Backend URL')}
                className="flex items-center justify-center gap-2 h-10 rounded-md border border-border-strong text-[13px] font-sans text-text-2 hover:bg-white/[0.06] transition-colors duration-fast cursor-pointer"
              >
                <Copy size={14} /> Copy backend URL
              </button>
              {copyMsg && <p className="text-[11px] text-score-best text-center">{copyMsg}</p>}
            </div>

            {/* Status + delete */}
            <div className="flex items-center gap-2 pt-2 border-t border-border">
              <label className="font-sans text-[12px] text-text-3" htmlFor="feedback-status-select">
                Status
              </label>
              <select
                id="feedback-status-select"
                value={item.status}
                disabled={busy}
                onChange={(e) => void handleStatusChange(e.target.value as FeedbackStatus)}
                className="bg-sunken text-text text-[13px] px-2 py-1.5 rounded-md border border-border flex-1"
              >
                {(Object.keys(STATUS_LABEL) as FeedbackStatus[]).map((s) => (
                  <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => void handleDelete()}
                disabled={busy}
                aria-label="Delete feedback"
                className="flex items-center justify-center w-9 h-9 rounded-md border border-score-bad/40 text-score-bad hover:bg-score-bad/10 transition-colors duration-fast cursor-pointer disabled:opacity-50"
              >
                <Trash2 size={15} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main route ─────────────────────────────────────────────────────────────

export function Feedback() {
  const [statusFilter, setStatusFilter] = useState<FeedbackStatus | 'all'>('all')
  const [typeFilter, setTypeFilter] = useState<FeedbackType | 'all'>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const { data, isLoading } = useFeedback({ status: statusFilter, type: typeFilter })
  const items = data?.feedback ?? []

  // Deep-link: "#feedback?id=<uuid>" opens that report's detail modal on load.
  useEffect(() => {
    const id = feedbackIdFromHash(window.location.hash)
    if (id) setSelectedId(id)
  }, [])

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Camera size={18} className="text-text-3" aria-hidden="true" />
        <h1 className="font-sans font-medium text-[20px] text-text">Feedback</h1>
        <span className="font-mono text-[12px] text-faint">{data?.count ?? 0}</span>
      </div>

      <div className="flex flex-col gap-2">
        <PillRow options={STATUS_PILLS} active={statusFilter} onSelect={setStatusFilter} />
        <PillRow options={TYPE_PILLS} active={typeFilter} onSelect={setTypeFilter} />
      </div>

      {isLoading && <p className="font-mono text-[12px] text-muted">Loading…</p>}

      {!isLoading && items.length === 0 && (
        <div className="flex items-center justify-center h-40">
          <p className="text-[13px] text-faint">
            No feedback yet — tap the 🐛 button on any screen to report a bug or idea.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {items.map((item) => (
          <FeedbackCard key={item.id} item={item} onClick={() => setSelectedId(item.id)} />
        ))}
      </div>

      {selectedId && (
        <FeedbackDetailModal id={selectedId} onClose={() => setSelectedId(null)} />
      )}
    </div>
  )
}
