/**
 * E2E test fixtures — API mock helpers and seed data.
 *
 * Two patterns:
 *   mockAppData / mockSettings — Playwright route interception. No DB writes.
 *     Preferred for smoke + read-only flows.
 *   seedPendingViaIngest — real backend POST (requires INGEST_TOKEN).
 *     Use only when testing actual mutation flows against the live backend.
 *
 * All data here mirrors the Vitest fixtures (src/test/mocks/fixtures.ts) so the
 * two test layers share the same realistic data shapes.
 */

import type { Page } from '@playwright/test'
import type {
  AppData,
  Entry,
  Feedback,
  FeedbackListResponse,
  FinanceCalculation,
  SettingsData,
  SettingsField,
  UserFinanceSettings,
} from '../../src/types/api'

// ── Entry factory ──────────────────────────────────────────────────────────

export function makeEntry(overrides: Partial<Entry> & { id: string }): Entry {
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
    verdict: 'Good location, reasonable price. Well-maintained building.',
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

// ── Canonical test entries ─────────────────────────────────────────────────

export const pendingEntry1 = makeEntry({
  id: 'e2e-pending-1',
  status: 'pending',
  score: 82,
  title: 'Spacious 2BR in Kesklinn',
  price_eur: 215_000,
  area_sqm: 62,
  district: 'Kesklinn',
})

export const pendingEntry2 = makeEntry({
  id: 'e2e-pending-2',
  status: 'pending',
  score: 71,
  title: 'Cozy studio near Viru Gate',
  price_eur: 145_000,
  area_sqm: 38,
  district: 'Vanalinn',
})

export const pendingEntry3 = makeEntry({
  id: 'e2e-pending-3',
  status: 'pending',
  score: 65,
  title: 'Modern flat with balcony',
  price_eur: 189_000,
  area_sqm: 48,
  district: 'Põhja-Tallinn',
})

export const approvedEntry = makeEntry({
  id: 'e2e-approved-1',
  status: 'approved',
  score: 88,
  title: 'Top pick: sunny corner flat',
  price_eur: 245_000,
  area_sqm: 72,
  district: 'Kadriorg',
  approved_at: '2026-07-30T09:00:00Z',
  shortlisted_at: '2026-07-30T09:00:00Z',
  // Wave 10: real production shape — entry.checklist.groups is never written by
  // the backend. 2 AI-filled keys (-> ok) + 1 user-flagged key (via
  // checklist.user_marks, the only real source of state=flag) for flag-first
  // group ordering + open-by-default coverage.
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
    ],
  },
})

export const viewingScheduledEntry = makeEntry({
  id: 'e2e-viewing-1',
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
  id: 'e2e-viewed-1',
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
  id: 'e2e-dropped-1',
  status: 'dropped',
  score: 62,
  title: 'Dropped: noise problem',
  price_eur: 135_000,
  area_sqm: 42,
  district: 'Kristiine',
  dropped_at: '2026-07-20T09:00:00Z',
  drop_reason: 'Noise from main road',
})

// ── AppData presets ────────────────────────────────────────────────────────

export const emptyAppData: AppData = {
  properties: [],
  pending: [],
  last_check: null,
  next_check: null,
}

export const appDataWithPending: AppData = {
  properties: [],
  pending: [pendingEntry1, pendingEntry2, pendingEntry3],
  last_check: '2026-08-01T10:00:00Z',
  next_check: '2026-08-01T16:00:00Z',
}

export const appDataWithShortlisted: AppData = {
  properties: [approvedEntry, viewingScheduledEntry, viewedEntry, droppedEntry],
  pending: [],
  last_check: '2026-08-01T10:00:00Z',
  next_check: '2026-08-01T16:00:00Z',
}

export const fullAppData: AppData = {
  properties: [approvedEntry, viewingScheduledEntry, viewedEntry, droppedEntry],
  pending: [pendingEntry1, pendingEntry2, pendingEntry3],
  last_check: '2026-08-01T10:00:00Z',
  next_check: '2026-08-01T16:00:00Z',
}

// ── Settings preset ────────────────────────────────────────────────────────

