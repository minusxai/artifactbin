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

const BUTTON_VARIANTS = {
  solid: 'bg-accent text-bg border border-accent hover:brightness-110 font-semibold',
  ghost: 'bg-transparent text-fg border border-edge-bright hover:border-accent hover:text-accent',
  danger: 'bg-transparent text-danger border border-edge-bright hover:border-danger hover:bg-danger-soft',
} as const;

/** Input and button styling for Solid asset forms. Native props keep accessible names and state. */
export function Button(props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof BUTTON_VARIANTS }): JSX.Element {
  return <button {...props} class={`cursor-pointer rounded-[4px] px-3 py-1.5 font-mono text-xs transition-colors disabled:opacity-50 ${BUTTON_VARIANTS[props.variant ?? 'solid']} ${props.class ?? ''}`} />;
}
export function Input(props: JSX.InputHTMLAttributes<HTMLInputElement>): JSX.Element {
  return <input {...props} class={`w-full rounded-[4px] border border-edge bg-surface px-3 py-1.5 font-mono text-sm text-fg placeholder:text-faint focus:border-accent focus:outline-none ${props.class ?? ''}`} />;
}
