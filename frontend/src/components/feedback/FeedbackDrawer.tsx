/**
 * FeedbackDrawer — vaul bottom sheet for submitting a feedback/bug report.
 *
 * Type chips (Bug/Feature/UX/Performance) + comment textarea + collapsed
 * "attached context" preview (URL, viewport, UA, screenshot thumbnail,
 * console log count) + manual screenshot fallback + Submit/Cancel.
 *
 * The screenshot itself is captured by the parent (FeedbackButton) BEFORE
 * this drawer opens (so the drawer's own UI never appears in the shot) and
 * handed down via `screenshotBlob`. If capture failed, `screenshotFailed`
 * is set and a manual file-input fallback is shown so Daniel can still
 * attach a shot (e.g. taken via the OS screenshot tool).
 */

import { useEffect, useRef, useState } from 'react'
import { Drawer } from 'vaul'
import { ChevronDown, ChevronRight, Bug, Lightbulb, Palette, Gauge } from 'lucide-react'
import { submitFeedback } from '../../lib/api'
import { useInvalidateFeedback } from '../../lib/queries'
import { getRecentLogs } from '../../lib/consoleCapture'
import { useAppStore } from '../../lib/state'
import type { FeedbackType } from '../../types/api'

const MAX_COMMENT_CHARS = 2000

const TYPE_OPTIONS: { id: FeedbackType; label: string; icon: React.ReactNode }[] = [
  { id: 'bug', label: 'Bug', icon: <Bug size={14} strokeWidth={1.75} /> },
  { id: 'feature', label: 'Feature', icon: <Lightbulb size={14} strokeWidth={1.75} /> },
  { id: 'ux', label: 'UX', icon: <Palette size={14} strokeWidth={1.75} /> },
  { id: 'perf', label: 'Performance', icon: <Gauge size={14} strokeWidth={1.75} /> },
]

interface FeedbackDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  screenshotBlob: Blob | null
  screenshotFailed: boolean
}