const FULL_FIELDS: SettingsField[] = [
  { key: 'max_price_eur', label: 'Max price', type: 'int', value: 220_000, default: 265_000, min: 50_000, max: 500_000, group: 'cost' },
  { key: 'min_rooms', label: 'Min rooms', type: 'int', value: 2, default: 2, min: 1, max: 6, group: 'cost' },
  { key: 'min_images', label: 'Min images', type: 'int', value: 5, default: 5, min: 0, max: 30, group: 'scraper' },
  { key: 'draft_score_threshold', label: 'Draft threshold', type: 'float', value: 75.0, default: 75.0, min: 0, max: 100, group: 'ai' },
  { key: 'telegram_min_score_photo', label: 'Telegram photo score', type: 'float', value: 60.0, default: 60.0, min: 0, max: 100, group: 'telegram' },
  { key: 'telegram_min_score_text', label: 'Telegram text score', type: 'float', value: 40.0, default: 40.0, min: 0, max: 100, group: 'telegram' },
  { key: 'rank_by_all_in', label: 'Rank by all-in cost', type: 'bool', value: false, default: false, group: 'cost' },
  { key: 'reno_kitchen_full', label: 'Kitchen reno', type: 'int', value: 8_000, default: 8_000, min: 2_000, max: 25_000, group: 'reno' },
  { key: 'reno_bathroom_full', label: 'Bathroom reno', type: 'int', value: 5_000, default: 5_000, min: 1_000, max: 15_000, group: 'reno' },
  { key: 'reno_contingency_pct', label: 'Contingency %', type: 'int', value: 15, default: 15, min: 0, max: 40, group: 'reno' },
]

export const fullSettings: SettingsData = {
  fields: FULL_FIELDS,
  groups: ['cost', 'ai', 'telegram', 'reno', 'scraper', 'dashboard'],
}

// ── Route mock helpers ─────────────────────────────────────────────────────

/**
 * Intercept /api/data and return canned AppData. No DB writes.
 * Call before page.goto().
 */
export async function mockAppData(page: Page, data: AppData): Promise<void> {
  await page.route('**/api/data', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) }),
  )
}

/**
 * Intercept /api/settings and return canned SettingsData. No DB writes.
 */
export async function mockSettings(page: Page, settings: SettingsData): Promise<void> {
  await page.route('**/api/settings', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(settings) }),
  )
}

/**
 * Mock geo endpoints that Overview fetches (isochrone, districts, tallinn-districts.geojson).
 * Prevents network errors when running against a backend that may not have these.
 */
export async function mockGeoEndpoints(page: Page): Promise<void> {
  await page.route('**/api/isochrone', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ type: 'FeatureCollection', features: [] }) }),
  )
  await page.route('**/api/districts', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        districts: [
          { name: 'Kesklinn', avg_price_per_sqm: 4200, count: 12 },
        ],
      }),
    }),
  )
  await page.route('**/tallinn-districts.geojson', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ type: 'FeatureCollection', features: [] }) }),
  )
}

// ── Feedback fixtures ───────────────────────────────────────────────────────

export function makeFeedback(overrides: Partial<Feedback> & { id: string }): Feedback {
  return {
    id: overrides.id,
    type: 'bug',
    comment: `Test feedback ${overrides.id}`,
    url: 'http://127.0.0.1:8000/#shortlist',
    viewport: '375x812',
    user_agent: 'Mozilla/5.0 (test)',
    console_logs: [{ ts: '2026-08-08T10:00:00Z', level: 'error', args: ['boom'] }],
    has_screenshot: false,
    status: 'open',
    created_at: '2026-08-08T10:00:00Z',
    updated_at: '2026-08-08T10:00:00Z',
    ...overrides,
  }
}

export const e2eFeedbackBug = makeFeedback({
  id: 'e2e-fb-1',
  type: 'bug',
  comment: 'Shortlist card overflows on narrow viewports',
  status: 'open',
})

export const emptyFeedbackList: FeedbackListResponse = { feedback: [], count: 0 }
export const fullFeedbackList: FeedbackListResponse = { feedback: [e2eFeedbackBug], count: 1 }

/**
 * Intercept GET /api/feedback (list) with canned data. Call before page.goto().
 * POST /api/feedback is intentionally left un-mocked in most specs so the
 * submit flow exercises the real backend end-to-end (feedback.spec.ts).
 */
export async function mockFeedback(page: Page, data: FeedbackListResponse): Promise<void> {
  await page.route('**/api/feedback', (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) })
  })
}

// ── Finance calculator fixtures (Wave B) ────────────────────────────────────

export const unconfiguredFinanceSettings: UserFinanceSettings = {
  monthly_income_eur: null,
  total_savings_eur: null,
  down_payment_pct: 15,
  loan_term_years: 30,
  current_euribor_pct: 3.5,
  euribor_stress_pct: 0.3,
  rate_scenarios_pct: [1.6, 1.7, 1.8],
  food_eur_monthly: 250,
  basic_eur_monthly: 300,
  hindamisakt_eur: 350,
  notary_eur: 275,
  keys_eur: 500,
  internet_eur_monthly: 20,
  electricity_eur_monthly: 30,
  is_persisted: false,
}

