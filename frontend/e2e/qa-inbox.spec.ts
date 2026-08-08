/**
 * qa-inbox.spec.ts — Proactive QA sweep additions for the Inbox tab.
 *
 * Fills gaps left by the pre-sweep inbox.spec.ts: highest-score ring, keyboard
 * S shortcut, Undo after skip, swipe-down-dismiss-as-skip, Later cycling,
 * and drag-gesture equivalents of the Look closer / Skip buttons.
 *
 * See docs/qa/user-flows.md for the full flow list.
 */

import { test, expect, type Page } from '@playwright/test'
import {
  mockAppData,
  mockSettings,
  mockGeoEndpoints,
  fullSettings,
  appDataWithPending,
  pendingEntry1,
  pendingEntry2,
  pendingEntry3,
} from './fixtures/seed'
import type { AppData } from '../src/types/api'

function attachConsoleWatcher(page: Page): () => string[] {
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(err.message))
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  return () => errors
}

/**
 * Drag from (startX, startY) horizontally by `deltaX` px, spread over real
 * wall-clock time (small waits between move steps). Framer Motion's drag
 * gesture (PanSession) tracks pointer velocity/timing, not just final
 * offset — a single `mouse.move` with Playwright's `steps` interpolation
 * fires all sub-events essentially synchronously with no elapsed time
 * between them, which the gesture recognizer doesn't reliably pick up as
 * an actual drag. Spreading 10 small moves over ~300ms mirrors a real
 * finger swipe closely enough for Framer Motion to register it.
 */
async function dragCardHorizontally(page: Page, startX: number, startY: number, deltaX: number) {
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  const steps = 10
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(startX + (deltaX * i) / steps, startY, { steps: 1 })
    await page.waitForTimeout(30)
  }
  await page.mouse.up()
}

// ── Desktop: highest-score card ring ────────────────────────────────────────

test('desktop — highest-score card has ring accent class', async ({ page, isMobile }) => {
  if (isMobile) { test.skip(); return }
  await mockAppData(page, appDataWithPending)
  await mockSettings(page, fullSettings)
  await mockGeoEndpoints(page)

  await page.goto('/#inbox')
  await page.waitForSelector('[role="article"]', { timeout: 10_000 })

  // pendingEntry1 (score 82) is the highest of the 3 fixture entries and is
  // pre-sorted first by selectInbox(). Its card should carry the ring class.
  const firstCard = page.locator('[role="article"]').first()
  const cls = await firstCard.getAttribute('class') ?? ''
  expect(cls).toMatch(/ring-1|ring-2/)
})

// ── Desktop: keyboard S shortcut ────────────────────────────────────────────

test('desktop — keyboard S opens skip modal on selected card', async ({ page, isMobile }) => {
  if (isMobile) { test.skip(); return }
  await mockAppData(page, appDataWithPending)
  await mockSettings(page, fullSettings)
  await mockGeoEndpoints(page)

  await page.goto('/#inbox')
  await page.waitForSelector('[role="article"]', { timeout: 10_000 })

  await page.keyboard.press('s')
  await expect(page.locator('text=Skipped — what put you off?')).toBeVisible({ timeout: 3_000 })
})

// ── Mobile: Undo restores skipped card to queue head ────────────────────────

test('mobile — Skip, Undo restores the card as the front card again', async ({ page, isMobile }) => {
  if (!isMobile) { test.skip(); return }
  const getErrors = attachConsoleWatcher(page)

  await mockAppData(page, appDataWithPending)
  await mockSettings(page, fullSettings)
  await mockGeoEndpoints(page)

  let rejectFired = false
  await page.route('**/api/pending/*/reject', (route) => {
    rejectFired = true
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  })

  await page.goto('/#inbox')
  await page.waitForSelector('[data-testid="inbox-mobile"]', { timeout: 10_000 })

  await test.step('skip first card', async () => {
    await expect(page.locator('text=' + pendingEntry1.title)).toBeVisible()
    await page.locator('button:has-text("Skip")').click()
    await expect(page.locator('text=/Skipped/')).toBeVisible({ timeout: 3_000 })
  })

  await test.step('tap Undo — no reject fired, card is restored', async () => {
    await page.locator('button:has-text("Undo")').click()
    await expect(page.locator('text=/Skipped/')).not.toBeVisible({ timeout: 3_000 })
    await expect(page.locator('text=' + pendingEntry1.title)).toBeVisible({ timeout: 3_000 })
    expect(rejectFired).toBe(false)
  })

  expect(getErrors().filter((e) => !e.includes('leaflet'))).toHaveLength(0)
})

// ── Mobile: swipe-down dismiss (Escape as the sheet-close signal) treated as skip-no-reason ─

