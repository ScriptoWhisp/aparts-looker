/**
 * cn — Tailwind class merging utility.
 * Combines clsx (conditional classes) + tailwind-merge (deduplication).
 */
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
