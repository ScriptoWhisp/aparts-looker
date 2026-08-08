/**
 * Test fixtures — realistic API response shapes.
 *
 * Covers: empty / partial / full / malformed (old contract) shapes.
 * Used by MSW handlers as defaults and directly in unit tests.
 */

import type {
  AppData,
  ChecklistRegistryResponse,
  Entry,
  Feedback,
  FinanceCalculation,
  SettingsData,
  SettingsField,
  UserFinanceSettings,
} from '../../types/api'

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

// ── Checklist registry (Wave A) ─────────────────────────────────────────────
// A compact but representative slice of backend/checklist_registry.py's real
// ~96-item registry — 13 items across the same 4 sections/shapes (onsite
// subgrouped, others flat), covering every legacy key the entry fixtures
// above use (s14_01/02/04/09/10, s09_01, s16_01) so the frontend legacy-key
// fallback (lib/checklistMeta.ts) is exercised by real fixture data.

export const mockChecklistRegistry: ChecklistRegistryResponse = {
  sections: [
    {
      id: 'evaluation',
      label_ru: 'Оценка по критериям',
      subgrouped: false,
      groups: [
        {
          id: 'location',
          label_ru: 'Расположение',
          items: [
            { key: 'sec2_address', section: 'evaluation', group: 'location', label_ru: 'Адрес — удобство расположения', label_et: null, ai_fillable: true, hint: null, order: 0 },
            { key: 'sec2_noise', section: 'evaluation', group: 'location', label_ru: 'Шум с улицы', label_et: null, ai_fillable: true, hint: null, order: 1 },
          ],
        },
        {
          id: 'price',
          label_ru: 'Цена',
          items: [
            { key: 'sec2_price', section: 'evaluation', group: 'price', label_ru: 'Цена и цена за м²', label_et: null, ai_fillable: true, hint: null, order: 2 },
          ],
        },
        {
          id: 'systems',
          label_ru: 'Отопление и системы',
          items: [
            { key: 'sec2_heating', section: 'evaluation', group: 'systems', label_ru: 'Тип отопления', label_et: null, ai_fillable: true, hint: null, order: 3 },
          ],
        },
      ],
    },
    {
      id: 'ask_seller',
      label_ru: 'Вопросы продавцу',
      subgrouped: false,
      groups: [
        {
          id: 'motivation',
          label_ru: 'Мотивация продажи',
          items: [
            { key: 'sec3_reason_for_sale', section: 'ask_seller', group: 'motivation', label_ru: 'Почему продают квартиру?', label_et: null, ai_fillable: false, hint: null, order: 4 },
          ],
        },
        {
          id: 'condition',
          label_ru: 'Состояние',
          items: [
            { key: 'sec3_renovation_history', section: 'ask_seller', group: 'condition', label_ru: 'Что ремонтировалось и когда?', label_et: null, ai_fillable: true, hint: null, order: 5 },
          ],
        },
      ],
    },
    {
      id: 'request_docs',
      label_ru: 'Документы к запросу',
      subgrouped: false,
      groups: [
        {
          id: 'docs_request',
          label_ru: 'Документы для запроса у продавца',
          items: [
            { key: 'sec4_extract_kinnistusraamat', section: 'request_docs', group: 'docs_request', label_ru: 'Свежий kinnistusraamatu väljavõte', label_et: null, ai_fillable: false, hint: null, order: 6 },
          ],
        },
        {
          id: 'kinnistusraamat',
          label_ru: 'Проверить в e-kinnistusraamat',
          items: [
            { key: 'sec4_kr_owner', section: 'request_docs', group: 'kinnistusraamat', label_ru: 'Кто является собственником', label_et: null, ai_fillable: false, hint: null, order: 7 },
          ],
        },
      ],
    },
    {
      id: 'onsite',
      label_ru: 'На месте',
      subgrouped: true,
      groups: [
        {
          id: 'first_impression',
          label_ru: 'Первое впечатление и запахи',
          items: [
            { key: 'sec5_1_damp_smell', section: 'onsite', group: 'first_impression', label_ru: 'Нет ли запаха сырости', label_et: null, ai_fillable: false, hint: null, order: 8 },
          ],
        },
        {
          id: 'structure',
          label_ru: 'Стены / потолок / углы / окна',
          items: [
            { key: 'sec5_2_corners', section: 'onsite', group: 'structure', label_ru: 'Углы у внешних стен', label_et: null, ai_fillable: false, hint: null, order: 9 },
            { key: 'sec5_2_windows_open', section: 'onsite', group: 'structure', label_ru: 'Открываются ли окна', label_et: null, ai_fillable: false, hint: null, order: 10 },
          ],
        },
        {
          id: 'neighborhood',
          label_ru: 'Район / окрестности',
          items: [
            { key: 'sec5_5_transit', section: 'onsite', group: 'neighborhood', label_ru: 'Сколько идти до остановки', label_et: null, ai_fillable: true, hint: null, order: 11 },
            { key: 'sec5_5_sun', section: 'onsite', group: 'neighborhood', label_ru: 'Как светит солнце', label_et: null, ai_fillable: true, hint: null, order: 12 },
          ],
        },
      ],
    },
  ],
  legacy_key_map: {
    s09_01: 'sec3_renovation_history',
    s09_02: 'sec2_building',
    s14_01: 'sec2_address',
    s14_02: 'sec2_price',
    s14_03: 'sec2_building',
    s14_04: 'sec2_heating',
    s14_05: 'sec2_additions',
    s14_09: 'sec2_noise',
    s14_10: 'sec5_5_sun',
    s16_01: 'sec5_5_transit',
    s16_02: 'sec5_5_amenities',
    s16_03: 'sec5_5_traffic_noise',
    s16_04: 'sec5_5_construction',
  },
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
    has_screenshot: true,
    status: 'open',
    created_at: '2026-08-08T10:00:00Z',
    updated_at: '2026-08-08T10:00:00Z',
    ...overrides,
  }
}

export const feedbackBug1 = makeFeedback({
  id: 'fb-1',
  type: 'bug',
  comment: 'Shortlist card overflows on mobile',
  status: 'open',
})

export const feedbackFeature1 = makeFeedback({
  id: 'fb-2',
  type: 'feature',
  comment: 'Would like a dark/light toggle',
  status: 'in_progress',
  has_screenshot: false,
})

export const feedbackFixed1 = makeFeedback({
  id: 'fb-3',
  type: 'ux',
  comment: 'Settings sliders are hard to tap on mobile',
  status: 'fixed',
})

export const mockFeedbackList: Feedback[] = [feedbackBug1, feedbackFeature1, feedbackFixed1]

// ── Finance calculator fixtures (Wave B) ────────────────────────────────────

export const mockUserFinanceSettingsUnconfigured: UserFinanceSettings = {
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

export const mockUserFinanceSettingsConfigured: UserFinanceSettings = {
  ...mockUserFinanceSettingsUnconfigured,
  monthly_income_eur: 3500,
  total_savings_eur: 40000,
  is_persisted: true,
}

export const mockFinanceCalculationGreen: FinanceCalculation = {
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

export const mockFinanceCalculationIncompleteSettings: FinanceCalculation = {
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

export const mockFinanceCalculationMissingInputs: FinanceCalculation = {
  ...mockFinanceCalculationGreen,
  status: 'incomplete',
  missing: ['utilities', 'remondifond'],
  monthly_worst_case: {
    ...mockFinanceCalculationGreen.monthly_worst_case!,
    utilities: null,
    remondifond: null,
  },
}
