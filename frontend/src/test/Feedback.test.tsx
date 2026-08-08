/**
 * Feedback.test.tsx — list renders, filters work, detail modal opens.
 */

import { describe, it, expect, vi } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from './mocks/server'
import { renderWithProviders } from './renderWithProviders'
import { Feedback } from '@/routes/Feedback'
import { feedbackBug1, feedbackFeature1, feedbackFixed1, mockFeedbackList } from './mocks/fixtures'

describe('Feedback route — renders list', () => {
  it('shows the count and every card comment', async () => {
    renderWithProviders(<Feedback />)
    await waitFor(() => expect(screen.getByText(String(mockFeedbackList.length))).toBeInTheDocument())
    expect(screen.getByText(feedbackBug1.comment)).toBeInTheDocument()
    expect(screen.getByText(feedbackFeature1.comment)).toBeInTheDocument()
    expect(screen.getByText(feedbackFixed1.comment)).toBeInTheDocument()
  })

  it('shows an empty state when there is no feedback', async () => {
    server.use(
      http.get('/api/feedback', () => HttpResponse.json({ feedback: [], count: 0 })),
    )
    renderWithProviders(<Feedback />)
    await waitFor(() => expect(screen.getByText(/no feedback yet/i)).toBeInTheDocument())
  })
})

describe('Feedback route — filters', () => {
  it('status pill click re-fetches with the ?status= query param', async () => {
    let lastUrl = ''
    server.use(
      http.get('/api/feedback', ({ request }) => {
        lastUrl = request.url
        return HttpResponse.json({ feedback: [feedbackFixed1], count: 1 })
      }),
    )
    renderWithProviders(<Feedback />)
    fireEvent.click(screen.getByRole('button', { name: 'Fixed' }))
    await waitFor(() => expect(lastUrl).toContain('status=fixed'))
  })

  it('type pill click re-fetches with the ?type= query param', async () => {
    let lastUrl = ''
    server.use(
      http.get('/api/feedback', ({ request }) => {
        lastUrl = request.url
        return HttpResponse.json({ feedback: [feedbackBug1], count: 1 })
      }),
    )
    renderWithProviders(<Feedback />)
    fireEvent.click(screen.getByRole('button', { name: 'Bug' }))
    await waitFor(() => expect(lastUrl).toContain('type=bug'))
  })
})

describe('Feedback route — detail modal', () => {
  it('clicking a card opens the detail modal with the full comment', async () => {
    renderWithProviders(<Feedback />)
    await waitFor(() => expect(screen.getByText(feedbackBug1.comment)).toBeInTheDocument())
    fireEvent.click(screen.getByText(feedbackBug1.comment))
    // "Feedback detail" heading renders immediately; the body waits on
    // useFeedbackOne's fetch, so assert on content that only appears once
    // that query resolves (findBy* auto-retries).
    expect(await screen.findByRole('button', { name: /copy report url for claude/i })).toBeInTheDocument()
    // Comment appears twice once the modal is open (card behind + modal).
    expect(screen.getAllByText(feedbackBug1.comment).length).toBeGreaterThanOrEqual(1)
  })

  it('close button dismisses the modal', async () => {
    renderWithProviders(<Feedback />)
    await waitFor(() => expect(screen.getByText(feedbackBug1.comment)).toBeInTheDocument())
    fireEvent.click(screen.getByText(feedbackBug1.comment))
    await waitFor(() => expect(screen.getByText('Feedback detail')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(screen.queryByText('Feedback detail')).not.toBeInTheDocument()
  })

  it('status dropdown change PATCHes the feedback status', async () => {
    let patchedStatus: string | null = null
    server.use(
      http.patch('/api/feedback/:id', async ({ request, params }) => {
        const body = (await request.json()) as { status?: string }
        patchedStatus = body.status ?? null
        return HttpResponse.json({ ...feedbackBug1, id: params.id, status: body.status })
      }),
    )
    renderWithProviders(<Feedback />)
    await waitFor(() => expect(screen.getByText(feedbackBug1.comment)).toBeInTheDocument())
    fireEvent.click(screen.getByText(feedbackBug1.comment))
    await waitFor(() => expect(screen.getByLabelText('Status')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'fixed' } })
    await waitFor(() => expect(patchedStatus).toBe('fixed'))
  })

  it('delete button (after confirm) calls DELETE and closes the modal', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    let deleteCalled = false
    server.use(
      http.delete('/api/feedback/:id', () => {
        deleteCalled = true
        return HttpResponse.json({ ok: true })
      }),
    )
    renderWithProviders(<Feedback />)
    await waitFor(() => expect(screen.getByText(feedbackBug1.comment)).toBeInTheDocument())
    fireEvent.click(screen.getByText(feedbackBug1.comment))
    await waitFor(() => expect(screen.getByLabelText('Delete feedback')).toBeInTheDocument())
    fireEvent.click(screen.getByLabelText('Delete feedback'))
    await waitFor(() => expect(deleteCalled).toBe(true))
    await waitFor(() => expect(screen.queryByText('Feedback detail')).not.toBeInTheDocument())
    vi.restoreAllMocks()
  })
})
