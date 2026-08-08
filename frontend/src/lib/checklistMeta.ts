/**
 * checklistMeta — shared helpers for the full checklist registry (Wave A).
 *
 * Replaces the old hardcoded 13-key CHECKLIST_KEY_META object. The registry
 * now lives server-side (backend/checklist_registry.py, ~96 items across 4
 * sections) and is fetched once via useChecklistRegistry() (lib/queries.ts,
 * 1h staleTime). This module provides pure lookup/index helpers over that
 * fetched data plus the isKnownStateShorthand guard reused from Wave 10.
 */

import { useMemo } from 'react'
import { useChecklistRegistry } from './queries'
import type { ChecklistRegistryItem, ChecklistRegistryResponse } from '../types/api'

const KNOWN_STATE_VALUES = new Set(['ok', 'flag', 'unknown', 'skip'])

export function isKnownStateShorthand(v: string): boolean {
  return KNOWN_STATE_VALUES.has(v)
}

/** Flat, key-indexed view of every item in the registry — built once per
 * registry fetch and reused by callers that need O(1) key -> item lookup. */
export function indexRegistryByKey(
  data: ChecklistRegistryResponse | undefined,
): Record<string, ChecklistRegistryItem> {
  const index: Record<string, ChecklistRegistryItem> = {}
  if (!data) return index
  for (const section of data.sections) {
    for (const group of section.groups) {
      for (const item of group.items) {
        index[item.key] = item
      }
    }
  }
  return index
}

/** Reverse of legacy_key_map: new key -> old key[] (a new key may receive
 * more than one legacy predecessor, e.g. sec2_building <- s09_02, s14_03). */
export function buildReverseLegacyMap(
  data: ChecklistRegistryResponse | undefined,
): Record<string, string[]> {
  const reverse: Record<string, string[]> = {}
  if (!data) return reverse
  for (const [oldKey, newKey] of Object.entries(data.legacy_key_map)) {
    ;(reverse[newKey] ??= []).push(oldKey)
  }
  return reverse
}

/** Look up a value by `key` in `dict`, falling back to any legacy key that
 * migrates onto `key` (frontend-side read compat — see Migration & backward
 * compat: the backend only folds legacy data forward lazily on write, so a
 * listing whose checklist has never been re-marked post-Wave-A still needs
 * to resolve via the old key here). */
export function lookupWithLegacyFallback<T>(
  key: string,
  dict: Record<string, T> | null | undefined,
  reverseLegacyMap: Record<string, string[]>,
): T | undefined {
  if (!dict) return undefined
  if (dict[key] !== undefined) return dict[key]
  for (const oldKey of reverseLegacyMap[key] ?? []) {
    if (dict[oldKey] !== undefined) return dict[oldKey]
  }
  return undefined
}

/** Single-key metadata lookup — {section, group, label_ru} — from the cached
 * registry. Returns undefined while the registry is still loading or if the
 * key is unknown. Not used in hot render loops (ChecklistCard reads the
 * registry tree directly); intended for one-off lookups elsewhere. */
export function useChecklistMeta(
  key: string,
): { section: string; group: string; label_ru: string } | undefined {
  const { data } = useChecklistRegistry()
  const index = useMemo(() => indexRegistryByKey(data), [data])
  return useMemo(() => {
    const item = index[key]
    if (!item) return undefined
    return { section: item.section, group: item.group, label_ru: item.label_ru }
  }, [index, key])
}
