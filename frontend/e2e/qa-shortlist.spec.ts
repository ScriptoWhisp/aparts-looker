/**
 * qa-shortlist.spec.ts — Proactive QA sweep additions for the Shortlist tab.
 *
 * Focus: the checklist accordion regression Daniel reported ("checklist
 * сломался"), plus the flows around it (Ask at viewing, Negotiation gating,
 * hero action transitions, mobile Back round-trip) that weren't covered by
 * the pre-sweep shortlist.spec.ts / compare.spec.ts.
 *
 * See docs/qa/user-flows.md for the full flow list this file implements.
 */

import { test, expect, type Page } from '@playwright/test'
import {
  mockAppData,
  mockSettings,
  mockGeoEndpoints,
  fullSettings,
  makeEntry,
  approvedEntry,
  viewingScheduledEntry,
  viewedEntry,
  droppedEntry,
} from './fixtures/seed'
import type { AppData, Entry } from '../src/types/api'

function attachConsoleWatcher(page: Page): () => string[] {
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(err.message))
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  return () => errors
}

function assertNoErrorBoundary(page: Page) {
  return expect(page.locator('[data-testid="error-boundary"]')).toHaveCount(0)
}

async function goSelectEntry(page: Page, entry: Entry) {
  const single: AppData = { properties: [entry], pending: [], last_check: null, next_check: null }
  await mockAppData(page, single)
  await mockSettings(page, fullSettings)
  await mockGeoEndpoints(page)
  await page.goto('/#shortlist')
  // Desktop: sidebar row must be clicked. Mobile: sidebar is the only pane initially too.
  await page.locator('button').filter({ hasText: entry.title }).first().click()
}

// ── Checklist — Wave A full-registry rewrite (4 sections, ~96 items) ───────
//
// The registry itself is served by the real backend at GET /api/checklist-registry
// (backend/checklist_registry.py) — these tests run against the live docker
// stack (playwright.config.ts baseURL), so they exercise the actual ~96-item
// registry rather than a mock slice.

const TOTAL_CHECKLIST_ITEMS = 96 // keep in sync with backend/checklist_registry.py

