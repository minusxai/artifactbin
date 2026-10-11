/* @jsxImportSource solid-js */
/**
 * THE COMBOBOX: a text input over a listbox of suggestions (a people picker), per the WAI-ARIA combobox
 * pattern. Focus never leaves the input: ArrowDown/ArrowUp (wrapping) move the active option, named to
 * assistive tech by `aria-activedescendant`; Enter picks it; Escape closes the list without reaching an
 * enclosing dialog. The list is portalled under the input (solid/ui/Popover, as wide as the input), so a
 * scrolling panel cannot clip it, and closes on an outside press.
 *
 * Its anatomy is exported for a picker whose keyboard lives elsewhere — a comment's @mention list driven by the
 * comment textarea: `ComboboxList` is the listbox and its options (ids `<id>-<index>`), `createListNavigation`
 * the active-index keyboard, answering `true` for a key it handled.
 */
import { createSignal, createUniqueId, For, Show, type Accessor, type JSX } from 'solid-js';
import { Popover } from './Popover';
import { useField } from './Field';
import { CONTROL_SIZE, DISABLED, FIELD_SURFACE, FOCUS_RING, type ControlSize } from './control-styles';

interface ListNavigation {
  active: Accessor<number>;
  setActive: (index: number) => void;
  /** Handle a key from whatever has focus; `true` when it was a list key (the caller then prevents its default). */
  keyDown: (key: string) => boolean;
  reset: () => void;
}

export function createListNavigation(options: { count: () => number; onSelect: (index: number) => void }): ListNavigation {
  const [active, setActive] = createSignal(-1);
  const keyDown = (key: string): boolean => {
    const count = options.count();
    if (!count) return false;
    const at = active();
    if (key === 'ArrowDown') setActive(at < 0 ? 0 : (at + 1) % count);
    else if (key === 'ArrowUp') setActive(at < 0 ? count - 1 : (at - 1 + count) % count);
    else if (key === 'Home') setActive(0);
    else if (key === 'End') setActive(count - 1);
    else if ((key === 'Enter' || key === 'Tab') && at >= 0 && at < count) options.onSelect(at);
    else return false;
    return true;
  };
  return { active, setActive, keyDown, reset: () => setActive(-1) };
}

const OPTION_SIZE: Record<ControlSize, string> = { md: 'px-3 py-2 font-sans text-sm', sm: 'px-2.5 py-1.5 font-mono text-xs' };

export function ComboboxList<T>(props: {
  id: string;
  label?: string;
  options: T[];
  optionKey: (option: T) => string;
  renderOption: (option: T, active: boolean) => JSX.Element;
  active: number;
  onActive: (index: number) => void;
  onSelect: (option: T) => void;
  /** A line under the options: loading, nothing found, an error. */
  status?: JSX.Element;
  size?: ControlSize;
  class?: string;
}): JSX.Element {
  return <div class={props.class}>
    <ul id={props.id} role="listbox" aria-label={props.label} class="max-h-64 overflow-y-auto p-1">
      <For each={props.options}>{(option, index) => (
        <li role="option" id={`${props.id}-${index()}`} data-key={props.optionKey(option)} aria-selected={index() === props.active}
          onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => props.onActive(index())} onClick={() => props.onSelect(option)}
          class={`cursor-pointer rounded-chip text-left text-fg ${OPTION_SIZE[props.size ?? 'md']} ${index() === props.active ? 'bg-raised' : ''}`}>
          {props.renderOption(option, index() === props.active)}
        </li>
      )}</For>
    </ul>
    <Show when={props.status}><p role="status" class="px-3 py-2 font-sans text-xs text-muted">{props.status}</p></Show>
  </div>;
}

export function Combobox<T>(props: {
  value: string;
  onValue: (value: string) => void;
  options: T[];
  optionKey: (option: T) => string;
  renderOption: (option: T, active: boolean) => JSX.Element;
  onSelect: (option: T) => void;
  /** The input's accessible name; omit it inside a Field. */
  ariaLabel?: string;
  /** The listbox's accessible name; defaults to `<name> suggestions`. */
  listLabel?: string;
  placeholder?: string;
  status?: JSX.Element;
  size?: ControlSize;
  disabled?: boolean;
  class?: string;
}): JSX.Element {
  const field = useField();
  const list = createUniqueId();
  const [open, setOpen] = createSignal(false);
  const size = () => props.size ?? 'md';
  const pick = (option: T) => { setOpen(false); nav.reset(); props.onSelect(option); };
  const nav = createListNavigation({ count: () => props.options.length, onSelect: (index) => pick(props.options[index]!) });
  const show = () => { if (!props.disabled) setOpen(true); };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { if (open()) { event.preventDefault(); event.stopPropagation(); setOpen(false); nav.reset(); } return; }
    if (!open()) { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); show(); nav.keyDown(event.key); } return; }
    if (event.key === 'Tab') { setOpen(false); return; }
    if (nav.keyDown(event.key)) event.preventDefault();
  };
  return <div class={`relative min-w-0 ${props.class ?? ''}`}>
    <Popover open={open()} onOpenChange={(next) => { setOpen(next); if (!next) nav.reset(); }} width="trigger" class="overflow-hidden"
      trigger={(attrs) => (
        <input ref={attrs.ref} type="text" role="combobox" autocomplete="off" id={field?.id}
          aria-label={props.ariaLabel} aria-describedby={field?.describedBy} aria-invalid={field?.invalid || undefined}
          aria-autocomplete="list" aria-haspopup="listbox" aria-expanded={attrs['aria-expanded']} aria-controls={open() ? list : undefined}
          aria-activedescendant={open() && nav.active() >= 0 && nav.active() < props.options.length ? `${list}-${nav.active()}` : undefined}
          value={props.value} placeholder={props.placeholder} disabled={props.disabled}
          onInput={(event) => { props.onValue(event.currentTarget.value); nav.reset(); show(); }}
          onClick={show}
          onKeyDown={onKeyDown}
          class={`${FIELD_SURFACE} ${CONTROL_SIZE[size()]} ${FOCUS_RING} ${DISABLED}`} />
      )}>
      <ComboboxList id={list} label={props.listLabel ?? `${props.ariaLabel ?? field?.label ?? ''} suggestions`.trim()} options={props.options} optionKey={props.optionKey}
        renderOption={props.renderOption} active={nav.active()} onActive={nav.setActive} onSelect={pick} status={props.status} size={size()} />
    </Popover>
  </div>;
}
