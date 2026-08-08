/**
 * qa-overview.spec.ts — Proactive QA sweep additions for the Overview tab.
 *
 * Fills gaps left by smoke.spec.ts / mobile-snapshots.spec.ts: BEST hero and
 * Next-up navigation, histogram/scatter rendering, empty state copy, and the
 * Calibration panel's exact 5-rated-viewings threshold.
 *
 * See docs/qa/user-flows.md for the full flow list.
 */

import { test, expect } from '@playwright/test'
import {
  mockAppData,
  mockSettings,
  mockGeoEndpoints,
  fullSettings,
  fullAppData,
  emptyAppData,
  makeEntry,
} from './fixtures/seed'
import type { AppData, Entry } from '../src/types/api'

// ── BEST hero / Next up navigation ──────────────────────────────────────────

test('desktop — BEST hero click navigates to Shortlist with that entry selected', async ({ page, isMobile }) => {
  if (isMobile) { test.skip(); return }
  await mockAppData(page, fullAppData)
  await mockSettings(page, fullSettings)
  await mockGeoEndpoints(page)

  await page.goto('/#overview')
  await page.waitForSelector('text=BEST TODAY', { timeout: 10_000 })

  await page.locator('text=BEST TODAY').locator('..').locator('..').click()

  await test.step('hash flips to #shortlist', async () => {
    await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#shortlist')
  })

  await test.step('the best entry hero renders in the main pane', async () => {
    // fullAppData's best entry (highest score among properties) is approvedEntry
    // ("Top pick: sunny corner flat", score 88). It legitimately appears twice
    // (sidebar row + main-pane heading) once selected — assert the heading.
    await expect(page.getByRole('heading', { name: 'Top pick: sunny corner flat' })).toBeVisible({ timeout: 5_000 })
  })
})

test('desktop — Next up row click navigates to Shortlist with that entry selected', async ({ page, isMobile }) => {
  if (isMobile) { test.skip(); return }
  await mockAppData(page, fullAppData)
  await mockSettings(page, fullSettings)
  await mockGeoEndpoints(page)

  await page.goto('/#overview')
  await page.waitForSelector('text=Next up', { timeout: 10_000 })

  // viewingScheduledEntry ("Viewing booked: Mustamäe gem") is in the To-view bucket
  // and appears in Next up alongside the approved entry.
  await page.locator('text=Viewing booked: Mustamäe gem').click()

  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#shortlist')
  await expect(page.locator('text=Viewing booked: Mustamäe gem').first()).toBeVisible({ timeout: 5_000 })
})

// ── Charts render ────────────────────────────────────────────────────────────

test('desktop — histogram bars and scatter dots render with data', async ({ page, isMobile }) => {
  if (isMobile) { test.skip(); return }
  await mockAppData(page, fullAppData)
  await mockSettings(page, fullSettings)
  await mockGeoEndpoints(page)

  await page.goto('/#overview')
  await page.waitForSelector('text=Where scores land', { timeout: 10_000 })

  await test.step('histogram renders at least one bar', async () => {
    // "Where scores land" span's grandparent is the HistogramSVG root (flex-col
    // container holding both the header row and the <svg>).
    const bars = page.locator('text=Where scores land').locator('../..').locator('svg rect')
    expect(await bars.count()).toBeGreaterThan(0)
  })

  await test.step('scatter renders at least one dot', async () => {
    const dots = page.locator('text=Score vs price').locator('../..').locator('svg circle')
    expect(await dots.count()).toBeGreaterThan(0)
  })

  await test.step('screenshot', async () => {
    await page.screenshot({ path: 'e2e/fixtures/screenshots/qa-overview-charts.png', fullPage: false })
  })
})

// ── Empty state ──────────────────────────────────────────────────────────────

test('empty overview shows friendly empty-state copy, no crash', async ({ page }) => {
  await mockAppData(page, emptyAppData)
  await mockSettings(page, fullSettings)
  await mockGeoEndpoints(page)

  await page.goto('/#overview')

  await expect(page.locator('text=No shortlisted entries yet.').first()).toBeVisible({ timeout: 10_000 })
  await expect(page.locator('[data-testid="error-boundary"]')).toHaveCount(0)
})

// ── Calibration panel threshold ─────────────────────────────────────────────

function entryWithOwnScore(id: string, aiScore: number, ownScore: number): Entry {
  return makeEntry({
    id,
    status: 'viewed',
    title: `Rated viewing ${id}`,
    score: aiScore,
    own_score: ownScore,
  })
}

// Two independent tests rather than test.step()s sharing one page — a second
// page.goto('/#overview') on an already-#overview page is a same-document,
// same-hash no-op navigation and would not force TanStack Query to refetch.

test('Calibration panel hidden below 5 rated viewings', async ({ page, isMobile }) => {
  if (isMobile) { test.skip(); return }

  const four: AppData = {
    properties: [
      entryWithOwnScore('cal-1', 70, 65),
      entryWithOwnScore('cal-2', 60, 55),
      entryWithOwnScore('cal-3', 80, 75),
      entryWithOwnScore('cal-4', 50, 48),
    ],
    pending: [],
    last_check: null,
    next_check: null,
  }
  await mockAppData(page, four)
  await mockSettings(page, fullSettings)
  await mockGeoEndpoints(page)
  await page.goto('/#overview')
  await page.waitForSelector('text=This week', { timeout: 10_000 })
  await expect(page.locator('text=Calibration')).toHaveCount(0)
})

test('Calibration panel shown at exactly 5 rated viewings, with MAE stat', async ({ page, isMobile }) => {
  if (isMobile) { test.skip(); return }

  const five: AppData = {
    properties: [
      entryWithOwnScore('cal-1', 70, 65),
      entryWithOwnScore('cal-2', 60, 55),
      entryWithOwnScore('cal-3', 80, 75),
      entryWithOwnScore('cal-4', 50, 48),
      entryWithOwnScore('cal-5', 90, 82),
    ],
    pending: [],
    last_check: null,
    next_check: null,
  }
  await mockAppData(page, five)
  await mockSettings(page, fullSettings)
  await mockGeoEndpoints(page)
  await page.goto('/#overview')
  await expect(page.locator('text=Calibration')).toBeVisible({ timeout: 10_000 })
  await expect(page.locator('text=/MAE \\d+ pts/')).toBeVisible()
})
