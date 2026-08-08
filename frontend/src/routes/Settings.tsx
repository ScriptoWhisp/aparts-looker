/**
 * Settings tab — Wave 7D full build.
 *
 * Layout: grid grid-cols-[200px_1fr]
 * - Left: 5 category tabs (sidebar)
 * - Right: form for selected category
 *
 * Categories mapped from settings_store.py groups:
 *   cost → "Cost model"
 *   telegram → "Telegram"
 *   ai → "Scoring & AI"
 *   dashboard → "Buyer profile" (web URL lives here)
 *   reno → "Cost model" (merged with cost)
 *
 * Actual groups: cost, telegram, ai, dashboard, reno
 * UI groups: Buyer profile / Scoring & AI / Cost model / Telegram / Scraper
 * Mapping: dashboard→"Buyer profile", ai→"Scoring & AI", cost+reno→"Cost model", telegram→"Telegram"
 *
 * Fields:
 *   int/float with min/max → slider + mono value label
 *   str → text input
 *   bool → toggle switch
 *   Special: rooms → segmented control
 *   Special: threshold fields → score ramp slider
 */

import { useState, useCallback, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useSettings } from '../lib/queries'
import { saveSettings } from '../lib/api'
import { QUERY_KEYS } from '../lib/queries'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { useAppStore } from '../lib/state'
import type { SettingsField } from '../types/api'

// ── Category definitions ───────────────────────────────────────────────────

interface CategoryDef {
  id: string
  label: string
  subtitle: string
  groups: string[]  // backend group keys this category shows
}

const CATEGORIES: CategoryDef[] = [
  {
    id: 'buyer',
    label: 'Buyer profile',
    subtitle: 'Dashboard URL and general configuration',
    groups: ['dashboard'],
  },
  {
    id: 'ai',
    label: 'Scoring & AI',
    subtitle: 'Claude model, token limits, and evaluation thresholds',
    groups: ['ai'],
  },
  {
    id: 'cost',
    label: 'Cost model',
    subtitle: 'Mortgage parameters, KÜ rates, renovation rates',
    groups: ['cost', 'reno'],
  },
  {
    id: 'telegram',
    label: 'Telegram',
    subtitle: 'Notification thresholds and delivery settings',
    groups: ['telegram'],
  },
  {
    id: 'scraper',
    label: 'Scraper',
    subtitle: 'Scraping intervals and filter criteria',
    groups: ['scraper'],
  },
]

// ── Slider component ──────────────────────────────────────────────────────

interface SliderFieldProps {
  field: SettingsField
  value: number
  onChange: (v: number) => void
  isThreshold?: boolean
}

function SliderField({ field, value, onChange, isThreshold }: SliderFieldProps) {
  const min = field.min ?? 0
  const max = field.max ?? 100
  const step = field.type === 'float' ? 0.1 : 1

  // Score ramp gradient for threshold sliders
  const rampStyle = isThreshold
    ? 'linear-gradient(to right, #c4635f 0%, #c98b52 40%, #c9b455 60%, #7fbf7a 75%, #4fb98d 100%)'
    : undefined

  const pct = max === min ? 0 : ((value - min) / (max - min)) * 100

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <span className="font-sans text-[13px] text-text-2">{field.label}</span>
        <span className="font-mono text-[13px] text-text">{field.type === 'float' ? value.toFixed(1) : value}</span>
      </div>

      {isThreshold ? (
        // Score ramp slider
        <div className="relative h-4 flex items-center">
          <div
            className="absolute inset-x-0 h-2 rounded-full"
            style={{ background: rampStyle }}
          />
          {/* Marker */}
          <div
            className="absolute w-1 h-4 rounded-full bg-white shadow-md pointer-events-none"
            style={{ left: `calc(${pct}% - 2px)` }}
          />
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e) => onChange(Number(e.target.value))}
            className="absolute inset-0 w-full opacity-0 cursor-pointer"
          />
        </div>
      ) : (
        <div className="relative h-4 flex items-center">
          <div className="absolute inset-x-0 h-1.5 rounded-full bg-border" />
          <div
            className="absolute h-1.5 rounded-full bg-accent/60"
            style={{ width: `${pct}%` }}
          />
          <div
            className="absolute w-3.5 h-3.5 rounded-full bg-accent shadow-sm border border-accent/40"
            style={{ left: `calc(${pct}% - 7px)` }}
          />
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e) => onChange(Number(e.target.value))}
            className="absolute inset-0 w-full opacity-0 cursor-pointer"
          />
        </div>
      )}

      <div className="flex justify-between">
        <span className="font-mono text-[10px] text-faint">{min}</span>
        <span className="font-mono text-[10px] text-faint">{max}</span>
      </div>
    </div>
  )
}

// ── Toggle switch ─────────────────────────────────────────────────────────

