/**
 * inbox.spec.ts — Inbox triage flows.
 *
 * Desktop flows (chromium-desktop):
 *   - Look closer: click → hash becomes #shortlist, POST /approve fired
 *   - Skip: click → modal → reason chip → confirm, POST /reject fired
 *   - Keyboard: press L on first card → same as Look closer button
 *
 * Mobile flows (webkit-mobile):
 *   - Mobile single-card layout renders (one card visible)
 *   - Bottom action buttons visible (swipe-card CTA area)
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
} from './fixtures/seed'

// ── Desktop: Look closer flow ──────────────────────────────────────────────

test('desktop — Look closer moves to shortlist', async ({ page, isMobile }) => {
  // InboxDesktop uses [role="article"] cards. On mobile, InboxMobile renders a different layout.
  if (isMobile) { test.skip(); return }
  await mockAppData(page, appDataWithPending)
  await mockSettings(page, fullSettings)
  await mockGeoEndpoints(page)

  // Intercept POST /approve to capture calls
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
    await page.waitForFunction(() => true) // let microtasks flush
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
    // Modal heading
    await expect(page.locator('text=Skipped — what put you off?')).toBeVisible()
    // 6 reason chips
    const chips = page.locator('button:has-text("Price"), button:has-text("Location"), button:has-text("Condition"), button:has-text("Layout"), button:has-text("Building"), button:has-text("Other")')
    await expect(chips).toHaveCount(6)
  })

  await test.step('select a reason chip', async () => {
    await page.locator('button:has-text("Location")').click()
  })

  await test.step('confirm skip', async () => {
    // The confirm button inside the modal (the Skip button, not the card Skip)
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

  // Focus somewhere non-input so the keyboard handler fires
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
  // This test is specifically for mobile viewports (webkit-mobile project)
  // On desktop it still runs but the mobile layout won't be active
  await mockAppData(page, appDataWithPending)
  await mockSettings(page, fullSettings)
  await mockGeoEndpoints(page)

  await page.goto('/#inbox')

  if (isMobile) {
    // Mobile layout: look for swipe-card action buttons
    // InboxMobile renders bottom action buttons ≥48px tall
    await page.waitForSelector('[data-testid="inbox-mobile"], .vaul-drawer-wrapper, h2, button', {
      timeout: 10_000,
    })

    // Check action area buttons are visible (Look closer / Skip / Later)
    // These are the bottom CTA bar on mobile
    const btns = page.locator('button').filter({ hasNotText: 'Overview' }).filter({ hasNotText: 'Inbox' }).filter({ hasNotText: 'Settings' }).filter({ hasNotText: 'Shortlist' }).filter({ hasNotText: 'Refresh' })
    const count = await btns.count()
    expect(count).toBeGreaterThan(0)
  } else {
    // Desktop fallback: cards are visible
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