test.describe('checklist — full registry + data shape resilience', () => {
  test(`checklist=null, ai_checklist_fills=null → all ${TOTAL_CHECKLIST_ITEMS} items render as unknown, no crash`, async ({ page }) => {
    const getErrors = attachConsoleWatcher(page)
    const entry = makeEntry({
      id: 'qa-checklist-null',
      status: 'viewed',
      title: 'Checklist null entry',
      checklist: null,
      ai_checklist_fills: null,
    })
    await goSelectEntry(page, entry)

    await expect(page.locator(`text=${TOTAL_CHECKLIST_ITEMS} items · 0 marked`)).toBeVisible({ timeout: 5_000 })
    await assertNoErrorBoundary(page)
    expect(getErrors().filter((e) => !e.includes('leaflet'))).toHaveLength(0)
  })

  test(`checklist={} (empty object, no .user_marks) → all ${TOTAL_CHECKLIST_ITEMS} items render, no crash`, async ({ page }) => {
    const entry = makeEntry({
      id: 'qa-checklist-empty-obj',
      status: 'viewed',
      title: 'Checklist empty object entry',
      checklist: {},
      ai_checklist_fills: null,
    })
    await goSelectEntry(page, entry)

    await expect(page.locator(`text=${TOTAL_CHECKLIST_ITEMS} items · 0 marked`)).toBeVisible({ timeout: 5_000 })
    await assertNoErrorBoundary(page)
  })

  test('real production shape — flat ai_checklist_fills strings render correctly, all items visible once expanded', async ({ page }) => {
    // Mirrors the ACTUAL shape backend/ai_evaluator.py produces and
    // backend/ingest_handler.py stores: key -> filled-in Russian text, using
    // pre-Wave-A legacy keys (s14_01/s14_02/s16_03) to also exercise the
    // frontend legacy-key fallback (lib/checklistMeta.ts) against the real
    // backend's legacy_key_map.
    const entry = makeEntry({
      id: 'qa-checklist-real-fills',
      status: 'viewed',
      title: 'Checklist real fills entry',
      checklist: null,
      ai_checklist_fills: {
        s14_01: 'Kesklinn, 15 минут до Bolt HQ',
        s14_02: '215 000 € · 3 468 €/м²',
        s16_03: '', // empty — must resolve to unknown, not a blank "ok" item
      },
    })
    await goSelectEntry(page, entry)

    await test.step('header summary counts the filled items as marked (2), the rest unmarked', async () => {
      await expect(page.locator(`text=2/${TOTAL_CHECKLIST_ITEMS} marked`)).toBeVisible({ timeout: 5_000 })
    })

    const evaluationHeader = page.getByTestId('checklist-section-header-evaluation')
    const onsiteHeader = page.getByTestId('checklist-section-header-onsite')

    await test.step('sections render keyed by the shared registry (Оценка по критериям, На месте)', async () => {
      await expect(evaluationHeader).toBeVisible()
      await expect(onsiteHeader).toBeVisible()
    })

    await test.step('a section without a flag/mark starts collapsed by design — expand to see item content', async () => {
      // s14_01/s14_02 both resolve to state=ok (no flag), so evaluation starts
      // collapsed. Expand it to verify every item renders — not just the two
      // the AI filled in.
      await evaluationHeader.click()
      await expect(page.locator('text=Адрес — насколько удобное расположение (универ, работа, друзья, центр)')).toBeVisible({ timeout: 3_000 })
      await expect(page.locator('text=Тип отопления (центральное / газ / электричество / индивидуальное)')).toBeVisible()
    })

    await test.step('label is human-readable, not the raw key code', async () => {
      await expect(page.locator('text=s14_01')).toHaveCount(0)
    })

    await test.step('filled text is shown as AI context under the label, not discarded', async () => {
      await expect(page.locator('text=Kesklinn, 15 минут до Bolt HQ')).toBeVisible()
    })

    await test.step('empty-string legacy fill (s16_03 -> onsite/neighborhood) renders unknown, not a blank "ok"', async () => {
      await onsiteHeader.click()
      await page.getByTestId('checklist-group-header-neighborhood').click()
      const chip = page.getByTestId('checklist-chip-sec5_5_traffic_noise')
      await expect(chip).toBeVisible({ timeout: 3_000 })
      await expect(chip).toHaveAttribute('data-state', 'unknown')
    })

    await test.step('screenshot', async () => {
      await page.screenshot({
        path: 'e2e/fixtures/screenshots/qa-checklist-real-fills.png',
        fullPage: false,
      })
    })
  })

  test('user_marks shape — flagged section open-by-default + sub-group expand', async ({ page }) => {
    await goSelectEntry(page, approvedEntry)
    // approvedEntry: s14_01/s14_02 AI-filled (-> ok), s09_01 (legacy ->
    // ask_seller/sec3_renovation_history) user-flagged.

    await test.step('flagged section (Вопросы продавцу) is open by default (item text visible without clicking)', async () => {
      await expect(page.locator('text=Что ремонтировалось и когда? Когда последний раз меняли сантех/электрику?')).toBeVisible({ timeout: 5_000 })
    })

    await test.step('bottom meta shows total item count', async () => {
      await expect(page.locator(`text=${TOTAL_CHECKLIST_ITEMS} items`)).toBeVisible()
    })

    await test.step('chevron click expands a collapsed (no flag/mark) section, then an onsite sub-group', async () => {
      const onsiteHeader = page.getByTestId('checklist-section-header-onsite')
      await expect(page.locator('text=Углы у внешних стен')).not.toBeVisible()
      await onsiteHeader.click()
      const structureGroup = page.getByTestId('checklist-group-header-structure')
      await structureGroup.click()
      await expect(page.locator('text=Углы у внешних стен')).toBeVisible({ timeout: 3_000 })
    })
  })
})

// ── Checklist — interactive state chip + note persistence + filters ────────

