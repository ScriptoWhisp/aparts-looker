/**
 * AskAtViewing — card showing unknown checklist items as checkbox questions.
 *
 * SPEC §2.4: lists unknown items from checklist groups.
 * Local state only — no persistence. Checkboxes are purely UX affordance.
 * Empty state: "No open questions — you have everything you need."
 */

import { useState, useMemo } from 'react'
import type { Entry } from '../../types/api'
import { CHECKLIST_ALL_KEYS, CHECKLIST_KEY_META, isKnownStateShorthand } from '../../lib/checklistMeta'

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

  // Fallback: derive unknowns from ai_checklist_fills. Real production shape is
  // key → "filled text" (only present when the AI found an explicit answer) —
  // a key that never made it into fills, or was filled with an empty/whitespace
  // string, means "still unknown, ask at the viewing". Legacy object-shaped
  // fills (key → {state}) are also honored for backward compat.
  const fills = entry.ai_checklist_fills ?? {}
  const questions: Question[] = []
  for (const key of CHECKLIST_ALL_KEYS) {
    const v = fills[key]
    const label = CHECKLIST_KEY_META[key]?.label ?? key
    if (v == null) {
      questions.push({ key, label })
      continue
    }
    if (typeof v === 'object') {
      const state = (v as { state?: string }).state
      if (state === 'unknown' || state == null) questions.push({ key, label })
      continue
    }
    const text = String(v).trim()
    if (text === '' || (isKnownStateShorthand(text) && text === 'unknown')) {
      questions.push({ key, label })
    }
  }
  return questions
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
