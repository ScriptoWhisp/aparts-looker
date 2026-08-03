/**
 * Thin fetch wrapper for all /api/* calls.
 *
 * All responses are typed; callers should handle errors via TanStack Query's
 * error state rather than try/catch here.
 */

import type { AppData, SettingsData } from '../types/api'

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => `HTTP ${res.status}`)
    throw new Error(`API ${path} failed [${res.status}]: ${text}`)
  }
  return res.json() as Promise<T>
}

// ── Data ──────────────────────────────────────────────────────────────────

export function fetchAppData(): Promise<AppData> {
  return apiFetch<AppData>('/api/data')
}

export function fetchSettings(): Promise<SettingsData> {
  return apiFetch<SettingsData>('/api/settings')
}

// ── Pending flow ──────────────────────────────────────────────────────────

export function approveEntry(id: string): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`/api/pending/${id}/approve`, { method: 'POST' })
}

export function rejectEntry(id: string, reason?: string): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`/api/pending/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify({ reason: reason ?? null }),
  })
}

// ── Entry actions ─────────────────────────────────────────────────────────

export function scheduleViewing(id: string, at: string): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`/api/entry/${id}/schedule-viewing`, {
    method: 'POST',
    body: JSON.stringify({ scheduled_at: at }),
  })
}

export function markViewed(id: string): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`/api/entry/${id}/mark-viewed`, { method: 'POST' })
}

export function viewingDecision(
  id: string,
  decision: 'still-in' | 'thinking' | 'drop',
  reason?: string,
): Promise<{ ok: boolean; new_status: string }> {
  return apiFetch<{ ok: boolean; new_status: string }>(
    `/api/entry/${id}/viewing-decision`,
    {
      method: 'POST',
      body: JSON.stringify({ decision, reason: reason ?? null }),
    },
  )
}

// ── Admin ─────────────────────────────────────────────────────────────────

export function triggerCheck(): Promise<{ ok: boolean; message?: string }> {
  return apiFetch<{ ok: boolean; message?: string }>('/api/check-now', { method: 'POST' })
}