test('state chip click cycles + fires PATCH /api/entry/:id/checklist-item', async ({ page }) => {
  let patchCount = 0
  let lastBody = ''
  await page.route('**/api/entry/*/checklist-item', async (route, request) => {
    patchCount += 1
    lastBody = request.postData() ?? ''
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, user_marks: {} }),
    })
  })

  const entry = makeEntry({
    id: 'qa-checklist-chip-click',
    status: 'viewed',
    title: 'Checklist chip click entry',
    checklist: null,
    ai_checklist_fills: null,
  })
  await goSelectEntry(page, entry)

  // sec3_reason_for_sale (ask_seller section) has no flag/mark on this bare
  // entry — expand its section first.
  await page.getByTestId('checklist-section-header-ask_seller').click()
  const chip = page.getByTestId('checklist-chip-sec3_reason_for_sale')
  await expect(chip).toHaveAttribute('data-state', 'unknown')

  await chip.click()
  await expect(chip).toHaveAttribute('data-state', 'ok', { timeout: 3_000 })
  await page.waitForFunction(() => true)
  expect(patchCount).toBeGreaterThanOrEqual(1)
  expect(lastBody).toContain('"key":"sec3_reason_for_sale"')
  expect(lastBody).toContain('"state":"ok"')

  await chip.click()
  await expect(chip).toHaveAttribute('data-state', 'flag', { timeout: 3_000 })
})

test('note textarea debounces and PATCHes with the note text', async ({ page }) => {
  let lastBody = ''
  await page.route('**/api/entry/*/checklist-item', async (route, request) => {
    lastBody = request.postData() ?? ''
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, user_marks: {} }),
    })
  })

  const entry = makeEntry({
    id: 'qa-checklist-note',
    status: 'viewed',
    title: 'Checklist note entry',
    checklist: null,
    ai_checklist_fills: null,
  })
  await goSelectEntry(page, entry)

  await page.getByTestId('checklist-section-header-ask_seller').click()
  await page.getByTestId('checklist-note-toggle-sec3_reason_for_sale').click()
  const textarea = page.getByTestId('checklist-note-textarea-sec3_reason_for_sale')
  await textarea.fill('Asked agent, waiting on reply')

  // Debounce is 800ms.
  await expect(async () => {
    expect(lastBody).toContain('Asked agent, waiting on reply')
  }).toPass({ timeout: 3_000 })
})

test('filter chips narrow visible items and force-expand only matching sections', async ({ page }) => {
  await goSelectEntry(page, approvedEntry)
  // approvedEntry: sec3_renovation_history flagged (via legacy s09_01).

  await page.getByTestId('checklist-filter-flagged').click()

  await test.step('the flagged item is visible', async () => {
    await expect(page.getByTestId('checklist-chip-sec3_renovation_history')).toBeVisible({ timeout: 5_000 })
  })

  await test.step('a section with no flagged items does not render at all under the Flagged filter', async () => {
    await expect(page.getByTestId('checklist-section-header-request_docs')).toHaveCount(0)
  })

  await test.step('switching back to All restores every section', async () => {
    await page.getByTestId('checklist-filter-all').click()
    await expect(page.getByTestId('checklist-section-header-request_docs')).toBeVisible({ timeout: 3_000 })
  })
})

// ── Negotiation card gating ─────────────────────────────────────────────────

// NOTE: two independent tests rather than two test.step()s sharing one page —
// page.goto('/#shortlist') is a same-document hash-only navigation when the
// page is already on that route, so a second goSelectEntry() call within the
// same test would NOT trigger a real reload and TanStack Query would keep
// serving the first entry's cached data.

test('Negotiation card is gated (opacity + locked copy) for approved status', async ({ page }) => {
  await goSelectEntry(page, approvedEntry)
  await expect(page.locator('text=unlocks after viewing')).toBeVisible({ timeout: 5_000 })
})

