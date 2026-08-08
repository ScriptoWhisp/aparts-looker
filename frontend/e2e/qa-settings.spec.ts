/**
 * qa-settings.spec.ts — Proactive QA sweep additions for the Settings tab.
 *
 * Fills gaps left by the pre-sweep settings.spec.ts: value persistence across
 * reload (a real save round-trip, not just the toast appearing), and the
 * cross-tab effect of the rank_by_all_in toggle on Shortlist sort order.
 *
 * See docs/qa/user-flows.md for the full flow list.
 */

import { test, expect, type Page } from '@playwright/test'
import { mockGeoEndpoints, fullSettings, makeEntry } from './fixtures/seed'
import type { AppData, SettingsData, SettingsField } from '../src/types/api'

/**
 * Stateful settings mock: GET returns current fields, POST merges changed
 * values into the in-memory copy so a subsequent GET (triggered by reload)
 * reflects the save — mirrors the real backend's persistence contract.
 */
async function mockStatefulSettings(page: Page, initial: SettingsData) {
  let current: SettingsField[] = initial.fields.map((f) => ({ ...f }))
  await page.route('**/api/settings', async (route, request) => {
    if (request.method() === 'POST') {
      const body = JSON.parse(request.postData() ?? '{}') as Record<string, SettingsField['value']>
      current = current.map((f) => (f.key in body ? { ...f, value: body[f.key] } : f))
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ applied: body, errors: [] }),
      })
    }
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ fields: current, groups: initial.groups }),
    })
  })
}

// ── Reload persists saved value ─────────────────────────────────────────────

test('settings — value persists after reload following a save', async ({ page }) => {
  await page.route('**/api/data', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ properties: [], pending: [], last_check: null, next_check: null }) }),
  )
  await mockStatefulSettings(page, fullSettings)
  await mockGeoEndpoints(page)

  await page.goto('/#settings')
  await page.waitForSelector('text=Cost model', { timeout: 10_000 })
  await page.locator('button:has-text("Cost model")').first().click()
  await expect(page.locator('h2:has-text("Cost model")')).toBeVisible()

  // "Max price" label span's parent is the label row div; its sibling (the
  // slider track div containing the actual <input type="range">) is one
  // level up, at the SliderField root.
  const maxPriceField = page.locator('text=Max price').locator('../..')
  const slider = maxPriceField.locator('input[type="range"]')

  const newValue = 300_000

  await test.step('change max price slider and save', async () => {
    await slider.evaluate((el: HTMLInputElement, value) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
      setter?.call(el, String(value))
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    }, newValue)
    await page.locator('button:has-text("Save")').click()
    await expect(page.locator('text=Saved')).toBeVisible({ timeout: 5_000 })
  })

  await test.step('reload — slider reflects the persisted value, not the original mock', async () => {
    await page.reload()
    await page.waitForSelector('text=Cost model', { timeout: 10_000 })
    await page.locator('button:has-text("Cost model")').first().click()
    await expect(page.locator('h2:has-text("Cost model")')).toBeVisible()
    const reloadedValueText = await page.locator('text=Max price').locator('..').locator('span.font-mono').first().textContent()
    expect(reloadedValueText?.replace(/[^\d]/g, '')).toBe(String(newValue))
  })
})

// ── rank_by_all_in toggle changes Shortlist sort order ──────────────────────

test('settings — toggling rank_by_all_in changes Shortlist sort order', async ({ page, isMobile }) => {
  if (isMobile) { test.skip(); return }

  const expensiveHighScore = makeEntry({
    id: 'qa-settings-expensive',
    status: 'approved',
    title: 'Expensive high-score listing',
    score: 90,
    price_eur: 300_000,
  })
  const cheapLowScore = makeEntry({
    id: 'qa-settings-cheap',
    status: 'approved',
    title: 'Cheap low-score listing',
    score: 60,
    price_eur: 150_000,
  })
  const appData: AppData = {
    properties: [expensiveHighScore, cheapLowScore],
    pending: [],
    last_check: null,
    next_check: null,
  }
  await page.route('**/api/data', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(appData) }),
  )
  await mockStatefulSettings(page, fullSettings)
  await mockGeoEndpoints(page)

  await test.step('default order — sorted by score desc (expensive high-score first)', async () => {
    await page.goto('/#shortlist')
    await page.waitForSelector('text=TO VIEW', { timeout: 10_000 })
    const rows = page.locator('aside button').filter({ hasText: 'listing' })
    await expect(rows.first()).toContainText('Expensive high-score listing')
  })

  await test.step('toggle rank_by_all_in and save', async () => {
    await page.goto('/#settings')
    await page.waitForSelector('text=Cost model', { timeout: 10_000 })
    await page.locator('button:has-text("Cost model")').first().click()
    const toggle = page.locator('button[role="switch"]').first()
    await toggle.click()
    await page.locator('button:has-text("Save")').click()
    await expect(page.locator('text=Saved')).toBeVisible({ timeout: 5_000 })
  })

  await test.step('shortlist now sorted by all-in cost asc (cheap listing first)', async () => {
    await page.goto('/#shortlist')
    await page.waitForSelector('text=TO VIEW', { timeout: 10_000 })
    const rows = page.locator('aside button').filter({ hasText: 'listing' })
    await expect(rows.first()).toContainText('Cheap low-score listing')
  })
})
