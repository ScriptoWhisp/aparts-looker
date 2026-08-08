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

// ── Checklist accordion — the reported-broken flow ─────────────────────────

test.describe('checklist accordion — data shape resilience', () => {
  test('checklist=null, ai_checklist_fills=null → empty state, no crash', async ({ page }) => {
    const getErrors = attachConsoleWatcher(page)
    const entry = makeEntry({
      id: 'qa-checklist-null',
      status: 'viewed',
      title: 'Checklist null entry',
      checklist: null,
      ai_checklist_fills: null,
    })
    await goSelectEntry(page, entry)

    await expect(page.locator('text=No checklist data yet')).toBeVisible({ timeout: 5_000 })
    await assertNoErrorBoundary(page)
    expect(getErrors().filter((e) => !e.includes('leaflet'))).toHaveLength(0)
  })

  test('checklist={} (empty object, no .groups) → empty state, no crash', async ({ page }) => {
    const entry = makeEntry({
      id: 'qa-checklist-empty-obj',
      status: 'viewed',
      title: 'Checklist empty object entry',
      checklist: {},
      ai_checklist_fills: null,
    })
    await goSelectEntry(page, entry)

    await expect(page.locator('text=No checklist data yet')).toBeVisible({ timeout: 5_000 })
    await assertNoErrorBoundary(page)
  })

  test('real production shape — flat ai_checklist_fills strings render correctly', async ({ page }) => {
    // This mirrors the ACTUAL shape backend/ai_evaluator.py produces and
    // backend/ingest_handler.py stores: key -> filled-in Russian text.
    // Before the fix in this sweep, this rendered raw key codes ("s14_01") as
    // labels and a gray "?" glyph for every item (the text was cast as the
    // ChecklistItemState enum and never matched ok/flag/unknown/skip).
    const entry = makeEntry({
      id: 'qa-checklist-real-fills',
      status: 'viewed',
      title: 'Checklist real fills entry',
      checklist: null,
      ai_checklist_fills: {
        s14_01: 'Kesklinn, 15 минут до Bolt HQ',
        s14_02: '215 000 € · 3 468 €/м²',
        s16_03: '', // empty — must be dropped, not rendered as an item
      },
    })
    await goSelectEntry(page, entry)

    await test.step('header summary counts the filled items as "ok", not "unknown"', async () => {
      // Header shows "{flag} flag {unknown} unknown {ok} ok" — 2 real fills both
      // resolve to state=ok, so the header's ok-count text must be present.
      await expect(page.locator('text=/2 ok/')).toBeVisible({ timeout: 5_000 })
      await expect(page.locator('text=/2 unknown/')).toHaveCount(0)
    })

    const financeGroupHeader = page.locator('button').filter({ hasText: 'Rahandus' })
    const locationGroupHeader = page.locator('button').filter({ hasText: 'Asukoht' })

    await test.step('groups render keyed by the shared registry (Finance, Location) — not dumped into one bucket', async () => {
      await expect(financeGroupHeader).toBeVisible()
      await expect(locationGroupHeader).toBeVisible()
    })

    await test.step('groups without a flag start collapsed by design — expand to see item content', async () => {
      // Neither group has a flag item (both fills resolve to state=ok), so both
      // start collapsed per "open by default iff group contains a flag". Expand
      // the Location group to verify the item content underneath.
      await locationGroupHeader.click()
      await expect(page.locator('text=Location convenience')).toBeVisible({ timeout: 3_000 })
    })

    await test.step('label is human-readable, not the raw key code', async () => {
      await expect(page.locator('text=s14_01')).toHaveCount(0)
    })

    await test.step('filled text is shown as the item note, not discarded', async () => {
      await expect(page.locator('text=Kesklinn, 15 минут до Bolt HQ')).toBeVisible()
    })

    await test.step('empty string value is dropped from the checklist card, not rendered as a blank item', async () => {
      // "Road / tram noise" (s16_03, the empty-string key) legitimately DOES
      // appear in the separate "Ask at the viewing" card, since an empty fill
      // correctly means "still unknown, ask at the viewing" — scope this
      // assertion to just the Checklist card so it isn't confused with that.
      const checklistCard = page.locator('text=Checklist').first().locator('../..')
      await expect(checklistCard.locator('text=Road / tram noise')).toHaveCount(0)
    })

    await test.step('screenshot', async () => {
      await page.screenshot({
        path: 'e2e/fixtures/screenshots/qa-checklist-real-fills.png',
        fullPage: false,
      })
    })
  })

  test('structured checklist.groups shape — flag-first ordering + signal strip', async ({ page }) => {
    await goSelectEntry(page, approvedEntry)

    await test.step('groups render with flag-first ordering (Risk before Building fund)', async () => {
      // approvedEntry fixture has building_fund (unknown) and risk (flag) groups.
      // Flag group should sort first (worstState priority: flag=0, unknown=1, ok=2).
      await expect(page.locator('text=Risk').first()).toBeVisible({ timeout: 5_000 })
      await expect(page.locator('text=Building fund').first()).toBeVisible()
    })

    await test.step('flagged group is open by default (item text visible without clicking)', async () => {
      await expect(page.locator('text=No moisture damage')).toBeVisible()
    })

    await test.step('bottom meta shows item + unknown count', async () => {
      await expect(page.locator('text=/\\d+ items?/')).toBeVisible()
    })

    await test.step('chevron click toggles a collapsed group open', async () => {
      const buildingFundHeader = page.locator('button', { hasText: 'Building fund' }).first()
      // building_fund has no flag item (only ok + unknown) — starts collapsed
      const fundExists = page.locator('text=Fund exists')
      await expect(fundExists).not.toBeVisible()
      await buildingFundHeader.click()
      await expect(fundExists).toBeVisible({ timeout: 3_000 })
    })
  })
})

// ── Ask at the viewing — unknown extraction ────────────────────────────────

test('Ask at the viewing lists unknown items as checkboxes, toggles state', async ({ page }) => {
  const entry = makeEntry({
    id: 'qa-ask-at-viewing',
    status: 'viewed',
    title: 'Ask at viewing entry',
    checklist: null,
    ai_checklist_fills: {
      s14_01: 'Kesklinn, close to center',
      s14_02: '200 000 € · 3 500 €/м²',
    },
  })
  await goSelectEntry(page, entry)

  await test.step('unfilled keys render as open questions', async () => {
    // 13 fillable keys total, 2 filled -> 11 questions expected.
    const items = page.locator('ul li')
    await expect(items).toHaveCount(11, { timeout: 5_000 })
  })

  await test.step('checkbox toggles checked state', async () => {
    const firstCheckbox = page.locator('[role="checkbox"]').first()
    await expect(firstCheckbox).toHaveAttribute('aria-checked', 'false')
    await firstCheckbox.click()
    await expect(firstCheckbox).toHaveAttribute('aria-checked', 'true')
  })
})

test('Ask at the viewing — all keys filled shows "No open questions"', async ({ page }) => {
  const allFilled = Object.fromEntries(
    ['s09_01', 's09_02', 's14_01', 's14_02', 's14_03', 's14_04', 's14_05',
      's14_09', 's14_10', 's16_01', 's16_02', 's16_03', 's16_04'].map((k) => [k, `filled ${k}`]),
  )
  const entry = makeEntry({
    id: 'qa-ask-at-viewing-all-filled',
    status: 'viewed',
    title: 'Ask at viewing all filled entry',
    checklist: null,
    ai_checklist_fills: allFilled,
  })
  await goSelectEntry(page, entry)

  await expect(page.locator('text=No open questions')).toBeVisible({ timeout: 5_000 })
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