test('Negotiation card is active with offer range for viewed status + brief', async ({ page }) => {
  const withBrief = makeEntry({
    ...viewedEntry,
    id: 'qa-negotiation-active',
    negotiation_brief: { offer_low: 190_000, offer_high: 205_000, target: 198_000, ask: 215_000 },
  })
  await goSelectEntry(page, withBrief)
  await expect(page.locator('text=unlocks after viewing')).toHaveCount(0)
  await expect(page.locator('button:has-text("regenerate")')).toBeVisible({ timeout: 5_000 })
})

// ── Hero action transitions ─────────────────────────────────────────────────

test('Schedule viewing — approved hero opens picker, Confirm fires POST', async ({ page, isMobile }) => {
  if (isMobile) { test.skip(); return }

  let scheduleCall: { url: string; body: string } | null = null
  await page.route('**/api/entry/*/schedule-viewing', async (route, request) => {
    scheduleCall = { url: request.url(), body: request.postData() ?? '' }
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  })

  await goSelectEntry(page, approvedEntry)

  await test.step('Schedule viewing button visible, opens picker', async () => {
    await page.locator('button:has-text("Schedule viewing")').click()
    await expect(page.locator('input[type="datetime-local"]')).toBeVisible({ timeout: 3_000 })
  })

  await test.step('pick a date and Confirm fires POST', async () => {
    await page.locator('input[type="datetime-local"]').fill('2026-09-01T14:00')
    await page.locator('button:has-text("Confirm")').click()
    await page.waitForFunction(() => true)
    expect(scheduleCall).not.toBeNull()
    expect(scheduleCall!.url).toContain('/schedule-viewing')
    expect(scheduleCall!.body).toContain('scheduled_at')
  })
})

test('Mark viewed — viewing_scheduled hero fires POST /mark-viewed', async ({ page, isMobile }) => {
  if (isMobile) { test.skip(); return }

  let markCalled = false
  await page.route('**/api/entry/*/mark-viewed', async (route) => {
    markCalled = true
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  })

  await goSelectEntry(page, viewingScheduledEntry)

  await page.locator('button:has-text("Mark viewed")').click()
  await page.waitForFunction(() => true)
  expect(markCalled).toBe(true)
})

test('After-viewing bar — Thinking and Drop decisions fire correct POST bodies', async ({ page, isMobile }) => {
  if (isMobile) { test.skip(); return }

  const decisionCalls: Array<{ body: string }> = []
  await page.route('**/api/entry/*/viewing-decision', async (route, request) => {
    decisionCalls.push({ body: request.postData() ?? '' })
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, new_status: 'thinking' }),
    })
  })

  await goSelectEntry(page, viewedEntry)

  await test.step('Thinking button fires decision=thinking', async () => {
    await page.locator('button:has-text("Thinking")').click()
    await page.waitForFunction(() => true)
    expect(decisionCalls.some((c) => c.body.includes('"thinking"'))).toBe(true)
  })

  await test.step('Drop button opens drawer, confirm fires decision=drop with reason', async () => {
    // Exact match — "Drop" is a substring of the sidebar's "Dropped 0" group
    // header, which sits earlier in the DOM than the after-viewing bar's Drop
    // button, so a substring match's .first() would hit the wrong element.
    await page.getByRole('button', { name: 'Drop', exact: true }).click()
    await expect(page.locator('text=Drop this listing?')).toBeVisible({ timeout: 3_000 })
    await page.locator('input[placeholder="Reason (optional)"]').fill('Noisy street')
    await page.locator('button:has-text("Drop listing")').click()
    await page.waitForFunction(() => true)
    expect(decisionCalls.some((c) => c.body.includes('"drop"') && c.body.includes('Noisy street'))).toBe(true)
  })
})

