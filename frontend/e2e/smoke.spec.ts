/**
 * smoke.spec.ts — 4 tabs load without console errors.
 *
 * Covers:
 *   - Each tab renders without page errors or unhandled exceptions
 *   - The active tab button has the accent style (bg-accent/[0.14])
 *   - No ErrorBoundary "Route crash" text is visible
 *   - Screenshot captured per tab for visual QA
 *
 * Runs on BOTH projects (chromium-desktop + webkit-mobile).
 */

import { test, expect, type Page } from '@playwright/test'
import {
  mockAppData,
  mockSettings,
  mockGeoEndpoints,
  fullAppData,
  fullSettings,
} from './fixtures/seed'

// Collect console errors per test for assertion
function attachConsoleWatcher(page: Page): () => string[] {
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(err.message))
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  return () => errors
}

const TABS = [
  { hash: '#overview',  label: 'Overview' },
  { hash: '#inbox',     label: 'Inbox' },
  { hash: '#shortlist', label: 'Shortlist' },
  { hash: '#settings',  label: 'Settings' },
] as const

for (const { hash, label } of TABS) {
  test(`${label} tab — loads without console errors`, async ({ page }) => {
    const getErrors = attachConsoleWatcher(page)

    await mockAppData(page, fullAppData)
    await mockSettings(page, fullSettings)
    await mockGeoEndpoints(page)

    await test.step(`navigate to ${hash}`, async () => {
      await page.goto(`/${hash}`)
      // Wait for the tab to be active (accent class on the button)
      await page.waitForSelector(`button:has-text("${label}")`, { timeout: 10_000 })
    })

    await test.step('assert no ErrorBoundary crash text', async () => {
      await expect(page.locator('body')).not.toContainText('Route crash')
      await expect(page.locator('body')).not.toContainText('Something went wrong')
    })

    await test.step('assert active tab button has accent style', async () => {
      // The active tab button contains the label and has bg-accent tint class
      const tabButton = page.locator(`button:has-text("${label}")`).first()
      await expect(tabButton).toBeVisible()
      // Active button carries one of: text-accent-lt or font-medium (per Header.tsx)
      const cls = await tabButton.getAttribute('class') ?? ''
      expect(cls).toContain('text-accent-lt')
    })

    await test.step('assert no unhandled JS errors', async () => {
      const errors = getErrors()
      // Filter known non-critical browser noise (e.g. Leaflet tile load on mocked geo)
      const realErrors = errors.filter(
        (e) =>
          !e.includes('net::ERR_') &&
          !e.includes('favicon') &&
          !e.includes('tile') &&
          !e.includes('leaflet'),
      )
      expect(realErrors).toHaveLength(0)
    })

    await test.step('screenshot', async () => {
      await page.screenshot({
        path: `e2e/fixtures/screenshots/smoke-${label.toLowerCase()}.png`,
        fullPage: false,
      })
    })
  })
}
