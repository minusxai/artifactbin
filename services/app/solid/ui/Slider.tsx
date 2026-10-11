/* @jsxImportSource solid-js */
/**
 * THE RANGE SLIDER: a native range input (so the keyboard, the role and the value are the browser's) in the
 * accent colour, named by `label` (visible beside it unless `hideLabel`), with its value shown and announced
 * through `valueText` (`4 px`).
 */
import { Show, type JSX } from 'solid-js';
import type { ControlSize } from './control-styles';

export function Slider(props: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  valueText?: (value: number) => string;
  hideLabel?: boolean;
  size?: ControlSize;
  disabled?: boolean;
  class?: string;
}): JSX.Element {
  const text = () => (props.valueText ? props.valueText(props.value) : String(props.value));
  const set = (event: Event & { currentTarget: HTMLInputElement }) => props.onChange(Number(event.currentTarget.value));
  return <label class={`flex min-w-0 items-center gap-3 ${props.size === 'sm' ? 'font-mono text-xs' : 'font-sans text-sm'} text-muted ${props.disabled ? 'opacity-50' : ''} ${props.class ?? ''}`}>
    <Show when={!props.hideLabel}><span class="shrink-0">{props.label}</span></Show>
    <input type="range" aria-label={props.label} aria-valuetext={text()} min={props.min} max={props.max} step={props.step} value={props.value} disabled={props.disabled}
      onInput={set} onChange={set}
      class="min-w-16 flex-1 cursor-pointer accent-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed" />
    <span aria-hidden="true" class="w-12 shrink-0 tabular-nums text-fg">{text()}</span>
  </label>;
}
