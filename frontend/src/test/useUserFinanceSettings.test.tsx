/**
 * useUserFinanceSettings.test.tsx — Wave B finance settings hooks.
 *
 * Tests:
 * - useUserFinanceSettings returns column defaults (is_persisted=false) on
 *   a fresh DB (no PUT has ever happened)
 * - usePutUserFinanceSettings round-trips a save and updates the cache
 */

import { describe, it, expect } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server } from './mocks/server'
import { useUserFinanceSettings, usePutUserFinanceSettings } from '@/lib/queries'
import { mockUserFinanceSettingsUnconfigured } from './mocks/fixtures'
import type { ReactNode } from 'react'

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

describe('useUserFinanceSettings', () => {
  it('returns column defaults with is_persisted=false on a fresh DB', async () => {
    server.use(
      http.get('/api/user-finance-settings', () => HttpResponse.json(mockUserFinanceSettingsUnconfigured)),
    )
    const { result } = renderHook(() => useUserFinanceSettings(), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.is_persisted).toBe(false)
    expect(result.current.data?.monthly_income_eur).toBeNull()
    expect(result.current.data?.down_payment_pct).toBe(15)
    expect(result.current.data?.rate_scenarios_pct).toEqual([1.6, 1.7, 1.8])
  })
})

describe('usePutUserFinanceSettings', () => {
  it('PUTs the payload and returns the persisted response', async () => {
    let putBody: unknown = null
    server.use(
      http.put('/api/user-finance-settings', async ({ request }) => {
        putBody = await request.json()
        return HttpResponse.json({
          ...mockUserFinanceSettingsUnconfigured,
          ...(putBody as object),
          is_persisted: true,
        })
      }),
    )
    const { result } = renderHook(() => usePutUserFinanceSettings(), { wrapper })

    act(() => {
      result.current.mutate({ monthly_income_eur: 3500, total_savings_eur: 40000 })
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(putBody).toEqual({ monthly_income_eur: 3500, total_savings_eur: 40000 })
    expect(result.current.data?.is_persisted).toBe(true)
    expect(result.current.data?.monthly_income_eur).toBe(3500)
  })
})
