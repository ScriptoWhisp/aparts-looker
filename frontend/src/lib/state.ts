/**
 * Zustand global UI state store.
 *
 * TanStack Query owns server state (AppData, SettingsData).
 * Zustand owns UI state: active tab, selected listing, sidebar state.
 *
 * Design: keep this small. Only add to the store when multiple components
 * need to read/write the same transient UI state. Component-local state
 * (useState) is preferred for single-component concerns.
 */

import { create } from 'zustand'

export type TabId = 'overview' | 'inbox' | 'shortlist' | 'settings' | 'feedback'

// ── Inbox session state ────────────────────────────────────────────────────
// Persists while the tab is open; resets on page refresh.

export interface InboxDecision {
  id: string
  title: string
  score: number | null
  outcome: 'shortlisted' | 'skipped'
  reason?: string
}

interface InboxSessionState {
  triaged: number
  shortlisted: number
  skipped: number
  // Ids of entries the user has decided on in this session (to exclude from queue)
  decidedIds: Set<string>
  // Ids of entries deferred with "Later" (moved to back of queue)
  laterIds: string[]
  // Ordered list of decisions made this session (for cleared state display)
  decisions: InboxDecision[]

  recordLookCloser: (id: string, title: string, score: number | null) => void
  recordSkip: (id: string, title: string, score: number | null, reason?: string) => void
  recordLater: (id: string) => void
  resetSession: () => void
}

export const useInboxSession = create<InboxSessionState>((set) => ({
  triaged: 0,
  shortlisted: 0,
  skipped: 0,
  decidedIds: new Set<string>(),
  laterIds: [],
  decisions: [],

  recordLookCloser: (id, title, score) =>
    set((s) => ({
      triaged: s.triaged + 1,
      shortlisted: s.shortlisted + 1,
      decidedIds: new Set([...s.decidedIds, id]),
      decisions: [...s.decisions, { id, title, score, outcome: 'shortlisted' }],
    })),

  recordSkip: (id, title, score, reason) =>
    set((s) => ({
      triaged: s.triaged + 1,
      skipped: s.skipped + 1,
      decidedIds: new Set([...s.decidedIds, id]),
      decisions: [...s.decisions, { id, title, score, outcome: 'skipped', reason }],
    })),

  recordLater: (id) =>
    set((s) => ({
      laterIds: [...s.laterIds.filter((x) => x !== id), id],
    })),

  resetSession: () =>
    set({ triaged: 0, shortlisted: 0, skipped: 0, decidedIds: new Set(), laterIds: [], decisions: [] }),
}))

// Hash → canonical tab mapping (backward compat with vanilla frontend)
const HASH_COMPAT: Record<string, TabId> = {
  '#overview':  'overview',
  '#inbox':     'inbox',
  '#shortlist': 'shortlist',
  '#settings':  'settings',
  '#feedback':  'feedback',
  // Legacy hashes from vanilla waves 1-5
  '#pending':   'inbox',
  '#detail':    'shortlist',
  '#rejected':  'shortlist',
  '#compare':   'overview',
}

function tabFromHash(hash: string): TabId {
  // Deep-link hashes carry a query string (#feedback?id=<uuid>) — strip it
  // before the lookup; the query is read separately by the Feedback route.
  const base = hash.split('?')[0]
  return HASH_COMPAT[base] ?? 'overview'
}

/** Extract ?id=<uuid> from a hash-based deep link, e.g. "#feedback?id=abc" → "abc". */
export function feedbackIdFromHash(hash: string): string | null {
  const qIndex = hash.indexOf('?')
  if (qIndex === -1) return null
  const params = new URLSearchParams(hash.slice(qIndex + 1))
  return params.get('id')
}

function hashForTab(tab: TabId): string {
  return `#${tab}`
}

// ── Store shape ────────────────────────────────────────────────────────────

interface AppState {
  // Active tab — synced with window.location.hash
  activeTab: TabId

  // Selected listing ID (for deep-link ?listing=<id> and sidebar selection)
  selectedListingId: string | null

  // Actions
  setTab: (tab: TabId) => void
  setSelectedListingId: (id: string | null) => void
  syncFromHash: () => void
}

export const useAppStore = create<AppState>((set) => ({
  activeTab: tabFromHash(window.location.hash),
  selectedListingId: null,

  setTab: (tab) => {
    window.location.hash = hashForTab(tab)
    set({ activeTab: tab })
  },

  setSelectedListingId: (id) => set({ selectedListingId: id }),

  syncFromHash: () => {
    const tab = tabFromHash(window.location.hash)
    set({ activeTab: tab })
  },
}))

// ── Deep-link: ?listing=<id> ───────────────────────────────────────────────
// On initial load, if the URL has ?listing=<id>, pre-select that listing.
// The route component will consume selectedListingId to open the panel.
;(function initDeepLink() {
  const params = new URLSearchParams(window.location.search)
  const listingId = params.get('listing')
  if (listingId) {
    useAppStore.getState().setSelectedListingId(listingId)
    // Route to shortlist (approved entry) or inbox (pending) — we don't know
    // the status yet, so default to shortlist; the component can correct later.
    useAppStore.getState().setTab('shortlist')
  }
})()
