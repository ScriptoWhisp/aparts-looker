/**
 * DescriptionCard — description translation + bulleted summary (Wave C).
 *
 * Daniel reads Estonian slowly; kv.ee descriptions are dense Estonian text.
 * This card surfaces, in order: (1) AI-extracted key-facts bullets, (2) a
 * Russian translation (default-open when it exists), (3) the raw Estonian
 * original (default-closed, collapsible).
 *
 * "обновить" (regenerate) is fire-and-forget: POSTs
 * /api/entry/{id}/regenerate-description, then invalidates appData after a
 * short delay (mirrors NegotiationCard's regenerate-brief pattern) since the
 * AI call runs in a background thread server-side.
 *
 * XSS-safe: both the translation and the raw original render as plain text
 * (React auto-escapes JSX text nodes) with whitespace-pre-wrap to preserve
 * line breaks — never dangerouslySetInnerHTML (see CLAUDE.md style guide).
 */

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Entry } from '../../types/api'
import { regenerateDescription } from '../../lib/api'
import { QUERY_KEYS } from '../../lib/queries'

interface DescriptionCardProps {
  entry: Entry
}

export function DescriptionCard({ entry }: DescriptionCardProps) {
  const qc = useQueryClient()
  const [regenerating, setRegenerating] = useState(false)
  const [error, setError] = useState(false)

  const description = entry.description ?? ''
  const descriptionRu = entry.description_ru ?? ''
  const bullets = entry.description_bullets ?? []

  const [translationOpen, setTranslationOpen] = useState(!!descriptionRu)
  const [originalOpen, setOriginalOpen] = useState(false)

  const hasAnyDescription = description.trim().length > 0
  const hasTranslation = descriptionRu.trim().length > 0
  const hasBullets = bullets.length > 0

  async function handleRegenerate() {
    setRegenerating(true)
    setError(false)
    try {
      await regenerateDescription(entry.id)
      // Regenerates in background — invalidate after a short delay so the UI
      // shows "переводим…" for a beat before the fresh data lands.
      setTimeout(() => {
        void qc.invalidateQueries({ queryKey: QUERY_KEYS.appData })
        setRegenerating(false)
      }, 3000)
    } catch {
      setRegenerating(false)
      setError(true)
    }
  }

  return (
    <div className="bg-sunken rounded-lg overflow-hidden flex flex-col" data-testid="description-card">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border flex-none">
        <p className="text-[10px] font-mono uppercase text-muted tracking-widest">Описание</p>
        <button
          type="button"
          onClick={handleRegenerate}
          disabled={regenerating}
          data-testid="description-regenerate"
          className="text-[11px] text-accent hover:text-accent-lt disabled:opacity-50 transition-colors"
        >
          {regenerating ? 'переводим…' : 'обновить'}
        </button>
      </div>

      <div className="px-3 py-2 flex flex-col gap-2">
        {!hasAnyDescription ? (
          <p className="text-[12px] text-faint italic" data-testid="description-empty">
            Описание пустое — kv.ee не отдал текст
          </p>
        ) : (
          <>
            {error && (
              <p className="text-[12px] text-status-skip" data-testid="description-error">
                перевод не удался — попробуй ещё раз
              </p>
            )}

            {/* AI-extracted key-facts bullets — always visible when present */}
            {hasBullets && (
              <ul className="flex flex-col gap-1 pl-4 list-disc text-[13px] text-text-2" data-testid="description-bullets">
                {bullets.map((bullet, i) => (
                  <li key={i} className="leading-[1.4]">{bullet}</li>
                ))}
              </ul>
            )}

            {/* Translation (RU) — default-open when it exists */}
            <div className="border-t border-border/50 pt-2">
              <button
                type="button"
                onClick={() => setTranslationOpen((o) => !o)}
                aria-expanded={translationOpen}
                data-testid="description-translation-toggle"
                className="w-full min-h-[32px] flex items-center text-left text-[13px] font-medium text-text-2"
              >
                {translationOpen ? '▾' : '▸'} Перевод (RU)
              </button>
              {translationOpen && (
                <div data-testid="description-translation-body" className="pt-1 pb-1">
                  {hasTranslation ? (
                    <p className="text-[13px] text-text-2 leading-[1.55] whitespace-pre-wrap">
                      {descriptionRu}
                    </p>
                  ) : (
                    <p className="text-[12px] text-faint italic">
                      нет перевода — нажми «обновить»
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Original (ET) — default-closed */}
            <div className="border-t border-border/50 pt-2">
              <button
                type="button"
                onClick={() => setOriginalOpen((o) => !o)}
                aria-expanded={originalOpen}
                data-testid="description-original-toggle"
                className="w-full min-h-[32px] flex items-center text-left text-[13px] font-medium text-text-2"
              >
                {originalOpen ? '▾' : '▸'} Оригинал (ET)
              </button>
              {originalOpen && (
                <div data-testid="description-original-body" className="pt-1 pb-1">
                  <p className="text-[13px] text-text-3 leading-[1.55] whitespace-pre-wrap">
                    {description}
                  </p>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
