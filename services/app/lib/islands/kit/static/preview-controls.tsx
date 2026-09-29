/* @jsxImportSource solid-js */
/** Inert rail miniatures for live controls. Their authored props are data from the compiler. */
import type { JSX } from 'solid-js';
import { refName } from '@/lib/story/dataflow';

type Props = Record<string, unknown>;
const str = (value: unknown): string | undefined => typeof value === 'string' ? value : undefined;
const literal = (value: unknown): string => typeof value === 'string' && !refName(value) ? value : typeof value === 'number' ? String(value) : '';
const join = (...values: Array<string | undefined | false>) => values.filter(Boolean).join(' ');
const SHELL_OMIT = new Set(['label', 'placeholder', 'className', 'value', 'options', 'multiple', 'allowCreate', 'valueFormat', 'checked', 'min', 'max', 'step', 'format', 'prefix', 'suffix', 'disabled', 'children', 'data']);
const shellRest = (props: Props): JSX.HTMLAttributes<HTMLDivElement> => Object.fromEntries(Object.entries(props).filter(([key]) => !SHELL_OMIT.has(key))) as JSX.HTMLAttributes<HTMLDivElement>;
const stamp = (props: Props): string | undefined => {
  const parts = ['value', 'options', 'checked'].flatMap((key) => {
    const name = typeof props[key] === 'string' ? refName(props[key]) : null;
    return name ? [`${key}:$${name}`] : [];
  });
  return parts.length ? parts.join(' ') : undefined;
};
const shellClass = 'mx-control relative inline-flex flex-col gap-1.5 align-top';
const fieldClass = 'w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-xs transition-colors outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50';
function Shell(props: { p: Props; children: JSX.Element; extra?: string[] }) {
  const rest = () => Object.fromEntries(Object.entries(shellRest(props.p)).filter(([key]) => !props.extra?.includes(key))) as JSX.HTMLAttributes<HTMLDivElement>;
  return <div {...rest()} data-mx-bound={stamp(props.p)} class={join(shellClass, str(props.p.className))}>
    {props.p.label ? <span class="flex items-baseline gap-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground"><span>{str(props.p.label)}</span></span> : null}
    {props.children}
  </div>;
}

export function PreviewInput({ p }: { p: Props }) {
  return <Shell p={p} extra={['type', 'required', 'autoFocus', 'rows', 'readOnly', 'name', 'run', 'aria-label']}><input aria-label={str(p['aria-label']) ?? str(p.label)} placeholder={str(p.placeholder)} required={p.required === true} autofocus={p.autoFocus === true}
    disabled readOnly value={literal(p.value)} type={typeof p.type === 'string' ? p.type : 'text'} min={p.min as string | number | undefined} max={p.max as string | number | undefined} step={p.step as string | number | undefined}
    class={join(fieldClass, 'h-9 min-w-48', p.type === 'number' && 'tabular-nums')} /></Shell>;
}

export function PreviewSwitch({ p }: { p: Props }) {
  const checked = p.checked === true;
  return <Shell p={p}><button type="button" role="switch" aria-label={str(p.label)} aria-checked={checked} disabled
    class={join('inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50', checked ? 'bg-primary' : 'bg-input')}>
    <span aria-hidden="true" class={join('block size-4 rounded-full bg-background shadow-sm transition-transform', checked ? 'translate-x-[18px]' : 'translate-x-0.5')} />
  </button></Shell>;
}

export function PreviewSelect({ p }: { p: Props }) {
  const entries = Array.isArray(p.options) ? p.options.map((option) => typeof option === 'object' && option !== null
    ? { value: String((option as Props).value ?? ''), label: String((option as Props).label ?? (option as Props).value ?? '') }
    : { value: String(option), label: String(option) }) : [];
  const value = literal(p.value);
  const label = entries.find((option) => option.value === value)?.label || value || str(p.placeholder) || 'All';
  return <Shell p={p}><div class="relative min-w-0"><button type="button" aria-label={str(p.label)} aria-haspopup="listbox" aria-expanded="false" disabled
    class="inline-flex w-full items-center justify-between gap-2 rounded-md text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 h-9 min-w-36 border border-input bg-background px-3 shadow-xs hover:bg-muted/40">
    <span class={join('truncate', !value && 'text-muted-foreground')}>{label}</span>
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="size-4 shrink-0 opacity-50" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
  </button></div></Shell>;
}
