import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright E2E config.
 *
 * Two projects:
 *   chromium-desktop — 1440×900 desktop Chrome
 *   webkit-mobile    — iPhone 13 WebKit (closest to iOS Safari)
 *
 * baseURL defaults to local Docker stack (http://127.0.0.1:8000).
 * Override: E2E_BASE_URL=https://aparts.example.com npm run e2e
 *
 * No webServer config — assumes `docker compose up -d` is already running.
 * Workflow: docker compose up -d && sleep 4 && npm run e2e
 *
 * All tests use Playwright's route interception (mockAppData / mockSettings)
 * for deterministic data — no live DB writes required.
 */

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
  ],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:8000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium-desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: 'webkit-mobile',
      use: { ...devices['iPhone 13'] },
    },
  ],
})
