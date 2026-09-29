/**
 * SPLIT from components/ui.tsx (probe): the framework-free half of the kit — labels, dates and the
 * class-name tokens. components/ui.tsx imports React, lucide-react and the Radix Tooltip at module
 * scope, so a Solid page importing `formatLabel` from it would drag React into its bundle. Once the
 * port is real, components/ui.tsx should re-export these rather than keep its own copies.
 */

/** Display name for a normalized format — the designed tier is BRANDED "mx-markup". */
export function formatLabel(format: string): string {
  return format === 'markup' ? 'mx-markup' : format;
}

/** Content-tier badge hues (flatuicolors defo palette); the fallback is the neutral grey. */
export const FORMAT_COLORS: Record<string, string> = {
  markup: '#c0392b',
};
export const FORMAT_FALLBACK_COLOR = '#95a5a6';

/** Blog-style absolute date ("Aug 8, 2026"). */
export function dateStamp(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Compact relative time: "just now" → "5 mins ago" → "3 hrs ago" → "Aug 8, 2026". */
export function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs === 1 ? '' : 's'} ago`;
  return dateStamp(iso);
}

export const PAGE_COLUMN = 'mx-auto max-w-4xl px-4 sm:px-6';
export const PANEL = 'rounded-[6px] border border-edge bg-surface';
export const TABLE_ROW = 'border-t border-edge hover:bg-raised transition-colors';
export const LINK = 'text-accent no-underline hover:underline underline-offset-4';
