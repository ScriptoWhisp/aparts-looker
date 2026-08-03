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

// ── Checklist data ────────────────────────────────────────────────────────
export interface ChecklistData {
  renovation_items?: RenovationItem[]
  [key: string]: unknown
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
  cost_of_ownership: CostOfOwnership | null
  own_score: number | null
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
