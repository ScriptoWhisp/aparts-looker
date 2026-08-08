/**
 * FeedbackDrawer.test.tsx — type chips, comment field, submit FormData shape.
 *
 * The drawer receives its screenshot via props (screenshotBlob/screenshotFailed)
 * — capture itself lives in FeedbackButton (html2canvas), tested separately by
 * the e2e suite where a real DOM/canvas exists. Here we exercise the form.
 */

import { describe, it, expect, vi } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from './mocks/server'
import { renderWithProviders } from './renderWithProviders'
import { FeedbackDrawer } from '@/components/feedback/FeedbackDrawer'

function renderDrawer(open = true) {
  const onOpenChange = vi.fn()
  const utils = renderWithProviders(
    <FeedbackDrawer
      open={open}
      onOpenChange={onOpenChange}
      screenshotBlob={new Blob(['fake-png'], { type: 'image/png' })}
      screenshotFailed={false}
    />,
  )
  return { onOpenChange, ...utils }
}

describe('FeedbackDrawer — renders', () => {
  it('shows the 4 type chips, comment textarea, and submit/cancel buttons when open', () => {
    renderDrawer(true)
    expect(screen.getByRole('radio', { name: /bug/i })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /feature/i })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /ux/i })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /performance/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/what's going on/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /submit/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
  })

  it('defaults to the Bug chip selected', () => {
    renderDrawer(true)
    expect(screen.getByRole('radio', { name: /bug/i })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: /feature/i })).toHaveAttribute('aria-checked', 'false')
  })

  it('does not render drawer content when closed', () => {
    renderDrawer(false)
    expect(screen.queryByLabelText(/what's going on/i)).not.toBeInTheDocument()
  })
})

describe('FeedbackDrawer — type chips are selectable', () => {
  it('clicking a chip switches the selection', () => {
    renderDrawer(true)
    fireEvent.click(screen.getByRole('radio', { name: /feature/i }))
    expect(screen.getByRole('radio', { name: /feature/i })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: /bug/i })).toHaveAttribute('aria-checked', 'false')
  })
})

describe('FeedbackDrawer — submit', () => {
  it('Submit button is disabled until a comment is entered', () => {
    renderDrawer(true)
    expect(screen.getByRole('button', { name: /submit/i })).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/what's going on/i), { target: { value: 'It crashed' } })
    expect(screen.getByRole('button', { name: /submit/i })).not.toBeDisabled()
  })

  // NOTE: this submits with screenshotBlob=null (renderDrawer's default has a
  // Blob prop, but we override here) — jsdom's Blob implementation hangs
  // indefinitely when @mswjs/interceptors reads a Blob part of a multipart
  // FormData body under the jsdom test environment (verified: a bare repro
  // with request.formData() + a Blob field times out even with no component
  // code involved). The screenshot-attached case is covered by
  // api.test.ts, which asserts the FormData shape via a mocked fetch instead
  // of a real network round-trip, sidestepping the jsdom/Blob limitation.
  it('submits a multipart FormData with type, comment, and url fields', async () => {
    let capturedForm: FormData | null = null
    server.use(
      http.post('/api/feedback', async ({ request }) => {
        capturedForm = await request.formData()
        return HttpResponse.json({ id: 'fb-new', created_at: '2026-08-08T12:00:00Z' })
      }),
    )

    const onOpenChange = vi.fn()
    renderWithProviders(
      <FeedbackDrawer
        open={true}
        onOpenChange={onOpenChange}
        screenshotBlob={null}
        screenshotFailed={false}
      />,
    )
    fireEvent.click(screen.getByRole('radio', { name: /ux/i }))
    fireEvent.change(screen.getByLabelText(/what's going on/i), {
      target: { value: 'Settings sliders are hard to tap' },
    })
    fireEvent.click(screen.getByRole('button', { name: /submit/i }))

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))

    expect(capturedForm).not.toBeNull()
    const form = capturedForm as unknown as FormData
    expect(form.get('type')).toBe('ux')
    expect(form.get('comment')).toBe('Settings sliders are hard to tap')
    expect(typeof form.get('url')).toBe('string')
  })

  it('shows an inline error and keeps the drawer open when the request fails', async () => {
    server.use(
      http.post('/api/feedback', () => new HttpResponse('server error', { status: 500 })),
    )

    const { onOpenChange } = renderDrawer(true)
    fireEvent.change(screen.getByLabelText(/what's going on/i), { target: { value: 'Broken' } })
    fireEvent.click(screen.getByRole('button', { name: /submit/i }))

    await waitFor(() => expect(screen.getByText(/failed/i)).toBeInTheDocument())
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })
})