export function FeedbackDrawer({ open, onOpenChange, screenshotBlob, screenshotFailed }: FeedbackDrawerProps) {
  const [type, setType] = useState<FeedbackType>('bug')
  const [comment, setComment] = useState('')
  const [contextOpen, setContextOpen] = useState(false)
  const [manualFile, setManualFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toastVisible, setToastVisible] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const invalidateFeedback = useInvalidateFeedback()
  const setTab = useAppStore((s) => s.setTab)

  const consoleLogs = getRecentLogs()
  const effectiveBlob: Blob | null = manualFile ?? screenshotBlob

  // Reset form state each time the drawer opens for a fresh report.
  useEffect(() => {
    if (open) {
      setType('bug')
      setComment('')
      setContextOpen(false)
      setManualFile(null)
      setError(null)
      // Autofocus the comment textarea once the sheet has mounted.
      const t = setTimeout(() => textareaRef.current?.focus(), 50)
      return () => clearTimeout(t)
    }
    return undefined
  }, [open])

  // Build/revoke an object URL for whichever screenshot source is active.
  useEffect(() => {
    if (!effectiveBlob) {
      setPreviewUrl(null)
      return undefined
    }
    const url = URL.createObjectURL(effectiveBlob)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [effectiveBlob])

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    }
  }, [])

  function showToast() {
    setToastVisible(true)
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    toastTimerRef.current = setTimeout(() => setToastVisible(false), 3000)
  }

  async function handleSubmit() {
    const trimmed = comment.trim()
    if (!trimmed) {
      setError('Comment is required')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await submitFeedback({
        type,
        comment: trimmed,
        url: window.location.href,
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        userAgent: navigator.userAgent,
        consoleLogs,
        screenshot: effectiveBlob,
      })
      invalidateFeedback()
      onOpenChange(false)
      showToast()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to submit feedback')
    } finally {
      setSubmitting(false)
    }
  }

  function handleManualFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null
    setManualFile(file)
  }

  return (
    <>
      <Drawer.Root open={open} onOpenChange={onOpenChange}>
        <Drawer.Portal>
          <Drawer.Overlay
            className="fixed inset-0 z-[3000]"
            style={{ background: 'rgba(0,0,0,0.4)' }}
            data-feedback-ignore="true"
          />
          <Drawer.Content
            data-feedback-ignore="true"
            className="fixed bottom-0 left-0 right-0 z-[3001] bg-surface rounded-t-xl p-4 shadow-lg max-h-[85vh] overflow-y-auto"
            style={{ outline: 'none', paddingBottom: 'calc(16px + env(safe-area-inset-bottom))' }}
          >
            <div className="mx-auto w-9 h-1 bg-border-strong rounded-full mb-4" />

            <h3 className="font-sans font-medium text-[16px] text-text mb-1">Report feedback</h3>
            <p className="text-[12px] text-text-3 mb-4">
              Bug, feature idea, UX friction, or something slow — Daniel triages these against
              the live report ID.
            </p>

            {/* Type chips */}
            <div className="flex flex-wrap gap-2 mb-4" role="radiogroup" aria-label="Feedback type">
              {TYPE_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  role="radio"
                  aria-checked={type === opt.id}
                  onClick={() => setType(opt.id)}
                  className={[
                    'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] font-sans transition-colors duration-fast cursor-pointer',
                    type === opt.id
                      ? 'bg-accent text-white border border-transparent'
                      : 'bg-sunken border border-border-strong text-text-3 hover:border-border hover:text-text',
                  ].join(' ')}
                >
                  {opt.icon}
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Comment */}
            <label className="block mb-1 font-sans text-[13px] text-text-2" htmlFor="feedback-comment">
              What's going on?
            </label>
            <textarea
              id="feedback-comment"
              ref={textareaRef}
              value={comment}
              maxLength={MAX_COMMENT_CHARS}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Describe the bug, idea, or friction point…"
              rows={4}
              className="w-full bg-sunken text-text text-[13px] px-3 py-2 rounded-md border border-border focus:outline-none focus:border-accent/60 transition-colors duration-fast resize-none mb-1"
            />
            <div className="flex justify-end mb-4">
              <span className="font-mono text-[10px] text-faint">{comment.length}/{MAX_COMMENT_CHARS}</span>
            </div>

            {/* Auto-capture context — collapsed by default */}
            <div className="mb-4 border border-border rounded-md overflow-hidden">
              <button
                type="button"
                onClick={() => setContextOpen((v) => !v)}
                className="w-full flex items-center justify-between px-3 py-2 bg-sunken text-[12px] font-sans text-text-3 hover:text-text transition-colors duration-fast cursor-pointer"
              >
                <span>
                  Attached: {effectiveBlob ? 'screenshot' : 'no screenshot'} + {consoleLogs.length} console
                  logs + URL
                </span>
                {contextOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
              {contextOpen && (
                <div className="p-3 flex flex-col gap-2 text-[12px] font-mono text-text-3">
                  <div>URL: <span className="text-text-2">{window.location.href}</span></div>
                  <div>Viewport: <span className="text-text-2">{window.innerWidth}x{window.innerHeight}</span></div>
                  <div>User agent: <span className="text-text-2">{navigator.userAgent.slice(0, 60)}…</span></div>
                  <div>Console logs: <span className="text-text-2">{consoleLogs.length} entries</span></div>

                  <div className="mt-1">
                    {previewUrl ? (
                      <img
                        src={previewUrl}
                        alt="Screenshot preview"
                        className="max-h-32 rounded border border-border-strong"
                      />
                    ) : (
                      <span className="text-faint">
                        Screenshot: {screenshotFailed ? 'capture failed — attach manually below' : 'not captured'}
                      </span>
                    )}
                  </div>

                  <label className="mt-2 font-sans text-[12px] text-text-2">
                    Attach screenshot manually
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleManualFileChange}
                      className="block mt-1 text-[11px] text-faint"
                    />
                  </label>
                </div>
              )}
            </div>

            {error && (
              <p className="text-[12px] text-score-bad mb-3">{error}</p>
            )}

            {/* Actions */}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                disabled={submitting}
                className="flex-1 h-11 rounded-md font-sans text-[14px] font-normal border border-border-strong bg-transparent text-text-3 hover:bg-white/[0.06] hover:text-text transition-colors duration-fast cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={submitting || !comment.trim()}
                className="flex-1 h-11 rounded-md font-sans text-[14px] font-medium bg-accent text-white hover:bg-accent/80 transition-colors duration-fast cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? 'Submitting…' : 'Submit'}
              </button>
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>

      {/* Toast — rendered outside Drawer.Root so it survives the drawer closing */}
      {toastVisible && (
        <div
          className="fixed bottom-4 right-4 z-[3500] px-4 py-2.5 rounded-lg shadow-lg font-sans text-[13px] bg-score-best text-bg flex items-center gap-2 cursor-pointer"
          onClick={() => {
            setTab('feedback')
            setToastVisible(false)
          }}
          role="status"
        >
          Reported ✓ — <span className="underline">Open feedback list</span>
        </div>
      )}
    </>
  )
}
