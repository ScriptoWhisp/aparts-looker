/**
 * FinanceCard — per-listing affordability calculator (Wave B).
 *
 * Fetches GET /api/entry/{id}/finance-calculation and renders:
 *   - Verdict pill (green/yellow/red) + one-line Russian summary
 *   - Collapsible "Одноразовые" (one-time costs) section with post-down-
 *     payment buffer check
 *   - Collapsible "Ежемесячно" (worst-case monthly total) section with
 *     inline inputs for null values (utilities/remondifond) that PATCH
 *     /api/entry/{id}/finance-inputs on blur
 *   - Collapsible "Сценарии ставки" (6 rate scenarios), collapsed by default
 *   - Missing-data callout listing which settings/inputs are needed
 *
 * Design-system note: the design brief describes generic status-ok/warn/bad
 * colors; this codebase's actual token set (tailwind.config.ts) only defines
 * the `score` ramp (score-bad/mid/best) and no `status-*` color tokens — the
 * verdict pill uses those instead of inventing new non-existent classes.
 *
 * When status === 'incomplete' because global settings (income/savings) are
 * unset, the card renders a dimmed CTA linking to Settings > Финансы rather
 * than the full breakdown (there's nothing meaningful to show yet).
 */

import { useState } from 'react'
import { useFinanceCalculation, usePatchFinanceInputs } from '../../lib/queries'
import { useAppStore } from '../../lib/state'
import { fmtEur } from '../../lib/format'
import type { Entry, FinanceScenario } from '../../types/api'

interface FinanceCardProps {
  entry: Entry
}

const VERDICT_STYLES: Record<'green' | 'yellow' | 'red', string> = {
  green:  'bg-score-best/15 text-score-best',
  yellow: 'bg-score-mid/15 text-score-mid',
  red:    'bg-score-bad/15 text-score-bad',
}

const VERDICT_LABEL_RU: Record<'green' | 'yellow' | 'red', string> = {
  green: 'проходит',
  yellow: 'тесно',
  red: 'не проходит',
}

const BUFFER_LABEL_RU: Record<'good' | 'tight' | 'insufficient', string> = {
  good: 'хорошо',
  tight: 'впритык',
  insufficient: 'недостаточно',
}

const MISSING_LABELS_RU: Record<string, string> = {
  income: 'укажи доход в Настройках → Финансы',
  savings: 'укажи накопления в Настройках → Финансы',
  ask: 'у объявления нет цены',
  utilities: 'запроси счета за декабрь–январь и июнь–июль для точной коммуналки',
  remondifond: 'узнай размер ремфонда из документов КЮ',
  first_purchases: 'оцени бюджет на первые покупки/ремонт',
}

const GLOBAL_SETTINGS_MISSING = new Set(['income', 'savings'])

// ── Inline editable € field (utilities / remondifond) ──────────────────────

interface InlineEuroFieldProps {
  label: string
  value: number | null
  testKey: string
  onSave: (v: number | null) => void
}

function InlineEuroField({ label, value, testKey, onSave }: InlineEuroFieldProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value != null ? String(value) : '')

  function commit() {
    setEditing(false)
    const trimmed = draft.trim()
    if (trimmed === '') {
      onSave(null)
      return
    }
    const parsed = Number(trimmed)
    onSave(Number.isFinite(parsed) ? parsed : null)
  }

  if (editing) {
    return (
      <div className="flex items-center justify-between py-1 gap-2">
        <span className="text-[12px] text-muted flex-none">{label}</span>
        <div className="flex items-center gap-1">
          <input
            type="number"
            inputMode="decimal"
            autoFocus
            value={draft}
            data-testid={`finance-input-${testKey}`}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
            className="w-20 text-right text-base bg-surface/50 border border-border rounded px-1.5 py-1 text-text-2 focus:outline-none focus:border-accent/60 transition-colors"
          />
          <span className="text-[11px] text-muted">€</span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-[12px] text-muted">{label}</span>
      <button
        type="button"
        onClick={() => { setDraft(value != null ? String(value) : ''); setEditing(true) }}
        data-testid={`finance-add-${testKey}`}
        className={[
          'min-h-[32px] px-1 text-[12px] font-mono transition-colors',
          value != null ? 'text-text-2 hover:text-accent-lt' : 'text-accent hover:text-accent-lt',
        ].join(' ')}
      >
        {value != null ? fmtEur(value) : '— € [+ ввести]'}
      </button>
    </div>
  )
}

// ── Collapsible section wrapper ─────────────────────────────────────────────

