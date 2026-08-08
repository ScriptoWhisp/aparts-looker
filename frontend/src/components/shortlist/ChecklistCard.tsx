/**
 * ChecklistCard — fully interactive, always-full checklist (Wave 10 rewrite).
 *
 * Wave 7C rendered only the ~2-5 keys the AI happened to fill in from the listing
 * text, leaving 8-11 of the 13 registry keys invisible — and item marks were pure
 * local UI state (AskAtViewing's checkboxes), never persisted. Daniel's reported
 * bug ("чеклист опять сломан, я не могу отметить и написать коммент... я могу
 * видеть пункты которые стоят как 'true', все остальные не видно") is both of
 * those problems at once.
 *
 * This rewrite:
 * - Always renders every key in CHECKLIST_ALL_KEYS, grouped by CHECKLIST_KEY_META.
 * - Merges three sources into one state per item:
 *     final_state = user_marks[key]?.state ?? ai_state_for(key)
 *   where ai_state_for() mirrors the Wave 7C buildGroupsFromFills logic (a filled
 *   AI string means "known" -> ok; an empty/absent key means "unknown").
 * - Each item is a state chip (click to cycle ok -> flag -> unknown -> skip ->
 *   back to the AI default) + label + optional AI-filled context + a note field —
 *   both PATCH persisted to entry.checklist.user_marks via
 *   PATCH /api/entry/{id}/checklist-item.
 * - AskAtViewing.tsx is retired: with every item visible and taggable here,
 *   a separate "unknowns" view added nothing a merged 'unknown' state chip
 *   doesn't already show.
 *
 * NOTE on key coverage: CHECKLIST_KEY_META (frontend/src/lib/checklistMeta.ts)
 * mirrors backend/ai_evaluator.py::AI_FILLABLE_CHECKLIST_KEYS exactly — 13 keys,
 * not "40+". No other key registry exists anywhere in this repo (grepped
 * backend/*.py and frontend/src for any larger manual-checklist source). This is
 * a documented mismatch against the original spec's assumption, not an invented
 * expansion — see docs/design/react-rewrite-progress.md Wave 10 notes.
 */

import { useState, useRef, useMemo } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { Entry, ChecklistItemState, ChecklistUserMark } from '../../types/api'
import { CHECKLIST_ALL_KEYS, CHECKLIST_KEY_META, isKnownStateShorthand } from '../../lib/checklistMeta'
import { patchChecklistItem, type ChecklistItemPatch } from '../../lib/api'
import { QUERY_KEYS } from '../../lib/queries'

// ── Constants ──────────────────────────────────────────────────────────────

const GROUP_META: Record<string, { label: string; label_et: string }> = {
  building_fund: { label: 'Building fund', label_et: 'Remondifond' },
  risk:          { label: 'Risk',          label_et: 'Riskid' },
  finance:       { label: 'Finance',       label_et: 'Rahandus' },
  quality:       { label: 'Quality',       label_et: 'Kvaliteet' },
  location:      { label: 'Location',      label_et: 'Asukoht' },
}

const GROUP_ORDER = ['building_fund', 'risk', 'finance', 'quality', 'location']

// Manual-mark cycle: ok -> flag -> unknown -> skip -> back to AI default (null override).
const CYCLE: (ChecklistItemState | null)[] = ['ok', 'flag', 'unknown', 'skip', null]

// ── State → color / glyph ──────────────────────────────────────────────────

function stateColor(state: ChecklistItemState): string {
  switch (state) {
    case 'ok':      return '#4fb98d'
    case 'flag':    return '#c4635f'
    case 'unknown': return '#75798c'
    case 'skip':    return '#595d6c'
    default:        return '#595d6c'
  }
}

function stateGlyph(state: ChecklistItemState): string {
  switch (state) {
    case 'ok':      return '✓'
    case 'flag':    return '✕'
    case 'unknown': return '?'
    case 'skip':    return '—'
    default:        return '?'
  }
}

// ── Merged item model ────────────────────────────────────────────────────

interface MergedItem {
  key: string
  label: string
  state: ChecklistItemState   // final = user override ?? AI-derived
  hasOverride: boolean        // true if user_marks[key].state is explicitly set
  aiNote: string | null       // AI-filled context text, if the AI found an answer
  userNote: string | null     // user's own persisted note
  hasAnyMark: boolean         // true if user_marks has ANY entry (state and/or note) for this key
}

