'use client';

/**
 * The house dropdown — terminal-graphite chrome for what a native <select>
 * draws with OS widgets. Same anatomy as ThemePicker (trigger button, absolute
 * panel, pointerdown-outside + Escape dismiss), made reusable now that the
 * pattern repeats across the chart inspector.
 *
 * Lives beside ui.tsx rather than in it: the kit file is imported by server
 * components for its class constants, and this one needs state.
 *
 * A listbox, not a menu: it always models "one value out of a closed set", so
 * `aria-selected` and the check mark always mean something. Callers that need
 * "no value" pass it as an explicit option (`{ value: '', label: '— none —' }`)
 * — the empty string is a choice a user can make, not an absence.
 *
 * THE PANEL IS PORTALLED, for the same reason Tooltip's is: an absolutely
 * placed panel is clipped by any `overflow-hidden`/`overflow-y-auto` ancestor,
 * and z-index does not escape a clip. This dropdown's homes are precisely the
 * places that have one — the centered share dialog (which rounds its corners
 * and scrolls its own body) and the chart inspector rail — so the role list on
 * the last person in the share list was cut in half and `can edit` could not be
 * reached. Radix Popover also flips it above the trigger when the space below
 * runs out, which is the other half of the same bug.
 */
import { Check, ChevronDown } from 'lucide-react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { useState } from 'react';

export interface SelectMenuOption {
  value: string;
  label: string;
  /** Dim annotation after the label — a column's type, a dataset's row count. */
  hint?: string;
}

export function SelectMenu({
  value,
  options,
  onChange,
  ariaLabel,
  disabled = false,
  placeholder = '— none —',
}: {
  value: string;
  options: SelectMenuOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  disabled?: boolean;
  /** Trigger text when `value` matches no option — the caller says what absence means here. */
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  /** Keyboard cursor while open; seeded on the current value so arrows start from it. */
  const [active, setActive] = useState(0);

  const current = options.find((o) => o.value === value);
  const pick = (v: string) => {
    setOpen(false);
    onChange(v);
  };
  const openList = () => {
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        openList();
      }
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, options.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (options[active]) pick(options[active].value); }
    else if (e.key === 'Tab') setOpen(false);
  };

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={(next) => (next ? openList() : setOpen(false))}>
      <div className="relative" onKeyDown={onKeyDown}>
        <PopoverPrimitive.Trigger asChild>
          <button
            type="button"
            aria-label={ariaLabel}
            aria-haspopup="listbox"
            disabled={disabled}
            className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-[4px] border border-edge bg-surface px-2 py-1 text-left font-mono text-xs text-fg hover:bg-raised disabled:cursor-default disabled:opacity-50"
          >
            <span className="truncate">
              {current ? current.label : placeholder}
              {current?.hint && <span className="text-faint"> · {current.hint}</span>}
            </span>
            <ChevronDown size={12} className="shrink-0 opacity-60" />
          </button>
        </PopoverPrimitive.Trigger>
      </div>

      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          role="listbox"
          aria-label={`${ariaLabel} options`}
          align="start"
          sideOffset={4}
          collisionPadding={8}
          onKeyDown={onKeyDown}
          // The trigger keeps the keyboard; a listbox whose options are buttons
          // would otherwise take focus on open and lose the arrow handler above.
          onOpenAutoFocus={(e) => e.preventDefault()}
          // Above EVERY app layer, not merely above its neighbours: portalled to
          // <body>, it inherits no stacking context from the thing that opened
          // it, so it has to outrank the highest surface that can hold a trigger
          // — the centered dialogs at z-[100], which is where it lives.
          className="z-[200] max-h-64 overflow-y-auto rounded-[4px] border border-edge bg-surface py-1 shadow-lg"
          style={{ width: 'var(--radix-popover-trigger-width)' }}
        >
          {options.map((o, i) => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={o.value === value}
              onClick={() => pick(o.value)}
              onMouseEnter={() => setActive(i)}
              className={`flex w-full cursor-pointer items-center justify-between gap-2 px-2 py-1 text-left font-mono text-xs text-fg ${
                i === active ? 'bg-raised' : ''
              }`}
            >
              <span className="truncate">
                {o.label}
                {o.hint && <span className="text-faint"> · {o.hint}</span>}
              </span>
              {o.value === value && <Check size={11} className="shrink-0 text-accent" />}
            </button>
          ))}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
