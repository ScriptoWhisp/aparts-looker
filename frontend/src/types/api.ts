/**
 * TypeScript types mirroring the /api/* response shapes from the FastAPI backend.
 *
 * Keep these in sync with backend/models.py and the actual /api/data + /api/settings
 * response shapes. Strict-mode on, so all optional fields are marked explicitly.
 */

// ── Listing status enum ────────────────────────────────────────────────────
export type ListingStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'viewing_scheduled'
  | 'viewed'
  | 'thinking'
  | 'offer_drafted'
  | 'dropped'
  | 'withdrawn'

// ── Renovation item (from AI evaluator) ───────────────────────────────────
export interface RenovationItem {
  key: string
  applies: boolean | null  // true=applies, false=no, null=unknown
  confidence: 1 | 2 | 3
  qty: number | null
  note: string | null
}

// ── Viewing history event ──────────────────────────────────────────────────
export interface ViewingEvent {
  action: string
  at?: string
  decision?: string
  new_status?: string
  drop_reason?: string
  own_score?: number
  withdrawn_at?: string
}

// ── Cost of ownership ─────────────────────────────────────────────────────
export interface CostOfOwnership {
  monthly_eur?: number
  mortgage_eur?: number
  hoa_eur?: number
  management_eur?: number
  insurance_eur?: number
  renovation?: {
    work_eur: number
    all_in_eur: number
    band_eur: number
    override?: boolean
    override_work_eur?: number
  }
}

// ── Checklist item state ──────────────────────────────────────────────────
export type ChecklistItemState = 'ok' | 'flag' | 'unknown' | 'skip'

export interface ChecklistItem {
  key: string
  label: string
  state: ChecklistItemState
  pts?: number        // negative pts if flag
  note?: string | null
}

export interface ChecklistGroup {
  key: string
  label: string
  label_et: string   // Estonian sub-label
  items: ChecklistItem[]
}

// ── Checklist user mark (Wave 10 — interactive checklist) ─────────────────
export interface ChecklistUserMark {
  state?: 'ok' | 'flag' | 'unknown' | 'skip' | null
  note?: string | null
  marked_at?: string
}

// ── Checklist data ────────────────────────────────────────────────────────
export interface ChecklistData {
  renovation_items?: RenovationItem[]
  groups?: ChecklistGroup[]
  user_marks?: Record<string, ChecklistUserMark>
  [key: string]: unknown
}

// ── Checklist registry (Wave A — GET /api/checklist-registry) ─────────────
export interface ChecklistRegistryItem {
  key: string
  section: string
  group: string
  label_ru: string
  label_et: string | null
  ai_fillable: boolean
  hint: string | null
  order: number
}

export interface ChecklistRegistryGroup {
  id: string
  label_ru: string
  items: ChecklistRegistryItem[]
}

export interface ChecklistRegistrySection {
  id: string
  label_ru: string
  subgrouped: boolean
  groups: ChecklistRegistryGroup[]
}

export interface ChecklistRegistryResponse {
  sections: ChecklistRegistrySection[]
  legacy_key_map: Record<string, string>
}

// ── Negotiation brief ─────────────────────────────────────────────────────
export interface NegotiationBrief {
  // Backend fields — see backend/brief_generator.py:generate_negotiation_brief.
  // Backend uses suggested_offer_{low,high}_eur (aliased below for existing code).
  suggested_offer_low_eur?: number
  suggested_offer_high_eur?: number
  brief_ru?: string
  brief?: string
  // Optional post-hoc validation flag (see brief_generator._validate_no_hallucinated_numbers)
  needs_review?: boolean
  error?: string
  // Legacy aliases some UI code still reads — kept as optional to unblock any
  // consumer still on the old names; new code should use suggested_offer_*.
  offer_low?: number
  offer_high?: number
  target?: number
  ask?: number
}

