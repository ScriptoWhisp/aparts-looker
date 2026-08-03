/**
 * TanStack Query hooks for server state.
 *
 * Server state (API data, settings) lives here.
 * UI state (active tab, selected listing) lives in lib/state.ts (Zustand).
 *
 * Refresh interval: 30 seconds for app data.
 * Stale time: 20 seconds — data is considered fresh for 20s after last fetch.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchAppData, fetchSettings } from './api'
import type { AppData, Entry, SettingsData } from '../types/api'

// ── Query keys ─────────────────────────────────────────────────────────────
export const QUERY_KEYS = {
  appData:  ['appData']  as const,
  settings: ['settings'] as const,
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

// ── Manual refresh helper ──────────────────────────────────────────────────
export function useRefreshAll() {
  const client = useQueryClient()
  return () => {
    void client.invalidateQueries({ queryKey: QUERY_KEYS.appData })
    void client.invalidateQueries({ queryKey: QUERY_KEYS.settings })
  }
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
