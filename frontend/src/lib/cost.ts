/**
 * All-in cost computation — ported from vanilla Wave 6C computeAllIn.
 *
 * Computes the "all-in" cost of an apartment by adding price + estimated
 * renovation work, factoring in a contingency buffer and uncertainty band.
 *
 * Settings rates used:
 *   reno_kitchen_full, reno_bathroom_full, reno_windows_per_unit,
 *   reno_floors_per_sqm, reno_rewire_per_sqm, reno_heating,
 *   reno_cosmetic_per_sqm, reno_contingency_pct
 *
 * If the entry has a manual renovation_override_work_eur in cost_of_ownership,
 * that value is used directly and uncertainty band is set to 0.
 *
 * Mirrors backend/cost_calculator.py SPEC §4 + §6 logic.
 */

import type { Entry, SettingsData, RenovationItem } from '../types/api'

// ── Settings value helpers ─────────────────────────────────────────────────

/** Extract a numeric setting value by key from SettingsData.fields */
function settingNum(settings: SettingsData | undefined, key: string, fallback = 0): number {
  const field = settings?.fields.find((f) => f.key === key)
  if (!field) return fallback
  const v = field.value
  if (typeof v === 'number') return v
  const n = parseFloat(String(v))
  return isNaN(n) ? fallback : n
}

// ── Renovation rate keys that scale per-sqm ───────────────────────────────

const PER_SQM_KEYS = new Set(['floors', 'rewire', 'cosmetic'])

// ── Result type ────────────────────────────────────────────────────────────

export interface AllInResult {
  /** Estimated renovation work cost (contingency included), 0 if no items */
  work: number
  /** price_eur + work */
  allIn: number
  /** Uncertainty band (±band around work) */
  band: number
  /** True if any item has confidence === 1 (low confidence → wider band) */
  hasLowConfidence: boolean
  /** True if there are no renovation items at all (all-in is price-only estimate) */
  noItems: boolean
}

/**
 * Compute all-in cost for a listing given current settings.
 *
 * Returns allIn=price_eur if no renovation_items present (noItems=true).
 * Respects manual renovation_override_work_eur stored in cost_of_ownership.
 */
export function computeAllIn(
  entry: Entry,
  settings: SettingsData | undefined,
): AllInResult {
  const price = entry.price_eur ?? 0

  // Manual override takes precedence
  const override = (entry.cost_of_ownership as Record<string, unknown> | null)
    ?.renovation_override_work_eur
  if (typeof override === 'number') {
    return {
      work: override,
      allIn: price + override,
      band: 0,
      hasLowConfidence: false,
      noItems: false,
    }
  }

  const items: RenovationItem[] =
    (entry.checklist as { renovation_items?: RenovationItem[] } | null)
      ?.renovation_items ?? []

  if (items.length === 0) {
    return { work: 0, allIn: price, band: 0, hasLowConfidence: false, noItems: true }
  }

  const rates: Record<string, number> = {
    kitchen_full:    settingNum(settings, 'reno_kitchen_full', 8000),
    bathroom_full:   settingNum(settings, 'reno_bathroom_full', 5000),
    windows:         settingNum(settings, 'reno_windows_per_unit', 600),
    floors:          settingNum(settings, 'reno_floors_per_sqm', 35),
    rewire:          settingNum(settings, 'reno_rewire_per_sqm', 25),
    heating:         settingNum(settings, 'reno_heating', 3000),
    cosmetic:        settingNum(settings, 'reno_cosmetic_per_sqm', 15),
  }

  const area = entry.area_sqm ?? 0
  let subtotal = 0
  let hasLowConfidence = false

  for (const item of items) {
    if (item.applies === false) continue
    const rate = rates[item.key] ?? 0
    const qty = item.qty ?? (PER_SQM_KEYS.has(item.key) ? area : 1)
    subtotal += rate * qty
    if (item.confidence === 1) hasLowConfidence = true
  }

  const contingencyPct = settingNum(settings, 'reno_contingency_pct', 15)
  const work = Math.round(subtotal * (1 + contingencyPct / 100))
  const allIn = price + work
  const bandPct = hasLowConfidence ? 0.4 : 0.25
  const band = Math.round(work * bandPct)

  return { work, allIn, band, hasLowConfidence, noItems: false }
}

/**
 * Sort shortlisted entries by all-in cost (ascending).
 * Falls back to score-descending when settings.rank_by_all_in is false.
 */
export function rankByAllIn(
  entries: Entry[],
  settings: SettingsData | undefined,
): Entry[] {
  const rankSetting = settings?.fields.find((f) => f.key === 'rank_by_all_in')
  if (!rankSetting || rankSetting.value !== true) {
    // Default: sort by score descending
    return [...entries].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
  }
  return [...entries].sort((a, b) => {
    const aAllIn = computeAllIn(a, settings).allIn
    const bAllIn = computeAllIn(b, settings).allIn
    return aAllIn - bAllIn
  })
}
