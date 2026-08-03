/**
 * Formatting helpers for display values.
 *
 * NOTE: React auto-escapes JSX text nodes — never use dangerouslySetInnerHTML.
 * escapeHtml is kept here for edge cases (e.g. strings passed to Leaflet's
 * tooltip APIs that require raw HTML strings). Do NOT use it to bypass React's
 * built-in escaping.
 *
 * BANNED: dangerouslySetInnerHTML — see style guide in CLAUDE.md.
 */

/**
 * Format a euro price: 185000 → "185 000 €"
 * Uses narrow non-breaking space as thousands separator to match the design brief.
 */
export function fmtEur(value: number | null | undefined): string {
  if (value == null) return '—'
  return (
    new Intl.NumberFormat('et-EE', {
      style: 'currency',
      currency: 'EUR',
      maximumFractionDigits: 0,
    })
      .format(value)
      // Estonian locale uses "€ 185 000" — reformat to "185 000 €"
      .replace(/^€\s*/, '')
      .trim() + ' €'
  )
}

/**
 * Format an ISO date string to a short human-readable date.
 * "2026-08-01T12:00:00Z" → "1 Aug 2026"
 */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

/**
 * Format a relative time: "scraped 12 min ago", "scraped just now"
 */
export function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return 'never scraped'
  try {
    const diffMs = Date.now() - new Date(iso).getTime()
    const diffMin = Math.floor(diffMs / 60_000)
    if (diffMin < 1) return 'scraped just now'
    if (diffMin === 1) return 'scraped 1 min ago'
    if (diffMin < 60) return `scraped ${diffMin} min ago`
    const diffHr = Math.floor(diffMin / 60)
    if (diffHr === 1) return 'scraped 1 hr ago'
    if (diffHr < 24) return `scraped ${diffHr} hr ago`
    return `scraped ${fmtDate(iso)}`
  } catch {
    return 'scraped recently'
  }
}

/**
 * Escape HTML special characters for use in raw-string contexts
 * (e.g. Leaflet tooltip bindPopup() calls).
 *
 * IMPORTANT: Do NOT use this to sanitize strings before passing to
 * dangerouslySetInnerHTML — that API is banned in this codebase.
 * React JSX auto-escapes string values — use JSX instead.
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}
