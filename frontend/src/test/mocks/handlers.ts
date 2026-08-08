/**
 * MSW request handlers for /api/* endpoints.
 *
 * Default handlers return realistic data from fixtures.
 * Individual tests override via server.use(http.get(...)) for edge cases.
 */

import { http, HttpResponse } from 'msw'
import {
  mockAppDataFull,
  mockSettingsFull,
} from './fixtures'

export const handlers = [
  // ── Core data ────────────────────────────────────────────────────────────
  http.get('/api/data', () => {
    return HttpResponse.json(mockAppDataFull)
  }),

  http.get('/api/settings', () => {
    return HttpResponse.json(mockSettingsFull)
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
]
