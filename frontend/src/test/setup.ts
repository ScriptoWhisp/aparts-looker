/**
 * Vitest global test setup.
 *
 * - Extends expect with @testing-library/jest-dom matchers
 * - Starts MSW server before all tests, resets handlers after each test
 * - Cleans up React renders after each test
 */

import '@testing-library/jest-dom/vitest'
import { afterAll, afterEach, beforeAll } from 'vitest'
import { cleanup } from '@testing-library/react'
import { server } from './mocks/server'

// jsdom does not implement URL.createObjectURL/revokeObjectURL — provide
// no-op stubs so components that preview Blobs (e.g. FeedbackDrawer's
// screenshot thumbnail) don't crash in tests.
if (typeof URL !== 'undefined' && !URL.createObjectURL) {
  URL.createObjectURL = () => 'blob:mock-url'
}
if (typeof URL !== 'undefined' && !URL.revokeObjectURL) {
  URL.revokeObjectURL = () => {}
}

// jsdom does not implement matchMedia — provide a no-op stub.
// Tests that need mobile/desktop branching should override this per-test.
if (typeof window !== 'undefined' && !window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  })
}

// Start MSW before any test runs. onUnhandledRequest: 'error' ensures
// that if a component fires a request our handlers don't cover, the test
// fails loudly instead of silently hanging.
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  cleanup()
  server.resetHandlers()
})
afterAll(() => server.close())
