/**
 * ChecklistCard — accordion checklist with flag-first ordering + signal strip.
 *
 * SPEC §2.5 mockup 1c:
 * - 5 groups in flags-first order
 * - Each group header: 2px left rule in worst-item color, name, Estonian sub-label,
 *   signal strip (7×7 rounded squares per item), status count, chevron
 * - Open by default iff group contains a flag
 * - Expanded: items with glyph (✓/!/? ) + label + optional pts
 * - Consecutive ok items at end collapse into one summary row
 * - Bottom: "N items · the M unknowns become your viewing questions"
 *
 * The checklist data lives in entry.checklist.groups (typed ChecklistGroup[]).
 * If groups is absent but ai_checklist_fills exists, we build a synthetic structure
 * from the fill data so old entries still render something useful.
 */

import { useState, useMemo } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { Entry, ChecklistGroup, ChecklistItem, ChecklistItemState } from '../../types/api'
import { CHECKLIST_KEY_META, isKnownStateShorthand } from '../../lib/checklistMeta'

// ── Constants ──────────────────────────────────────────────────────────────

// Group display order and Estonian sub-labels
const GROUP_META: Record<string, { label: string; label_et: string }> = {
  building_fund: { label: 'Building fund', label_et: 'Remondifond' },
  risk:          { label: 'Risk',          label_et: 'Riskid' },
  finance:       { label: 'Finance',       label_et: 'Rahandus' },
  quality:       { label: 'Quality',       label_et: 'Kvaliteet' },
  location:      { label: 'Location',      label_et: 'Asukoht' },
}

// Preferred display order
const GROUP_ORDER = ['building_fund', 'risk', 'finance', 'quality', 'location']

// ── State → color / glyph ──────────────────────────────────────────────────

