/* @jsxImportSource solid-js */
/**
 * THE ACTION MENU: a trigger over a portalled `role="menu"` of `menuitem`s, built on solid/ui/Popover (so it
 * shares placement, the one-open-popup rule, outside-press and Escape dismissal, and its layer).
 * Opening focuses the first enabled item; ArrowUp/ArrowDown (wrapping), Home and End move between enabled
 * items; Escape and Tab close it and return focus to the trigger. Choosing an item closes the menu and
 * focuses the trigger BEFORE `onSelect` runs, so a dialog the item opens remembers a live element to
 * return to (not BODY).
 *
 * `icon` is a FUNCTION returning the element: in Solid, JSX evaluates to a real DOM node, and a prop getter
 * that builds one would build a fresh node on every read. Items render with <Index>, not <For>: callers build
 * a fresh items array on every reactive read, and <For> keys by object identity, so it would recreate every
 * item whenever `busy` changed — dropping focus. <Index> keys by position and updates fields in place.
 */
import { createSignal, Index, Show, type JSX } from 'solid-js';
import Ellipsis from 'lucide-solid/icons/ellipsis';
import { Popover } from './Popover';
import { Tooltip } from './Tooltip';
import { FOCUS_RING } from './control-styles';

interface MenuItem {
  /** The item's accessible name; it names the row it acts on: `Delete My doc`. */
  label: string;
  text: string;
  icon?: () => JSX.Element;
  onSelect: () => void;
  danger?: boolean;
  /** Offered but refused: the caller puts the reason in `text`. */
  disabled?: boolean;
}

interface MenuTriggerAttrs {
  ref: (el: HTMLElement) => void;
  'aria-haspopup': 'menu';
  'aria-expanded': boolean;
  onClick: () => void;
  onKeyDown: (event: KeyboardEvent) => void;
}

const ITEMS = '[role="menuitem"]:not([disabled])';

export function Menu(props: {
  /** Accessible name of the menu panel. */
  label: string;
  items: MenuItem[];
  /** Renders the trigger; spread the given attrs onto the real trigger button. */
  trigger: (attrs: MenuTriggerAttrs) => JSX.Element;
  align?: 'start' | 'center' | 'end';
}): JSX.Element {
  const [open, setOpen] = createSignal(false);
  let trigger: HTMLElement | undefined;
  let panel: HTMLDivElement | undefined;
  const items = () => [...(panel?.querySelectorAll<HTMLButtonElement>(ITEMS) ?? [])];
  const focusItem = (pick: (all: HTMLButtonElement[], at: number) => HTMLButtonElement | undefined) => {
    const all = items();
    pick(all, all.indexOf(document.activeElement as HTMLButtonElement))?.focus();
  };
  const show = () => { setOpen(true); focusItem((all) => all[0]); };
  const close = () => { setOpen(false); trigger?.focus({ preventScroll: true }); };

  const onPanelKeyDown = (event: KeyboardEvent) => {
    const step = (by: number) => focusItem((all, at) => all[(Math.max(at, by > 0 ? -1 : 0) + by + all.length) % all.length]);
    if (event.key === 'ArrowDown') step(1);
    else if (event.key === 'ArrowUp') step(-1);
    else if (event.key === 'Home') focusItem((all) => all[0]);
    else if (event.key === 'End') focusItem((all) => all[all.length - 1]);
    else if (event.key === 'Tab') close();
    else return;
    event.preventDefault();
  };

  return (
    <Popover
      open={open()}
      onOpenChange={(next) => (next ? show() : setOpen(false))}
      label={props.label}
      role="menu"
      align={props.align ?? 'end'}
      class="min-w-36 whitespace-nowrap p-1 font-mono text-xs"
      onPanelKeyDown={onPanelKeyDown}
      trigger={(attrs) => props.trigger({
        ref: (el) => { trigger = el; attrs.ref(el); },
        'aria-haspopup': 'menu',
        get 'aria-expanded'() { return attrs['aria-expanded']; },
        onClick: () => (open() ? setOpen(false) : show()),
        onKeyDown: (event) => { if (!open() && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) { event.preventDefault(); show(); } },
      })}
    >
      <div ref={panel} class="flex flex-col">
        <Index each={props.items}>
          {(item) => (
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              aria-label={item().label}
              disabled={item().disabled}
              class={`flex w-full items-center gap-2 rounded-chip px-2 py-1 text-left text-muted ${FOCUS_RING} focus-visible:bg-raised disabled:cursor-not-allowed disabled:text-faint enabled:cursor-pointer enabled:hover:bg-raised ${item().danger ? 'enabled:hover:text-danger enabled:focus-visible:text-danger' : 'enabled:hover:text-fg enabled:focus-visible:text-fg'}`}
              onClick={() => { close(); item().onSelect(); }}
            >
              {item().icon?.()} {item().text}
            </button>
          )}
        </Index>
      </div>
    </Popover>
  );
}

/** The overflow menu behind a row's "…": an ellipsis icon button named `More actions for <name>`. */
export function RowMenu(props: { name: string; items: MenuItem[] }): JSX.Element {
  return (
    <Show when={props.items.length > 0}>
      <span class="relative z-10 inline-flex">
        <Menu label={`Actions for ${props.name}`} items={props.items} trigger={(attrs) => (
          <Tooltip content="more">
            <button
              {...attrs}
              type="button"
              aria-label={`More actions for ${props.name}`}
              class={`inline-flex size-6 cursor-pointer items-center justify-center rounded-chip border-0 bg-transparent p-0 transition-colors ${FOCUS_RING} ${attrs['aria-expanded'] ? 'text-fg' : 'text-muted hover:text-accent'}`}
            >
              <Ellipsis size={13} aria-hidden="true" />
            </button>
          </Tooltip>
        )} />
      </span>
    </Show>
  );
}
