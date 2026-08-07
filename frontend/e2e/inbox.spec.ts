/**
 * inbox.spec.ts — Inbox triage flows (Wave 8A update).
 *
 * Desktop flows (chromium-desktop):
 *   - Look closer: click → POST /approve fired, hash stays #inbox (NOT #shortlist)
 *   - Skip: click → modal → reason chip → confirm, POST /reject fired
 *   - Keyboard: press L on first card → same as Look closer button
 *
 * Mobile flows (webkit-mobile) — Wave 8A Tinder behavior:
 *   - Approve card 1 → card 2 rendered + hash still #inbox
 *   - Skip card → sheet opens with Next button (no countdown)
 *   - Skip → chip → Next → POST /reject with reason
 *   - Cleared state: approve both → decision list + Open shortlist visible
 *
 * Both:
 *   - Empty state: "Inbox is empty" when no pending entries
 */

import { test, expect } from '@playwright/test'
import {
  mockAppData,
  mockSettings,
  mockGeoEndpoints,
  fullSettings,
  appDataWithPending,
  emptyAppData,
  pendingEntry1,
  pendingEntry2,
} from './fixtures/seed'
import type { AppData } from '../src/types/api'

// ── Desktop: Look closer flow ──────────────────────────────────────────────

test('desktop — Look closer moves to shortlist', async ({ page, isMobile }) => {
  if (isMobile) { test.skip(); return }
  await mockAppData(page, appDataWithPending)
  await mockSettings(page, fullSettings)
  await mockGeoEndpoints(page)

  const approveCalls: string[] = []
  await page.route('**/api/pending/*/approve', (route, request) => {
    approveCalls.push(request.url())
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  })

  await page.goto('/#inbox')
  await page.waitForSelector('[role="article"]', { timeout: 10_000 })

  await test.step('click Look closer on first card', async () => {
    const firstCard = page.locator('[role="article"]').first()
    await expect(firstCard).toBeVisible()
    const lookBtn = firstCard.locator('button:has-text("Look closer")')
    await lookBtn.click()
  })

  await test.step('verify POST /approve was called', async () => {
    await page.waitForFunction(() => true)
    expect(approveCalls.length).toBeGreaterThanOrEqual(1)
    expect(approveCalls[0]).toContain('/api/pending/')
    expect(approveCalls[0]).toContain('/approve')
  })

  await test.step('screenshot', async () => {
    await page.screenshot({
      path: 'e2e/fixtures/screenshots/inbox-look-closer.png',
      fullPage: false,
    })
  })
})

// ── Desktop: Skip flow ─────────────────────────────────────────────────────

test('desktop — Skip opens reason modal and fires POST /reject', async ({ page, isMobile }) => {
  if (isMobile) { test.skip(); return }
  await mockAppData(page, appDataWithPending)
  await mockSettings(page, fullSettings)
  await mockGeoEndpoints(page)

  const rejectCalls: Array<{ url: string; body: string }> = []
  await page.route('**/api/pending/*/reject', async (route, request) => {
    rejectCalls.push({ url: request.url(), body: request.postData() ?? '' })
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  })

  await page.goto('/#inbox')
  await page.waitForSelector('[role="article"]', { timeout: 10_000 })

  await test.step('click Skip on first card', async () => {
    const firstCard = page.locator('[role="article"]').first()
    const skipBtn = firstCard.locator('button:has-text("Skip")')
    await skipBtn.click()
  })

  await test.step('skip modal opens with reason chips', async () => {
    await expect(page.locator('text=Skipped — what put you off?')).toBeVisible()
    const chips = page.locator('button:has-text("Price"), button:has-text("Location"), button:has-text("Condition"), button:has-text("Layout"), button:has-text("Building"), button:has-text("Other")')
    await expect(chips).toHaveCount(6)
  })

  await test.step('select a reason chip', async () => {
    await page.locator('button:has-text("Location")').click()
  })

  await test.step('confirm skip', async () => {
    await page.locator('.fixed button:has-text("Skip")').click()
  })

  await test.step('verify POST /reject was called', async () => {
    await page.waitForFunction(() => true)
    expect(rejectCalls.length).toBeGreaterThanOrEqual(1)
    expect(rejectCalls[0].url).toContain('/api/pending/')
    expect(rejectCalls[0].url).toContain('/reject')
  })

  await test.step('screenshot', async () => {
    await page.screenshot({
      path: 'e2e/fixtures/screenshots/inbox-skip-confirmed.png',
      fullPage: false,
    })
  })
})

// ── Desktop: Keyboard L shortcut ──────────────────────────────────────────

