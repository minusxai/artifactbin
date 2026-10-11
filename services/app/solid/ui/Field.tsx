/* @jsxImportSource solid-js */
/**
 * THE TEXT CONTROLS AND THEIR LABEL. `Field` draws a label, an optional hint and an error around one control
 * and wires them: the control inside it (Input, Textarea, SearchField, Select) takes the Field's id, so the
 * label's `for` names it, and `aria-describedby` / `aria-invalid` follow the hint and error. A control used
 * without a Field takes its name from its own `aria-label`.
 */
import { createContext, createUniqueId, Show, splitProps, useContext, type JSX } from 'solid-js';
import Search from 'lucide-solid/icons/search';
import { CONTROL_SIZE, DISABLED, FIELD_SURFACE, FOCUS_RING, type ControlSize } from './control-styles';

interface FieldWiring { id: string; labelId: string; label: string; describedBy: string | undefined; invalid: boolean }
const FieldContext = createContext<FieldWiring>();
/** The wiring of the Field this control sits in, if any (solid/ui only). */
export const useField = (): FieldWiring | undefined => useContext(FieldContext);

export function Field(props: { label: string; hint?: JSX.Element; error?: string | null; class?: string; children: JSX.Element }): JSX.Element {
  const id = createUniqueId();
  const wiring: FieldWiring = {
    id,
    labelId: `${id}-label`,
    get label() { return props.label; },
    get describedBy() { return [props.hint ? `${id}-hint` : '', props.error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined; },
    get invalid() { return !!props.error; },
  };
  return <div class={`grid content-start gap-1.5 ${props.class ?? ''}`}>
    <label id={wiring.labelId} for={id} class="font-sans text-sm font-medium text-fg">{props.label}</label>
    <FieldContext.Provider value={wiring}>{props.children}</FieldContext.Provider>
    <Show when={props.hint}><p id={`${id}-hint`} class="font-sans text-xs text-muted">{props.hint}</p></Show>
    <Show when={props.error}><p id={`${id}-error`} class="font-sans text-xs text-danger">{props.error}</p></Show>
  </div>;
}

type Sized<T> = Omit<T, 'size' | 'class'> & { size?: ControlSize; class?: string };

export function Input(props: Sized<JSX.InputHTMLAttributes<HTMLInputElement>>): JSX.Element {
  const field = useField();
  const [own, native] = splitProps(props, ['size', 'class']);
  return <input id={field?.id} aria-describedby={field?.describedBy} aria-invalid={field?.invalid || undefined} {...native}
    class={`${FIELD_SURFACE} ${CONTROL_SIZE[own.size ?? 'md']} ${FOCUS_RING} ${DISABLED} ${own.class ?? ''}`} />;
}

const TEXTAREA_SIZE: Record<ControlSize, string> = {
  md: 'min-h-24 rounded-control px-3.5 py-2 font-sans text-sm',
  sm: 'min-h-16 rounded-control px-2.5 py-1.5 font-mono text-xs',
};

export function Textarea(props: Sized<JSX.TextareaHTMLAttributes<HTMLTextAreaElement>>): JSX.Element {
  const field = useField();
  const [own, native] = splitProps(props, ['size', 'class']);
  return <textarea id={field?.id} aria-describedby={field?.describedBy} aria-invalid={field?.invalid || undefined} {...native}
    class={`${FIELD_SURFACE} ${TEXTAREA_SIZE[own.size ?? 'md']} ${FOCUS_RING} ${DISABLED} ${own.class ?? ''}`} />;
}

/** A search box with its icon; `clearOnEscape` empties it on Escape. Named by `label` (or its Field). */
export function SearchField(props: { value: string; onValue: (value: string) => void; label?: string; placeholder?: string; size?: ControlSize; clearOnEscape?: boolean; disabled?: boolean; class?: string }): JSX.Element {
  const field = useField();
  const size = () => props.size ?? 'md';
  return <div class={`relative min-w-0 ${props.class ?? ''}`}>
    <Search size={size() === 'md' ? 15 : 13} aria-hidden="true" class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
    <input type="search" id={field?.id} aria-describedby={field?.describedBy} aria-label={field ? undefined : props.label}
      placeholder={props.placeholder ?? props.label} value={props.value} disabled={props.disabled}
      onInput={(event) => props.onValue(event.currentTarget.value)}
      onKeyDown={(event) => { if (event.key === 'Escape' && props.clearOnEscape && props.value) { event.preventDefault(); props.onValue(''); } }}
      class={`${FIELD_SURFACE} ${CONTROL_SIZE[size()]} ${size() === 'md' ? 'pl-9' : 'pl-8'} ${FOCUS_RING} ${DISABLED}`} />
  </div>;
}