export const configuredFinanceSettings: UserFinanceSettings = {
  ...unconfiguredFinanceSettings,
  monthly_income_eur: 3500,
  total_savings_eur: 40000,
  is_persisted: true,
}

export const greenFinanceCalculation: FinanceCalculation = {
  status: 'complete',
  missing: [],
  one_time: {
    down_payment: { amount: 33000, pct: 15 },
    hindamisakt: 350,
    notary: 275,
    keys: 500,
    first_purchases: 2000,
    total: 36125,
  },
  buffer_after_down: { amount: 3875, verdict: 'good' },
  loan_amount: 187000,
  loan_term_years: 30,
  scenarios: [
    { base_rate_pct: 1.6, euribor_pct: 3.5, total_rate_pct: 5.1, monthly_payment: 1015, is_stress: false },
    { base_rate_pct: 1.6, euribor_pct: 3.8, total_rate_pct: 5.4, monthly_payment: 1051, is_stress: true },
    { base_rate_pct: 1.7, euribor_pct: 3.5, total_rate_pct: 5.2, monthly_payment: 1025, is_stress: false },
    { base_rate_pct: 1.7, euribor_pct: 3.8, total_rate_pct: 5.5, monthly_payment: 1061, is_stress: true },
    { base_rate_pct: 1.8, euribor_pct: 3.5, total_rate_pct: 5.3, monthly_payment: 1035, is_stress: false },
    { base_rate_pct: 1.8, euribor_pct: 3.8, total_rate_pct: 5.6, monthly_payment: 1071, is_stress: true },
  ],
  monthly_worst_case: {
    mortgage_max: 1071,
    utilities: 150,
    remondifond: 60,
    internet: 20,
    electricity: 30,
    food: 250,
    basic: 300,
    total: 1881,
  },
  affordability: {
    monthly_income: 3500,
    monthly_total: 1881,
    monthly_free: 1619,
    verdict: 'green',
    message_ru: 'Проходит с буфером 1619 €/мес',
  },
}

export const incompleteFinanceCalculation: FinanceCalculation = {
  status: 'incomplete',
  missing: ['income', 'savings'],
  one_time: null,
  buffer_after_down: null,
  loan_amount: null,
  loan_term_years: 30,
  scenarios: [],
  monthly_worst_case: null,
  affordability: null,
}

export const missingInputsFinanceCalculation: FinanceCalculation = {
  ...greenFinanceCalculation,
  status: 'incomplete',
  missing: ['utilities', 'remondifond'],
  monthly_worst_case: {
    ...greenFinanceCalculation.monthly_worst_case!,
    utilities: null,
    remondifond: null,
  },
}

/** Intercept GET/PUT /api/user-finance-settings with canned data. */
export async function mockUserFinanceSettings(page: Page, settings: UserFinanceSettings): Promise<void> {
  let current = { ...settings }
  await page.route('**/api/user-finance-settings', async (route, request) => {
    if (request.method() === 'PUT') {
      const body = JSON.parse(request.postData() ?? '{}') as Partial<UserFinanceSettings>
      current = { ...current, ...body, is_persisted: true }
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(current) })
    }
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(current) })
  })
}

/** Intercept GET /api/entry/:id/finance-calculation with canned data for every listing. */
export async function mockFinanceCalculation(page: Page, calc: FinanceCalculation): Promise<void> {
  await page.route('**/api/entry/*/finance-calculation', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(calc) }),
  )
}

/** Intercept PATCH /api/entry/:id/finance-inputs — echoes the patch back. */
export async function mockFinanceInputsPatch(page: Page): Promise<void> {
  await page.route('**/api/entry/*/finance-inputs', async (route, request) => {
    if (request.method() !== 'PATCH') return route.continue()
    const body = JSON.parse(request.postData() ?? '{}') as Record<string, number | null>
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        utilities_eur_monthly: null,
        remondifond_eur_monthly: null,
        first_purchases_eur: null,
        override_ask_eur: null,
        ...body,
      }),
    })
  })
}

/**
 * Seed pending entries via real backend POST /api/ingest.
 * Requires INGEST_TOKEN env var. Use only for mutation flow tests.
 */
export async function seedPendingViaIngest(entries: Partial<Entry>[]): Promise<void> {
  const token = process.env.INGEST_TOKEN
  if (!token) throw new Error('INGEST_TOKEN env var required for seedPendingViaIngest')
  const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:8000'
  const res = await fetch(`${baseURL}/api/ingest`, {
    method: 'POST',
    body: JSON.stringify(entries),
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  })
  if (!res.ok) throw new Error(`/api/ingest failed: ${res.status}`)
}
