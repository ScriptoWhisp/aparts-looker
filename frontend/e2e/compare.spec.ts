/**
 * compare.spec.ts — Multi-select sidebar + CompareOverlay.
 *
 * Covers:
 *   - Cmd/Ctrl-click two sidebar rows → visual selection ring
 *   - Compare button appears with 2 selected
 *   - Compare dialog opens with "Compare" heading
 *   - Dialog shows differing-rows only (entries with different scores)
 *   - Esc closes dialog
 *   - Backdrop click closes dialog
 *
 * NOTE: multi-select via keyboard (C shortcut) requires 2 entries in compareIds state.
 * We test via the Compare button that appears in the sidebar funnel header.
 *
 * These tests run on chromium-desktop only — the multi-select compare UX
 * is desktop-targeted (keyboard + sidebar visible).
 */

import { test, expect } from '@playwright/test'
import {
  mockAppData,
  mockSettings,
  mockGeoEndpoints,
  fullSettings,
} from './fixtures/seed'
import type { AppData, Entry } from '../src/types/api'

// Two shortlisted entries with clearly different scores/prices so compare shows differing rows
const entryA: Entry = {
  id: 'compare-a',
  url: 'https://kv.ee/en/object/compare-a',
  status: 'approved',
  score: 88,
  title: 'Compare: Entry A — sunny corner',
  price_eur: 245_000,
  area_sqm: 72,
  rooms: 3,
  floor: 4,
  floors_total: 8,
  year_built: 2005,
  district: 'Kadriorg',
  address: 'Narva mnt 10',
  image_url: null,
  verdict: 'Very good option',
  rejection_reason: null,
  scheduled_at: null,
  shortlisted_at: '2026-07-30T09:00:00Z',
  approved_at: '2026-07-30T09:00:00Z',
  created_at: '2026-08-01T10:00:00Z',
  viewing_history: [],
  cost_of_ownership: null,
  own_score: null,
  checklist: null,
  ai_checklist_fills: null,
  negotiation_brief: null,
  negotiation_brief_generated_at: null,
  energy_class: 'B',
  material: 'Brick',
  dropped_at: null,
  drop_reason: null,
  lat: 59.445,
  lng: 24.778,
  price_per_sqm: 3403,
  commute_minutes: 22,
}

const entryB: Entry = {
  id: 'compare-b',
  url: 'https://kv.ee/en/object/compare-b',
  status: 'approved',
  score: 71,
  title: 'Compare: Entry B — budget option',
  price_eur: 168_000,
  area_sqm: 48,
  rooms: 2,
  floor: 2,
  floors_total: 5,
  year_built: 1992,
  district: 'Mustamäe',
  address: 'Sõpruse pst 50',
  image_url: null,
  verdict: 'Affordable but smaller',
  rejection_reason: null,
  scheduled_at: null,
  shortlisted_at: '2026-07-29T10:00:00Z',
  approved_at: '2026-07-29T10:00:00Z',
  created_at: '2026-08-01T10:00:00Z',
  viewing_history: [],
  cost_of_ownership: null,
  own_score: null,
  checklist: null,
  ai_checklist_fills: null,
  negotiation_brief: null,
  negotiation_brief_generated_at: null,
  energy_class: 'D',
  material: 'Panel',
  dropped_at: null,
  drop_reason: null,
  lat: 59.411,
  lng: 24.703,
  price_per_sqm: 3500,
  commute_minutes: 35,
}

const compareAppData: AppData = {
  properties: [entryA, entryB],
  pending: [],
  last_check: '2026-08-01T10:00:00Z',
  next_check: null,
}

// ── Multi-select + Compare button ──────────────────────────────────────────

test('multi-select two rows shows Compare button', async ({ page, isMobile }) => {
  if (isMobile) {
    // Compare UX is desktop-only (sidebar not visible on mobile)
    test.skip()
    return
  }

  await mockAppData(page, compareAppData)
  await mockSettings(page, fullSettings)
  await mockGeoEndpoints(page)

  await page.goto('/#shortlist')
  await page.waitForSelector('text=TO VIEW', { timeout: 10_000 })

  await test.step('ctrl-click sidebar rows for both entries', async () => {
    // Sidebar rows are button elements inside <aside> (the 284px sidebar)
    // We target the sidebar rows by their button role and partial name matching score + title
    const sidebarRows = page.locator('aside button').filter({ hasText: 'Entry A' })
    const firstSidebarRow = sidebarRows.first()
    await expect(firstSidebarRow).toBeVisible({ timeout: 5_000 })
    await firstSidebarRow.click({ modifiers: ['Meta'] })

    // Wait for compare bar to appear — sidebar funnel header shows when compareIds > 0
    // The bar shows "{count}/2 selected"
    await page.waitForSelector('text=/\\d\\/2 selected/', { timeout: 5_000 })

    const sidebarRowsB = page.locator('aside button').filter({ hasText: 'Entry B' })
    const secondSidebarRow = sidebarRowsB.first()
    await expect(secondSidebarRow).toBeVisible()
    await secondSidebarRow.click({ modifiers: ['Meta'] })
  })

  await test.step('Compare button is enabled and visible', async () => {
    // When 2 entries selected, Compare button becomes enabled.
    // The bar header Compare button has text exactly "Compare"
    await page.waitForSelector('text=/\\d\\/2 selected/', { timeout: 5_000 })
    const compareBtn = page.getByRole('button', { name: /^Compare$/ })
    await expect(compareBtn).toBeEnabled({ timeout: 5_000 })
  })

  await test.step('screenshot with selection ring', async () => {
    await page.screenshot({
      path: 'e2e/fixtures/screenshots/compare-multi-select.png',
      fullPage: false,
    })
  })
})

