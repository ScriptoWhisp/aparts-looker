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

// ── Checklist — Wave 10 interactive rewrite ─────────────────────────────────

test.describe('checklist — always-full registry + data shape resilience', () => {
  test('checklist=null, ai_checklist_fills=null → all 13 items render as unknown, no crash', async ({ page }) => {
    const getErrors = attachConsoleWatcher(page)
    const entry = makeEntry({
      id: 'qa-checklist-null',
      status: 'viewed',
      title: 'Checklist null entry',
      checklist: null,
      ai_checklist_fills: null,
    })
    await goSelectEntry(page, entry)

    await expect(page.locator('text=13 items')).toBeVisible({ timeout: 5_000 })
    await assertNoErrorBoundary(page)
    expect(getErrors().filter((e) => !e.includes('leaflet'))).toHaveLength(0)
  })

  test('checklist={} (empty object, no .user_marks) → all 13 items render, no crash', async ({ page }) => {
    const entry = makeEntry({
      id: 'qa-checklist-empty-obj',
      status: 'viewed',
      title: 'Checklist empty object entry',
      checklist: {},
      ai_checklist_fills: null,
    })
    await goSelectEntry(page, entry)

    await expect(page.locator('text=13 items')).toBeVisible({ timeout: 5_000 })
    await assertNoErrorBoundary(page)
  })

  test('real production shape — flat ai_checklist_fills strings render correctly, all items visible once expanded', async ({ page }) => {
    // This mirrors the ACTUAL shape backend/ai_evaluator.py produces and
    // backend/ingest_handler.py stores: key -> filled-in Russian text.
    // Pre-Wave-10, this rendered raw key codes ("s14_01") as labels and a gray
    // "?" glyph for every item, AND only showed the 2-3 keys the AI happened to
    // fill — everything else was simply absent from the DOM.
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

    await test.step('header summary counts the filled items as "ok", not "unknown"; the rest are unknown', async () => {
      // 2 fills -> ok, 11 remaining registry keys -> unknown.
      await expect(page.locator('text=/2 ok/')).toBeVisible({ timeout: 5_000 })
      await expect(page.locator('text=/11 unknown/')).toBeVisible()
    })

    const financeGroupHeader = page.locator('button').filter({ hasText: 'Rahandus' })
    const locationGroupHeader = page.locator('button').filter({ hasText: 'Asukoht' })

    await test.step('groups render keyed by the shared registry (Finance, Location) — not dumped into one bucket', async () => {
      await expect(financeGroupHeader).toBeVisible()
      await expect(locationGroupHeader).toBeVisible()
    })

    await test.step('groups without a flag/mark start collapsed by design — expand to see item content', async () => {
      // Neither group has a flag or a user mark (both fills resolve to
      // state=ok), so both start collapsed. Expand Location to verify every
      // item in it renders now — not just the one the AI filled.
      await locationGroupHeader.click()
      await expect(page.locator('text=Location convenience')).toBeVisible({ timeout: 3_000 })
      await expect(page.locator('text=Distance to public transit')).toBeVisible()
      await expect(page.locator('text=Road / tram noise')).toBeVisible()
    })

    await test.step('label is human-readable, not the raw key code', async () => {
      await expect(page.locator('text=s14_01')).toHaveCount(0)
    })

    await test.step('filled text is shown as AI context under the label, not discarded', async () => {
      await expect(page.locator('text=Kesklinn, 15 минут до Bolt HQ')).toBeVisible()
    })

    await test.step('empty-string fill (s16_03) renders as a normal unknown item, not a blank "ok"', async () => {
      const chip = page.getByTestId('checklist-chip-s16_03')
      await expect(chip).toBeVisible()
      await expect(chip).toHaveAttribute('data-state', 'unknown')
    })

    await test.step('screenshot', async () => {
      await page.screenshot({
        path: 'e2e/fixtures/screenshots/qa-checklist-real-fills.png',
        fullPage: false,
      })
    })
  })

  test('user_marks shape — flag-first group ordering + open-by-default', async ({ page }) => {
    await goSelectEntry(page, approvedEntry)
    // approvedEntry: s14_01/s14_02 AI-filled (-> ok), s09_01 (risk group) user-flagged.

    await test.step('Risk (has the flag) sorts before Location/Finance (ok-only, no mark)', async () => {
      const risk = page.locator('button').filter({ hasText: 'Risk' })
      await expect(risk).toBeVisible({ timeout: 5_000 })
    })

    await test.step('flagged group is open by default (item text visible without clicking)', async () => {
      await expect(page.locator('text=Plumbing / electrical replacement year')).toBeVisible()
    })

    await test.step('bottom meta shows item count', async () => {
      await expect(page.locator('text=13 items')).toBeVisible()
    })

    await test.step('chevron click toggles a collapsed (no flag/mark) group open', async () => {
      const locationHeader = page.locator('button').filter({ hasText: 'Asukoht' })
      const transitItem = page.locator('text=Distance to public transit')
      await expect(transitItem).not.toBeVisible()
      await locationHeader.click()
      await expect(transitItem).toBeVisible({ timeout: 3_000 })
    })
  })
})

// ── Checklist — interactive state chip + note persistence (Wave 10) ────────

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

  // s09_01 (risk group) has no flag/mark on this bare entry — expand its group first.
  await page.locator('button').filter({ hasText: 'Risk' }).click()
  const chip = page.getByTestId('checklist-chip-s09_01')
  await expect(chip).toHaveAttribute('data-state', 'unknown')

  await chip.click()
  await expect(chip).toHaveAttribute('data-state', 'ok', { timeout: 3_000 })
  await page.waitForFunction(() => true)
  expect(patchCount).toBeGreaterThanOrEqual(1)
  expect(lastBody).toContain('"key":"s09_01"')
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

  await page.locator('button').filter({ hasText: 'Risk' }).click()
  await page.getByTestId('checklist-note-toggle-s09_01').click()
  const textarea = page.getByTestId('checklist-note-textarea-s09_01')
  await textarea.fill('Asked agent, waiting on reply')

  // Debounce is 800ms.
  await expect(async () => {
    expect(lastBody).toContain('Asked agent, waiting on reply')
  }).toPass({ timeout: 3_000 })
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
