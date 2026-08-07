/**
 * MSW Node server — used in the Vitest jsdom test environment.
 *
 * Import this in setup.ts to activate request interception for all tests.
 */

import { setupServer } from 'msw/node'
import { handlers } from './handlers'

export const server = setupServer(...handlers)
