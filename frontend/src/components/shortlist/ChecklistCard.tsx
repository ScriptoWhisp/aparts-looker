/**
 * ChecklistCard — full checklist registry, section-based collapsible UI (Wave A).
 *
 * Wave 10 rendered a flat 13-key AI-fillable subset. Wave A expands the
 * registry to ~96 items across 4 sections Daniel actually uses when
 * evaluating a Tallinn apartment:
 *   - Оценка по критериям (evaluation, 13 items — AI can autofill several)
 *   - Вопросы продавцу (ask_seller, 16 items — questions to ask the seller/agent)
 *   - Документы к запросу (request_docs, 20 items — docs to request + e-kinnistusraamat)
 *   - На месте (onsite, 47 items across 5 physical-inspection sub-groups)
 *
 * The registry itself is fetched once from GET /api/checklist-registry
 * (useChecklistRegistry, lib/queries.ts, 1h staleTime) — this component never
 * hardcodes the item list. Per-item state still merges three sources exactly
 * as Wave 10 did:
 *   final_state = user_marks[key]?.state ?? ai_state_for(key)
 * with a frontend-side legacy-key fallback (lookupWithLegacyFallback) so a
 * listing whose checklist.user_marks / ai_checklist_fills still carries a
 * pre-Wave-A key (s09/s14/s16) renders correctly even before it has been
 * re-marked (which is when the backend's lazy migration actually fires).
 *
 * Mobile-first: state chips and note-toggle buttons are >=44px touch targets;
 * the note textarea uses text-base (16px) so iOS does not zoom on focus.
 */

import { useMemo, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type {
  ChecklistRegistryResponse,
  ChecklistItemState,
  ChecklistUserMark,
  Entry,
} from '../../types/api'
import { useChecklistRegistry } from '../../lib/queries'
import { buildReverseLegacyMap, isKnownStateShorthand, lookupWithLegacyFallback } from '../../lib/checklistMeta'
import { patchChecklistItem, type ChecklistItemPatch } from '../../lib/api'
import { QUERY_KEYS } from '../../lib/queries'

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

// 4-state cycle: unknown -> ok -> flag -> skip -> unknown.
const CYCLE: ChecklistItemState[] = ['unknown', 'ok', 'flag', 'skip']

function nextState(current: ChecklistItemState): ChecklistItemState {
  const idx = CYCLE.indexOf(current)
  return CYCLE[(idx + 1) % CYCLE.length]
}

// ── Filter ───────────────────────────────────────────────────────────────

type FilterKey = 'all' | 'todo' | 'ok' | 'flagged'

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all',     label: 'All' },
  { key: 'todo',    label: 'To do' },
  { key: 'ok',      label: 'OK' },
  { key: 'flagged', label: 'Flagged' },
]

function matchesFilter(state: ChecklistItemState, filter: FilterKey): boolean {
  if (filter === 'all') return true
  if (filter === 'todo') return state === 'unknown'
  if (filter === 'ok') return state === 'ok'
  return state === 'flag'
}

// ── Merged item model ────────────────────────────────────────────────────

interface MergedItem {
  key: string
  label_ru: string
  hint: string | null
  state: ChecklistItemState   // final = user override ?? AI-derived
  hasOverride: boolean
  aiNote: string | null
  userNote: string | null
  hasAnyMark: boolean
}

interface MergedGroup {
  id: string
  label_ru: string
  items: MergedItem[]
}

interface MergedSection {
  id: string
  label_ru: string
  subgrouped: boolean
  groups: MergedGroup[]
}

/** AI-derived state + context note for a single key's raw fill value.
 *
 * Real production shape: key -> "filled text" (present only when the AI found
 * an explicit answer). A legacy object shape (key -> {state, note}) is also
 * honored for backward compat with manual/legacy fixtures.
 */