interface MergedGroup {
  key: string
  label: string
  label_et: string
  items: MergedItem[]
}

function worstState(items: MergedItem[]): ChecklistItemState {
  if (items.some((i) => i.state === 'flag'))    return 'flag'
  if (items.some((i) => i.state === 'unknown')) return 'unknown'
  if (items.some((i) => i.state === 'ok'))      return 'ok'
  return 'skip'
}

/** AI-derived state + context note for a single key from ai_checklist_fills.
 *
 * Real production shape: key -> "filled text" (present only when the AI found an
 * explicit answer). A legacy object shape (key -> {state, note}) is also honored
 * for backward compat with manual/legacy fixtures and any pre-Wave-10 data.
 */
function aiStateFor(
  key: string,
  fills: Record<string, unknown> | null | undefined,
): { state: ChecklistItemState; note: string | null } {
  const v = fills?.[key]
  if (v == null) return { state: 'unknown', note: null }

  if (typeof v === 'object') {
    const obj = v as { state?: string; note?: string }
    return { state: (obj.state as ChecklistItemState) ?? 'unknown', note: obj.note ?? null }
  }

  const text = String(v).trim()
  if (text === '') return { state: 'unknown', note: null }
  if (isKnownStateShorthand(text)) return { state: text as ChecklistItemState, note: null }
  // A real AI-filled answer — presence means "known", the text is shown as context.
  return { state: 'ok', note: text }
}

function buildMergedGroups(entry: Entry): MergedGroup[] {
  const fills = entry.ai_checklist_fills
  const userMarks = entry.checklist?.user_marks ?? {}

  const byGroup = new Map<string, MergedItem[]>()
  for (const key of CHECKLIST_ALL_KEYS) {
    const meta = CHECKLIST_KEY_META[key]
    if (!meta) continue
    const { state: aiState, note: aiNote } = aiStateFor(key, fills)
    const mark: ChecklistUserMark | undefined = userMarks[key]
    const hasOverride = mark?.state != null
    const finalState = (mark?.state ?? aiState) as ChecklistItemState

    const item: MergedItem = {
      key,
      label: meta.label,
      state: finalState,
      hasOverride,
      aiNote,
      userNote: mark?.note ?? null,
      hasAnyMark: mark != null,
    }
    const arr = byGroup.get(meta.group) ?? []
    arr.push(item)
    byGroup.set(meta.group, arr)
  }

  return GROUP_ORDER
    .map((g) => ({
      key: g,
      label: GROUP_META[g]?.label ?? g,
      label_et: GROUP_META[g]?.label_et ?? '',
      items: byGroup.get(g) ?? [],
    }))
    .filter((g) => g.items.length > 0)
}

/** Next state in the manual cycle: ok -> flag -> unknown -> skip -> AI default (null). */
function nextState(item: MergedItem): ChecklistItemState | null {
  const current = item.hasOverride ? item.state : null
  const idx = CYCLE.indexOf(current)
  return CYCLE[(idx + 1) % CYCLE.length]
}

// ── Signal strip ─────────────────────────────────────────────────────────

function SignalStrip({ items }: { items: MergedItem[] }) {
  return (
    <div className="flex gap-[3px] flex-wrap">
      {items.map((item) => (
        <div
          key={item.key}
          title={item.label}
          className="w-[7px] h-[7px] rounded-[2px] flex-none"
          style={{ background: stateColor(item.state) }}
        />
      ))}
    </div>
  )
}

// ── State chip ───────────────────────────────────────────────────────────

function StateChip({
  state,
  itemKey,
  onClick,
}: {
  state: ChecklistItemState
  itemKey: string
  onClick: () => void
}) {
  const color = stateColor(state)
  return (
    <button
      type="button"
      onClick={onClick}
      title="Click to change your mark"
      aria-label={`Checklist item state: ${state}. Click to change.`}
      data-testid={`checklist-chip-${itemKey}`}
      data-state={state}
      className="flex-none w-7 h-7 min-w-[28px] min-h-[28px] rounded-md border flex items-center justify-center font-mono text-[13px] transition-colors duration-fast hover:brightness-125 active:scale-95"
      style={{ color, borderColor: `${color}55`, background: `${color}14` }}
    >
      {stateGlyph(state)}
    </button>
  )
}

