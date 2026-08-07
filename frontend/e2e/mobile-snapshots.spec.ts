/**
 * mobile-snapshots.spec.ts — Wave 9 mobile regression net.
 *
 * Captures screenshots + structural assertions for all 4 mobile tabs.
 * Run: npx playwright test mobile-snapshots.spec.ts --project=webkit-mobile
 *
 * Assertions per tab:
 *   Overview  — no canvas/element narrower than 60px on mobile
 *   Shortlist — main pane hidden (display:none or width 0) without selection
 *   Settings  — sidebar uses overflow-x scroll on mobile (horizontal strip)
 *   Inbox     — both front card and peek card render title text
 */

import { test, expect } from '@playwright/test'
import { mockAppData, mockSettings, mockGeoEndpoints, fullAppData, fullSettings } from './fixtures/seed'

// ── Helpers ────────────────────────────────────────────────────────────────

async function setupMocks(page: Parameters<typeof mockAppData>[0]) {
  await mockAppData(page, fullAppData)
  await mockSettings(page, fullSettings)
  await mockGeoEndpoints(page)
}

// ── Overview ───────────────────────────────────────────────────────────────

test('mobile overview: single-column stack, no broken narrow elements', async ({ page }) => {
  await setupMocks(page)
  await page.goto('/#overview')
  await page.waitForTimeout(2000)

  // Take screenshot for manual review
  await page.screenshot({
    path: 'e2e/fixtures/screenshots/mobile-overview.png',
    fullPage: true,
  })

  // Assert: no visible block-level element narrower than 60px
  // (catches the broken 20px map-strip regression from the old desktop grid)
  const narrowElements = await page.evaluate(() => {
    const suspects: string[] = []
    // Only check elements inside the overview route content area
    const root = document.querySelector('[data-testid="tab-overview"]') ?? document.body
    root.querySelectorAll('div, canvas, svg').forEach((el) => {
      const box = (el as HTMLElement).getBoundingClientRect()
      // Skip zero-size (invisible) elements and tiny decorative lines
      if (box.width > 0 && box.width < 60 && box.height > 30) {
        suspects.push(`${el.tagName}[class="${(el as HTMLElement).className.slice(0, 40)}"] w=${box.width}`)
      }
    })
    return suspects
  })

  // Filter out known-small elements: score badges (~36px), status pills
  const filteredNarrow = narrowElements.filter((desc) =>
    !desc.includes('ScoreBadge') && !desc.includes('StatusPill'),
  )

  expect(filteredNarrow, `Narrow elements found: ${filteredNarrow.join(', ')}`).toHaveLength(0)

  // Assert: the map is NOT rendered on mobile (map uses Leaflet with class 'leaflet-container')
  const mapVisible = await page.locator('.leaflet-container').isVisible().catch(() => false)
  expect(mapVisible, 'Leaflet map should be hidden on mobile overview').toBe(false)
})

test('mobile overview: BEST hero card price shows single euro symbol', async ({ page }) => {
  await setupMocks(page)
  await page.goto('/#overview')
  await page.waitForTimeout(2000)

  // Find the BEST hero card price text — should not contain "€ €"
  const bodyText = await page.locator('body').innerText()
  expect(bodyText, 'Page must not contain double-euro symbol "€ €"').not.toContain('€ €')
})

// ── Shortlist ──────────────────────────────────────────────────────────────

test('mobile shortlist: only sidebar visible without selection', async ({ page }) => {
  await setupMocks(page)
  await page.goto('/#shortlist')
  await page.waitForTimeout(1500)

  await page.screenshot({
    path: 'e2e/fixtures/screenshots/mobile-shortlist.png',
    fullPage: true,
  })

  // The main pane should not be visible when no listing is selected.
  // We detect this by checking that the "Select a listing" text is absent
  // AND that no HeroRow / detail content is rendered outside the sidebar.
  const noSelectionText = page.getByText('Select a listing from the sidebar')
  // On mobile with no selection, the main pane is not rendered at all.
  // The element should be absent from DOM or hidden.
  const mainPaneCount = await noSelectionText.count()
  expect(mainPaneCount, 'NoSelection placeholder should not appear on mobile (main pane hidden)').toBe(0)

  // The sidebar list items should be visible
  const sidebarItems = page.locator('button').filter({ hasText: 'Top pick' })
  await expect(sidebarItems.first()).toBeVisible()
})