// ── Core listing entry (from /api/data response) ──────────────────────────
export interface Entry {
  id: string
  url: string
  status: ListingStatus
  score: number | null
  title: string
  price_eur: number | null
  area_sqm: number | null
  rooms: number | null
  floor: number | null
  floors_total: number | null
  year_built: number | null
  district: string | null
  address: string | null
  image_url: string | null
  // Wave C: raw kv.ee description + AI-produced Russian translation/bullets
  // (piggybacked onto the same evaluate_listing() call). Null until the AI
  // pipeline (re)generates them.
  description: string | null
  description_ru: string | null
  description_bullets: string[] | null
  verdict: string | null
  rejection_reason: string | null
  scheduled_at: string | null
  shortlisted_at: string | null
  approved_at: string | null
  created_at: string | null
  viewing_history: ViewingEvent[]
  cost_of_ownership: (CostOfOwnership & Record<string, unknown>) | null
  own_score: number | null
  checklist: ChecklistData | null
  ai_checklist_fills: Record<string, unknown> | null
  negotiation_brief: NegotiationBrief | null
  negotiation_brief_generated_at: string | null
  energy_class: string | null
  material: string | null
  dropped_at: string | null
  drop_reason: string | null
  lat: number | null
  lng: number | null
  price_per_sqm: number | null
  commute_minutes: number | null
}

// ── /api/data response ────────────────────────────────────────────────────
export interface AppData {
  properties: Entry[]   // shortlisted + viewed entries
  pending: Entry[]      // inbox entries
  last_check: string | null
  next_check: string | null
  settings?: SettingsData
}

// ── Settings field schema ─────────────────────────────────────────────────
export interface SettingsField {
  key: string
  label: string
  type: 'int' | 'float' | 'str' | 'bool'
  value: number | string | boolean
  default: number | string | boolean
  min?: number
  max?: number
  group: string
}

// ── /api/settings response ────────────────────────────────────────────────
export interface SettingsData {
  fields: SettingsField[]
  groups: string[]
}

// ── Finance calculator (Wave B) ────────────────────────────────────────────

export interface UserFinanceSettings {
  monthly_income_eur: number | null
  total_savings_eur: number | null
  down_payment_pct: number
  loan_term_years: number
  current_euribor_pct: number
  euribor_stress_pct: number
  rate_scenarios_pct: [number, number, number]
  food_eur_monthly: number
  basic_eur_monthly: number
  hindamisakt_eur: number
  notary_eur: number
  keys_eur: number
  internet_eur_monthly: number
  electricity_eur_monthly: number
  is_persisted: boolean
}

export interface FinanceInputs {
  utilities_eur_monthly: number | null
  remondifond_eur_monthly: number | null
  first_purchases_eur: number | null
  override_ask_eur: number | null
}

export interface FinanceScenario {
  base_rate_pct: number
  euribor_pct: number
  total_rate_pct: number
  monthly_payment: number
  is_stress: boolean
}

export interface FinanceOneTime {
  down_payment: { amount: number; pct: number }
  hindamisakt: number
  notary: number
  keys: number
  first_purchases: number | null
  total: number
}

export interface FinanceBufferAfterDown {
  amount: number
  verdict: 'good' | 'tight' | 'insufficient'
}

export interface FinanceMonthlyWorstCase {
  mortgage_max: number
  utilities: number | null
  remondifond: number | null
  internet: number
  electricity: number
  food: number
  basic: number
  total: number
}

export interface FinanceAffordability {
  monthly_income: number
  monthly_total: number
  monthly_free: number
  verdict: 'green' | 'yellow' | 'red'
  message_ru: string
}

export interface FinanceCalculation {
  status: 'complete' | 'incomplete'
  missing: string[]
  one_time: FinanceOneTime | null
  buffer_after_down: FinanceBufferAfterDown | null
  loan_amount: number | null
  loan_term_years: number | null
  scenarios: FinanceScenario[]
  monthly_worst_case: FinanceMonthlyWorstCase | null
  affordability: FinanceAffordability | null
}

// ── Feedback / bug reports ─────────────────────────────────────────────────

export type FeedbackType = 'bug' | 'feature' | 'ux' | 'perf'
export type FeedbackStatus = 'open' | 'in_progress' | 'fixed' | 'wontfix'

export interface ConsoleLogEntry {
  ts: string
  level: string
  args: string[]
}

// ── /api/feedback list item + detail response ──────────────────────────────
// The list endpoint truncates `comment` to 200 chars server-side; GET /{id}
// returns the full comment. Same shape either way — callers should not rely
// on `comment` length from the list endpoint for anything but a preview.
export interface Feedback {
  id: string
  type: FeedbackType
  comment: string
  url: string
  viewport: string | null
  user_agent: string | null
  console_logs: ConsoleLogEntry[]
  has_screenshot: boolean
  status: FeedbackStatus
  created_at: string | null
  updated_at: string | null
}

export interface FeedbackListResponse {
  feedback: Feedback[]
  count: number
}

export interface FeedbackCreateResponse {
  id: string
  created_at: string | null
}