// ── Item row ─────────────────────────────────────────────────────────────

interface ItemRowProps {
  item: MergedItem
  onCycleState: (item: MergedItem) => void
  onSaveNote: (key: string, note: string | null) => void
}

function ItemRow({ item, onCycleState, onSaveNote }: ItemRowProps) {
  const [noteOpen, setNoteOpen] = useState(!!item.userNote)
  const [noteDraft, setNoteDraft] = useState(item.userNote ?? '')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function handleNoteChange(v: string) {
    setNoteDraft(v)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      onSaveNote(item.key, v.trim() === '' ? null : v)
    }, 800)
  }

  return (
    <div className="flex items-start gap-2 py-1.5 px-3">
      <StateChip state={item.state} itemKey={item.key} onClick={() => onCycleState(item)} />
      <div className="flex-1 min-w-0">
        <p className="text-[13px] text-text-2 leading-snug">{item.label}</p>
        {item.aiNote && (
          <p className="text-[11px] text-muted mt-0.5">{item.aiNote}</p>
        )}
        {!noteOpen ? (
          <button
            type="button"
            onClick={() => setNoteOpen(true)}
            data-testid={`checklist-note-toggle-${item.key}`}
            className="text-[11px] text-accent hover:text-accent-lt mt-1 transition-colors"
          >
            + note
          </button>
        ) : (
          <textarea
            value={noteDraft}
            onChange={(e) => handleNoteChange(e.target.value)}
            placeholder="Your note…"
            rows={2}
            data-testid={`checklist-note-textarea-${item.key}`}
            className={[
              'mt-1 w-full text-[12px] bg-surface/50 border border-border rounded px-2 py-1.5',
              'text-text-2 resize-none focus:outline-none focus:border-accent/60 transition-colors',
            ].join(' ')}
          />
        )}
      </div>
    </div>
  )
}

// ── Group header ─────────────────────────────────────────────────────────

interface GroupHeaderProps {
  group: MergedGroup
  isOpen: boolean
  onToggle: () => void
}

function GroupHeader({ group, isOpen, onToggle }: GroupHeaderProps) {
  const worst = worstState(group.items)
  const borderColor = stateColor(worst)
  const flags   = group.items.filter((i) => i.state === 'flag').length
  const unknown = group.items.filter((i) => i.state === 'unknown').length
  const ok      = group.items.filter((i) => i.state === 'ok').length

  const countText = [
    flags   > 0 ? `${flags} flag`    : '',
    unknown > 0 ? `${unknown} unknown` : '',
    ok      > 0 ? `${ok} ok`          : '',
  ].filter(Boolean).join(' · ')

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={isOpen}
      data-testid={`checklist-group-header-${group.key}`}
      className={[
        'w-full flex items-start gap-3 py-2 pl-3 pr-3 text-left',
        'border-l-2 hover:bg-surface/40 transition-colors duration-fast',
      ].join(' ')}
      style={{ borderLeftColor: borderColor }}
    >
      <div className="flex flex-col min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {isOpen ? (
            <ChevronDown size={12} className="text-muted flex-none mt-[1px]" />
          ) : (
            <ChevronRight size={12} className="text-muted flex-none mt-[1px]" />
          )}
          <span className="text-[13px] font-medium text-text">{group.label}</span>
          <span className="text-[11px] text-muted">{group.label_et}</span>
        </div>
        <div className="mt-1.5 ml-[18px]">
          <SignalStrip items={group.items} />
        </div>
      </div>
      <span className="text-[11px] text-muted flex-none self-center">{countText}</span>
    </button>
  )
}

// ── Main ChecklistCard ─────────────────────────────────────────────────────

interface ChecklistCardProps {
  entry: Entry
}

