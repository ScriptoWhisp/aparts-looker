/**
 * feedback.spec.ts — floating button, drawer submit, and the #feedback list.
 *
 * Submit flow hits the REAL backend (not mocked) so it exercises the actual
 * multipart POST + html2canvas capture end-to-end, matching the acceptance
 * manual-smoke steps. The created report is deleted at the end of the test
 * so repeated CI runs don't accumulate rows.
 */

import { test, expect } from '@playwright/test'
import { mockAppData, mockGeoEndpoints, emptyAppData } from './fixtures/seed'

test('floating feedback button is visible on every main tab', async ({ page }) => {
  await mockAppData(page, emptyAppData)
  await mockGeoEndpoints(page)

  for (const hash of ['#overview', '#inbox', '#shortlist', '#settings']) {
    await page.goto(`/${hash}`)
    await expect(page.getByRole('button', { name: /report feedback/i })).toBeVisible({ timeout: 10_000 })
  }
})

test('clicking the floating button opens the drawer with type chips and comment field', async ({ page }) => {
  await mockAppData(page, emptyAppData)
  await mockGeoEndpoints(page)
  await page.goto('/#shortlist')

  const button = page.getByRole('button', { name: /report feedback/i })
  await expect(button).toBeVisible()
  await button.click()

  await expect(page.getByText('Report feedback')).toBeVisible({ timeout: 5_000 })
  await expect(page.getByRole('radio', { name: /bug/i })).toBeVisible()
  await expect(page.getByRole('radio', { name: /feature/i })).toBeVisible()
  await expect(page.getByRole('radio', { name: /^ux/i })).toBeVisible()
  await expect(page.getByRole('radio', { name: /performance/i })).toBeVisible()
  await expect(page.getByLabel(/what's going on/i)).toBeVisible()

  await test.step('screenshot', async () => {
    await page.screenshot({ path: 'e2e/fixtures/screenshots/feedback-drawer.png', fullPage: false })
  })
})

test('submitting feedback shows a toast and the report appears in the Feedback list', async ({ page }) => {
  await mockAppData(page, emptyAppData)
  await mockGeoEndpoints(page)
  await page.goto('/#shortlist')

  const uniqueComment = `e2e test report ${Date.now()}`

  await page.getByRole('button', { name: /report feedback/i }).click()
  await expect(page.getByText('Report feedback')).toBeVisible({ timeout: 5_000 })

  await page.getByRole('radio', { name: /feature/i }).click()
  await page.getByLabel(/what's going on/i).fill(uniqueComment)
  await page.getByRole('button', { name: /^submit$/i }).click()

  // Toast appears
  await expect(page.getByText(/reported/i)).toBeVisible({ timeout: 10_000 })

  // Navigate to the Feedback tab and confirm the new report is at the top.
  await page.goto('/#feedback')
  await expect(page.getByText(uniqueComment)).toBeVisible({ timeout: 10_000 })

  await test.step('open detail and clean up', async () => {
    await page.getByText(uniqueComment).click()
    await expect(page.getByText('Feedback detail')).toBeVisible()
    await expect(page.getByRole('button', { name: /copy report url for claude/i })).toBeVisible()

    // Clean up: delete the report this test created so re-runs stay deterministic.
    page.once('dialog', (dialog) => void dialog.accept())
    await page.getByRole('button', { name: /delete feedback/i }).click()
    await expect(page.getByText(uniqueComment)).toHaveCount(0, { timeout: 10_000 })
  })
})