test('desktop — keyboard L fires approve on first card', async ({ page, isMobile }) => {
  if (isMobile) { test.skip(); return }
  await mockAppData(page, appDataWithPending)
  await mockSettings(page, fullSettings)
  await mockGeoEndpoints(page)

  const approveCalls: string[] = []
  await page.route('**/api/pending/*/approve', (route, request) => {
    approveCalls.push(request.url())
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  })

  await page.goto('/#inbox')
  await page.waitForSelector('[role="article"]', { timeout: 10_000 })

  await page.keyboard.press('l')

  await page.waitForFunction(() => true)
  expect(approveCalls.length).toBeGreaterThanOrEqual(1)
})

// ── Empty state ────────────────────────────────────────────────────────────

test('empty inbox shows "Inbox is empty" text', async ({ page }) => {
  await mockAppData(page, emptyAppData)
  await mockSettings(page, fullSettings)
  await mockGeoEndpoints(page)

  await page.goto('/#inbox')

  await expect(page.locator('text=Inbox is empty')).toBeVisible({ timeout: 10_000 })
  await expect(page.locator('button:has-text("Adjust threshold")')).toBeVisible()

  await test.step('screenshot', async () => {
    await page.screenshot({
      path: 'e2e/fixtures/screenshots/inbox-empty-state.png',
      fullPage: false,
    })
  })
})

// ── Mobile: single-card layout ─────────────────────────────────────────────

test('mobile — inbox renders action buttons', async ({ page, isMobile }) => {
  await mockAppData(page, appDataWithPending)
  await mockSettings(page, fullSettings)
  await mockGeoEndpoints(page)

  await page.goto('/#inbox')

  if (isMobile) {
    await page.waitForSelector('[data-testid="inbox-mobile"]', { timeout: 10_000 })

    // Check action buttons visible
    await expect(page.locator('button:has-text("Look closer")')).toBeVisible()
    await expect(page.locator('button:has-text("Skip")')).toBeVisible()
    await expect(page.locator('button:has-text("Later")')).toBeVisible()
  } else {
    await page.waitForSelector('[role="article"]', { timeout: 10_000 })
    await expect(page.locator('[role="article"]').first()).toBeVisible()
  }

  await test.step('screenshot', async () => {
    await page.screenshot({
      path: `e2e/fixtures/screenshots/inbox-mobile-${isMobile ? 'mobile' : 'desktop'}.png`,
      fullPage: false,
    })
  })
})

// ── Mobile: Wave 8A Tinder flow — Look closer stays on #inbox ─────────────

test('mobile — Look closer on card 1 stays on #inbox and shows card 2', async ({ page, isMobile }) => {
  if (!isMobile) { test.skip(); return }

  await mockAppData(page, appDataWithPending)
  await mockSettings(page, fullSettings)
  await mockGeoEndpoints(page)

  const approveCalls: string[] = []
  await page.route('**/api/pending/*/approve', (route, request) => {
    approveCalls.push(request.url())
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  })

  await page.goto('/#inbox')
  await page.waitForSelector('[data-testid="inbox-mobile"]', { timeout: 10_000 })

  const initialHash = await page.evaluate(() => window.location.hash)
  expect(initialHash).toBe('#inbox')

  await test.step('click Look closer on front card', async () => {
    await expect(page.locator('button:has-text("Look closer")')).toBeVisible()
    await page.locator('button:has-text("Look closer")').click()
  })

  await test.step('hash stays on #inbox after approve', async () => {
    // Give animation time to play
    await page.waitForTimeout(400)
    const hash = await page.evaluate(() => window.location.hash)
    expect(hash).toBe('#inbox')
  })

  await test.step('POST /approve was fired', async () => {
    expect(approveCalls.length).toBeGreaterThanOrEqual(1)
    expect(approveCalls[0]).toContain('/approve')
  })

  await test.step('card 1 is gone, card 2 (Cozy studio) now visible', async () => {
    // After card 1 slides out, card 2 should be in the DOM
    await expect(page.locator('text=Cozy studio near Viru Gate')).toBeVisible({ timeout: 3000 })
    // Card 1 should not be visible
    await expect(page.locator('text=Spacious 2BR in Kesklinn')).not.toBeVisible()
  })

  await test.step('screenshot', async () => {
    await page.screenshot({
      path: 'e2e/fixtures/screenshots/inbox-mobile-tinder-advance.png',
      fullPage: false,
    })
  })
})

// ── Mobile: Wave 8A — Skip flow: sheet with Next button ───────────────────