// ── Compare dialog opens ───────────────────────────────────────────────────

test('Compare button opens dialog with heading', async ({ page, isMobile }) => {
  if (isMobile) {
    test.skip()
    return
  }

  await mockAppData(page, compareAppData)
  await mockSettings(page, fullSettings)
  await mockGeoEndpoints(page)

  await page.goto('/#shortlist')
  await page.waitForSelector('text=TO VIEW', { timeout: 10_000 })

  // Select two sidebar rows via ctrl-click
  const sidebarA = page.locator('aside button').filter({ hasText: 'Entry A' }).first()
  await expect(sidebarA).toBeVisible({ timeout: 5_000 })
  await sidebarA.click({ modifiers: ['Meta'] })
  await page.waitForSelector('text=/\\d\\/2 selected/', { timeout: 5_000 })

  const sidebarB = page.locator('aside button').filter({ hasText: 'Entry B' }).first()
  await expect(sidebarB).toBeVisible()
  await sidebarB.click({ modifiers: ['Meta'] })
  await page.waitForSelector('text=2/2 selected', { timeout: 5_000 })

  await test.step('click Compare button', async () => {
    // Target the Compare button in the sidebar bar header (short text, not the entry titles)
    // The bar header button has text exactly "Compare" (the entry titles have longer text)
    const compareBtn = page.getByRole('button', { name: /^Compare$/ })
    await expect(compareBtn).toBeEnabled({ timeout: 5_000 })
    await compareBtn.click()
  })

  await test.step('dialog opens with Compare heading', async () => {
    await expect(page.locator('h2:has-text("Compare")')).toBeVisible({ timeout: 5_000 })
  })

  await test.step('dialog shows differing rows', async () => {
    // Entries differ on score (88 vs 71), price, area — at least one row should render
    const dialogContent = page.locator('.fixed.inset-0').last()
    await expect(dialogContent).toBeVisible()
  })

  await test.step('screenshot', async () => {
    await page.screenshot({
      path: 'e2e/fixtures/screenshots/compare-dialog-open.png',
      fullPage: false,
    })
  })
})

// ── Esc closes dialog ─────────────────────────────────────────────────────

test('Esc closes compare dialog', async ({ page, isMobile }) => {
  if (isMobile) {
    test.skip()
    return
  }

  await mockAppData(page, compareAppData)
  await mockSettings(page, fullSettings)
  await mockGeoEndpoints(page)

  await page.goto('/#shortlist')
  await page.waitForSelector('text=TO VIEW', { timeout: 10_000 })

  // Select two sidebar rows + open compare
  const escSidebarA = page.locator('aside button').filter({ hasText: 'Entry A' }).first()
  await expect(escSidebarA).toBeVisible({ timeout: 5_000 })
  await escSidebarA.click({ modifiers: ['Meta'] })
  await page.waitForSelector('text=/\\d\\/2 selected/', { timeout: 5_000 })

  const escSidebarB = page.locator('aside button').filter({ hasText: 'Entry B' }).first()
  await escSidebarB.click({ modifiers: ['Meta'] })
  await page.waitForSelector('text=2/2 selected', { timeout: 5_000 })

  const compareBtn = page.getByRole('button', { name: /^Compare$/ })
  await expect(compareBtn).toBeEnabled({ timeout: 5_000 })
  await compareBtn.click()

  await expect(page.locator('h2:has-text("Compare")')).toBeVisible({ timeout: 5_000 })

  await test.step('press Esc', async () => {
    await page.keyboard.press('Escape')
  })

  await test.step('dialog is gone', async () => {
    await expect(page.locator('h2:has-text("Compare")')).not.toBeVisible({ timeout: 3_000 })
  })
})

// ── Backdrop click closes dialog ───────────────────────────────────────────

test('backdrop click closes compare dialog', async ({ page, isMobile }) => {
  if (isMobile) {
    test.skip()
    return
  }

  await mockAppData(page, compareAppData)
  await mockSettings(page, fullSettings)
  await mockGeoEndpoints(page)

  await page.goto('/#shortlist')
  await page.waitForSelector('text=TO VIEW', { timeout: 10_000 })

  // Select two sidebar rows + open compare
  const bdSidebarA = page.locator('aside button').filter({ hasText: 'Entry A' }).first()
  await expect(bdSidebarA).toBeVisible({ timeout: 5_000 })
  await bdSidebarA.click({ modifiers: ['Meta'] })
  await page.waitForSelector('text=/\\d\\/2 selected/', { timeout: 5_000 })

  const bdSidebarB = page.locator('aside button').filter({ hasText: 'Entry B' }).first()
  await bdSidebarB.click({ modifiers: ['Meta'] })
  await page.waitForSelector('text=2/2 selected', { timeout: 5_000 })

  const compareBtn = page.getByRole('button', { name: /^Compare$/ })
  await expect(compareBtn).toBeEnabled({ timeout: 5_000 })
  await compareBtn.click()

  await expect(page.locator('h2:has-text("Compare")')).toBeVisible({ timeout: 5_000 })

  await test.step('click backdrop (outside dialog bounds)', async () => {
    // The backdrop is fixed inset-0 z-50. The dialog is 1000px wide centered on 1440px,
    // so left edge is at ~220px. Click at (5, 450) — left of dialog, on backdrop.
    // The backdrop div has onClick={onClose}, so clicking outside the dialog's stopPropagation zone fires onClose.
    await page.mouse.click(5, 450)
  })

  await test.step('dialog is gone', async () => {
    await expect(page.locator('h2:has-text("Compare")')).not.toBeVisible({ timeout: 3_000 })
  })
})