export function ChecklistCard({ entry }: ChecklistCardProps) {
  const qc = useQueryClient()

  // Optimistic local overrides — cleared on error revert. Not cleared on success;
  // the next appData refetch will carry the same value, so no flicker.
  const [localOverrides, setLocalOverrides] = useState<Record<string, Partial<ChecklistUserMark>>>({})

  const effectiveEntry: Entry = useMemo(() => {
    if (Object.keys(localOverrides).length === 0) return entry
    const baseMarks = entry.checklist?.user_marks ?? {}
    const mergedMarks: Record<string, ChecklistUserMark> = { ...baseMarks }
    for (const [key, override] of Object.entries(localOverrides)) {
      mergedMarks[key] = { ...mergedMarks[key], ...override }
    }
    return { ...entry, checklist: { ...(entry.checklist ?? {}), user_marks: mergedMarks } }
  }, [entry, localOverrides])

  const groups = useMemo(() => buildMergedGroups(effectiveEntry), [effectiveEntry])

  // Open by default iff group has a flag OR any user_mark (indicates user attention).
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {}
    for (const g of groups) {
      init[g.key] = g.items.some((i) => i.state === 'flag' || i.hasAnyMark)
    }
    return init
  })

  function toggleGroup(key: string) {
    setOpenGroups((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const [errorNotice, setErrorNotice] = useState<string | null>(null)
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  function flashError(msg: string) {
    setErrorNotice(msg)
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current)
    errorTimerRef.current = setTimeout(() => setErrorNotice(null), 2500)
  }

  const mutation = useMutation({
    mutationFn: (payload: ChecklistItemPatch) => patchChecklistItem(entry.id, payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: QUERY_KEYS.appData })
    },
  })

  function handleCycleState(item: MergedItem) {
    const next = nextState(item)
    setLocalOverrides((prev) => ({ ...prev, [item.key]: { ...prev[item.key], state: next } }))
    mutation.mutate(
      { key: item.key, state: next },
      {
        onError: () => {
          setLocalOverrides((prev) => {
            const rest = { ...prev }
            delete rest[item.key]
            return rest
          })
          flashError('Could not save — reverted')
        },
      },
    )
  }

  function handleSaveNote(key: string, note: string | null) {
    const previous = localOverrides[key]?.note
    setLocalOverrides((prev) => ({ ...prev, [key]: { ...prev[key], note } }))
    mutation.mutate(
      { key, note },
      {
        onError: () => {
          setLocalOverrides((prev) => ({ ...prev, [key]: { ...prev[key], note: previous } }))
          flashError('Could not save note — reverted')
        },
      },
    )
  }

  const totalItems   = groups.reduce((s, g) => s + g.items.length, 0)
  const unknownCount = groups.reduce((s, g) => s + g.items.filter((i) => i.state === 'unknown').length, 0)
  const flagCount    = groups.reduce((s, g) => s + g.items.filter((i) => i.state === 'flag').length, 0)
  const okCount      = groups.reduce((s, g) => s + g.items.filter((i) => i.state === 'ok').length, 0)

  return (
    <div className="bg-sunken rounded-lg overflow-hidden flex flex-col max-h-[70vh] md:h-full md:max-h-none">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border flex-none">
        <span className="text-[13px] font-medium text-text">Checklist</span>
        <span className="text-[11px] text-muted font-mono">
          {flagCount > 0 && <span className="text-score-bad">{flagCount} flag </span>}
          {unknownCount > 0 && <span>{unknownCount} unknown </span>}
          {okCount > 0 && <span className="text-status-short">{okCount} ok</span>}
        </span>
      </div>

      {errorNotice && (
        <div className="px-3 py-1 text-[11px] text-score-bad bg-score-bad/10 flex-none">
          {errorNotice}
        </div>
      )}

      {/* Groups */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {groups.map((group) => (
          <div key={group.key} className="border-b border-border/50 last:border-b-0">
            <GroupHeader
              group={group}
              isOpen={openGroups[group.key] ?? false}
              onToggle={() => toggleGroup(group.key)}
            />
            <AnimatePresence initial={false}>
              {(openGroups[group.key]) && (
                <motion.div
                  key="body"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.16, ease: 'easeInOut' }}
                  className="overflow-hidden"
                >
                  <div className="pb-1">
                    {group.items.map((item) => (
                      <ItemRow
                        key={item.key}
                        item={item}
                        onCycleState={handleCycleState}
                        onSaveNote={handleSaveNote}
                      />
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ))}
      </div>

      {/* Bottom meta */}
      {totalItems > 0 && (
        <div className="px-3 py-2 border-t border-border/50 flex-none">
          <p className="text-[11px] text-muted">
            {totalItems} items
            {unknownCount > 0 && ` · ${unknownCount} unmarked`}
          </p>
        </div>
      )}
    </div>
  )
}