test('mobile — Skip opens sheet with Next button (no countdown)', async ({ page, isMobile }) => {
  if (!isMobile) { test.skip(); return }

  await mockAppData(page, appDataWithPending)
  await mockSettings(page, fullSettings)
  await mockGeoEndpoints(page)

  const rejectCalls: Array<{ url: string; body: string }> = []
  await page.route('**/api/pending/*/reject', async (route, request) => {
    rejectCalls.push({ url: request.url(), body: request.postData() ?? '' })
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  })

  await page.goto('/#inbox')
  await page.waitForSelector('[data-testid="inbox-mobile"]', { timeout: 10_000 })

  await test.step('click Skip', async () => {
    await page.locator('button:has-text("Skip")').click()
  })

  await test.step('sheet appears with Skipped heading and Next button', async () => {
    // Sheet slides up after card animation (allow some time)
    await expect(page.locator('text=/Skipped/')).toBeVisible({ timeout: 2000 })
    await expect(page.locator('button:has-text("Next")')).toBeVisible()
    // No countdown text
    const bodyText = await page.locator('body').textContent()
    expect(bodyText).not.toMatch(/auto-closes/i)
  })

  await test.step('select chip and click Next', async () => {
    await page.locator('button:has-text("Location")').first().click()
    await page.locator('button:has-text("Next")').click()
  })

  await test.step('POST /reject fired with reason', async () => {
    await page.waitForTimeout(300)
    expect(rejectCalls.length).toBeGreaterThanOrEqual(1)
    expect(rejectCalls[0].body).toContain('Location')
  })

  await test.step('screenshot', async () => {
    await page.screenshot({
      path: 'e2e/fixtures/screenshots/inbox-mobile-skip-sheet.png',
      fullPage: false,
    })
  })
})

// ── Mobile: Wave 8A — Cleared state after all cards triaged ───────────────

test('mobile — cleared state renders decision list after all cards approved', async ({ page, isMobile }) => {
  if (!isMobile) { test.skip(); return }

  // Seed only 2 pending entries for a quick triage session
  const twoEntryData: AppData = {
    properties: [],
    pending: [pendingEntry1, pendingEntry2],
    last_check: '2026-08-07T20:00:00Z',
    next_check: '2026-08-07T22:40:00Z',
  }

  await mockAppData(page, twoEntryData)
  await mockSettings(page, fullSettings)
  await mockGeoEndpoints(page)

  await page.route('**/api/pending/*/approve', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) }),
  )

  await page.goto('/#inbox')
  await page.waitForSelector('[data-testid="inbox-mobile"]', { timeout: 10_000 })

  await test.step('approve card 1', async () => {
    await page.locator('button:has-text("Look closer")').click()
    await page.waitForTimeout(400)
  })

  await test.step('approve card 2', async () => {
    await expect(page.locator('text=Cozy studio near Viru Gate')).toBeVisible({ timeout: 2000 })
    await page.locator('button:has-text("Look closer")').click()
    await page.waitForTimeout(400)
  })

  await test.step('cleared state is shown', async () => {
    await expect(page.locator('text=Inbox clear')).toBeVisible({ timeout: 3000 })
  })

  await test.step('decision list shows 2 entries', async () => {
    // Both approved entries appear in list
    const body = await page.locator('body').textContent()
    expect(body).toContain('Spacious 2BR in Kesklinn')
    expect(body).toContain('Cozy studio near Viru Gate')
    // Shortlisted outcome tags
    expect(body?.match(/shortlisted/gi)?.length ?? 0).toBeGreaterThanOrEqual(2)
  })

  await test.step('Open shortlist button is visible', async () => {
    await expect(page.locator('button:has-text("Open shortlist")')).toBeVisible()
  })

  await test.step('screenshot', async () => {
    await page.screenshot({
      path: 'e2e/fixtures/screenshots/inbox-mobile-cleared.png',
      fullPage: false,
    })
  })
})

// ── Mobile: Bottom nav visible ─────────────────────────────────────────────

test('mobile — bottom nav dock is visible', async ({ page, isMobile }) => {
  if (!isMobile) { test.skip(); return }

  await mockAppData(page, appDataWithPending)
  await mockSettings(page, fullSettings)
  await mockGeoEndpoints(page)

  await page.goto('/#inbox')
  await page.waitForSelector('[data-testid="inbox-mobile"]', { timeout: 10_000 })

  // Bottom nav should have the 4 navigation items
  const nav = page.locator('nav[aria-label="Main navigation"]')
  await expect(nav).toBeVisible()

  const navItems = ['Overview', 'Inbox', 'Shortlist', 'Settings']
  for (const label of navItems) {
    await expect(nav.locator(`text=${label}`)).toBeVisible()
  }
})
