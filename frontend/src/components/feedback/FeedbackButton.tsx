/**
 * FeedbackButton — floating round trigger, present on every screen (mounted
 * once from Shell). Fixed bottom-right, above the mobile bottom-nav.
 *
 * Owns the screenshot-capture lifecycle: on click, hides itself, captures
 * document.body via html2canvas, restores itself, then opens FeedbackDrawer
 * with the captured blob (or null + an error flag if capture failed —
 * FeedbackDrawer falls back to a manual file-input attach).
 *
 * Positioning: bottom: 72px on mobile (clears the 56px bottom-nav + gap),
 * bottom: 24px on desktop. env(safe-area-inset-bottom) added on top so it
 * clears the home-indicator area on notched phones.
 */

import { useRef, useState } from 'react'
import { Bug } from 'lucide-react'
import html2canvas from 'html2canvas'
import { useMediaQuery } from '../../hooks/useMediaQuery'
import { FeedbackDrawer } from './FeedbackDrawer'

export function FeedbackButton() {
  const [open, setOpen] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const [screenshotBlob, setScreenshotBlob] = useState<Blob | null>(null)
  const [screenshotFailed, setScreenshotFailed] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const isMobile = useMediaQuery('(max-width: 767px)')

  async function handleOpen() {
    setCapturing(true)
    setScreenshotBlob(null)
    setScreenshotFailed(false)

    const btn = buttonRef.current
    const prevVisibility = btn?.style.visibility ?? ''
    if (btn) btn.style.visibility = 'hidden'

    try {
      const canvas = await html2canvas(document.body, {
        logging: false,
        useCORS: true,
        // Skip the drawer/portal root if it somehow already exists (defensive —
        // it shouldn't be mounted yet since `open` is still false here).
        ignoreElements: (el) => el.hasAttribute('data-feedback-ignore'),
      })
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
      setScreenshotBlob(blob)
      if (!blob) setScreenshotFailed(true)
    } catch {
      setScreenshotFailed(true)
    } finally {
      if (btn) btn.style.visibility = prevVisibility
      setCapturing(false)
      setOpen(true)
    }
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => void handleOpen()}
        disabled={capturing}
        aria-label="Report feedback"
        title="Report a bug or idea"
        data-feedback-ignore="true"
        style={{
          // Mobile: clear both the 56px bottom-nav AND the taller
          // pinned action strips some routes render just above it (e.g.
          // Inbox's Look closer/Skip/Later row, ~68px). 140px keeps the
          // button clear of every known bottom-pinned control instead of
          // the bottom-nav alone.
          bottom: isMobile
            ? 'calc(140px + env(safe-area-inset-bottom))'
            : 'calc(24px + env(safe-area-inset-bottom))',
        }}
        className={[
          'fixed right-4 z-[2900] w-12 h-12 rounded-full',
          'flex items-center justify-center',
          'bg-accent/90 text-white shadow-lg border border-accent/40',
          'hover:bg-accent transition-colors duration-fast cursor-pointer',
          'disabled:opacity-60 disabled:cursor-wait',
        ].join(' ')}
      >
        <Bug size={20} strokeWidth={1.75} aria-hidden="true" />
      </button>

      <FeedbackDrawer
        open={open}
        onOpenChange={setOpen}
        screenshotBlob={screenshotBlob}
        screenshotFailed={screenshotFailed}
      />
    </>
  )
}
