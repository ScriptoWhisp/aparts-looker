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
