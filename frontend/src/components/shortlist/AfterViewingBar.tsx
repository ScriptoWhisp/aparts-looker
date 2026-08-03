/**
 * AfterViewingBar — post-viewing decision bar (SPEC §2.4 Wave 5A endpoint).
 *
 * Only rendered when status IN {viewed, thinking, offer_drafted, dropped}.
 * Buttons: Still in → offer_drafted, Thinking → thinking, Drop → opens modal.
 * Dropped state: shows "Undo drop" ghost button instead.
 *
 * Drop modal uses vaul Drawer pattern from InboxMobile.
 */

import { useState } from 'react'
import { Drawer } from 'vaul'
import { useQueryClient } from '@tanstack/react-query'
import type { Entry } from '../../types/api'
import { viewingDecision } from '../../lib/api'
import { QUERY_KEYS } from '../../lib/queries'

interface AfterViewingBarProps {
  entry: Entry
}

const AFTER_VIEWING_STATUSES = new Set(['viewed', 'thinking', 'offer_drafted', 'dropped'])

// ── Drop reason drawer ─────────────────────────────────────────────────────

interface DropDrawerProps {
  open: boolean
  onClose: () => void
  onConfirm: (reason: string) => void
  loading: boolean
}

function DropDrawer({ open, onClose, onConfirm, loading }: DropDrawerProps) {
  const [reason, setReason] = useState('')

  function handleConfirm() {
    onConfirm(reason.trim())
    setReason('')
  }

  return (
    <Drawer.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-black/50 z-40" />
        <Drawer.Content className="fixed bottom-0 left-0 right-0 z-50 bg-surface rounded-t-xl p-4 flex flex-col gap-4 max-w-lg mx-auto">
          <div className="mx-auto w-12 h-1 rounded-full bg-border-strong" />
          <Drawer.Title className="text-[15px] font-medium text-text">
            Drop this listing?
          </Drawer.Title>
          <p className="text-[13px] text-text-3">
            You can optionally leave a reason for your future reference.
          </p>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (optional)"
            maxLength={200}
            className={[
              'bg-sunken text-text text-[13px] px-3 py-2 rounded-md',
              'border border-border focus:outline-none focus:border-accent/60',
            ].join(' ')}
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleConfirm}
              disabled={loading}
              className="flex-1 py-2.5 text-[13px] font-medium bg-score-bad/90 text-white rounded-md hover:bg-score-bad disabled:opacity-50 transition-colors"
            >
              {loading ? 'Saving…' : 'Drop listing'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 text-[13px] text-text-3 border border-border rounded-md hover:bg-surface/80 transition-colors"
            >
              Cancel
            </button>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}

// ── Main bar ───────────────────────────────────────────────────────────────

export function AfterViewingBar({ entry }: AfterViewingBarProps) {
  const qc = useQueryClient()
  const [loading, setLoading] = useState(false)
  const [dropDrawerOpen, setDropDrawerOpen] = useState(false)

  if (!AFTER_VIEWING_STATUSES.has(entry.status)) return null

  async function handleDecision(
    decision: 'still-in' | 'thinking' | 'drop',
    reason?: string,
  ) {
    setLoading(true)
    try {
      await viewingDecision(entry.id, decision, reason)
      void qc.invalidateQueries({ queryKey: QUERY_KEYS.appData })
    } catch {
      // silently fail (backend never-raise)
    } finally {
      setLoading(false)
    }
  }

  // Dropped state: "Undo drop" ghost button
  if (entry.status === 'dropped') {
    return (
      <div className="mt-3 mx-4 p-3 rounded-md bg-sunken ring-1 ring-muted/20 flex items-center gap-3">
        <button
          type="button"
          onClick={() => handleDecision('thinking')}
          disabled={loading}
          className={[
            'px-3 py-1.5 text-[12px] text-muted border border-border rounded-md',
            'hover:text-text hover:border-border-strong transition-colors',
            'disabled:opacity-50',
          ].join(' ')}
        >
          {loading ? 'Saving…' : 'Undo drop'}
        </button>
        {entry.drop_reason && (
          <span className="text-[11px] text-faint italic">{entry.drop_reason}</span>
        )}
      </div>
    )
  }

  return (
    <>
      <div className="mt-3 mx-4 p-3 rounded-md bg-sunken ring-1 ring-accent/30 flex items-center gap-3 flex-wrap">
        <p className="text-[10px] font-mono uppercase text-muted tracking-widest flex-none">
          After the viewing
        </p>

        {/* Decision buttons */}
        <div className="flex gap-2 flex-none">
          <button
            type="button"
            onClick={() => handleDecision('still-in')}
            disabled={loading || entry.status === 'offer_drafted'}
            className={[
              'px-3 py-1.5 text-[12px] font-medium rounded-md transition-colors',
              entry.status === 'offer_drafted'
                ? 'bg-status-short/20 text-status-short cursor-default'
                : 'bg-accent text-bg hover:bg-accent/80 disabled:opacity-50',
            ].join(' ')}
          >
            {entry.status === 'offer_drafted' ? 'Still in (offer drafted)' : 'Still in — draft offer'}
          </button>

          <button
            type="button"
            onClick={() => handleDecision('thinking')}
            disabled={loading || entry.status === 'thinking'}
            className={[
              'px-3 py-1.5 text-[12px] rounded-md border transition-colors',
              entry.status === 'thinking'
                ? 'border-accent/40 text-accent/70 cursor-default'
                : 'border-border text-text-3 hover:text-text hover:border-border-strong disabled:opacity-50',
            ].join(' ')}
          >
            Thinking
          </button>

          <button
            type="button"
            onClick={() => setDropDrawerOpen(true)}
            disabled={loading}
            className="px-3 py-1.5 text-[12px] rounded-md border border-border text-text-3 hover:text-score-bad hover:border-score-bad/50 disabled:opacity-50 transition-colors"
          >
            Drop
          </button>
        </div>

        {/* Right muted hint */}
        <p className="text-[11.5px] text-faint italic ml-auto">
          The one decision the AI can't make for you — it's why the list stays short.
        </p>
      </div>

      <DropDrawer
        open={dropDrawerOpen}
        onClose={() => setDropDrawerOpen(false)}
        onConfirm={(reason) => {
          setDropDrawerOpen(false)
          void handleDecision('drop', reason)
        }}
        loading={loading}
      />
    </>
  )
}
