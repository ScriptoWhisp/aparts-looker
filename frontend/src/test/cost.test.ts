/**
 * cost.test.ts — pure logic tests for computeAllIn, settingNum, rankByAllIn.
 *
 * These are the fastest tests in the suite — no DOM, no async, no MSW.
 * Primary regression guard for the .find-on-undefined bug class.
 */

import { describe, it, expect } from 'vitest'
import { computeAllIn, rankByAllIn } from '@/lib/cost'
import type { Entry, SettingsData } from '@/types/api'
import {
  mockSettingsFull,
  mockSettingsEmpty,
  mockSettingsMalformed,
  approvedEntry,
  pendingEntry1,
  pendingEntry2,
} from './mocks/fixtures'

// ── Helpers ────────────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: 'test',
    url: 'https://kv.ee/test',
    status: 'approved',
    score: 75,
    title: 'Test',
    price_eur: 200_000,
    area_sqm: 55,
    rooms: 2,
    floor: 3,
    floors_total: 5,
    year_built: 2005,
    district: null,
    address: null,
    image_url: null,
    verdict: null,
    rejection_reason: null,
    scheduled_at: null,
    shortlisted_at: null,
    approved_at: null,
    created_at: null,
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
    lat: null,
    lng: null,
    price_per_sqm: null,
    commute_minutes: null,
    ...overrides,
  }
}

// ── computeAllIn ───────────────────────────────────────────────────────────

describe('computeAllIn', () => {
  it('returns work=0 and noItems=true when no renovation_items', () => {
    const entry = makeEntry({ checklist: null })
    const result = computeAllIn(entry, mockSettingsFull)
    expect(result.work).toBe(0)
    expect(result.noItems).toBe(true)
    expect(result.allIn).toBe(200_000) // allIn = price_eur when noItems
  })

  it('returns work=0 when renovation_items is empty array', () => {
    const entry = makeEntry({ checklist: { renovation_items: [] } })
    const result = computeAllIn(entry, mockSettingsFull)
    expect(result.work).toBe(0)
    expect(result.noItems).toBe(true)
  })

  it('excludes items with applies=false — work=0, noItems=false (items exist but all skipped)', () => {
    const entry = makeEntry({
      checklist: {
        renovation_items: [
          { key: 'kitchen_full', applies: false, confidence: 2, qty: null, note: null },
        ],
      },
    })
    const result = computeAllIn(entry, mockSettingsFull)
    // items exist (length>0) so noItems=false; but all are skipped so work=0
    expect(result.work).toBe(0)
    expect(result.noItems).toBe(false)
  })

  it('applies contingency to subtotal', () => {
    // kitchen_full @ 8000, contingency 15% → 8000 * 1.15 = 9200
    const entry = makeEntry({
      checklist: {
        renovation_items: [
          { key: 'kitchen_full', applies: true, confidence: 2, qty: null, note: null },
        ],
      },
    })
    const result = computeAllIn(entry, mockSettingsFull)
    expect(result.work).toBe(9200)
    expect(result.allIn).toBe(200_000 + 9200)
  })

  it('widens band to 40% when any item has confidence=1 (low)', () => {
    const entry = makeEntry({
      checklist: {
        renovation_items: [
          { key: 'kitchen_full', applies: true, confidence: 1, qty: null, note: null },
        ],
      },
    })
    const result = computeAllIn(entry, mockSettingsFull)
    expect(result.hasLowConfidence).toBe(true)
    expect(result.band).toBe(Math.round(result.work * 0.4))
  })

  it('uses 25% band when no low-confidence items', () => {
    const entry = makeEntry({
      checklist: {
        renovation_items: [
          { key: 'kitchen_full', applies: true, confidence: 3, qty: null, note: null },
        ],
      },
    })
    const result = computeAllIn(entry, mockSettingsFull)
    expect(result.hasLowConfidence).toBe(false)
    expect(result.band).toBe(Math.round(result.work * 0.25))
  })

  it('respects renovation_override_work_eur and returns band=0', () => {
    const entry = makeEntry({
      cost_of_ownership: { renovation_override_work_eur: 12000 } as Record<string, unknown>,
    })
    const result = computeAllIn(entry, mockSettingsFull)
    expect(result.work).toBe(12000)
    expect(result.allIn).toBe(200_000 + 12000)
    expect(result.band).toBe(0)
    expect(result.noItems).toBe(false)
  })

  it('scales per-sqm items by area_sqm when qty is null', () => {
    // cosmetic is a PER_SQM key → rate 15 * 55sqm = 825, +15% = ~949
    const entry = makeEntry({
      area_sqm: 55,
      checklist: {
        renovation_items: [
          { key: 'cosmetic', applies: true, confidence: 3, qty: null, note: null },
        ],
      },
    })
    const result = computeAllIn(entry, mockSettingsFull)
    expect(result.work).toBe(Math.round(15 * 55 * 1.15))
  })

  it('uses explicit qty instead of area when qty is set', () => {
    // windows @ 600 * qty=3 = 1800, +15% = 2070
    const entry = makeEntry({
      checklist: {
        renovation_items: [
          { key: 'windows', applies: true, confidence: 2, qty: 3, note: null },
        ],
      },
    })
    const result = computeAllIn(entry, mockSettingsFull)
    expect(result.work).toBe(Math.round(600 * 3 * 1.15))
  })
})