function stateColor(state: ChecklistItemState): string {
  switch (state) {
    case 'ok':      return '#4fb98d'   // score-best green
    case 'flag':    return '#c4635f'   // score-bad red
    case 'unknown': return '#75798c'   // muted
    case 'skip':    return '#595d6c'   // faint
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

function worstState(items: ChecklistItem[]): ChecklistItemState {
  if (items.some((i) => i.state === 'flag'))    return 'flag'
  if (items.some((i) => i.state === 'unknown')) return 'unknown'
  if (items.some((i) => i.state === 'ok'))      return 'ok'
  return 'skip'
}

// ── Signal strip — one 7×7 square per item ────────────────────────────────

function SignalStrip({ items }: { items: ChecklistItem[] }) {
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

// ── Build synthetic groups from ai_checklist_fills ─────────────────────────
//
// Two shapes have to be supported:
//   1. Legacy/object shape:  key → {state, label, pts, note}
//   2. Real production shape (backend/ai_evaluator.py checklist_fills → RU text):
//      key → "<filled-in text>", e.g. { s14_01: "Kesklinn, 15 min to Bolt HQ" }
//      A key is only present when the AI found an explicit answer — so a filled
//      string means "known" (state=ok), and the string itself is the note shown
//      under the item label (not the state — the previous version wrongly cast
//      the raw text as the ChecklistItemState enum, which never matched any of
//      ok/flag/unknown/skip and rendered as a gray "?" for every real listing).
//   A bare shorthand string like "ok" / "flag" / "unknown" / "skip" is also
//   accepted for legacy/manual test fixtures.

function buildGroupsFromFills(fills: Record<string, unknown>): ChecklistGroup[] {
  const groups: ChecklistGroup[] = GROUP_ORDER.map((key) => ({
    key,
    label:    GROUP_META[key]?.label    ?? key,
    label_et: GROUP_META[key]?.label_et ?? '',
    items: [],
  }))

  for (const [k, v] of Object.entries(fills)) {
    const meta = CHECKLIST_KEY_META[k]
    const raw = v as { state?: string; label?: string; pts?: number; note?: string } | string

    let state: ChecklistItemState
    let label: string
    let pts = 0
    let note: string | null = null

    if (raw && typeof raw === 'object') {
      // Legacy/object shape — unchanged behavior.
      state = (raw.state as ChecklistItemState) ?? 'unknown'
      label = raw.label ?? meta?.label ?? k
      pts   = raw.pts ?? 0
      note  = raw.note ?? null
    } else {
      const text = String(raw ?? '').trim()
      if (text === '') continue // whitelist should already drop empties, but be defensive
      if (isKnownStateShorthand(text)) {
        // Bare enum shorthand (manual/legacy fixtures) — text IS the state.
        state = text as ChecklistItemState
        label = meta?.label ?? k
      } else {
        // Real AI-filled text — presence of an explicit answer means "known/ok".
        state = 'ok'
        label = meta?.label ?? k
        note  = text
      }
    }

    // Assign via the shared key registry; fall back to a prefix guess, then 'quality'.
    const groupKey = meta?.group ?? GROUP_ORDER.find((g) => k.startsWith(g)) ?? 'quality'
    const group = groups.find((g) => g.key === groupKey)
    if (group) {
      group.items.push({ key: k, label, state, pts, note })
    }
  }

  return groups.filter((g) => g.items.length > 0)
}

// ── Group header ──────────────────────────────────────────────────────────

interface GroupHeaderProps {
  group: ChecklistGroup
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

  const meta = GROUP_META[group.key]

  return (
    <button
      type="button"
      onClick={onToggle}
      className={[
        'w-full flex items-start gap-3 py-2 pl-3 pr-3 text-left',
        'border-l-2 hover:bg-surface/40 transition-colors duration-fast',
      ].join(' ')}
      style={{ borderLeftColor: borderColor }}
    >
      {/* Group name + Estonian sub-label */}
      <div className="flex flex-col min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {isOpen ? (
            <ChevronDown size={12} className="text-muted flex-none mt-[1px]" />
          ) : (
            <ChevronRight size={12} className="text-muted flex-none mt-[1px]" />
          )}
          <span className="text-[13px] font-medium text-text">
            {meta?.label ?? group.label}
          </span>
          <span className="text-[11px] text-muted">
            {meta?.label_et ?? group.label_et}
          </span>
        </div>
        {/* Signal strip */}
        <div className="mt-1.5 ml-[18px]">
          <SignalStrip items={group.items} />
        </div>
      </div>

      {/* Count text */}
      <span className="text-[11px] text-muted flex-none self-center">{countText}</span>
    </button>
  )
}

// ── Item row ──────────────────────────────────────────────────────────────

function ItemRow({ item }: { item: ChecklistItem }) {
  return (
    <div className="flex items-baseline gap-2 py-1 px-4">
      <span
        className="font-mono text-[13px] flex-none w-4 text-center"
        style={{ color: stateColor(item.state) }}
      >
        {stateGlyph(item.state)}
      </span>
      <span className="text-[13px] text-text-2 flex-1 min-w-0">
        {item.label}
        {item.note && (
          <span className="block text-[11px] text-muted mt-0.5">{item.note}</span>
        )}
      </span>
      {item.pts && item.pts < 0 && (
        <span className="text-[11px] font-mono text-muted flex-none">{item.pts} pts</span>
      )}
    </div>
  )
}

// ── Collapsed ok tail row ──────────────────────────────────────────────────

function CollapsedOkRow({ items }: { items: ChecklistItem[] }) {
  if (items.length === 0) return null
  if (items.length === 1) return <ItemRow item={items[0]} />

  // Show first 2 labels + "N more"
  const visible = items.slice(0, 2)
  const rest = items.length - 2

  return (
    <div className="flex items-baseline gap-1 py-1 px-4">
      <span className="font-mono text-[13px] flex-none w-4 text-center" style={{ color: stateColor('ok') }}>
        ✓
      </span>
      <span className="text-[13px] text-muted flex-1 min-w-0">
        {visible.map((i) => i.label).join(' · ')}
        {rest > 0 && ` · +${rest} more`}
      </span>
    </div>
  )
}

// ── Checklist group body ──────────────────────────────────────────────────

function GroupBody({ group }: { group: ChecklistGroup }) {
  // Find the last consecutive ok run at the end
  let tailStart = group.items.length
  for (let i = group.items.length - 1; i >= 0; i--) {
    if (group.items[i].state === 'ok') tailStart = i
    else break
  }
  const nonTail = group.items.slice(0, tailStart)
  const tail    = group.items.slice(tailStart)

  // NOTE: when every item in the group is 'ok', the scan above walks all the
  // way to tailStart=0, so `tail` already equals the full items array — there
  // is no separate "nonTail is empty" case to additionally render. A prior
  // version had a second `nonTail.length === 0 && ok.length > 0` branch here
  // that duplicated every item in an all-ok group (rendered twice). Since
  // `tail` already fully covers that scenario, the extra branch was always
  // 100% redundant with it — removed rather than guarded, to avoid ever
  // reintroducing the duplicate-render bug.
  return (
    <div className="pb-1">
      {nonTail.map((item) => (
        <ItemRow key={item.key} item={item} />
      ))}
      {tail.length > 0 && (
        <CollapsedOkRow items={tail} />
      )}
    </div>
  )
}

// ── Main ChecklistCard ────────────────────────────────────────────────────

interface ChecklistCardProps {
  entry: Entry
}

export function ChecklistCard({ entry }: ChecklistCardProps) {
  // Resolve groups: prefer entry.checklist.groups, else build from ai_checklist_fills
  const groups: ChecklistGroup[] = useMemo(() => {
    const fromChecklist = entry.checklist?.groups
    if (fromChecklist && fromChecklist.length > 0) {
      // Sort: flags first, then unknown, then ok
      return [...fromChecklist].sort((a, b) => {
        const priority = { flag: 0, unknown: 1, ok: 2, skip: 3 }
        return (priority[worstState(a.items)] ?? 3) - (priority[worstState(b.items)] ?? 3)
      })
    }
    const fills = entry.ai_checklist_fills
    if (fills && Object.keys(fills).length > 0) {
      return buildGroupsFromFills(fills)
    }
    return []
  }, [entry.checklist, entry.ai_checklist_fills])

  // Open by default iff group contains a flag
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {}
    for (const g of groups) {
      init[g.key] = g.items.some((i) => i.state === 'flag')
    }
    return init
  })

  function toggleGroup(key: string) {
    setOpenGroups((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const totalItems   = groups.reduce((s, g) => s + g.items.length, 0)
  const unknownCount = groups.reduce((s, g) => s + g.items.filter((i) => i.state === 'unknown').length, 0)
  const flagCount    = groups.reduce((s, g) => s + g.items.filter((i) => i.state === 'flag').length, 0)
  const okCount      = groups.reduce((s, g) => s + g.items.filter((i) => i.state === 'ok').length, 0)

  return (
    // h-full only at md+: on mobile the Shortlist main content grid stacks to a
    // single auto-height row (Shortlist.tsx grid-cols-1 md:grid-cols-[1fr_340px]),
    // and height:100% against that indeterminate auto-sized grid row collapses
    // the card (and its internal overflow-y-auto scroller) to ~0px, making its
    // content unclickable/invisible even though the DOM node is technically
    // "visible". max-h-[70vh] gives the card its own bounded scroll on mobile
    // instead of relying on a percentage height it can't resolve.
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

      {/* Groups */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {groups.length === 0 ? (
          <p className="text-[13px] text-faint text-center py-8 px-4">
            No checklist data yet — AI evaluation may still be running.
          </p>
        ) : (
          groups.map((group) => (
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
                    <GroupBody group={group} />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))
        )}
      </div>

      {/* Bottom meta */}
      {totalItems > 0 && (
        <div className="px-3 py-2 border-t border-border/50 flex-none">
          <p className="text-[11px] text-muted">
            {totalItems} items
            {unknownCount > 0 && ` · the ${unknownCount} unknown${unknownCount !== 1 ? 's' : ''} become your viewing questions`}
          </p>
        </div>
      )}
    </div>
  )
}
