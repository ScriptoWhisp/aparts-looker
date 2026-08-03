/**
 * Shortlist tab — placeholder for Wave 7C.
 *
 * Wave 7C will implement:
 * - 284px sidebar: To view / Viewed / Dropped funnel groups with score rules
 * - Main pane: hero row (photo + status + metrics), verdict band, accordion checklist
 * - After-viewing decision bar (Still in / Thinking / Drop)
 * - Gated negotiation card (unlocks after viewing)
 * - Compare overlay (cmd-click multi-select)
 */

export function Shortlist() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-6">
      <div className="text-muted text-[13px] font-sans">
        <p className="font-medium text-text mb-2">Shortlist</p>
        <p className="text-text-3">
          This tab migrates in Wave 7C.
        </p>
        <p className="text-faint text-[12px] mt-3">
          Features: 284px sidebar funnel, hero row, verdict band, checklist accordion,
          after-viewing decision bar, compare overlay.
        </p>
      </div>
    </div>
  )
}
