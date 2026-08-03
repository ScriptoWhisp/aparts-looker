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

export type TabId = 'overview' | 'inbox' | 'shortlist' | 'settings'

// Hash → canonical tab mapping (backward compat with vanilla frontend)
const HASH_COMPAT: Record<string, TabId> = {
  '#overview':  'overview',
  '#inbox':     'inbox',
  '#shortlist': 'shortlist',
  '#settings':  'settings',
  // Legacy hashes from vanilla waves 1-5
  '#pending':   'inbox',
  '#detail':    'shortlist',
  '#rejected':  'shortlist',
  '#compare':   'overview',
}

function tabFromHash(hash: string): TabId {
  return HASH_COMPAT[hash] ?? 'overview'
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