test('Dropped entry — Undo drop button fires decision=thinking', async ({ page, isMobile }) => {
  if (isMobile) { test.skip(); return }

  let lastDecisionBody = ''
  await page.route('**/api/entry/*/viewing-decision', async (route, request) => {
    lastDecisionBody = request.postData() ?? ''
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, new_status: 'thinking' }),
    })
  })

  // The "Dropped" sidebar group is collapsed by default (SidebarFunnel
  // defaultCollapsed=true), so goSelectEntry's row click needs the group
  // expanded first.
  const single: AppData = { properties: [droppedEntry], pending: [], last_check: null, next_check: null }
  await mockAppData(page, single)
  await mockSettings(page, fullSettings)
  await mockGeoEndpoints(page)
  await page.goto('/#shortlist')
  await page.locator('text=Dropped').first().click()
  await page.locator('button').filter({ hasText: droppedEntry.title }).first().click()

  await test.step('Undo drop button replaces the after-viewing bar', async () => {
    await expect(page.locator('button:has-text("Undo drop")')).toBeVisible({ timeout: 5_000 })
    await expect(page.locator('button:has-text("Still in")')).toHaveCount(0)
  })

  await test.step('click fires decision=thinking', async () => {
    await page.locator('button:has-text("Undo drop")').click()
    await page.waitForFunction(() => true)
    expect(lastDecisionBody).toContain('"thinking"')
  })
})

// ── Description translation card (Wave C) ───────────────────────────────────

test('DescriptionCard — visible with bullets, translation expanded, original collapsed', async ({ page }) => {
  await goSelectEntry(page, approvedEntry)

  await test.step('card visible near top of shortlist detail', async () => {
    await expect(page.getByTestId('description-card')).toBeVisible({ timeout: 5_000 })
  })

  await test.step('bullets render', async () => {
    const bullets = page.getByTestId('description-bullets')
    await expect(bullets).toBeVisible()
    for (const bullet of approvedEntry.description_bullets ?? []) {
      await expect(bullets.locator(`text=${bullet}`)).toBeVisible()
    }
  })

  await test.step('translation (RU) is expanded by default', async () => {
    await expect(page.getByTestId('description-translation-toggle')).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByTestId('description-translation-body')).toBeVisible()
    await expect(page.locator(`text=${approvedEntry.description_ru}`)).toBeVisible()
  })

  await test.step('original (ET) is collapsed by default, expands on click', async () => {
    await expect(page.getByTestId('description-original-toggle')).toHaveAttribute('aria-expanded', 'false')
    await page.getByTestId('description-original-toggle').click()
    await expect(page.getByTestId('description-original-body')).toBeVisible({ timeout: 3_000 })
    await expect(page.locator(`text=${approvedEntry.description}`)).toBeVisible()
  })
})

test('DescriptionCard — regenerate button is clickable and fires the endpoint', async ({ page }) => {
  let called = false
  await page.route('**/api/entry/*/regenerate-description', async (route) => {
    called = true
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  })

  await goSelectEntry(page, approvedEntry)
  await page.getByTestId('description-regenerate').click()
  await page.waitForFunction(() => true)
  expect(called).toBe(true)
})

test('DescriptionCard — empty state when description is missing', async ({ page }) => {
  const entry = makeEntry({
    id: 'qa-description-empty',
    status: 'approved',
    title: 'No description entry',
    description: null,
    description_ru: null,
    description_bullets: null,
  })
  await goSelectEntry(page, entry)
  await expect(page.getByTestId('description-empty')).toBeVisible({ timeout: 5_000 })
  await expect(page.locator('text=Описание пустое — kv.ee не отдал текст')).toBeVisible()
})

// ── Mobile: sidebar/main pane exclusivity round-trip ────────────────────────

test('mobile — Back button returns from main pane to sidebar', async ({ page, isMobile }) => {
  if (!isMobile) { test.skip(); return }

  await goSelectEntry(page, approvedEntry)

  await test.step('main pane visible with Back button', async () => {
    await expect(page.locator('text=Back')).toBeVisible({ timeout: 5_000 })
  })

  await test.step('tap Back — sidebar visible again, main pane gone', async () => {
    await page.locator('text=Back').click()
    await expect(page.locator('button').filter({ hasText: approvedEntry.title }).first()).toBeVisible({ timeout: 3_000 })
    await expect(page.locator('text=Back')).toHaveCount(0)
  })
})
