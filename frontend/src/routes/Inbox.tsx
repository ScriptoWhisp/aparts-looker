/**
 * Inbox tab — placeholder for Wave 7B.
 *
 * Wave 7B will implement:
 * - Desktop: 3-column card grid with Look closer / Skip actions
 * - Mobile (≤768px): single-card triage with Framer Motion swipe cards
 * - Keyboard shortcuts: L, S, ↑↓
 * - Skip reason bottom sheet (vaul)
 * - Cleared state after triage
 */

export function Inbox() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-6">
      <div className="text-muted text-[13px] font-sans">
        <p className="font-medium text-text mb-2">Inbox</p>
        <p className="text-text-3">
          This tab migrates in Wave 7B.
        </p>
        <p className="text-faint text-[12px] mt-3">
          Features: mobile swipe cards (Framer Motion), Look closer / Skip, keyboard shortcuts.
        </p>
      </div>
    </div>
  )
}
