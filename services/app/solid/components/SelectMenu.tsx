/* @jsxImportSource solid-js */
/**
 * components/SelectMenu.tsx in SOLID: the house dropdown, terminal-graphite chrome for what a native
 * <select> draws with OS widgets. Same contract — a trigger button over an anchored, portalled panel
 * (solid/components/Popover) — and the same anatomy: a listbox, not a menu, so `aria-selected` and the
 * check mark always mean something, and a caller that needs "no value" passes it as an explicit option.
 */
import { createSignal, For, Show, type JSX } from 'solid-js';
import Check from 'lucide-solid/icons/check';
import ChevronDown from 'lucide-solid/icons/chevron-down';
import { Popover } from './Popover';

export interface SelectMenuOption {
  value: string;
  label: string;
  /** Dim annotation after the label — a column's type, a dataset's row count. */
  hint?: string;
}

export function SelectMenu(props: {
  value: string;
  options: SelectMenuOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  disabled?: boolean;
  /** Trigger text when `value` matches no option — the caller says what absence means here. */
  placeholder?: string;
}): JSX.Element {
  const [open, setOpen] = createSignal(false);
  /** Keyboard cursor while open; seeded on the current value so arrows start from it. */
  const [active, setActive] = createSignal(0);
  const current = () => props.options.find((o) => o.value === props.value);
  const placeholder = () => props.placeholder ?? '— none —';

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
    else if (event.key === 'Enter') { event.preventDefault(); const o = props.options[active()]; if (o) pick(o.value); }
    else if (event.key === 'Tab') setOpen(false);
  };

  return (
    <div class="relative" onKeyDown={onKeyDown}>
      <Popover
        open={open()}
        onOpenChange={(next) => (next ? openList() : setOpen(false))}
        label={`${props.ariaLabel} options`}
        role="listbox"
        class="z-[200] max-h-64 overflow-y-auto rounded-[4px] py-1"
        onPanelKeyDown={onKeyDown}
        trigger={(attrs) => (
          <button
            ref={attrs.ref}
            type="button"
            aria-label={props.ariaLabel}
            aria-haspopup={attrs['aria-haspopup']}
            disabled={props.disabled}
            onClick={() => (open() ? setOpen(false) : openList())}
            class="flex w-full cursor-pointer items-center justify-between gap-2 rounded-[4px] border border-edge bg-surface px-2 py-1 text-left font-mono text-xs text-fg hover:bg-raised disabled:cursor-default disabled:opacity-50"
          >
            <span class="truncate">
              {current() ? current()!.label : placeholder()}
              <Show when={current()?.hint}>{(hint) => <span class="text-faint"> · {hint()}</span>}</Show>
            </span>
            <ChevronDown size={12} class="shrink-0 opacity-60" />
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
                class={`flex w-full cursor-pointer items-center justify-between gap-2 px-2 py-1 text-left font-mono text-xs text-fg ${i() === active() ? 'bg-raised' : ''}`}
              >
                <span class="truncate">
                  {o.label}
                  <Show when={o.hint}>{(hint) => <span class="text-faint"> · {hint()}</span>}</Show>
                </span>
                <Show when={o.value === props.value}><Check size={11} class="shrink-0 text-accent" /></Show>
              </button>
            )}
          </For>
        </div>
      </Popover>
    </div>
  );
}
