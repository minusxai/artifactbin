/* @jsxImportSource solid-js */
/**
 * THE APP'S SELECT, drawn for what a native <select> leaves to OS widgets: a trigger button over an
 * anchored, portalled listbox (solid/ui/Popover). A listbox, not a menu, so `aria-selected` and the check
 * mark always mean something, and a caller that needs "no value" passes it as an explicit option.
 * The trigger is an Input of the same `size` in every measure (height, radius, border, focus ring); it is
 * named by `ariaLabel`, or by the Field it sits in.
 */
import { createSignal, For, Show, type JSX } from 'solid-js';
import Check from 'lucide-solid/icons/check';
import ChevronDown from 'lucide-solid/icons/chevron-down';
import { Popover } from './Popover';
import { useField } from './Field';
import { CONTROL_SIZE, DISABLED, FIELD_SURFACE, FOCUS_RING, type ControlSize } from './control-styles';

interface SelectOption {
  value: string;
  label: string;
  /** Dim annotation after the label — a column's type, a dataset's row count. */
  hint?: string;
}

const OPTION_SIZE: Record<ControlSize, string> = {
  md: 'min-h-control-sm px-3 py-1.5 font-sans text-sm',
  sm: 'px-2.5 py-1 font-mono text-xs',
};

export function Select(props: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  /** The accessible name; omit it inside a Field, whose label names the trigger. */
  ariaLabel?: string;
  size?: ControlSize;
  disabled?: boolean;
  /** Trigger text when `value` matches no option — the caller says what absence means here. */
  placeholder?: string;
  class?: string;
}): JSX.Element {
  const field = useField();
  const size = () => props.size ?? 'md';
  const [open, setOpen] = createSignal(false);
  /** Keyboard cursor while open; seeded on the current value so arrows start from it. */
  const [active, setActive] = createSignal(0);
  const current = () => props.options.find((o) => o.value === props.value);
  const placeholder = () => props.placeholder ?? '— none —';
  const name = () => props.ariaLabel ?? field?.label ?? '';

  const pick = (v: string) => { setOpen(false); props.onChange(v); };
  const openList = () => {
    setActive(Math.max(0, props.options.findIndex((o) => o.value === props.value)));
    setOpen(true);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (!open()) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); openList(); }
      return;
    }
    if (event.key === 'Escape') { event.preventDefault(); setOpen(false); }
    else if (event.key === 'ArrowDown') { event.preventDefault(); setActive((i) => Math.min(i + 1, props.options.length - 1)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (event.key === 'Home') { event.preventDefault(); setActive(0); }
    else if (event.key === 'End') { event.preventDefault(); setActive(props.options.length - 1); }
    else if (event.key === 'Enter') { event.preventDefault(); const o = props.options[active()]; if (o) pick(o.value); }
    else if (event.key === 'Tab') setOpen(false);
  };

  return (
    <div class={`relative min-w-0 ${props.class ?? ''}`} onKeyDown={onKeyDown}>
      <Popover
        open={open()}
        onOpenChange={(next) => (next ? openList() : setOpen(false))}
        label={`${name()} options`}
        role="listbox"
        class="max-h-64 overflow-y-auto py-1"
        onPanelKeyDown={onKeyDown}
        trigger={(attrs) => (
          <button
            ref={attrs.ref}
            type="button"
            id={field?.id}
            aria-label={props.ariaLabel}
            aria-labelledby={props.ariaLabel ? undefined : field?.labelId}
            aria-describedby={field?.describedBy}
            aria-haspopup="listbox"
            aria-expanded={attrs['aria-expanded']}
            disabled={props.disabled}
            onClick={() => (open() ? setOpen(false) : openList())}
            class={`flex cursor-pointer items-center justify-between gap-2 text-left hover:bg-raised ${FIELD_SURFACE} ${CONTROL_SIZE[size()]} ${FOCUS_RING} ${DISABLED}`}
          >
            <span class={`truncate ${current() ? '' : 'text-faint'}`}>
              {current() ? current()!.label : placeholder()}
              <Show when={current()?.hint}>{(hint) => <span class="text-faint"> · {hint()}</span>}</Show>
            </span>
            <ChevronDown size={size() === 'md' ? 14 : 12} aria-hidden="true" class="shrink-0 opacity-60" />
          </button>
        )}
      >
        <div style={{ width: 'var(--radix-popper-anchor-width)' }}>
          <For each={props.options}>
            {(o, i) => (
              <button
                type="button"
                role="option"
                aria-selected={o.value === props.value}
                onClick={() => pick(o.value)}
                onMouseEnter={() => setActive(i())}
                class={`flex w-full cursor-pointer items-center justify-between gap-2 text-left text-fg ${OPTION_SIZE[size()]} ${i() === active() ? 'bg-raised' : ''}`}
              >
                <span class="truncate">
                  {o.label}
                  <Show when={o.hint}>{(hint) => <span class="text-faint"> · {hint()}</span>}</Show>
                </span>
                <Show when={o.value === props.value}><Check size={size() === 'md' ? 13 : 11} aria-hidden="true" class="shrink-0 text-accent" /></Show>
              </button>
            )}
          </For>
        </div>
      </Popover>
    </div>
  );
}
