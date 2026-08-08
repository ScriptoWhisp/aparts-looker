/**
 * Test fixtures — realistic API response shapes.
 *
 * Covers: empty / partial / full / malformed (old contract) shapes.
 * Used by MSW handlers as defaults and directly in unit tests.
 */

import type { AppData, Entry, SettingsData, SettingsField } from '../../types/api'

// ── Entry factories ────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<Entry> & { id: string }): Entry {
  return {
    id: overrides.id,
    url: `https://kv.ee/en/object/${overrides.id}`,
    status: 'pending',
    score: 75,
    title: `Test Listing ${overrides.id}`,
    price_eur: 200_000,
    area_sqm: 55,
    rooms: 2,
    floor: 3,
    floors_total: 5,
    year_built: 2005,
    district: 'Kesklinn',
    address: 'Viru 1, Tallinn',
    image_url: null,
    verdict: 'Good location, reasonable price.',
    rejection_reason: null,
    scheduled_at: null,
    shortlisted_at: null,
    approved_at: null,
    created_at: '2026-08-01T10:00:00Z',
    viewing_history: [],
    cost_of_ownership: null,
    own_score: null,
    checklist: null,
    ai_checklist_fills: null,
    negotiation_brief: null,
    negotiation_brief_generated_at: null,
    energy_class: null,
    material: null,
    dropped_at: null,
    drop_reason: null,
    lat: 59.437,
    lng: 24.745,
    price_per_sqm: 3636,
    commute_minutes: 18,
    ...overrides,
  }
}

// ── Pending (inbox) entries ────────────────────────────────────────────────

export const pendingEntry1 = makeEntry({
  id: 'pending-1',
  status: 'pending',
  score: 82,
  title: 'Spacious 2BR in Kesklinn',
  price_eur: 215_000,
  area_sqm: 62,
  district: 'Kesklinn',
})

export const pendingEntry2 = makeEntry({
  id: 'pending-2',
  status: 'pending',
  score: 71,
  title: 'Cozy studio near Viru Gate',
  price_eur: 145_000,
  area_sqm: 38,
  district: 'Vanalinn',
})

export const pendingEntry3 = makeEntry({
  id: 'pending-3',
  status: 'pending',
  score: 65,
  title: 'Modern flat with balcony',
  price_eur: 189_000,
  area_sqm: 48,
  district: 'Põhja-Tallinn',
})

// ── Shortlisted entries ────────────────────────────────────────────────────

export const approvedEntry = makeEntry({
  id: 'approved-1',
  status: 'approved',
  score: 88,
  title: 'Top pick: sunny corner flat',
  price_eur: 245_000,
  area_sqm: 72,
  district: 'Kadriorg',
  approved_at: '2026-07-30T09:00:00Z',
  shortlisted_at: '2026-07-30T09:00:00Z',
  // Wave 10: real production shape. entry.checklist.groups is never written by
  // the backend (grepped backend/*.py — only ai_checklist_fills + the new
  // checklist.user_marks sub-key exist). 2 AI-filled keys (-> state=ok), 1
  // user-flagged key (via checklist.user_marks — the only source of state=flag
  // in the real system) exercises the flag-first group ordering + open-by-default.
  ai_checklist_fills: {
    s14_01: 'Kadriorg, 5 min to the sea, quiet street',
    s14_02: '245 000 € · 3 403 €/m²',
  },
  checklist: {
    user_marks: {
      s09_01: { state: 'flag', note: 'Plumbing not replaced since 1998', marked_at: '2026-07-30T10:00:00Z' },
    },
    renovation_items: [
      { key: 'kitchen_full', applies: true, confidence: 2, qty: null, note: 'Kitchen needs full reno' },
      { key: 'cosmetic', applies: true, confidence: 3, qty: null, note: null },
    ],
  },
})

export const viewingScheduledEntry = makeEntry({
  id: 'viewing-scheduled-1',
  status: 'viewing_scheduled',
  score: 79,
  title: 'Viewing booked: Mustamäe gem',
  price_eur: 178_000,
  area_sqm: 58,
  district: 'Mustamäe',
  scheduled_at: '2026-08-10T14:00:00Z',
  approved_at: '2026-07-28T11:00:00Z',
})

export const viewedEntry = makeEntry({
  id: 'viewed-1',
  status: 'viewed',
  score: 76,
  title: 'Viewed: Lasnamäe bargain',
  price_eur: 155_000,
  area_sqm: 65,
  district: 'Lasnamäe',
  own_score: 70,
  viewing_history: [
    { action: 'scheduled', at: '2026-07-25T10:00:00Z' },
    { action: 'viewed', at: '2026-07-26T14:30:00Z' },
    { action: 'decision', decision: 'still-in', at: '2026-07-26T15:00:00Z', own_score: 70 },
  ],
})

