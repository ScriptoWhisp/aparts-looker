/**
 * api.test.ts — submitFeedback() FormData shape, including the screenshot field.
 *
 * Uses a mocked global.fetch instead of a real MSW round-trip: jsdom's Blob
 * implementation hangs when @mswjs/interceptors reads a Blob part of a
 * multipart body under the jsdom test environment (verified independently —
 * a bare `request.formData()` handler with a Blob field times out even with
 * no app code involved). Mocking fetch directly sidesteps that environment
 * limitation while still asserting the exact FormData contents callers rely
 * on (routes_feedback.py reads these exact field names).
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { submitFeedback } from '@/lib/api'

describe('submitFeedback', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('POSTs a FormData body with type/comment/url/viewport/user_agent/console_logs/screenshot', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 'fb-1', created_at: '2026-08-08T10:00:00Z' }), { status: 200 }),
    )

    const screenshot = new Blob(['fake-png-bytes'], { type: 'image/png' })
    await submitFeedback({
      type: 'bug',
      comment: 'It crashed on submit',
      url: 'http://127.0.0.1:8000/#shortlist',
      viewport: '375x812',
      userAgent: 'Mozilla/5.0 (test)',
      consoleLogs: [{ ts: '2026-08-08T10:00:00Z', level: 'error', args: ['boom'] }],
      screenshot,
    })

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [path, options] = fetchSpy.mock.calls[0]
    expect(path).toBe('/api/feedback')
    expect(options?.method).toBe('POST')

    const form = options?.body as FormData
    expect(form.get('type')).toBe('bug')
    expect(form.get('comment')).toBe('It crashed on submit')
    expect(form.get('url')).toBe('http://127.0.0.1:8000/#shortlist')
    expect(form.get('viewport')).toBe('375x812')
    expect(form.get('user_agent')).toBe('Mozilla/5.0 (test)')
    expect(JSON.parse(form.get('console_logs') as string)).toEqual([
      { ts: '2026-08-08T10:00:00Z', level: 'error', args: ['boom'] },
    ])
    // form.set(name, blob, filename) coerces the Blob into a File — assert
    // shape (size/type/filename) rather than reference identity.
    const attached = form.get('screenshot') as File
    expect(attached.size).toBe(screenshot.size)
    expect(attached.type).toBe('image/png')
    expect(attached.name).toBe('screenshot.png')
  })

  it('omits the screenshot field when screenshot is null', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 'fb-2', created_at: '2026-08-08T10:00:00Z' }), { status: 200 }),
    )

    await submitFeedback({
      type: 'feature',
      comment: 'Would like dark mode',
      url: 'http://127.0.0.1:8000/#settings',
      viewport: '1440x900',
      userAgent: 'Mozilla/5.0 (test)',
      consoleLogs: [],
      screenshot: null,
    })

    const [, options] = fetchSpy.mock.calls[0]
    const form = options?.body as FormData
    expect(form.get('screenshot')).toBeNull()
  })

  it('does not set a Content-Type header (browser must set the multipart boundary)', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 'fb-3', created_at: null }), { status: 200 }),
    )

    await submitFeedback({
      type: 'ux',
      comment: 'Hard to tap',
      url: 'http://127.0.0.1:8000/#settings',
      viewport: '375x812',
      userAgent: 'test',
      consoleLogs: [],
      screenshot: null,
    })

    const [, options] = fetchSpy.mock.calls[0]
    expect(options?.headers).toBeUndefined()
  })

  it('throws with response text on a non-ok response', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('comment must not be empty', { status: 422 }),
    )

    await expect(
      submitFeedback({
        type: 'bug',
        comment: '',
        url: '',
        viewport: '',
        userAgent: '',
        consoleLogs: [],
        screenshot: null,
      }),
    ).rejects.toThrow(/422/)
  })
})