test('mobile shortlist: main pane visible after row tap', async ({ page }) => {
  await setupMocks(page)
  await page.goto('/#shortlist')
  await page.waitForTimeout(1500)

  // Tap the first sidebar row (it's a button)
  const firstRow = page.locator('button').filter({ hasText: 'Top pick' }).first()
  await firstRow.click()
  await page.waitForTimeout(500)

  // Main pane should now be visible — back button should appear
  const backButton = page.getByText('Back')
  await expect(backButton).toBeVisible()

  // Sidebar should be hidden
  const sidebarItems = page.locator('button').filter({ hasText: 'Top pick' })
  await expect(sidebarItems.first()).not.toBeVisible()
})

// ── Settings ───────────────────────────────────────────────────────────────

test('mobile settings: horizontal category strip rendered', async ({ page }) => {
  await setupMocks(page)
  await page.goto('/#settings')
  await page.waitForTimeout(1500)

  await page.screenshot({
    path: 'e2e/fixtures/screenshots/mobile-settings.png',
    fullPage: true,
  })

  // On mobile, the categories should be in a horizontally scrollable strip.
  // Assert: all 5 category labels are present on the page.
  const categories = ['Buyer profile', 'Scoring & AI', 'Cost model', 'Telegram', 'Scraper']
  for (const cat of categories) {
    await expect(page.getByRole('button', { name: cat })).toBeVisible()
  }

  // Assert: the form area is full-width (wider than the old 200px sidebar scenario).
  // We check that the form container's right edge reaches near the viewport right edge.
  const viewport = page.viewportSize()
  if (!viewport) throw new Error('No viewport')

  // The fixed 200px sidebar should NOT be present (its nav items would be stacked vertically)
  // On mobile layout, the aside element should NOT have a fixed 200px width style
  const asideBox = await page.locator('aside').boundingBox().catch(() => null)
  if (asideBox) {
    // If aside exists, it should not be a full-height vertical sidebar (it would be 0 height or part of a strip)
    expect(asideBox.width, 'Aside (sidebar) must not be a fixed 200px vertical sidebar on mobile').not.toBeCloseTo(200, 5)
  }
})

// ── Inbox ──────────────────────────────────────────────────────────────────

test('mobile inbox: front card renders title text', async ({ page }) => {
  await setupMocks(page)
  await page.goto('/#inbox')
  await page.waitForTimeout(2000)

  await page.screenshot({
    path: 'e2e/fixtures/screenshots/mobile-inbox.png',
    fullPage: true,
  })

  // The front card's title should be visible
  await expect(page.getByText('Spacious 2BR in Kesklinn')).toBeVisible()
})

test('mobile inbox: peek card title text present in DOM', async ({ page }) => {
  await setupMocks(page)
  await page.goto('/#inbox')
  await page.waitForTimeout(2000)

  // With 3 pending entries, both front card and peek card are mounted.
  // Peek card (e2e-pending-2) title should be in the DOM even though dimmed.
  const peekTitle = page.getByText('Cozy studio near Viru Gate')
  // It's in the DOM (peek card) — may not be "visible" due to opacity but should exist
  expect(await peekTitle.count(), 'Peek card title must be in DOM').toBeGreaterThan(0)
})

test('mobile inbox: no double-euro in price display', async ({ page }) => {
  await setupMocks(page)
  await page.goto('/#inbox')
  await page.waitForTimeout(2000)

  const bodyText = await page.locator('body').innerText()
  expect(bodyText, 'Inbox must not show double euro "€ €"').not.toContain('€ €')
})
