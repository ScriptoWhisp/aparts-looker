/**
 * SidebarFunnel — 284px left sidebar with 3 collapsible funnel groups.
 *
 * Groups (mirrors models.py frozensets):
 *   To view  → status IN {approved, viewing_scheduled}
 *   Viewed   → status IN {viewed, thinking, offer_drafted}
 *   Dropped  → status = dropped   (collapsed by default)
 *
 * Each group has a count badge, collapses on click.
 * Filter input narrows all groups by title substring.
 *
 * Wave 7D: Compare multi-select via cmd/ctrl-click or checkbox.
 * Max 2 selections (FIFO evict). Compare button in header when ≥1 selected.
 * Keyboard C when 2 selected opens compare overlay.
 */

import { useState, useMemo, useEffect, useCallback } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { Entry } from '../../types/api'
import { SidebarRow } from './SidebarRow'

// Status frozensets (mirroring models.py)
const TO_VIEW = new Set(['approved', 'viewing_scheduled'])
const VIEWED  = new Set(['viewed', 'thinking', 'offer_drafted'])
const DROPPED = new Set(['dropped'])

interface Group {
  key: 'to_view' | 'viewed' | 'dropped'
  title: string
  entries: Entry[]
  defaultCollapsed: boolean
}

interface SidebarFunnelProps {
  entries: Entry[]
  selectedId: string | null
  onSelect: (id: string) => void
  onCompare?: (ids: [string, string]) => void
}

// ── Group header ──────────────────────────────────────────────────────────

interface GroupHeaderProps {
  title: string
  count: number
  isOpen: boolean
  onToggle: () => void
}

function GroupHeader({ title, count, isOpen, onToggle }: GroupHeaderProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-surface/40 transition-colors duration-fast"
    >
      <div className="flex items-center gap-1.5">
        {isOpen ? (
          <ChevronDown size={12} className="text-muted flex-none" />
        ) : (
          <ChevronRight size={12} className="text-muted flex-none" />
        )}
        <span className="text-[11px] font-medium text-text-3 uppercase tracking-wide">
          {title}
        </span>
      </div>
      <span className="text-[11px] font-mono text-muted">{count}</span>
    </button>
  )
}

// ── Main sidebar component ────────────────────────────────────────────────

export function SidebarFunnel({ entries, selectedId, onSelect, onCompare }: SidebarFunnelProps) {
  const [filter, setFilter] = useState('')
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    to_view: true,
    viewed: true,
    dropped: false,
  })
  // Compare selection: max 2, FIFO eviction
  const [compareIds, setCompareIds] = useState<string[]>([])

  function toggleGroup(key: string) {
    setOpenGroups((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  function handleCompareToggle(id: string) {
    setCompareIds((prev) => {
      if (prev.includes(id)) {
        return prev.filter((x) => x !== id)
      }
      // FIFO evict oldest if already at max 2
      const next = [...prev, id]
      return next.length > 2 ? next.slice(-2) : next
    })
  }

  // Keyboard C → open compare when 2 selected
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
    if (e.key === 'c' || e.key === 'C') {
      if (compareIds.length === 2) {
        onCompare?.([compareIds[0], compareIds[1]])
      }
    }
  }, [compareIds, onCompare])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  // Apply filter
  const q = filter.toLowerCase()
  const filtered = useMemo(() => {
    if (!q) return entries
    return entries.filter((e) =>
      (e.title || e.address || '').toLowerCase().includes(q),
    )
  }, [entries, q])

  // Build groups
  const groups: Group[] = useMemo(
    () => [
      {
        key: 'to_view',
        title: 'To view',
        entries: filtered.filter((e) => TO_VIEW.has(e.status)),
        defaultCollapsed: false,
      },
      {
        key: 'viewed',
        title: 'Viewed',
        entries: filtered.filter((e) => VIEWED.has(e.status)),
        defaultCollapsed: false,
      },
      {
        key: 'dropped',
        title: 'Dropped',
        entries: filtered.filter((e) => DROPPED.has(e.status)),
        defaultCollapsed: true,
      },
    ],
    [filtered],
  )

  const totalCount = entries.length

  return (
    <aside className="flex flex-col h-full border-r border-border bg-bg overflow-hidden">
      {/* Compare header bar */}
      {compareIds.length > 0 && (
        <div className="flex items-center justify-between px-3 py-2 bg-accent/[0.08] border-b border-accent/30 flex-none">
          <span className="text-[11px] text-accent-lt font-sans">
            {compareIds.length}/2 selected
          </span>
          <div className="flex items-center gap-2">
            {compareIds.length > 0 && (
              <button
                type="button"
                onClick={() => setCompareIds([])}
                className="text-[11px] text-muted hover:text-text transition-colors"
              >
                Clear
              </button>
            )}
            <button
              type="button"
              disabled={compareIds.length < 2}
              onClick={() => {
                if (compareIds.length === 2) {
                  onCompare?.([compareIds[0], compareIds[1]])
                }
              }}
              className={[
                'px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors',
                compareIds.length === 2
                  ? 'bg-accent text-bg hover:bg-accent/80 cursor-pointer'
                  : 'bg-border text-muted cursor-not-allowed opacity-50',
              ].join(' ')}
            >
              Compare
            </button>
          </div>
        </div>
      )}

      {/* Filter input */}
      <div className="px-3 pt-3 pb-2 border-b border-border flex-none">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter listings…"
          className={[
            'w-full bg-sunken text-text text-[12px] placeholder-faint',
            'px-2.5 py-1.5 rounded-md border border-border',
            'focus:outline-none focus:border-accent/60 transition-colors duration-fast',
          ].join(' ')}
        />
      </div>

      {/* Groups */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {totalCount === 0 ? (
          <div className="flex flex-col items-center justify-center h-full px-4 text-center">
            <p className="text-[13px] text-text-3 font-medium mb-1">Nothing shortlisted yet</p>
            <p className="text-[11px] text-faint">Approve listings in Inbox first</p>
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.key}>
              <GroupHeader
                title={group.title}
                count={group.entries.length}
                isOpen={openGroups[group.key] ?? !group.defaultCollapsed}
                onToggle={() => toggleGroup(group.key)}
              />
              <AnimatePresence initial={false}>
                {(openGroups[group.key] ?? !group.defaultCollapsed) && (
                  <motion.div
                    key="content"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.16, ease: 'easeInOut' }}
                    className="overflow-hidden"
                  >
                    {group.entries.length === 0 ? (
                      <p className="text-[11px] text-faint px-3 py-2 italic">
                        {filter ? 'No matches' : 'Empty'}
                      </p>
                    ) : (
                      group.entries.map((entry) => (
                        <SidebarRow
                          key={entry.id}
                          entry={entry}
                          isSelected={selectedId === entry.id}
                          isCompareSelected={compareIds.includes(entry.id)}
                          onClick={() => onSelect(entry.id)}
                          onCompareToggle={handleCompareToggle}
                        />
                      ))
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))
        )}
      </div>

      {/* Sidebar footer */}
      <div className="flex-none px-3 py-2.5 border-t border-border">
        {compareIds.length === 0 ? (
          <p className="text-[11px] text-faint italic leading-snug">
            Inbox decides worth a look. This list decides worth an offer.
          </p>
        ) : (
          <p className="text-[11px] text-muted leading-snug">
            Cmd/Ctrl+click to select · C to compare
          </p>
        )}
      </div>
    </aside>
  )
}