function ToggleField({ field, value, onChange }: {
  field: SettingsField
  value: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="font-sans text-[13px] text-text-2">{field.label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
        className={[
          'relative w-9 h-5 rounded-full transition-colors duration-base',
          value ? 'bg-accent' : 'bg-border-strong',
        ].join(' ')}
      >
        <span
          className={[
            'absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-base',
            value ? 'translate-x-[18px]' : 'translate-x-[2px]',
          ].join(' ')}
        />
      </button>
    </div>
  )
}

// ── Text input ─────────────────────────────────────────────────────────────

function TextField({ field, value, onChange }: {
  field: SettingsField
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="font-sans text-[13px] text-text-2">{field.label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={[
          'bg-sunken text-text text-[13px] px-3 py-2 rounded-md',
          'border border-border focus:outline-none focus:border-accent/60 transition-colors duration-fast',
        ].join(' ')}
      />
    </div>
  )
}

// ── Field renderer ─────────────────────────────────────────────────────────

const THRESHOLD_KEYS = new Set(['telegram_min_score_photo', 'telegram_min_score_text', 'draft_score_threshold'])

interface FieldRendererProps {
  field: SettingsField
  value: SettingsField['value']
  onChange: (key: string, v: SettingsField['value']) => void
}

function FieldRenderer({ field, value, onChange }: FieldRendererProps) {
  if (field.type === 'bool') {
    return (
      <ToggleField
        field={field}
        value={value as boolean}
        onChange={(v) => onChange(field.key, v)}
      />
    )
  }
  if (field.type === 'str') {
    return (
      <TextField
        field={field}
        value={String(value)}
        onChange={(v) => onChange(field.key, v)}
      />
    )
  }
  // int or float
  return (
    <SliderField
      field={field}
      value={Number(value)}
      onChange={(v) => onChange(field.key, v)}
      isThreshold={THRESHOLD_KEYS.has(field.key)}
    />
  )
}

// ── Category form ─────────────────────────────────────────────────────────

interface CategoryFormProps {
  category: CategoryDef
  allFields: SettingsField[]
  values: Record<string, SettingsField['value']>
  onChange: (key: string, v: SettingsField['value']) => void
}

function CategoryForm({ category, allFields, values, onChange }: CategoryFormProps) {
  const fields = allFields.filter((f) => category.groups.includes(f.group))

  if (fields.length === 0) {
    return (
      <div className="flex items-center justify-center h-40">
        <p className="text-[13px] text-faint">
          No settings available for this category yet.
        </p>
      </div>
    )
  }

  // Split: bool fields go right, others go left (or just render all in grid)
  const boolFields  = fields.filter((f) => f.type === 'bool')
  const otherFields = fields.filter((f) => f.type !== 'bool')

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-8 max-w-5xl">
      {/* Left column: sliders + text inputs */}
      <div className="flex flex-col gap-6">
        {otherFields.map((f) => (
          <FieldRenderer
            key={f.key}
            field={f}
            value={values[f.key] ?? f.value}
            onChange={onChange}
          />
        ))}
      </div>

      {/* Right column: toggles */}
      {boolFields.length > 0 && (
        <div className="flex flex-col gap-4">
          <div className="bg-sunken rounded-lg p-4 flex flex-col gap-4 shadow-hairline">
            {boolFields.map((f) => (
              <FieldRenderer
                key={f.key}
                field={f}
                value={values[f.key] ?? f.value}
                onChange={onChange}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Toast ──────────────────────────────────────────────────────────────────

function Toast({ message, type }: { message: string; type: 'ok' | 'error' }) {
  return (
    <div
      className={[
        'fixed bottom-4 right-4 z-50 px-4 py-2.5 rounded-lg shadow-lg font-sans text-[13px]',
        type === 'ok' ? 'bg-score-best text-bg' : 'bg-score-bad text-white',
      ].join(' ')}
    >
      {message}
    </div>
  )
}

// ── Main Settings component ────────────────────────────────────────────────

export function Settings() {
  const { data: settingsData, isLoading } = useSettings()
  const qc = useQueryClient()
  const [activeCat, setActiveCat] = useState('cost')
  const [localValues, setLocalValues] = useState<Record<string, SettingsField['value']>>({})
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'error' } | null>(null)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function showToast(msg: string, type: 'ok' | 'error') {
    setToast({ msg, type })
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    toastTimerRef.current = setTimeout(() => setToast(null), 2500)
  }

  const handleChange = useCallback((key: string, v: SettingsField['value']) => {
    setLocalValues((prev) => ({ ...prev, [key]: v }))
  }, [])

  // Effective values: local overrides take precedence over server values
  const effectiveValues: Record<string, SettingsField['value']> = {}
  if (settingsData?.fields) {
    for (const f of settingsData.fields) {
      effectiveValues[f.key] = f.key in localValues ? localValues[f.key] : f.value
    }
  }

  async function handleSave() {
    if (!settingsData) return
    setSaving(true)
    try {
      const res = await saveSettings(localValues)
      if (res.errors?.length) {
        showToast(`Errors: ${res.errors.join(', ')}`, 'error')
      } else {
        setLocalValues({}) // reset local after save
        void qc.invalidateQueries({ queryKey: QUERY_KEYS.settings })
        showToast('Saved', 'ok')
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Save failed', 'error')
    } finally {
      setSaving(false)
    }
  }

  const hasChanges = Object.keys(localValues).length > 0
  const activeCategory = CATEGORIES.find((c) => c.id === activeCat) ?? CATEGORIES[0]
  const isMobile = useMediaQuery('(max-width: 767px)')
  const setTab = useAppStore((s) => s.setTab)

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-48px)]">
        <span className="font-mono text-[13px] text-muted">Loading settings…</span>
      </div>
    )
  }

  // ── Shared Save button (used in both layouts) ────────────────────────────
  const saveButton = (
    <button
      type="button"
      onClick={handleSave}
      disabled={!hasChanges || saving}
      className={[
        'px-4 py-2 rounded-md font-sans font-medium text-[13px] transition-colors duration-fast flex-shrink-0',
        hasChanges && !saving
          ? 'bg-accent text-bg cursor-pointer hover:bg-accent/80'
          : 'bg-border text-muted cursor-not-allowed opacity-50',
      ].join(' ')}
    >
      {saving ? 'Saving…' : 'Save'}
    </button>
  )

  // ── Feedback tab link — mobile's primary entry point into #feedback ──────
  const feedbackLink = (
    <button
      type="button"
      onClick={() => setTab('feedback')}
      className="text-[12px] font-sans text-text-3 hover:text-accent-lt transition-colors duration-fast cursor-pointer underline underline-offset-2"
    >
      Feedback / bug reports →
    </button>
  )

  // ── Mobile layout (< 768px) ───────────────────────────────────────────────
  if (isMobile) {
    return (
      <div className="flex flex-col h-[calc(100vh-48px)]">
        {/* Horizontal category strip — scrollable pills */}
        <div className="flex-shrink-0 border-b border-border overflow-x-auto">
          <div className="flex gap-2 px-3 py-2.5 w-max min-w-full">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => setActiveCat(cat.id)}
                className={[
                  'flex-shrink-0 px-3 py-1.5 rounded-full text-[13px] font-sans transition-colors duration-fast whitespace-nowrap',
                  activeCat === cat.id
                    ? 'bg-accent/15 text-accent-lt font-medium border border-accent/30'
                    : 'text-text-3 bg-sunken border border-border hover:border-border-strong hover:text-text',
                ].join(' ')}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>

        {/* Form pane — full width, scrollable */}
        <div className="flex-1 overflow-auto p-4 relative">
          {/* Header row: title + Save */}
          <div className="flex items-start justify-between mb-5">
            <div>
              <h2 className="font-sans font-medium text-[20px] text-text leading-tight">
                {activeCategory.label}
              </h2>
              <p className="font-sans text-[12px] text-muted mt-0.5">
                {activeCategory.subtitle}
              </p>
              <div className="mt-1.5">{feedbackLink}</div>
            </div>
            {saveButton}
          </div>

          <CategoryForm
            category={activeCategory}
            allFields={settingsData?.fields ?? []}
            values={effectiveValues}
            onChange={handleChange}
          />
        </div>

        {/* Toast */}
        {toast && <Toast message={toast.msg} type={toast.type} />}
      </div>
    )
  }

  // ── Desktop layout (≥ 768px) — two-column grid ────────────────────────────
  return (
    <div
      className="grid h-[calc(100vh-48px)]"
      style={{ gridTemplateColumns: '200px 1fr' }}
    >
      {/* Left sidebar */}
      <aside className="border-r border-border p-4 flex flex-col gap-1 overflow-hidden overflow-x-auto">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            type="button"
            onClick={() => setActiveCat(cat.id)}
            className={[
              'w-full text-left px-3 py-2 rounded-md text-[13px] font-sans transition-colors duration-fast',
              activeCat === cat.id
                ? 'bg-accent/12 text-accent-lt font-medium'
                : 'text-text-3 hover:bg-surface/50 hover:text-text',
            ].join(' ')}
          >
            {cat.label}
          </button>
        ))}
      </aside>

      {/* Right pane */}
      <div className="p-6 overflow-auto relative">
        {/* Header */}
        <div className="flex items-start justify-between mb-6 max-w-5xl">
          <div>
            <h2 className="font-sans font-medium text-[22px] text-text leading-tight">
              {activeCategory.label}
            </h2>
            <p className="font-sans text-[13px] text-muted mt-0.5">
              {activeCategory.subtitle}
            </p>
            <div className="mt-1.5">{feedbackLink}</div>
          </div>
          {saveButton}
        </div>

        {/* Form */}
        <CategoryForm
          category={activeCategory}
          allFields={settingsData?.fields ?? []}
          values={effectiveValues}
          onChange={handleChange}
        />
      </div>

      {/* Toast */}
      {toast && <Toast message={toast.msg} type={toast.type} />}
    </div>
  )
}
