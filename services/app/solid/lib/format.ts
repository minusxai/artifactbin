/** Dates and counts as the app shows them, in one place. Counts reuse the reader's default number format. */
import { numberFormatter } from '@/lib/dataflow/number-format';

const count = numberFormatter(undefined);

/** A whole or fractional count with the viewer's digit grouping ("12,345"). */
export function formatCount(n: number): string {
  return count(n);
}

/** Blog-style absolute date ("Aug 8, 2026"). */
function dateStamp(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Absolute date and time in the viewer's locale, for tooltips and status lines. */
export function dateTime(iso: string): string {
  return new Date(iso).toLocaleString();
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
