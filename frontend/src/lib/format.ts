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
 *
 * The et-EE locale for EUR may place € at the start ("€ 185 000") OR at the
 * end ("185 000 €") depending on the runtime's ICU data version. We normalise
 * both: strip any leading/trailing € symbol + surrounding whitespace, then
 * re-append a single " €" suffix. This prevents the "185 000 € €" double-symbol
 * regression seen when the locale already appends the symbol.
 */
export function fmtEur(value: number | null | undefined): string {
  if (value == null) return '—'
  const formatted = new Intl.NumberFormat('et-EE', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(value)
  // Strip any € (with surrounding whitespace) from start or end, then add one.
  const digits = formatted
    .replace(/^\s*€\s*/, '')   // leading € (some ICU versions)
    .replace(/\s*€\s*$/, '')   // trailing € (other ICU versions)
    .trim()
  return `${digits} €`
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
