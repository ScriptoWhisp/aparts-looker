/**
 * MSW request handlers for /api/* endpoints.
 *
 * Default handlers return realistic data from fixtures.
 * Individual tests override via server.use(http.get(...)) for edge cases.
 */

import { http, HttpResponse } from 'msw'
import {
  mockAppDataFull,
  mockChecklistRegistry,
  mockSettingsFull,
  mockFeedbackList,
  mockUserFinanceSettingsConfigured,
  mockFinanceCalculationGreen,
} from './fixtures'

export const handlers = [
  // ── Core data ────────────────────────────────────────────────────────────
  http.get('/api/data', () => {
    return HttpResponse.json(mockAppDataFull)
  }),

  http.get('/api/settings', () => {
    return HttpResponse.json(mockSettingsFull)
  }),

  http.get('/api/checklist-registry', () => {
    return HttpResponse.json(mockChecklistRegistry)
  }),

  // ── Geo endpoints ────────────────────────────────────────────────────────
  http.get('/api/isochrone', () => {
    return HttpResponse.json({ type: 'FeatureCollection', features: [] })
  }),

  http.get('/api/districts', () => {
    return HttpResponse.json({
      districts: [
        { name: 'Kesklinn', avg_price_per_sqm: 4200, count: 12 },
        { name: 'Kadriorg', avg_price_per_sqm: 3800, count: 5 },
      ],
    })
  }),

  // ── Entry action endpoints ───────────────────────────────────────────────
  http.post('/api/pending/:id/approve', () => {
    return HttpResponse.json({ ok: true })
  }),

  http.post('/api/pending/:id/reject', () => {
    return HttpResponse.json({ ok: true })
  }),

  http.post('/api/entry/:id/schedule-viewing', () => {
    return HttpResponse.json({ ok: true })
  }),

  http.post('/api/entry/:id/mark-viewed', () => {
    return HttpResponse.json({ ok: true })
  }),

  http.post('/api/entry/:id/viewing-decision', () => {
    return HttpResponse.json({ ok: true, new_status: 'still-in' })
  }),

  http.post('/api/entry/:id/cost-override', () => {
    return HttpResponse.json({ ok: true })
  }),

  http.post('/api/entry/:id/regenerate-brief', () => {
    return HttpResponse.json({ ok: true })
  }),

  http.post('/api/entry/:id/regenerate-description', () => {
    return HttpResponse.json({ ok: true })
  }),

  http.post('/api/entry/:id/refresh-ku', () => {
    return HttpResponse.json({ ok: true })
  }),

  http.patch('/api/entry/:id/checklist-item', async ({ request }) => {
    const body = (await request.json()) as { key: string; state?: string | null; note?: string | null }
    return HttpResponse.json({
      ok: true,
      user_marks: { [body.key]: { state: body.state ?? undefined, note: body.note ?? undefined } },
    })
  }),

  // ── Settings save ────────────────────────────────────────────────────────
  http.post('/api/settings', () => {
    return HttpResponse.json({ applied: {}, errors: [] })
  }),

  // ── Admin ────────────────────────────────────────────────────────────────
  http.post('/api/check-now', () => {
    return HttpResponse.json({ ok: true })
  }),

  // ── Feedback ─────────────────────────────────────────────────────────────
  http.get('/api/feedback', () => {
    return HttpResponse.json({ feedback: mockFeedbackList, count: mockFeedbackList.length })
  }),

  http.get('/api/feedback/:id', ({ params }) => {
    const found = mockFeedbackList.find((f) => f.id === params.id)
    if (!found) return new HttpResponse(null, { status: 404 })
    return HttpResponse.json(found)
  }),

  http.post('/api/feedback', () => {
    return HttpResponse.json({ id: 'fb-new', created_at: '2026-08-08T12:00:00Z' })
  }),

  http.patch('/api/feedback/:id', async ({ params, request }) => {
    const body = (await request.json()) as { status?: string; comment?: string }
    const found = mockFeedbackList.find((f) => f.id === params.id)
    if (!found) return new HttpResponse(null, { status: 404 })
    return HttpResponse.json({ ...found, ...body })
  }),

  http.delete('/api/feedback/:id', () => {
    return HttpResponse.json({ ok: true })
  }),

  // ── Finance calculator (Wave B) ─────────────────────────────────────────
  http.get('/api/user-finance-settings', () => {
    return HttpResponse.json(mockUserFinanceSettingsConfigured)
  }),

  http.put('/api/user-finance-settings', async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>
    return HttpResponse.json({ ...mockUserFinanceSettingsConfigured, ...body, is_persisted: true })
  }),

  http.get('/api/entry/:id/finance-calculation', () => {
    return HttpResponse.json(mockFinanceCalculationGreen)
  }),

  http.patch('/api/entry/:id/finance-inputs', async ({ request }) => {
    const body = (await request.json()) as Record<string, number | null>
    return HttpResponse.json({
      utilities_eur_monthly: null,
      remondifond_eur_monthly: null,
      first_purchases_eur: null,
      override_ask_eur: null,
      ...body,
    })
  }),
]
