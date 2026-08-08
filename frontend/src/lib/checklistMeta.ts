/**
 * checklistMeta — shared key → {group, label} registry for the AI-fillable
 * manual-checklist subset.
 *
 * Mirrors backend/ai_evaluator.py::AI_FILLABLE_CHECKLIST_KEYS exactly (13 keys).
 * Keep in sync — if the backend prompt schema adds/removes a key, update here too.
 *
 * Real production shape of entry.ai_checklist_fills is a FLAT map:
 *   { "s14_01": "Kesklinn, 15 min to Bolt HQ", "s16_03": "" , ... }
 * i.e. key → plain string (the AI's filled-in text), NOT key → {state,label,pts}.
 * A key is only present when the AI found an explicit answer in the listing text
 * (backend/ingest_handler.py::_whitelist_checklist_fills drops empty strings) —
 * so "known" = key present with non-empty text, "unknown" = key absent.
 *
 * ChecklistCard.tsx and AskAtViewing.tsx both need this key → group/label mapping
 * to render something meaningful from the flat shape, so it lives here once.
 */

export type ChecklistGroupKey = 'building_fund' | 'risk' | 'finance' | 'quality' | 'location'

export interface ChecklistKeyMeta {
  group: ChecklistGroupKey
  label: string
}

// Every key the AI is allowed to fill (backend/ai_evaluator.py AI_FILLABLE_CHECKLIST_KEYS),
// mapped to the checklist group it belongs to and a human-readable label.
export const CHECKLIST_KEY_META: Record<string, ChecklistKeyMeta> = {
  s09_01: { group: 'risk',     label: 'Plumbing / electrical replacement year' },
  s09_02: { group: 'quality',  label: 'Facade insulation / windows year' },
  s14_01: { group: 'location', label: 'Location convenience' },
  s14_02: { group: 'finance',  label: 'Price per m²' },
  s14_03: { group: 'quality',  label: 'Year, material, energy class' },
  s14_04: { group: 'quality',  label: 'Heating type' },
  s14_05: { group: 'quality',  label: 'Balcony, storage, parking' },
  s14_09: { group: 'location', label: 'Street noise' },
  s14_10: { group: 'quality',  label: 'Sun / orientation' },
  s16_01: { group: 'location', label: 'Distance to public transit' },
  s16_02: { group: 'location', label: 'Nearby shops / pharmacies' },
  s16_03: { group: 'location', label: 'Road / tram noise' },
  s16_04: { group: 'risk',     label: 'Nearby construction plans' },
}

// Ordered list of all fillable keys — used to compute which ones are still
// "unknown" (absent or empty in ai_checklist_fills) for the Ask-at-viewing card.
export const CHECKLIST_ALL_KEYS: string[] = Object.keys(CHECKLIST_KEY_META)

const KNOWN_STATE_VALUES = new Set(['ok', 'flag', 'unknown', 'skip'])

export function isKnownStateShorthand(v: string): boolean {
  return KNOWN_STATE_VALUES.has(v)
}
