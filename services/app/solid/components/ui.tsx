/* @jsxImportSource solid-js */
/** The kit pieces the ported pages use (components/ui.tsx in Solid); tokens and labels are shared. */
import type { JSX } from 'solid-js';
import { FORMAT_COLORS, FORMAT_FALLBACK_COLOR, formatLabel } from '../shared/ui-tokens';

export { formatLabel, timeAgo, dateStamp, PANEL, TABLE_ROW, LINK, PAGE_COLUMN } from '../shared/ui-tokens';

const TONES = {
  default: 'border-edge-bright text-muted',
  accent: 'border-accent/40 text-accent bg-accent-soft',
  dim: 'border-edge text-faint',
} as const;

export function Badge(props: { children: JSX.Element; tone?: keyof typeof TONES }): JSX.Element {
  return (
    <span class={`inline-block rounded-[3px] border px-1.5 py-0.5 font-mono text-[11px] leading-none ${TONES[props.tone ?? 'default']}`}>
      {props.children}
    </span>
  );
}

export function FormatBadge(props: { format?: string }): JSX.Element {
  const key = () => props.format ?? 'markup';
  const color = () => FORMAT_COLORS[key()] ?? FORMAT_FALLBACK_COLOR;
  return (
    <span
      class="inline-block rounded-[3px] border px-1.5 py-0.5 font-mono text-[11px] leading-none whitespace-nowrap"
      style={{ color: color(), 'border-color': `${color()}4d`, background: `${color()}14` }}
    >
      {formatLabel(key())}
    </span>
  );
}

/** Uppercase micro-label used for table headers and section titles. */
export function MicroLabel(props: { children: JSX.Element }): JSX.Element {
  return <span class="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">{props.children}</span>;
}