function aiStateFor(raw: unknown): { state: ChecklistItemState; note: string | null } {
  if (raw == null) return { state: 'unknown', note: null }

  if (typeof raw === 'object') {
    const obj = raw as { state?: string; note?: string }
    return { state: (obj.state as ChecklistItemState) ?? 'unknown', note: obj.note ?? null }
  }

  const text = String(raw).trim()
  if (text === '') return { state: 'unknown', note: null }
  if (isKnownStateShorthand(text)) return { state: text as ChecklistItemState, note: null }
  return { state: 'ok', note: text }
}

function buildMergedSections(
  entry: Entry,
  registry: ChecklistRegistryResponse,
): MergedSection[] {
  const fills = (entry.ai_checklist_fills ?? {}) as Record<string, unknown>
  const userMarks = (entry.checklist?.user_marks ?? {}) as Record<string, ChecklistUserMark>
  const reverseLegacy = buildReverseLegacyMap(registry)

  return registry.sections.map((section) => ({
    id: section.id,
    label_ru: section.label_ru,
    subgrouped: section.subgrouped,
    groups: section.groups.map((group) => ({
      id: group.id,
      label_ru: group.label_ru,
      items: group.items.map((def): MergedItem => {
        const rawFill = lookupWithLegacyFallback(def.key, fills, reverseLegacy)
        const { state: aiState, note: aiNote } = aiStateFor(rawFill)
        const mark = lookupWithLegacyFallback(def.key, userMarks, reverseLegacy)
        const hasOverride = mark?.state != null
        const finalState = (mark?.state ?? aiState) as ChecklistItemState
        return {
          key: def.key,
          label_ru: def.label_ru,
          hint: def.hint,
          state: finalState,
          hasOverride,
          aiNote,
          userNote: mark?.note ?? null,
          hasAnyMark: mark != null,
        }
      }),
    })),
  }))
}

function flattenSectionItems(section: MergedSection): MergedItem[] {
  return section.groups.flatMap((g) => g.items)
}

function markedCount(items: MergedItem[]): number {
  return items.filter((i) => i.state === 'ok' || i.state === 'flag').length
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
      title="Tap to change your mark"
      aria-label={`Checklist item state: ${state}. Tap to change.`}
      data-testid={`checklist-chip-${itemKey}`}
      data-state={state}
      className="flex-none w-11 h-11 min-w-[44px] min-h-[44px] rounded-md border flex items-center justify-center font-mono text-[15px] transition-colors duration-fast hover:brightness-125 active:scale-95"
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
    <div className="flex items-start gap-2 py-2 px-3">
      <StateChip state={item.state} itemKey={item.key} onClick={() => onCycleState(item)} />
      <div className="flex-1 min-w-0">
        <p className="text-[13px] text-text-2 leading-snug">{item.label_ru}</p>
        {item.hint && !item.aiNote && (
          <p className="text-[11px] text-muted mt-0.5">{item.hint}</p>
        )}
        {item.aiNote && (
          <p className="text-[11px] text-muted mt-0.5">{item.aiNote}</p>
        )}
        {!noteOpen ? (
          <button
            type="button"
            onClick={() => setNoteOpen(true)}
            data-testid={`checklist-note-toggle-${item.key}`}
            className="min-h-[44px] flex items-center text-[11px] text-accent hover:text-accent-lt transition-colors -ml-0.5 px-0.5"
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
              'mt-1 w-full text-base bg-surface/50 border border-border rounded px-2 py-1.5',
              'text-text-2 resize-none focus:outline-none focus:border-accent/60 transition-colors',
            ].join(' ')}
          />
        )}
      </div>
    </div>
  )
}

// ── Section header ───────────────────────────────────────────────────────

interface SectionHeaderProps {
  section: MergedSection
  visibleCount: number
  isOpen: boolean
  onToggle: () => void
}

