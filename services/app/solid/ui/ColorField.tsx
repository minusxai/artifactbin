/* @jsxImportSource solid-js */
/**
 * THE COLOUR CONTROLS. `ColorField` is a swatch that opens the native colour picker beside a hex text input of
 * the same `size`; the text input takes its name from the Field it sits in (or `ariaLabel`), the picker is
 * named `<name> picker`. Typed text is applied when it is a hex colour (`#abc` expands to `#aabbcc`); anything
 * else marks the input invalid and is restored on blur. `onChange` only ever receives `#rrggbb`.
 *
 * `SwatchPicker` is a row of preset colours as a radio group (one Tab stop, the arrow keys choose), with an
 * optional trailing custom picker; SWATCHES is the shared marker palette (a screenshot brush, a text colour).
 */
import { createSignal, createUniqueId, For, Show, type JSX } from 'solid-js';
import Check from 'lucide-solid/icons/check';
import { useField } from './Field';
import { CONTROL_SIZE, DISABLED, FIELD_SURFACE, FOCUS_RING, type ControlSize } from './control-styles';
import { Tooltip } from './Tooltip';

export interface Swatch { value: string; label: string }
/** The marker palette: saturated enough to read on a screenshot, with black and white for contrast. */
export const SWATCHES: readonly Swatch[] = [
  { value: '#ef4444', label: 'Red' },
  { value: '#f59e0b', label: 'Orange' },
  { value: '#3b82f6', label: 'Blue' },
  { value: '#22c55e', label: 'Green' },
  { value: '#171717', label: 'Black' },
  { value: '#ffffff', label: 'White' },
];

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;
/** `#rrggbb` for a 3- or 6-digit hex colour (with or without `#`), else null. */
function normalizeHex(text: string): string | null {
  const match = HEX.exec(text.trim());
  if (!match) return null;
  const digits = match[1]!.length === 3 ? [...match[1]!].map((d) => d + d).join('') : match[1]!;
  return `#${digits.toLowerCase()}`;
}

const SWATCH_SIZE: Record<ControlSize, string> = { md: 'size-control', sm: 'size-control-sm' };

export function ColorField(props: { value: string; onChange: (hex: string) => void; ariaLabel?: string; size?: ControlSize; disabled?: boolean; class?: string }): JSX.Element {
  const field = useField();
  const size = () => props.size ?? 'md';
  const name = () => props.ariaLabel ?? field?.label ?? 'Color';
  const [draft, setDraft] = createSignal<string | null>(null);
  const invalid = () => draft() !== null && normalizeHex(draft()!) === null;
  const apply = (text: string) => {
    const hex = normalizeHex(text);
    setDraft(hex ? null : text);
    if (hex && hex !== props.value) props.onChange(hex);
  };
  return <div class={`flex min-w-0 items-center gap-2 ${props.class ?? ''}`}>
    <label class={`relative shrink-0 overflow-hidden rounded-control border border-edge-bright ${SWATCH_SIZE[size()]} ${props.disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'} focus-within:ring-2 focus-within:ring-accent/30`}
      style={{ 'background-color': normalizeHex(props.value) ?? 'transparent' }}>
      <input type="color" aria-label={`${name()} picker`} value={normalizeHex(props.value) ?? '#000000'} disabled={props.disabled}
        onInput={(event) => apply(event.currentTarget.value)} class="absolute inset-0 size-full cursor-[inherit] opacity-0" />
    </label>
    <input type="text" id={field?.id} aria-label={field ? undefined : name()} aria-describedby={field?.describedBy}
      aria-invalid={invalid() || field?.invalid || undefined} spellcheck={false} autocomplete="off" maxLength={7} disabled={props.disabled}
      value={draft() ?? props.value}
      onInput={(event) => apply(event.currentTarget.value)}
      onBlur={() => setDraft(null)}
      class={`${FIELD_SURFACE} ${CONTROL_SIZE[size()]} ${FOCUS_RING} ${DISABLED} font-mono`} />
  </div>;
}

export function SwatchPicker(props: { label: string; options: readonly Swatch[]; value: string; onChange: (value: string) => void; size?: ControlSize; custom?: boolean; class?: string }): JSX.Element {
  const id = createUniqueId();
  const size = () => props.size ?? 'md';
  const selectedIndex = () => Math.max(0, props.options.findIndex((o) => o.value.toLowerCase() === props.value.toLowerCase()));
  const onKeyDown = (event: KeyboardEvent) => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const radios = [...(event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    const at = radios.indexOf(event.target as HTMLButtonElement);
    const next = (at + step + radios.length) % radios.length;
    radios[next]?.focus();
    props.onChange(props.options[next]!.value);
  };
  return <div class={`flex flex-wrap items-center gap-2 ${props.class ?? ''}`}>
    <div role="radiogroup" aria-label={props.label} id={id} onKeyDown={onKeyDown} class="flex flex-wrap items-center gap-2">
      <For each={props.options}>{(swatch, index) => {
        const checked = () => swatch.value.toLowerCase() === props.value.toLowerCase();
        return <Tooltip content={swatch.label}>
          <button type="button" role="radio" aria-checked={checked()} aria-label={swatch.label} tabIndex={index() === selectedIndex() ? 0 : -1}
            onClick={() => props.onChange(swatch.value)}
            style={{ 'background-color': swatch.value }}
            class={`inline-flex ${size() === 'md' ? 'size-7' : 'size-6'} shrink-0 cursor-pointer items-center justify-center rounded-full border border-edge-bright shadow-sm transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${checked() ? 'ring-2 ring-fg ring-offset-2 ring-offset-surface' : ''}`}>
            <Show when={checked()}><Check size={14} strokeWidth={3} aria-hidden="true" class="mix-blend-difference text-white" /></Show>
          </button>
        </Tooltip>;
      }}</For>
    </div>
    <Show when={props.custom}>
      <ColorField ariaLabel={`Custom ${props.label.toLowerCase()}`} size={size()} value={props.value} onChange={props.onChange} class="w-36" />
    </Show>
  </div>;
}
