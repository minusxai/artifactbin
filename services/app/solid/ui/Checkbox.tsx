/* @jsxImportSource solid-js */
/**
 * THE TWO TOGGLES. Checkbox is a native checkbox inside its label (so the label text, with an optional
 * description, names it and toggles it). Switch is a `role="switch"` button for a setting that takes
 * effect at once; it is named by `label`.
 */
import { Show, type JSX } from 'solid-js';
import type { ControlSize } from './control-styles';

export function Checkbox(props: { label: JSX.Element; description?: JSX.Element; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean; size?: ControlSize; class?: string }): JSX.Element {
  const sm = () => props.size === 'sm';
  return <label class={`flex items-start gap-3 ${sm() ? 'font-mono text-xs' : 'font-sans text-sm'} ${props.disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'} ${props.class ?? ''}`}>
    <input type="checkbox" checked={props.checked} disabled={props.disabled} onChange={(event) => props.onChange(event.currentTarget.checked)}
      class={`${sm() ? 'mt-px size-3.5' : 'mt-0.5 size-4'} shrink-0 cursor-[inherit] accent-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent`} />
    <span class="min-w-0 text-fg">{props.label}<Show when={props.description}><span class="mt-1 block text-xs leading-5 text-muted">{props.description}</span></Show></span>
  </label>;
}

const TRACK = { md: 'h-6 w-11', sm: 'h-5 w-9' } as const;
const THUMB = { md: 'size-5', sm: 'size-4' } as const;
const SHIFT = { md: 'translate-x-5', sm: 'translate-x-4' } as const;

export function Switch(props: { label: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean; size?: ControlSize; class?: string }): JSX.Element {
  const size = () => props.size ?? 'md';
  return <button type="button" role="switch" aria-label={props.label} aria-checked={props.checked} disabled={props.disabled}
    onClick={() => props.onChange(!props.checked)}
    class={`relative inline-flex shrink-0 cursor-pointer items-center rounded-full p-0.5 ring-1 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50 ${TRACK[size()]} ${props.checked ? 'bg-accent ring-accent' : 'bg-raised ring-edge-bright'} ${props.class ?? ''}`}>
    <span aria-hidden="true" class={`block rounded-full bg-white shadow-sm transition-transform ${THUMB[size()]} ${props.checked ? SHIFT[size()] : 'translate-x-0'}`} />
  </button>;
}
