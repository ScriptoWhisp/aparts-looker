/**
 * Settings tab — placeholder for Wave 7D.
 *
 * Wave 7D will implement:
 * - Left rail: Buyer profile / Scoring & AI / Cost model / Telegram / Scraper
 * - Renovation rates table (editable, triggers client-side re-cost)
 * - Score threshold ramp slider
 * - District chips, room segmented control
 * - Weight sliders (sum-to-100 guard)
 * - Maa-amet data source attribution
 */

export function Settings() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-6">
      <div className="text-muted text-[13px] font-sans">
        <p className="font-medium text-text mb-2">Settings</p>
        <p className="text-text-3">
          This tab migrates in Wave 7D.
        </p>
        <p className="text-faint text-[12px] mt-3">
          Features: renovation rates, score ramp slider, district chips,
          Telegram config, Maa-amet data attribution.
        </p>
      </div>
    </div>
  )
}