function SectionHeader({ section, visibleCount, isOpen, onToggle }: SectionHeaderProps) {
  const items = flattenSectionItems(section)
  const marked = markedCount(items)
  const flagged = items.filter((i) => i.state === 'flag').length
  const borderColor = flagged > 0 ? stateColor('flag') : 'transparent'

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={isOpen}
      data-testid={`checklist-section-header-${section.id}`}
      className={[
        'w-full min-h-[44px] flex items-center gap-2 py-2.5 pl-3 pr-3 text-left',
        'border-l-2 hover:bg-surface/40 transition-colors duration-fast',
      ].join(' ')}
      style={{ borderLeftColor: borderColor }}
    >
      {isOpen ? (
        <ChevronDown size={14} className="text-muted flex-none" />
      ) : (
        <ChevronRight size={14} className="text-muted flex-none" />
      )}
      <span className="text-[14px] font-medium text-text flex-1 min-w-0">
        {section.label_ru}
      </span>
      <span className="text-[11px] text-muted flex-none font-mono">
        {marked}/{items.length}
        {visibleCount !== items.length ? ` · ${visibleCount} shown` : ''}
      </span>
    </button>
  )
}

// ── Sub-group header (onsite only — smaller/italic, no counter) ────────────

function SubGroupHeader({
  group,
  isOpen,
  onToggle,
}: {
  group: MergedGroup
  isOpen: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={isOpen}
      data-testid={`checklist-group-header-${group.id}`}
      className="w-full min-h-[40px] flex items-center gap-1.5 py-1.5 pl-6 pr-3 text-left hover:bg-surface/30 transition-colors duration-fast"
    >
      {isOpen ? (
        <ChevronDown size={11} className="text-muted flex-none" />
      ) : (
        <ChevronRight size={11} className="text-muted flex-none" />
      )}
      <span className="text-[12px] italic text-muted">{group.label_ru}</span>
    </button>
  )
}

// ── Main ChecklistCard ─────────────────────────────────────────────────────

interface ChecklistCardProps {
  entry: Entry
}

