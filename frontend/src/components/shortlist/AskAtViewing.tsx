/**
 * AskAtViewing — card showing unknown checklist items as checkbox questions.
 *
 * SPEC §2.4: lists unknown items from checklist groups.
 * Local state only — no persistence. Checkboxes are purely UX affordance.
 * Empty state: "No open questions — you have everything you need."
 */

import { useState, useMemo } from 'react'
import type { Entry } from '../../types/api'

interface AskAtViewingProps {
  entry: Entry
}

interface Question {
  key: string
  label: string
}

function extractQuestions(entry: Entry): Question[] {
  const groups = entry.checklist?.groups ?? []
  if (groups.length > 0) {
    return groups.flatMap((g) =>
      g.items
        .filter((i) => i.state === 'unknown')
        .map((i) => ({ key: i.key, label: i.label })),
    )
  }
  // Fallback: ai_checklist_fills with unknown state
  const fills = entry.ai_checklist_fills ?? {}
  return Object.entries(fills)
    .filter(([, v]) => {
      const state = typeof v === 'object' && v !== null
        ? (v as { state?: string }).state
        : String(v)
      return state === 'unknown'
    })
    .map(([k, v]) => ({
      key: k,
      label: (typeof v === 'object' && v !== null
        ? (v as { label?: string }).label ?? k
        : k) as string,
    }))
}

export function AskAtViewing({ entry }: AskAtViewingProps) {
  const questions = useMemo(() => extractQuestions(entry), [entry])
  const [checked, setChecked] = useState<Set<string>>(new Set())

  function toggleCheck(key: string) {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div className="bg-sunken rounded-lg overflow-hidden">
      <div className="px-3 py-2.5 border-b border-border">
        <p className="text-[10px] font-mono uppercase text-muted tracking-widest">
          Ask at the viewing
        </p>
      </div>

      <div className="p-3">
        {questions.length === 0 ? (
          <p className="text-[12px] text-faint italic">
            No open questions — you have everything you need.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {questions.map((q) => (
              <li key={q.key} className="flex items-start gap-2">
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={checked.has(q.key)}
                  onClick={() => toggleCheck(q.key)}
                  className={[
                    'w-[11px] h-[11px] rounded-[3px] flex-none mt-[3px]',
                    'border transition-colors duration-fast',
                    checked.has(q.key)
                      ? 'bg-accent/80 border-accent'
                      : 'bg-transparent border-border-strong hover:border-accent/60',
                  ].join(' ')}
                />
                <span
                  className={[
                    'text-[12px] leading-snug',
                    checked.has(q.key) ? 'line-through text-faint' : 'text-text-2',
                  ].join(' ')}
                >
                  {q.label}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
