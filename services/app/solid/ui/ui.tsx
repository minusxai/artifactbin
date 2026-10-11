/* @jsxImportSource solid-js */
/** The kit pieces the ported pages use and its tokens and labels. */
import type { JSX } from 'solid-js';
export { timeAgo } from '../lib/format';
/** Display name for a normalized format — the designed tier is BRANDED "mx-markup". */
export function formatLabel(format: string): string {
  return format === 'markup' ? 'mx-markup' : format;
}

/** Content-tier badge hues (flatuicolors defo palette); the fallback is the neutral grey. */
const FORMAT_COLORS: Record<string, string> = {
  markup: '#c0392b',
};
const FORMAT_FALLBACK_COLOR = '#95a5a6';

export const PAGE_COLUMN = 'mx-auto max-w-4xl px-4 sm:px-6';
/** @deprecated Use ui/Panel. */
export const PANEL = 'rounded-panel border border-edge bg-surface';
/** @deprecated Use ui/Panel's ListRow (lists) — a table row keeps this until tables get a primitive. */
export const TABLE_ROW = 'border-t border-edge hover:bg-raised transition-colors';
export const LINK = 'text-accent no-underline hover:underline underline-offset-4';

const TONES = {
  default: 'border-edge-bright text-muted',
  accent: 'border-accent/40 text-accent bg-accent-soft',
  dim: 'border-edge text-faint',
  danger: 'border-danger/40 text-danger bg-danger-soft',
} as const;

export function Badge(props: { children: JSX.Element; tone?: keyof typeof TONES }): JSX.Element {
  return (
    <span class={`inline-block rounded-chip border px-1.5 py-0.5 font-mono text-2xs leading-none ${TONES[props.tone ?? 'default']}`}>
      {props.children}
    </span>
  );
}

export function FormatBadge(props: { format?: string }): JSX.Element {
  const key = () => props.format ?? 'markup';
  const color = () => FORMAT_COLORS[key()] ?? FORMAT_FALLBACK_COLOR;
  return (
    <span
      class="inline-block rounded-chip border px-1.5 py-0.5 font-mono text-2xs leading-none whitespace-nowrap"
      style={{ color: color(), 'border-color': `${color()}4d`, background: `${color()}14` }}
    >
      {formatLabel(key())}
    </span>
  );
}

/** Uppercase micro-label used for table headers and section titles. */
export function MicroLabel(props: { children: JSX.Element }): JSX.Element {
  return <span class="font-mono text-micro uppercase tracking-[0.14em] text-faint">{props.children}</span>;
}
