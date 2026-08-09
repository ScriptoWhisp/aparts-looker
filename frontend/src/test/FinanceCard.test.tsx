/**
 * FinanceCard.test.tsx — Wave B finance calculator card.
 *
 * Tests:
 * - Renders the verdict pill matching calc.affordability.verdict
 * - Renders the missing-data callout when status=incomplete due to
 *   per-listing inputs (utilities/remondifond), not global settings
 * - Renders the "settings incomplete" CTA when income/savings are missing
 * - Inline "+ ввести" input for a null value PATCHes on blur
 * - Scenarios section is collapsed by default and expands on tap, revealing
 *   all 6 rate scenarios
 */

import { describe, it, expect } from 'vitest'
import { screen, fireEvent, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from './mocks/server'
import { renderWithProviders } from './renderWithProviders'
import { FinanceCard } from '@/components/shortlist/FinanceCard'
import { approvedEntry } from './mocks/fixtures'
import {
  mockFinanceCalculationGreen,
  mockFinanceCalculationIncompleteSettings,
  mockFinanceCalculationMissingInputs,
} from './mocks/fixtures'

describe('FinanceCard — verdict pill', () => {
  it('renders the green verdict pill + big verdict line for a complete calculation', async () => {
    renderWithProviders(<FinanceCard entry={approvedEntry} />)
    const pill = await screen.findByTestId('finance-verdict-pill')
    expect(pill).toHaveAttribute('data-verdict', 'green')
    expect(screen.getByText(mockFinanceCalculationGreen.affordability!.message_ru)).toBeInTheDocument()
  })

  it('renders a yellow verdict pill when affordability.verdict is yellow', async () => {
    server.use(
      http.get('/api/entry/:id/finance-calculation', () =>
        HttpResponse.json({
          ...mockFinanceCalculationGreen,
          affordability: { ...mockFinanceCalculationGreen.affordability!, verdict: 'yellow', message_ru: 'Тесно: свободно только 200 €/мес' },
        }),
      ),
    )
    renderWithProviders(<FinanceCard entry={approvedEntry} />)
    const pill = await screen.findByTestId('finance-verdict-pill')
    expect(pill).toHaveAttribute('data-verdict', 'yellow')
  })

  it('renders a red verdict pill when affordability.verdict is red', async () => {
    server.use(
      http.get('/api/entry/:id/finance-calculation', () =>
        HttpResponse.json({
          ...mockFinanceCalculationGreen,
          affordability: { ...mockFinanceCalculationGreen.affordability!, verdict: 'red', message_ru: 'Не хватает 300 €/мес' },
        }),
      ),
    )
    renderWithProviders(<FinanceCard entry={approvedEntry} />)
    const pill = await screen.findByTestId('finance-verdict-pill')
    expect(pill).toHaveAttribute('data-verdict', 'red')
  })
})

describe('FinanceCard — missing-data callout', () => {
  it('shows the settings-incomplete CTA when income/savings are unset', async () => {
    server.use(
      http.get('/api/entry/:id/finance-calculation', () =>
        HttpResponse.json(mockFinanceCalculationIncompleteSettings),
      ),
    )
    renderWithProviders(<FinanceCard entry={approvedEntry} />)
    await screen.findByTestId('finance-card-incomplete')
    expect(screen.getByText(/Настройки не заполнены/)).toBeInTheDocument()
    expect(screen.queryByTestId('finance-verdict-pill')).toBeNull()
  })

  it('shows the missing-data callout (not the settings CTA) when only per-listing inputs are missing', async () => {
    server.use(
      http.get('/api/entry/:id/finance-calculation', () =>
        HttpResponse.json(mockFinanceCalculationMissingInputs),
      ),
    )
    renderWithProviders(<FinanceCard entry={approvedEntry} />)
    const callout = await screen.findByTestId('finance-missing-callout')
    expect(callout).toBeInTheDocument()
    // Still shows the verdict pill — the calculation itself did run.
    expect(screen.getByTestId('finance-verdict-pill')).toBeInTheDocument()
  })

  it('does not render a missing-data callout when status is complete', async () => {
    renderWithProviders(<FinanceCard entry={approvedEntry} />)
    await screen.findByTestId('finance-verdict-pill')
    expect(screen.queryByTestId('finance-missing-callout')).toBeNull()
  })
})

describe('FinanceCard — inline inputs', () => {
  it('shows "+ ввести" for a null utilities value and PATCHes on blur', async () => {
    server.use(
      http.get('/api/entry/:id/finance-calculation', () =>
        HttpResponse.json(mockFinanceCalculationMissingInputs),
      ),
    )
    let patchBody: unknown = null
    server.use(
      http.patch('/api/entry/:id/finance-inputs', async ({ request }) => {
        patchBody = await request.json()
        return HttpResponse.json({
          utilities_eur_monthly: 150,
          remondifond_eur_monthly: null,
          first_purchases_eur: null,
          override_ask_eur: null,
        })
      }),
    )

    renderWithProviders(<FinanceCard entry={approvedEntry} />)
    // Ежемесячно section is collapsed by default (compact mode) — expand first
    fireEvent.click(await screen.findByTestId('finance-section-toggle-monthly'))
    const addBtn = await screen.findByTestId('finance-add-utilities')
    fireEvent.click(addBtn)

    const input = screen.getByTestId('finance-input-utilities')
    fireEvent.change(input, { target: { value: '150' } })
    fireEvent.blur(input)

    await waitFor(() => {
      expect(patchBody).toEqual({ utilities_eur_monthly: 150 })
    })
  })

  it('does not crash when clearing an inline input back to empty (saves null)', async () => {
    server.use(
      http.get('/api/entry/:id/finance-calculation', () =>
        HttpResponse.json(mockFinanceCalculationMissingInputs),
      ),
    )
    let patchBody: unknown = null
    server.use(
      http.patch('/api/entry/:id/finance-inputs', async ({ request }) => {
        patchBody = await request.json()
        return HttpResponse.json({
          utilities_eur_monthly: null,
          remondifond_eur_monthly: null,
          first_purchases_eur: null,
          override_ask_eur: null,
        })
      }),
    )

    renderWithProviders(<FinanceCard entry={approvedEntry} />)
    fireEvent.click(await screen.findByTestId('finance-section-toggle-monthly'))
    fireEvent.click(await screen.findByTestId('finance-add-remondifond'))
    const input = screen.getByTestId('finance-input-remondifond')
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)

    await waitFor(() => {
      expect(patchBody).toEqual({ remondifond_eur_monthly: null })
    })
  })
})

describe('FinanceCard — scenarios section', () => {
  it('is collapsed by default and expands to show all 6 scenarios on tap', async () => {
    renderWithProviders(<FinanceCard entry={approvedEntry} />)
    await screen.findByTestId('finance-verdict-pill')

    expect(screen.queryByTestId('finance-section-body-scenarios')).toBeNull()

    fireEvent.click(screen.getByTestId('finance-section-toggle-scenarios'))

    const body = await screen.findByTestId('finance-section-body-scenarios')
    const rows = within(body).getAllByTestId('finance-scenario-row')
    expect(rows).toHaveLength(6)
  })
})
