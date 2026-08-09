/**
 * qa-finance.spec.ts — Wave B finance calculator card + Settings > Финансы.
 *
 * Flows covered:
 *   1. Settings > Финансы — fill in income + savings, save, see the toast.
 *   2. Shortlist — open a listing, see the FinanceCard with a verdict pill.
 *   3. Inline "+ ввести" on a missing input (utilities) — enter a value,
 *      blur, and the missing-data callout clears once the recalculated
 *      breakdown comes back complete.
 *   4. Mobile (iPhone SE viewport, 375x812) — FinanceCard renders without
 *      horizontal overflow and its collapsible sections are usable.
 */

import { test, expect, type Page } from '@playwright/test'
import {
  mockAppData,
  mockSettings,
  mockGeoEndpoints,
  fullSettings,
  makeEntry,
  mockUserFinanceSettings,
  mockFinanceInputsPatch,
  unconfiguredFinanceSettings,
  configuredFinanceSettings,
  greenFinanceCalculation,
  missingInputsFinanceCalculation,
} from './fixtures/seed'
import type { AppData, Entry, FinanceCalculation } from '../src/types/api'

async function goSelectEntry(page: Page, entry: Entry) {
  const single: AppData = { properties: [entry], pending: [], last_check: null, next_check: null }
  await mockAppData(page, single)
  await mockSettings(page, fullSettings)
  await mockGeoEndpoints(page)
  await page.goto('/#shortlist')
  await page.locator('button').filter({ hasText: entry.title }).first().click()
}

// ── 1. Settings > Финансы — fill + save ─────────────────────────────────────

test('settings — fill income + savings in Финансы and save shows toast', async ({ page }) => {
  await page.route('**/api/data', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ properties: [], pending: [], last_check: null, next_check: null }) }),
  )
  await mockSettings(page, fullSettings)
  await mockGeoEndpoints(page)
  await mockUserFinanceSettings(page, unconfiguredFinanceSettings)

  await page.goto('/#settings')
  await page.locator('button:has-text("Финансы")').first().click()
  await expect(page.locator('text=Ежемесячный доход')).toBeVisible({ timeout: 10_000 })

  const incomeInput = page.locator('text=Ежемесячный доход').locator('..').locator('input')
  await incomeInput.fill('3500')
  const savingsInput = page.locator('text=Накопления').locator('..').locator('input')
  await savingsInput.fill('40000')

  await page.locator('button:has-text("Сохранить")').click()
  await expect(page.locator('text=Сохранено')).toBeVisible({ timeout: 5_000 })
})

// ── 2. Shortlist — FinanceCard verdict pill ─────────────────────────────────

test('shortlist — listing detail shows FinanceCard with a verdict pill', async ({ page }) => {
  await mockUserFinanceSettings(page, configuredFinanceSettings)
  await page.route('**/api/entry/*/finance-calculation', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(greenFinanceCalculation) }),
  )
  await mockFinanceInputsPatch(page)

  const entry = makeEntry({
    id: 'qa-finance-1',
    status: 'approved',
    title: 'Финансовая проверка listing',
    price_eur: 220_000,
  })
  await goSelectEntry(page, entry)

  const pill = page.getByTestId('finance-verdict-pill')
  await expect(pill).toBeVisible({ timeout: 10_000 })
  await expect(pill).toHaveAttribute('data-verdict', 'green')
  await expect(page.getByText(greenFinanceCalculation.affordability!.message_ru)).toBeVisible()
})

// ── 3. Inline input fills a missing value and the callout clears ───────────

test('shortlist — filling utilities via inline input clears the missing-data callout', async ({ page }) => {
  await mockUserFinanceSettings(page, configuredFinanceSettings)

  let utilitiesFilled = false
  await page.route('**/api/entry/*/finance-calculation', (route) => {
    const body: FinanceCalculation = utilitiesFilled
      ? greenFinanceCalculation
      : missingInputsFinanceCalculation
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) })
  })
  await page.route('**/api/entry/*/finance-inputs', async (route, request) => {
    if (request.method() !== 'PATCH') return route.continue()
    utilitiesFilled = true
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        utilities_eur_monthly: 150,
        remondifond_eur_monthly: 60,
        first_purchases_eur: 2000,
        override_ask_eur: null,
      }),
    })
  })

  const entry = makeEntry({
    id: 'qa-finance-2',
    status: 'approved',
    title: 'Listing needing utilities input',
    price_eur: 220_000,
  })
  await goSelectEntry(page, entry)

  await expect(page.getByTestId('finance-missing-callout')).toBeVisible({ timeout: 10_000 })

  // Ежемесячно section is collapsed by default (compact mode) — expand first
  await page.getByTestId('finance-section-toggle-monthly').click()
  await page.getByTestId('finance-add-utilities').click()
  const input = page.getByTestId('finance-input-utilities')
  await input.fill('150')
  await input.blur()

  await expect(page.getByTestId('finance-missing-callout')).toHaveCount(0, { timeout: 5_000 })
})

// ── 4. Mobile — iPhone SE viewport (375x812) ────────────────────────────────

test('mobile (375px) — FinanceCard renders without horizontal overflow and sections expand', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })

  await mockUserFinanceSettings(page, configuredFinanceSettings)
  await page.route('**/api/entry/*/finance-calculation', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(greenFinanceCalculation) }),
  )
  await mockFinanceInputsPatch(page)

  const entry = makeEntry({
    id: 'qa-finance-mobile-1',
    status: 'approved',
    title: 'Mobile finance card listing',
    price_eur: 220_000,
  })
  await goSelectEntry(page, entry)

  const card = page.getByTestId('finance-card')
  await expect(card).toBeVisible({ timeout: 10_000 })

  // No horizontal scroll — card width must not exceed the viewport.
  const box = await card.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.width).toBeLessThanOrEqual(375)

  // Scenarios section toggles open, revealing all 6 rows.
  await page.getByTestId('finance-section-toggle-scenarios').click()
  await expect(page.getByTestId('finance-scenario-row')).toHaveCount(6)
})