interface SectionProps {
  title: string
  totalLabel?: string
  defaultOpen?: boolean
  testId: string
  children: React.ReactNode
}

function Section({ title, totalLabel, defaultOpen = true, testId, children }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border-t border-border/50 first:border-t-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        data-testid={`finance-section-toggle-${testId}`}
        className="w-full min-h-[40px] flex items-center justify-between py-2 text-left"
      >
        <span className="text-[13px] font-medium text-text-2">
          {open ? '▾' : '▸'} {title}
          {totalLabel && <span className="text-muted font-normal"> ({totalLabel})</span>}
        </span>
      </button>
      {open && <div data-testid={`finance-section-body-${testId}`} className="pb-2">{children}</div>}
    </div>
  )
}

// ── Scenario row ─────────────────────────────────────────────────────────

function ScenarioRow({ scenario, isMax }: { scenario: FinanceScenario; isMax: boolean }) {
  return (
    <div
      data-testid="finance-scenario-row"
      className={[
        'flex items-center justify-between py-1.5 px-2 text-[12px] font-mono rounded',
        isMax ? 'bg-score-bad/10 text-score-bad' : 'text-text-2',
      ].join(' ')}
    >
      <span>
        {scenario.base_rate_pct.toFixed(2)}% + {scenario.euribor_pct.toFixed(2)}%
        {scenario.is_stress ? ' ⚠' : ''}
      </span>
      <span>{scenario.total_rate_pct.toFixed(2)}%</span>
      <span>{fmtEur(scenario.monthly_payment)}</span>
    </div>
  )
}

// ── Main FinanceCard ────────────────────────────────────────────────────────

