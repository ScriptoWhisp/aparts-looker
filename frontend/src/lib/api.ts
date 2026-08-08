/**
 * Thin fetch wrapper for all /api/* calls.
 *
 * All responses are typed; callers should handle errors via TanStack Query's
 * error state rather than try/catch here.
 */

import type {
  AppData,
  ChecklistRegistryResponse,
  Feedback,
  FeedbackCreateResponse,
  FeedbackListResponse,
  FeedbackStatus,
  FeedbackType,
  FinanceCalculation,
  FinanceInputs,
  SettingsData,
  UserFinanceSettings,
} from '../types/api'

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

/** Like apiFetch but never sets Content-Type — required for multipart/form-data
 * (FormData) requests where the browser must set the boundary itself. */
async function apiFetchForm<T>(path: string, body: FormData, method = 'POST'): Promise<T> {
  const res = await fetch(path, { method, body })
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

// ── Checklist registry (Wave A) ─────────────────────────────────────────────

export function fetchChecklistRegistry(): Promise<ChecklistRegistryResponse> {
  return apiFetch<ChecklistRegistryResponse>('/api/checklist-registry')
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

// ── Negotiation brief ─────────────────────────────────────────────────────

export function regenerateBrief(id: string): Promise<{ ok: boolean; message?: string }> {
  return apiFetch<{ ok: boolean; message?: string }>(
    `/api/entry/${id}/regenerate-brief`,
    { method: 'POST' },
  )
}

// ── KÜ refresh ────────────────────────────────────────────────────────────

export function refreshKu(id: string): Promise<{ ok: boolean; message?: string }> {
  return apiFetch<{ ok: boolean; message?: string }>(
    `/api/entry/${id}/refresh-ku`,
    { method: 'POST' },
  )
}

// ── Cost override / own score ─────────────────────────────────────────────

export function saveOwnScore(id: string, ownScore: number): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`/api/entry/${id}/cost-override`, {
    method: 'POST',
    body: JSON.stringify({ own_score: ownScore }),
  })
}

// ── Checklist item marks ──────────────────────────────────────────────────

export interface ChecklistItemPatch {
  key: string
  state?: 'ok' | 'flag' | 'unknown' | 'skip' | null
  note?: string | null
}

export function patchChecklistItem(
  id: string,
  payload: ChecklistItemPatch,
): Promise<{ ok: boolean; user_marks: Record<string, { state?: string; note?: string; marked_at?: string }> }> {
  return apiFetch(`/api/entry/${id}/checklist-item`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

// ── Settings save ─────────────────────────────────────────────────────────

export function saveSettings(values: Record<string, unknown>): Promise<{ applied: Record<string, unknown>; errors: string[] }> {
  return apiFetch<{ applied: Record<string, unknown>; errors: string[] }>('/api/settings', {
    method: 'POST',
    body: JSON.stringify(values),
  })
}

// ── Finance calculator (Wave B) ─────────────────────────────────────────────

export function fetchUserFinanceSettings(): Promise<UserFinanceSettings> {
  return apiFetch<UserFinanceSettings>('/api/user-finance-settings')
}

export function putUserFinanceSettings(
  settings: Partial<UserFinanceSettings>,
): Promise<UserFinanceSettings> {
  return apiFetch<UserFinanceSettings>('/api/user-finance-settings', {
    method: 'PUT',
    body: JSON.stringify(settings),
  })
}

export function patchFinanceInputs(
  id: string,
  inputs: Partial<FinanceInputs>,
): Promise<FinanceInputs> {
  return apiFetch<FinanceInputs>(`/api/entry/${id}/finance-inputs`, {
    method: 'PATCH',
    body: JSON.stringify(inputs),
  })
}

export function fetchFinanceCalculation(id: string): Promise<FinanceCalculation> {
  return apiFetch<FinanceCalculation>(`/api/entry/${id}/finance-calculation`)
}

// ── Admin ─────────────────────────────────────────────────────────────────

export function triggerCheck(): Promise<{ ok: boolean; message?: string }> {
  return apiFetch<{ ok: boolean; message?: string }>('/api/check-now', { method: 'POST' })
}

// ── Feedback ──────────────────────────────────────────────────────────────

export interface SubmitFeedbackPayload {
  type: FeedbackType
  comment: string
  url: string
  viewport: string
  userAgent: string
  consoleLogs: unknown[]
  screenshot: Blob | null
}

export function submitFeedback(payload: SubmitFeedbackPayload): Promise<FeedbackCreateResponse> {
  const form = new FormData()
  form.set('type', payload.type)
  form.set('comment', payload.comment)
  form.set('url', payload.url)
  form.set('viewport', payload.viewport)
  form.set('user_agent', payload.userAgent)
  form.set('console_logs', JSON.stringify(payload.consoleLogs))
  if (payload.screenshot) {
    form.set('screenshot', payload.screenshot, 'screenshot.png')
  }
  return apiFetchForm<FeedbackCreateResponse>('/api/feedback', form)
}

export interface FeedbackFilters {
  status?: FeedbackStatus | 'all'
  type?: FeedbackType | 'all'
}

export function fetchFeedback(filters?: FeedbackFilters): Promise<FeedbackListResponse> {
  const params = new URLSearchParams()
  if (filters?.status && filters.status !== 'all') params.set('status', filters.status)
  if (filters?.type && filters.type !== 'all') params.set('type', filters.type)
  const qs = params.toString()
  return apiFetch<FeedbackListResponse>(`/api/feedback${qs ? `?${qs}` : ''}`)
}

export function fetchFeedbackOne(id: string): Promise<Feedback> {
  return apiFetch<Feedback>(`/api/feedback/${id}`)
}

export function patchFeedback(
  id: string,
  patch: { status?: FeedbackStatus; comment?: string },
): Promise<Feedback> {
  return apiFetch<Feedback>(`/api/feedback/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

export function deleteFeedback(id: string): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`/api/feedback/${id}`, { method: 'DELETE' })
}

export function feedbackScreenshotUrl(id: string): string {
  return `/api/feedback/${id}/screenshot`
}
