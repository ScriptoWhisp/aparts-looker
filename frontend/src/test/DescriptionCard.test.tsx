/**
 * DescriptionCard.test.tsx — Wave C description translation + bulleted summary.
 *
 * Tests:
 * - Renders bullets when present
 * - Renders translation collapsible section (default-open when RU exists)
 * - Renders original collapsible section (default-closed)
 * - Empty state when both description and translation are null
 * - Regenerate button triggers the mutation and invalidates queries
 * - Line breaks preserved in the original text (whitespace-pre-wrap)
 */

import { describe, it, expect } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from './mocks/server'
import { renderWithProviders } from './renderWithProviders'
import { DescriptionCard } from '@/components/shortlist/DescriptionCard'
import { approvedEntry } from './mocks/fixtures'
import type { Entry } from '../types/api'

function makeTestEntry(overrides: Partial<Entry> = {}): Entry {
  return { ...approvedEntry, ...overrides }
}

describe('DescriptionCard — bullets', () => {
  it('renders bullets when present', () => {
    renderWithProviders(<DescriptionCard entry={approvedEntry} />)
    const bullets = screen.getByTestId('description-bullets')
    expect(bullets).toBeInTheDocument()
    for (const bullet of approvedEntry.description_bullets ?? []) {
      expect(screen.getByText(bullet)).toBeInTheDocument()
    }
  })

  it('does not render the bullets block when there are none', () => {
    const entry = makeTestEntry({ description_bullets: [] })
    renderWithProviders(<DescriptionCard entry={entry} />)
    expect(screen.queryByTestId('description-bullets')).toBeNull()
  })
})

describe('DescriptionCard — translation section', () => {
  it('is open by default and shows the RU translation when it exists', () => {
    renderWithProviders(<DescriptionCard entry={approvedEntry} />)
    const toggle = screen.getByTestId('description-translation-toggle')
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('description-translation-body')).toBeInTheDocument()
    expect(screen.getByText(approvedEntry.description_ru as string)).toBeInTheDocument()
  })

  it('shows a placeholder + collapses when no translation exists', () => {
    const entry = makeTestEntry({ description_ru: null })
    renderWithProviders(<DescriptionCard entry={entry} />)
    const toggle = screen.getByTestId('description-translation-toggle')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toggle)
    expect(screen.getByText(/нет перевода/)).toBeInTheDocument()
  })

  it('toggles closed on click', () => {
    renderWithProviders(<DescriptionCard entry={approvedEntry} />)
    const toggle = screen.getByTestId('description-translation-toggle')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('description-translation-body')).toBeNull()
  })
})

describe('DescriptionCard — original section', () => {
  it('is collapsed by default', () => {
    renderWithProviders(<DescriptionCard entry={approvedEntry} />)
    const toggle = screen.getByTestId('description-original-toggle')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('description-original-body')).toBeNull()
  })

  it('expands to show the raw original text on click', () => {
    renderWithProviders(<DescriptionCard entry={approvedEntry} />)
    fireEvent.click(screen.getByTestId('description-original-toggle'))
    const body = screen.getByTestId('description-original-body')
    expect(body).toBeInTheDocument()
    expect(screen.getByText(approvedEntry.description as string)).toBeInTheDocument()
  })

  it('preserves line breaks via whitespace-pre-wrap', () => {
    const entry = makeTestEntry({ description: 'Line one.\nLine two.\nLine three.' })
    renderWithProviders(<DescriptionCard entry={entry} />)
    fireEvent.click(screen.getByTestId('description-original-toggle'))
    const body = screen.getByTestId('description-original-body')
    const p = body.querySelector('p')
    expect(p).not.toBeNull()
    expect(p).toHaveClass('whitespace-pre-wrap')
    expect(p?.textContent).toBe('Line one.\nLine two.\nLine three.')
  })
})

describe('DescriptionCard — empty state', () => {
  it('shows the empty-description message when both description and translation are null', () => {
    const entry = makeTestEntry({
      description: null,
      description_ru: null,
      description_bullets: null,
    })
    renderWithProviders(<DescriptionCard entry={entry} />)
    expect(screen.getByTestId('description-empty')).toBeInTheDocument()
    expect(screen.getByText('Описание пустое — kv.ee не отдал текст')).toBeInTheDocument()
    expect(screen.queryByTestId('description-bullets')).toBeNull()
    expect(screen.queryByTestId('description-translation-toggle')).toBeNull()
  })
})

describe('DescriptionCard — regenerate', () => {
  it('triggers the regenerate mutation and shows the loading label', async () => {
    let called = false
    server.use(
      http.post('/api/entry/:id/regenerate-description', () => {
        called = true
        return HttpResponse.json({ ok: true })
      }),
    )

    renderWithProviders(<DescriptionCard entry={approvedEntry} />)
    const btn = screen.getByTestId('description-regenerate')
    fireEvent.click(btn)

    await waitFor(() => expect(called).toBe(true))
    expect(screen.getByTestId('description-regenerate')).toHaveTextContent('переводим…')
    expect(screen.getByTestId('description-regenerate')).toBeDisabled()
  })

  it('shows an error state + re-enables the button when the request fails', async () => {
    server.use(
      http.post('/api/entry/:id/regenerate-description', () => {
        return new HttpResponse(null, { status: 500 })
      }),
    )

    renderWithProviders(<DescriptionCard entry={approvedEntry} />)
    fireEvent.click(screen.getByTestId('description-regenerate'))

    await waitFor(() => {
      expect(screen.getByTestId('description-error')).toBeInTheDocument()
    })
    expect(screen.getByText('перевод не удался — попробуй ещё раз')).toBeInTheDocument()
    expect(screen.getByTestId('description-regenerate')).not.toBeDisabled()
  })
})
