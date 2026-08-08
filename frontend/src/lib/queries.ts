/**
 * TanStack Query hooks for server state.
 *
 * Server state (API data, settings) lives here.
 * UI state (active tab, selected listing) lives in lib/state.ts (Zustand).
 *
 * Refresh interval: 30 seconds for app data.
 * Stale time: 20 seconds — data is considered fresh for 20s after last fetch.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchAppData,
  fetchChecklistRegistry,
  fetchFinanceCalculation,
  fetchSettings,
  fetchFeedback,
  fetchFeedbackOne,
  fetchUserFinanceSettings,
  patchFinanceInputs,
  putUserFinanceSettings,
  type FeedbackFilters,
} from './api'
import type {
  AppData,
  ChecklistRegistryResponse,
  Entry,
  Feedback,
  FeedbackListResponse,
  FinanceCalculation,
  FinanceInputs,
  SettingsData,
  UserFinanceSettings,
} from '../types/api'

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url} failed [${res.status}]`)
  return res.json() as Promise<T>
}

// ── Query keys ─────────────────────────────────────────────────────────────
export const QUERY_KEYS = {
  appData:   ['appData']   as const,
  settings:  ['settings']  as const,
  isochrone: ['isochrone'] as const,
  districts: ['districts'] as const,
  checklistRegistry: ['checklist-registry'] as const,
  feedback:  (filters?: FeedbackFilters) => ['feedback', filters ?? {}] as const,
  feedbackOne: (id: string) => ['feedback', 'one', id] as const,
  userFinanceSettings: ['user-finance-settings'] as const,
  financeCalculation: (id: string) => ['finance-calculation', id] as const,
}

// ── App data hook ──────────────────────────────────────────────────────────
export function useAppData() {
  return useQuery<AppData>({
    queryKey: QUERY_KEYS.appData,
    queryFn:  fetchAppData,
    refetchInterval: 30_000,
    staleTime: 20_000,
  })
}

// ── Settings hook ──────────────────────────────────────────────────────────
export function useSettings() {
  return useQuery<SettingsData>({
    queryKey: QUERY_KEYS.settings,
    queryFn:  fetchSettings,
    staleTime: 60_000,
  })
}

// ── Checklist registry hook (Wave A) ─────────────────────────────────────────
// Registry rarely changes — 1h staleTime, fetched once per session, no
// per-listing refetch.
export function useChecklistRegistry() {
  return useQuery<ChecklistRegistryResponse>({
    queryKey: QUERY_KEYS.checklistRegistry,
    queryFn:  fetchChecklistRegistry,
    staleTime: 60 * 60 * 1000,
  })
}

// ── Geo hooks ─────────────────────────────────────────────────────────────
export function useIsochrone() {
  return useQuery<object>({
    queryKey: QUERY_KEYS.isochrone,
    queryFn:  () => fetchJson<object>('/api/isochrone'),
    staleTime: 300_000, // 5 min — isochrone rarely changes
  })
}

export interface DistrictStat {
  name: string
  avg_price_per_sqm: number | null
  count: number
}
export function useDistricts() {
  return useQuery<{ districts: DistrictStat[] }>({
    queryKey: QUERY_KEYS.districts,
    queryFn:  () => fetchJson<{ districts: DistrictStat[] }>('/api/districts'),
    staleTime: 60_000,
  })
}

// ── Manual refresh helper ──────────────────────────────────────────────────
export function useRefreshAll() {
  const client = useQueryClient()
  return () => {
    void client.invalidateQueries({ queryKey: QUERY_KEYS.appData })
    void client.invalidateQueries({ queryKey: QUERY_KEYS.settings })
  }
}

// ── Feedback hooks ──────────────────────────────────────────────────────────

export function useFeedback(filters?: FeedbackFilters) {
  return useQuery<FeedbackListResponse>({
    queryKey: QUERY_KEYS.feedback(filters),
    queryFn:  () => fetchFeedback(filters),
    staleTime: 10_000,
  })
}

export function useFeedbackOne(id: string | null) {
  return useQuery<Feedback>({
    queryKey: QUERY_KEYS.feedbackOne(id ?? ''),
    queryFn:  () => fetchFeedbackOne(id as string),
    enabled: !!id,
    staleTime: 10_000,
  })
}

/** Invalidate every cached feedback query (list + detail) — call after POST/PATCH/DELETE. */
export function useInvalidateFeedback() {
  const client = useQueryClient()
  return () => {
    void client.invalidateQueries({ queryKey: ['feedback'] })
  }
}

// ── Finance calculator hooks (Wave B) ───────────────────────────────────────

export function useUserFinanceSettings() {
  return useQuery<UserFinanceSettings>({
    queryKey: QUERY_KEYS.userFinanceSettings,
    queryFn:  fetchUserFinanceSettings,
    staleTime: 60_000,
  })
}

export function useFinanceCalculation(id: string | null) {
  return useQuery<FinanceCalculation>({
    queryKey: QUERY_KEYS.financeCalculation(id ?? ''),
    queryFn:  () => fetchFinanceCalculation(id as string),
    enabled: !!id,
    staleTime: 10_000,
  })
}

export function usePutUserFinanceSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (settings: Partial<UserFinanceSettings>) => putUserFinanceSettings(settings),
    onSuccess: (data) => {
      qc.setQueryData(QUERY_KEYS.userFinanceSettings, data)
      void qc.invalidateQueries({ queryKey: ['finance-calculation'] })
    },
  })
}

export function usePatchFinanceInputs(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (inputs: Partial<FinanceInputs>) => patchFinanceInputs(id, inputs),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: QUERY_KEYS.financeCalculation(id) })
      void qc.invalidateQueries({ queryKey: QUERY_KEYS.appData })
    },
  })
}

// ── Derived data selectors ─────────────────────────────────────────────────

/** All shortlisted entries (approved, viewing_scheduled, viewed, thinking, offer_drafted, dropped) */
export function selectShortlisted(data: AppData | undefined): Entry[] {
  if (!data?.properties) return []
  return data.properties
}

/** Inbox entries (pending status), sorted by score desc */
export function selectInbox(data: AppData | undefined): Entry[] {
  if (!data?.pending) return []
  return [...data.pending].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
}

/** Best scoring approved/shortlisted entry (for Overview hero card) */
export function selectBestEntry(data: AppData | undefined): Entry | null {
  const entries = selectShortlisted(data)
  if (entries.length === 0) return null
  return entries.reduce((best, e) =>
    (e.score ?? 0) > (best.score ?? 0) ? e : best
  )
}

/** Pending count for the inbox badge */
export function selectPendingCount(data: AppData | undefined): number {
  return data?.pending?.length ?? 0
}