export function FinanceCard({ entry }: FinanceCardProps) {
  const { data: calc, isLoading } = useFinanceCalculation(entry.id)
  const patchInputs = usePatchFinanceInputs(entry.id)
  const setTab = useAppStore((s) => s.setTab)

  function saveInput(key: 'utilities_eur_monthly' | 'remondifond_eur_monthly', value: number | null) {
    patchInputs.mutate({ [key]: value })
  }

  if (isLoading || !calc) {
    return (
      <div className="bg-sunken rounded-lg overflow-hidden p-3">
        <p className="text-[10px] font-mono uppercase text-muted tracking-widest mb-2">Финансы</p>
        <p className="text-[12px] text-faint">Загрузка…</p>
      </div>
    )
  }

  const settingsIncomplete = calc.missing.some((m) => GLOBAL_SETTINGS_MISSING.has(m))

  if (calc.status === 'incomplete' && settingsIncomplete) {
    return (
      <div className="bg-sunken rounded-lg overflow-hidden p-3 opacity-70" data-testid="finance-card-incomplete">
        <p className="text-[10px] font-mono uppercase text-muted tracking-widest mb-2">Финансы</p>
        <p className="text-[13px] text-text-2 mb-2">
          Настройки не заполнены — укажи доход и накопления в Настройках, чтобы увидеть расчёт.
        </p>
        <button
          type="button"
          onClick={() => setTab('settings')}
          className="text-[12px] text-accent hover:text-accent-lt transition-colors underline underline-offset-2"
        >
          Настройки → Финансы ↗
        </button>
      </div>
    )
  }

  const verdict = calc.affordability?.verdict ?? null
  const missingExtras = calc.missing.filter((m) => !GLOBAL_SETTINGS_MISSING.has(m))

  return (
    <div className="bg-sunken rounded-lg overflow-hidden flex flex-col" data-testid="finance-card">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border flex-none">
        <p className="text-[10px] font-mono uppercase text-muted tracking-widest">Финансы</p>
        {verdict && (
          <span
            data-testid="finance-verdict-pill"
            data-verdict={verdict}
            className={[
              'px-2 py-0.5 rounded-full text-[11px] font-medium',
              VERDICT_STYLES[verdict],
            ].join(' ')}
          >
            {VERDICT_LABEL_RU[verdict]}
          </span>
        )}
      </div>

      <div className="px-3 py-2">
        {/* Big verdict line */}
        {calc.affordability && (
          <p className="text-[15px] text-text-2 leading-snug mb-1">
            {calc.affordability.message_ru}
          </p>
        )}

        {/* Одноразовые — collapsed by default: verdict + totals are the
            at-a-glance info; details behind a tap. Prevents FinanceCard from
            dominating the right column and hiding NegotiationCard below. */}
        {calc.one_time && (
          <Section
            title="Одноразовые"
            totalLabel={fmtEur(calc.one_time.total)}
            defaultOpen={false}
            testId="one-time"
          >
            <div className="flex flex-col">
              <div className="flex items-center justify-between py-1">
                <span className="text-[12px] text-muted">Взнос</span>
                <span className="text-[12px] font-mono text-text-2">
                  {fmtEur(calc.one_time.down_payment.amount)} ({calc.one_time.down_payment.pct}%)
                </span>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className="text-[12px] text-muted">Hindamisakt</span>
                <span className="text-[12px] font-mono text-text-2">{fmtEur(calc.one_time.hindamisakt)}</span>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className="text-[12px] text-muted">Нотариус</span>
                <span className="text-[12px] font-mono text-text-2">{fmtEur(calc.one_time.notary)}</span>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className="text-[12px] text-muted">Ключи</span>
                <span className="text-[12px] font-mono text-text-2">{fmtEur(calc.one_time.keys)}</span>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className="text-[12px] text-muted">Первые покупки</span>
                <span className="text-[12px] font-mono text-text-2">
                  {calc.one_time.first_purchases != null ? fmtEur(calc.one_time.first_purchases) : '— €'}
                </span>
              </div>

              {calc.buffer_after_down && (
                <div className="flex items-center justify-between pt-2 mt-1 border-t border-border/50">
                  <span className="text-[12px] text-muted">Остаток буфера</span>
                  <span
                    data-testid="finance-buffer-verdict"
                    data-verdict={calc.buffer_after_down.verdict}
                    className="text-[12px] font-mono text-text-2"
                  >
                    {fmtEur(calc.buffer_after_down.amount)} · {BUFFER_LABEL_RU[calc.buffer_after_down.verdict]}
                  </span>
                </div>
              )}
            </div>
          </Section>
        )}

        {/* Ежемесячно — collapsed by default (same reason as Одноразовые) */}
        {calc.monthly_worst_case && (
          <Section
            title="Ежемесячно"
            totalLabel={fmtEur(calc.monthly_worst_case.total)}
            defaultOpen={false}
            testId="monthly"
          >
            <div className="flex flex-col">
              <div className="flex items-center justify-between py-1">
                <span className="text-[12px] text-muted">Ипотека (худший случай)</span>
                <span className="text-[12px] font-mono text-text-2">
                  {fmtEur(calc.monthly_worst_case.mortgage_max)}
                </span>
              </div>
              <InlineEuroField
                label="Коммуналка"
                value={calc.monthly_worst_case.utilities}
                testKey="utilities"
                onSave={(v) => saveInput('utilities_eur_monthly', v)}
              />
              <InlineEuroField
                label="Ремфонд"
                value={calc.monthly_worst_case.remondifond}
                testKey="remondifond"
                onSave={(v) => saveInput('remondifond_eur_monthly', v)}
              />
              <div className="flex items-center justify-between py-1">
                <span className="text-[12px] text-muted">Интернет</span>
                <span className="text-[12px] font-mono text-text-2">{fmtEur(calc.monthly_worst_case.internet)}</span>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className="text-[12px] text-muted">Электричество</span>
                <span className="text-[12px] font-mono text-text-2">{fmtEur(calc.monthly_worst_case.electricity)}</span>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className="text-[12px] text-muted">Еда</span>
                <span className="text-[12px] font-mono text-text-2">{fmtEur(calc.monthly_worst_case.food)}</span>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className="text-[12px] text-muted">Базовые потребности</span>
                <span className="text-[12px] font-mono text-text-2">{fmtEur(calc.monthly_worst_case.basic)}</span>
              </div>
            </div>
          </Section>
        )}

        {/* Сценарии ставки — collapsed by default */}
        {calc.scenarios.length > 0 && (
          <Section
            title="Сценарии ставки"
            totalLabel={`${calc.scenarios.length}`}
            defaultOpen={false}
            testId="scenarios"
          >
            <div className="flex flex-col gap-0.5">
              {calc.scenarios.map((s, i) => (
                <ScenarioRow
                  key={i}
                  scenario={s}
                  isMax={s.monthly_payment === calc.monthly_worst_case?.mortgage_max}
                />
              ))}
            </div>
          </Section>
        )}

        {/* Missing-data callout */}
        {missingExtras.length > 0 && (
          <div
            data-testid="finance-missing-callout"
            className="mt-2 pt-2 border-t border-border/50 flex flex-col gap-1"
          >
            <p className="text-[11px] text-score-weak font-medium">⚠ Не хватает данных:</p>
            {missingExtras.map((key) => (
              <p key={key} className="text-[11px] text-muted pl-3">
                {MISSING_LABELS_RU[key] ?? key}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
