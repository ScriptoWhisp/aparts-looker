/**
 * renderWithProviders — wraps components in all required React context providers.
 *
 * Creates a fresh QueryClient per call so no cache state leaks between tests.
 * Accepts an optional `queryCache` map to seed the cache before render.
 */

import { type ReactNode } from 'react'
import { render, type RenderResult } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

interface RenderOptions {
  /**
   * Seed the query cache with pre-fetched data.
   * Key: the query key array joined as a string (e.g. 'appData').
   * Use QUERY_KEYS constants from lib/queries for the key.
   */
  queryCache?: Array<{ queryKey: string[]; data: unknown }>
}

export function renderWithProviders(
  ui: ReactNode,
  options: RenderOptions = {},
): RenderResult & { queryClient: QueryClient } {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Disable retries in tests — we want immediate errors
        retry: false,
        // No background refetching during tests
        refetchOnWindowFocus: false,
        staleTime: Infinity,
      },
    },
  })

  // Seed cache if requested
  if (options.queryCache) {
    for (const { queryKey, data } of options.queryCache) {
      queryClient.setQueryData(queryKey, data)
    }
  }

  const result = render(
    <QueryClientProvider client={queryClient}>
      {ui}
    </QueryClientProvider>,
  )

  return { ...result, queryClient }
}
