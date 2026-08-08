/**
 * qa-header.spec.ts — Proactive QA sweep additions for header/nav.
 *
 * Fills gaps left by smoke.spec.ts: sequential tab switching (desktop nav +
 * mobile bottom nav), legacy hash backward-compat, and the Refresh button's
 * /api/check-now trigger.
 *
 * See docs/qa/user-flows.md for the full flow list.
 */

import { test, expect } from '@playwright/test'
import { mockAppData, mockSettings, mockGeoEndpoints, fullAppData, fullSettings } from './fixtures/seed'

// ── Desktop: sequential tab switching via top nav ───────────────────────────

test('desktop — clicking through all 4 top-nav tabs updates hash and content', async ({ page, isMobile }) => {
  if (isMobile) { test.skip(); return }
  await mockAppData(page, fullAppData)
  await mockSettings(page, fullSettings)
  await mockGeoEndpoints(page)

  await page.goto('/#overview')
  await page.waitForSelector('nav', { timeout: 10_000 })

  const tabs = [
    { label: 'Inbox', hash: '#inbox' },
    { label: 'Shortlist', hash: '#shortlist' },
    { label: 'Settings', hash: '#settings' },
    { label: 'Overview', hash: '#overview' },
  ]

  for (const { label, hash } of tabs) {
    await test.step(`click ${label}`, async () => {
      await page.locator('nav button', { hasText: label }).first().click()
      await expect.poll(() => page.evaluate(() => window.location.hash)).toBe(hash)
      const cls = await page.locator('nav button', { hasText: label }).first().getAttribute('class') ?? ''
      expect(cls).toContain('text-accent-lt')
    })
  }
})

// ── Mobile: sequential tab switching via bottom nav ─────────────────────────

test('mobile — tapping through all 4 bottom-nav items updates aria-current', async ({ page, isMobile }) => {
  if (!isMobile) { test.skip(); return }
  await mockAppData(page, fullAppData)
  await mockSettings(page, fullSettings)
  await mockGeoEndpoints(page)

  await page.goto('/#overview')
  const nav = page.locator('nav[aria-label="Main navigation"]')
  await expect(nav).toBeVisible({ timeout: 10_000 })

  for (const label of ['Inbox', 'Shortlist', 'Settings', 'Overview']) {
    await test.step(`tap ${label}`, async () => {
      await nav.locator('button', { hasText: label }).click()
      await expect(nav.locator('button', { hasText: label })).toHaveAttribute('aria-current', 'page')
    })
  }
})

// ── Legacy hash backward-compat ─────────────────────────────────────────────

test('#pending legacy hash lands on Inbox', async ({ page }) => {
  await mockAppData(page, fullAppData)
  await mockSettings(page, fullSettings)
  await mockGeoEndpoints(page)

  await page.goto('/#pending')

  // tabFromHash maps #pending -> 'inbox' at store-init time; Inbox content should render.
  const inboxIndicator = page.locator('[data-testid="inbox-mobile"]').or(page.locator('[role="article"]').first())
  await expect(inboxIndicator.first()).toBeVisible({ timeout: 10_000 })
})

// ── Refresh button ───────────────────────────────────────────────────────────

test('desktop — Refresh button fires POST /api/check-now and shows Checking… state', async ({ page, isMobile }) => {
  if (isMobile) { test.skip(); return }
  await mockAppData(page, fullAppData)
  await mockSettings(page, fullSettings)
  await mockGeoEndpoints(page)

  let checkCalled = false
  await page.route('**/api/check-now', async (route) => {
    checkCalled = true
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  })

  await page.goto('/#overview')
  await page.waitForSelector('button:has-text("Refresh")', { timeout: 10_000 })

  const refreshBtn = page.locator('button:has-text("Refresh")')
  await refreshBtn.click()

  await expect(page.locator('button:has-text("Checking…")')).toBeVisible({ timeout: 2_000 })
  await page.waitForFunction(() => true)
  expect(checkCalled).toBe(true)
})