// ── settingNum (tested indirectly — coverage via computeAllIn with various settings) ──

describe('settingNum — regression guards for undefined settings', () => {
  it('returns fallback when settings is undefined', () => {
    const entry = makeEntry({
      checklist: {
        renovation_items: [
          { key: 'kitchen_full', applies: true, confidence: 2, qty: null, note: null },
        ],
      },
    })
    // Should NOT throw, uses fallback rates
    expect(() => computeAllIn(entry, undefined)).not.toThrow()
    const result = computeAllIn(entry, undefined)
    // With undefined settings, kitchen_full fallback=8000, contingency fallback=15%
    expect(result.work).toBe(Math.round(8000 * 1.15))
  })

  it('returns fallback when settings.fields is undefined — the exact .find() bug', () => {
    // mockSettingsMalformed has `schema` instead of `fields`
    expect(() => computeAllIn(approvedEntry, mockSettingsMalformed)).not.toThrow()
  })

  it('returns fallback when settings.fields is empty', () => {
    const entry = makeEntry({
      checklist: {
        renovation_items: [
          { key: 'kitchen_full', applies: true, confidence: 2, qty: null, note: null },
        ],
      },
    })
    expect(() => computeAllIn(entry, mockSettingsEmpty)).not.toThrow()
    const result = computeAllIn(entry, mockSettingsEmpty)
    // Empty fields → fallback 8000 * 1.15
    expect(result.work).toBe(Math.round(8000 * 1.15))
  })
})

// ── rankByAllIn ────────────────────────────────────────────────────────────

describe('rankByAllIn', () => {
  const entries = [pendingEntry1, pendingEntry2, approvedEntry]

  it('sorts by score descending when rank_by_all_in is false', () => {
    const settingsRankFalse: SettingsData = {
      ...mockSettingsFull,
      fields: mockSettingsFull.fields.map((f) =>
        f.key === 'rank_by_all_in' ? { ...f, value: false } : f,
      ),
    }
    const result = rankByAllIn(entries, settingsRankFalse)
    for (let i = 0; i < result.length - 1; i++) {
      expect((result[i].score ?? 0)).toBeGreaterThanOrEqual(result[i + 1].score ?? 0)
    }
  })

  it('sorts by score descending when settings is undefined', () => {
    expect(() => rankByAllIn(entries, undefined)).not.toThrow()
    const result = rankByAllIn(entries, undefined)
    for (let i = 0; i < result.length - 1; i++) {
      expect((result[i].score ?? 0)).toBeGreaterThanOrEqual(result[i + 1].score ?? 0)
    }
  })

  it('sorts by score descending when settings.fields is undefined (malformed)', () => {
    expect(() => rankByAllIn(entries, mockSettingsMalformed)).not.toThrow()
    const result = rankByAllIn(entries, mockSettingsMalformed)
    for (let i = 0; i < result.length - 1; i++) {
      expect((result[i].score ?? 0)).toBeGreaterThanOrEqual(result[i + 1].score ?? 0)
    }
  })

  it('sorts by all-in cost ascending when rank_by_all_in is true', () => {
    const settingsRankTrue: SettingsData = {
      ...mockSettingsFull,
      fields: mockSettingsFull.fields.map((f) =>
        f.key === 'rank_by_all_in' ? { ...f, value: true } : f,
      ),
    }
    // approvedEntry has renovation_items, so its allIn > price; others have noItems so allIn=price
    // pendingEntry2 price=145k < pendingEntry1 price=215k < approvedEntry all-in
    const result = rankByAllIn(entries, settingsRankTrue)
    for (let i = 0; i < result.length - 1; i++) {
      const aAllIn = computeAllIn(result[i], settingsRankTrue).allIn
      const bAllIn = computeAllIn(result[i + 1], settingsRankTrue).allIn
      expect(aAllIn).toBeLessThanOrEqual(bAllIn)
    }
  })

  it('does not mutate the input array', () => {
    const original = [...entries]
    rankByAllIn(entries, mockSettingsFull)
    expect(entries).toEqual(original)
  })
})