test('mobile — dismissing the skip sheet without Next/Undo commits skip-no-reason and advances', async ({ page, isMobile }) => {
  if (!isMobile) { test.skip(); return }

  await mockAppData(page, appDataWithPending)
  await mockSettings(page, fullSettings)
  await mockGeoEndpoints(page)

  const rejectCalls: Array<{ body: string }> = []
  await page.route('**/api/pending/*/reject', async (route, request) => {
    rejectCalls.push({ body: request.postData() ?? '' })
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  })

  await page.goto('/#inbox')
  await page.waitForSelector('[data-testid="inbox-mobile"]', { timeout: 10_000 })

  await page.locator('button:has-text("Skip")').click()
  await expect(page.locator('text=/Skipped/')).toBeVisible({ timeout: 3_000 })

  // vaul's Drawer.Root closes on Escape by default (same onOpenChange(false) path a
  // swipe-down dismiss takes) without going through the explicit Next/Undo handlers —
  // this exercises the "swipe-down = commit skip with no reason" branch in
  // InboxMobile's onOpenChange handler.
  await page.keyboard.press('Escape')

  await test.step('sheet closes and reject fires with no reason', async () => {
    await expect(page.locator('text=/Skipped/')).not.toBeVisible({ timeout: 3_000 })
    await page.waitForFunction(() => true)
    expect(rejectCalls.length).toBeGreaterThanOrEqual(1)
    expect(rejectCalls[0].body).toContain('"reason":null')
  })

  await test.step('queue advanced to next card', async () => {
    await expect(page.locator('text=' + pendingEntry2.title)).toBeVisible({ timeout: 3_000 })
  })
})

// ── Mobile: Later cycles without a backend call ─────────────────────────────

test('mobile — Later moves the card to the end of the queue with no network call', async ({ page, isMobile }) => {
  if (!isMobile) { test.skip(); return }

  const threeEntryData: AppData = {
    properties: [],
    pending: [pendingEntry1, pendingEntry2, pendingEntry3],
    last_check: null,
    next_check: null,
  }
  await mockAppData(page, threeEntryData)
  await mockSettings(page, fullSettings)
  await mockGeoEndpoints(page)

  let anyDecisionCall = false
  await page.route('**/api/pending/*/approve', (route) => { anyDecisionCall = true; return route.fulfill({ contentType: 'application/json', body: '{}' }) })
  await page.route('**/api/pending/*/reject', (route) => { anyDecisionCall = true; return route.fulfill({ contentType: 'application/json', body: '{}' }) })

  await page.goto('/#inbox')
  await page.waitForSelector('[data-testid="inbox-mobile"]', { timeout: 10_000 })

  await test.step('tap Later on card 1', async () => {
    await expect(page.locator('text=' + pendingEntry1.title)).toBeVisible()
    await page.locator('button:has-text("Later")').click()
  })

  await test.step('card 2 is now the front card, no network call fired', async () => {
    await expect(page.locator('text=' + pendingEntry2.title)).toBeVisible({ timeout: 3_000 })
    expect(anyDecisionCall).toBe(false)
  })
})

// ── Mobile: drag gestures ────────────────────────────────────────────────────

test('mobile — dragging the front card right past threshold approves it (same as Look closer)', async ({ page, isMobile }) => {
  if (!isMobile) { test.skip(); return }

  await mockAppData(page, appDataWithPending)
  await mockSettings(page, fullSettings)
  await mockGeoEndpoints(page)

  let approveFired = false
  await page.route('**/api/pending/*/approve', (route) => {
    approveFired = true
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  })

  await page.goto('/#inbox')
  await page.waitForSelector('[data-testid="inbox-mobile"]', { timeout: 10_000 })

  // SwipeCard is the top (front) draggable card in the stack — a stable, unique selector regardless of DOM nesting.
  const card = page.locator('.cursor-grab').first()
  const box = await card.boundingBox()
  if (!box) throw new Error('card bounding box not found')

  const startX = box.x + box.width / 2
  const startY = box.y + box.height / 2

  // Past SWIPE_THRESHOLD_PX (80).
  await dragCardHorizontally(page, startX, startY, 150)

  await page.waitForFunction(() => true)
  await expect.poll(() => approveFired, { timeout: 3_000 }).toBe(true)
})

test('mobile — dragging the front card left past threshold opens the skip sheet', async ({ page, isMobile }) => {
  if (!isMobile) { test.skip(); return }

  await mockAppData(page, appDataWithPending)
  await mockSettings(page, fullSettings)
  await mockGeoEndpoints(page)

  await page.goto('/#inbox')
  await page.waitForSelector('[data-testid="inbox-mobile"]', { timeout: 10_000 })

  // SwipeCard is the top (front) draggable card in the stack — a stable, unique selector regardless of DOM nesting.
  const card = page.locator('.cursor-grab').first()
  const box = await card.boundingBox()
  if (!box) throw new Error('card bounding box not found')

  const startX = box.x + box.width / 2
  const startY = box.y + box.height / 2

  await dragCardHorizontally(page, startX, startY, -150)

  await expect(page.locator('text=/Skipped/')).toBeVisible({ timeout: 3_000 })
})