export function ChecklistCard({ entry }: ChecklistCardProps) {
  const qc = useQueryClient()
  const { data: registry, isLoading: registryLoading } = useChecklistRegistry()

  // Optimistic local overrides — cleared on error revert.
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

  const sections = useMemo(
    () => (registry ? buildMergedSections(effectiveEntry, registry) : []),
    [effectiveEntry, registry],
  )

  const [filter, setFilter] = useState<FilterKey>('all')

  // Default openness is DERIVED (not baked into initial state) because the
  // registry — and therefore `sections` — only becomes available after the
  // first async fetch resolves; a useState initializer would run before that
  // and freeze every section/group as closed. A section/sub-group defaults
  // open iff it has a flagged item or any user mark (draws attention without
  // a click); `openSections`/`openGroups` only record explicit user toggles
  // that override that default.
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({})
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})

  function defaultSectionOpen(section: MergedSection): boolean {
    return flattenSectionItems(section).some((i) => i.state === 'flag' || i.hasAnyMark)
  }
  function defaultGroupOpen(group: MergedGroup): boolean {
    return group.items.some((i) => i.state === 'flag' || i.hasAnyMark)
  }

  function toggleSection(id: string, fallback: boolean) {
    setOpenSections((prev) => ({ ...prev, [id]: !(prev[id] ?? fallback) }))
  }
  function toggleGroup(key: string, fallback: boolean) {
    setOpenGroups((prev) => ({ ...prev, [key]: !(prev[key] ?? fallback) }))
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
    const next = nextState(item.state)
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

  const allItems = useMemo(() => sections.flatMap(flattenSectionItems), [sections])
  const totalItems = allItems.length
  const totalMarked = markedCount(allItems)

  if (registryLoading || !registry) {
    return (
      <div className="bg-sunken rounded-lg overflow-hidden flex flex-col max-h-[70vh] md:max-h-[calc(100vh-260px)]">
        <div className="px-3 py-2.5 border-b border-border flex-none">
          <span className="text-[13px] font-medium text-text">Checklist</span>
        </div>
        <div className="px-3 py-4 text-[12px] text-muted">Loading checklist…</div>
      </div>
    )
  }

  return (
    <div className="bg-sunken rounded-lg overflow-hidden flex flex-col max-h-[70vh] md:max-h-[calc(100vh-260px)]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border flex-none">
        <span className="text-[13px] font-medium text-text">Checklist</span>
        <span className="text-[11px] text-muted font-mono">
          {totalMarked}/{totalItems} marked
        </span>
      </div>

      {/* Filter chips */}
      <div className="flex gap-1.5 px-3 py-2 border-b border-border/50 flex-none overflow-x-auto">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            data-testid={`checklist-filter-${f.key}`}
            aria-pressed={filter === f.key}
            className={[
              'min-h-[32px] px-3 rounded-full text-[12px] flex-none transition-colors duration-fast',
              filter === f.key
                ? 'bg-accent/20 text-accent border border-accent/40'
                : 'bg-surface/40 text-muted border border-border hover:text-text-2',
            ].join(' ')}
          >
            {f.label}
          </button>
        ))}
      </div>

      {errorNotice && (
        <div className="px-3 py-1 text-[11px] text-score-bad bg-score-bad/10 flex-none">
          {errorNotice}
        </div>
      )}

      {/* Sections */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {sections.map((section) => {
          const items = flattenSectionItems(section)
          const visibleItems = items.filter((i) => matchesFilter(i.state, filter))
          if (filter !== 'all' && visibleItems.length === 0) return null

          const defaultOpen = defaultSectionOpen(section)
          const forceOpen = filter !== 'all' && visibleItems.length > 0
          const isOpen = forceOpen || (openSections[section.id] ?? defaultOpen)

          return (
            <div key={section.id} className="border-b border-border/50 last:border-b-0">
              <SectionHeader
                section={section}
                visibleCount={visibleItems.length}
                isOpen={isOpen}
                onToggle={() => toggleSection(section.id, defaultOpen)}
              />
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    key="body"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.16, ease: 'easeInOut' }}
                    className="overflow-hidden"
                  >
                    <div className="pb-1">
                      {section.subgrouped
                        ? section.groups.map((group) => {
                            const groupVisible = group.items.filter((i) =>
                              matchesFilter(i.state, filter),
                            )
                            if (filter !== 'all' && groupVisible.length === 0) return null
                            const groupKey = `${section.id}:${group.id}`
                            const groupDefaultOpen = defaultGroupOpen(group)
                            const groupForceOpen = filter !== 'all' && groupVisible.length > 0
                            const groupOpen = groupForceOpen || (openGroups[groupKey] ?? groupDefaultOpen)
                            return (
                              <div key={group.id}>
                                <SubGroupHeader
                                  group={group}
                                  isOpen={groupOpen}
                                  onToggle={() => toggleGroup(groupKey, groupDefaultOpen)}
                                />
                                <AnimatePresence initial={false}>
                                  {groupOpen && (
                                    <motion.div
                                      key="group-body"
                                      initial={{ height: 0, opacity: 0 }}
                                      animate={{ height: 'auto', opacity: 1 }}
                                      exit={{ height: 0, opacity: 0 }}
                                      transition={{ duration: 0.14, ease: 'easeInOut' }}
                                      className="overflow-hidden"
                                    >
                                      {groupVisible.map((item) => (
                                        <ItemRow
                                          key={item.key}
                                          item={item}
                                          onCycleState={handleCycleState}
                                          onSaveNote={handleSaveNote}
                                        />
                                      ))}
                                    </motion.div>
                                  )}
                                </AnimatePresence>
                              </div>
                            )
                          })
                        : visibleItems.map((item) => (
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
          )
        })}
      </div>

      {/* Bottom meta */}
      {totalItems > 0 && (
        <div className="px-3 py-2 border-t border-border/50 flex-none">
          <p className="text-[11px] text-muted">
            {totalItems} items · {totalMarked} marked
          </p>
        </div>
      )}
    </div>
  )
}
