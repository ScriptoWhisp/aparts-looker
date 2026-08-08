/**
 * consoleCapture — module-level ring buffer of the last 50 console.* entries,
 * plus window.onerror / unhandledrejection hooks.
 *
 * Feeds the Feedback drawer's "attached context" — Claude gets the tail of
 * the browser console when triaging a report instead of asking Daniel to
 * paste it manually.
 *
 * init() must run before React renders (see main.tsx) so early console
 * activity (React warnings, query errors) is captured too.
 *
 * Only strings are kept — args are serialized defensively so a console.log
 * of a DOM node, a circular object, or a huge blob never crashes capture or
 * bloats the payload sent to the backend. Each arg is capped at 500 chars to
 * match the backend's re-sanitization cap (routes_feedback.py).
 */

export interface ConsoleLogEntry {
  ts: string
  level: 'log' | 'warn' | 'error' | 'info' | 'onerror' | 'unhandledrejection'
  args: string[]
}

const MAX_ENTRIES = 50
const MAX_ARG_CHARS = 500

const buffer: ConsoleLogEntry[] = []
let initialized = false

function serializeArg(arg: unknown): string {
  try {
    if (typeof arg === 'string') return arg.slice(0, MAX_ARG_CHARS)
    if (arg instanceof Error) return `${arg.name}: ${arg.message}`.slice(0, MAX_ARG_CHARS)
    if (typeof arg === 'object' && arg !== null) {
      return JSON.stringify(arg).slice(0, MAX_ARG_CHARS)
    }
    return String(arg).slice(0, MAX_ARG_CHARS)
  } catch {
    return '[unserializable]'
  }
}

function push(level: ConsoleLogEntry['level'], args: unknown[]): void {
  buffer.push({
    ts: new Date().toISOString(),
    level,
    args: args.map(serializeArg),
  })
  if (buffer.length > MAX_ENTRIES) {
    buffer.splice(0, buffer.length - MAX_ENTRIES)
  }
}

/** Snapshot of the last <=50 captured console entries, oldest first. */
export function getRecentLogs(): ConsoleLogEntry[] {
  return [...buffer]
}

/** Monkey-patches console.log/warn/error/info + window.onerror/unhandledrejection.
 * Idempotent — calling twice (e.g. HMR, duplicate import) is a no-op after the first call. */
export function init(): void {
  if (initialized) return
  initialized = true

  const original = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    info: console.info.bind(console),
  }

  console.log = (...args: unknown[]) => {
    push('log', args)
    original.log(...args)
  }
  console.warn = (...args: unknown[]) => {
    push('warn', args)
    original.warn(...args)
  }
  console.error = (...args: unknown[]) => {
    push('error', args)
    original.error(...args)
  }
  console.info = (...args: unknown[]) => {
    push('info', args)
    original.info(...args)
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('error', (event: ErrorEvent) => {
      push('onerror', [event.message, event.filename, `${event.lineno}:${event.colno}`])
    })
    window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
      push('unhandledrejection', [String(event.reason)])
    })
  }
}

/** Test-only: clears the buffer and un-patches nothing (console.* stays
 * patched across the whole test run — the module singleton is intentional).
 * Only used from vitest specs so buffer assertions don't leak between tests. */
export function __resetForTests(): void {
  buffer.length = 0
}