export const droppedEntry = makeEntry({
  id: 'dropped-1',
  status: 'dropped',
  score: 62,
  title: 'Dropped: noise problem',
  price_eur: 135_000,
  area_sqm: 42,
  district: 'Kristiine',
  dropped_at: '2026-07-20T09:00:00Z',
  drop_reason: 'Noise from main road',
})

// ── AppData shapes ─────────────────────────────────────────────────────────

export const mockEmptyAppData: AppData = {
  properties: [],
  pending: [],
  last_check: null,
  next_check: null,
}

export const mockAppDataWithPending: AppData = {
  properties: [],
  pending: [pendingEntry1, pendingEntry2, pendingEntry3],
  last_check: '2026-08-01T10:00:00Z',
  next_check: '2026-08-01T16:00:00Z',
}

export const mockAppDataWithShortlisted: AppData = {
  properties: [approvedEntry, viewingScheduledEntry, viewedEntry, droppedEntry],
  pending: [],
  last_check: '2026-08-01T10:00:00Z',
  next_check: '2026-08-01T16:00:00Z',
}

export const mockAppDataFull: AppData = {
  properties: [approvedEntry, viewingScheduledEntry, viewedEntry, droppedEntry],
  pending: [pendingEntry1, pendingEntry2, pendingEntry3],
  last_check: '2026-08-01T10:00:00Z',
  next_check: '2026-08-01T16:00:00Z',
}

// ── Settings shapes ────────────────────────────────────────────────────────

const FULL_FIELDS: SettingsField[] = [
  { key: 'max_price_eur', label: 'Max price', type: 'int', value: 265000, default: 265000, min: 50000, max: 500000, group: 'cost' },
  { key: 'min_rooms', label: 'Min rooms', type: 'int', value: 2, default: 2, min: 1, max: 6, group: 'cost' },
  { key: 'min_images', label: 'Min images', type: 'int', value: 5, default: 5, min: 0, max: 30, group: 'scraper' },
  { key: 'draft_score_threshold', label: 'Draft threshold', type: 'float', value: 75.0, default: 75.0, min: 0, max: 100, group: 'ai' },
  { key: 'telegram_min_score_photo', label: 'Telegram photo score', type: 'float', value: 60.0, default: 60.0, min: 0, max: 100, group: 'telegram' },
  { key: 'telegram_min_score_text', label: 'Telegram text score', type: 'float', value: 40.0, default: 40.0, min: 0, max: 100, group: 'telegram' },
  { key: 'rank_by_all_in', label: 'Rank by all-in cost', type: 'bool', value: false, default: false, group: 'cost' },
  { key: 'reno_kitchen_full', label: 'Kitchen reno', type: 'int', value: 8000, default: 8000, min: 2000, max: 25000, group: 'reno' },
  { key: 'reno_bathroom_full', label: 'Bathroom reno', type: 'int', value: 5000, default: 5000, min: 1000, max: 15000, group: 'reno' },
  { key: 'reno_windows_per_unit', label: 'Window cost/unit', type: 'int', value: 600, default: 600, min: 200, max: 2000, group: 'reno' },
  { key: 'reno_floors_per_sqm', label: 'Floors cost/m²', type: 'int', value: 35, default: 35, min: 10, max: 100, group: 'reno' },
  { key: 'reno_rewire_per_sqm', label: 'Rewire cost/m²', type: 'int', value: 25, default: 25, min: 10, max: 80, group: 'reno' },
  { key: 'reno_heating', label: 'Heating system', type: 'int', value: 3000, default: 3000, min: 500, max: 10000, group: 'reno' },
  { key: 'reno_cosmetic_per_sqm', label: 'Cosmetic/m²', type: 'int', value: 15, default: 15, min: 5, max: 50, group: 'reno' },
  { key: 'reno_contingency_pct', label: 'Contingency %', type: 'int', value: 15, default: 15, min: 0, max: 40, group: 'reno' },
]

export const mockSettingsEmpty: SettingsData = {
  fields: [],
  groups: [],
}

export const mockSettingsFull: SettingsData = {
  fields: FULL_FIELDS,
  groups: ['cost', 'ai', 'telegram', 'reno', 'scraper', 'dashboard'],
}

/**
 * Malformed settings — OLD backend shape with `schema` instead of `fields`.
 * This is the contract mismatch that caused the original .find() crash.
 * Tests should assert graceful degradation when this shape is returned.
 */
export const mockSettingsMalformed = {
  schema: FULL_FIELDS,  // OLD field name — should be 'fields'
  values: { max_price_eur: 265000 },
} as unknown as SettingsData
