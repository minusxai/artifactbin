/* @jsxImportSource solid-js */
/**
 * THE ACTION MENU: a trigger over a portalled `role="menu"` of `menuitem`s, built on solid/ui/Popover (so it
 * shares placement, the one-open-popup rule, outside-press and Escape dismissal, its layer and appearance).
 * Opening focuses the first enabled item (the WAI-ARIA menu button pattern); ArrowUp/ArrowDown (wrapping), Home
 * and End move between the enabled items of the menu that has focus; Escape and Tab close it and return focus to
 * the trigger. Choosing an item closes the menu and focuses the trigger BEFORE `onSelect` runs, so a dialog the
 * item opens remembers a live element to return to (not BODY).
 *
 * Entries: an action (`onSelect`), a link (`href`, an <a role="menuitem">), a checkbox item (`checked`,
 * `menuitemcheckbox`), a submenu (`items`: a flyout beside its item, opened by hover, a click, ArrowRight, Enter
 * or Space and closed by ArrowLeft — Escape closes the whole menu), `{ separator: true }` and
 * `{ section, items }`, a labelled group. `width="trigger"` draws the panel as wide as a full-width trigger.
 *
 * `icon` is a FUNCTION returning the element: in Solid, JSX evaluates to a real DOM node, and a prop getter
 * that builds one would build a fresh node on every read. Items render with <Index>, not <For>: callers build
 * a fresh items array on every reactive read, and <For> keys by object identity, so it would recreate every
 * item whenever `busy` changed — dropping focus. <Index> keys by position and updates fields in place.
 */
import { createSignal, createUniqueId, Index, Match, Show, Switch, type Accessor, type JSX } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import Check from 'lucide-solid/icons/check';
import ChevronRight from 'lucide-solid/icons/chevron-right';
import Ellipsis from 'lucide-solid/icons/ellipsis';
import { Popover } from './Popover';
import { Tooltip } from './Tooltip';
import { FOCUS_RING } from './control-styles';

export interface MenuItem {
  /** The item's accessible name; it names the row it acts on: `Delete My doc`. */
  label: string;
  text: string;
  icon?: () => JSX.Element;
  onSelect?: () => void;
  /** A link item: an <a role="menuitem"> to this address. */
  href?: string;
  target?: string;
  danger?: boolean;
  /** Offered but refused: the caller puts the reason in `text`. */
  disabled?: boolean;
  /** A checkbox item (`menuitemcheckbox`) in this state. */
  checked?: boolean;
  /** A submenu, opened as a flyout beside this item. */
  items?: MenuEntry[];
}
export type MenuEntry = MenuItem | { separator: true } | { section: string; items: MenuItem[] };

interface MenuTriggerAttrs {
  ref: (el: HTMLElement) => void;
  'aria-haspopup': 'menu';
  'aria-expanded': boolean;
  onClick: () => void;
  onKeyDown: (event: KeyboardEvent) => void;
}

const ITEMS = '[role="menuitem"]:not([disabled]), [role="menuitemcheckbox"]:not([disabled])';
const ROW = `flex w-full items-center gap-2 rounded-chip px-2 py-1 text-left text-muted no-underline ${FOCUS_RING} focus-visible:bg-raised disabled:cursor-not-allowed disabled:text-faint enabled:cursor-pointer enabled:hover:bg-raised`;
const SURFACE = 'min-w-36 whitespace-nowrap p-1 font-mono text-xs';

/** The enabled items of `menu` itself, not of a submenu inside it. */
const itemsOf = (menu: Element | null): HTMLElement[] =>
  [...(menu?.querySelectorAll<HTMLElement>(ITEMS) ?? [])].filter((item) => item.closest('[role="menu"]') === menu);

interface RowContext { close: () => void; sub: Accessor<string | null>; setSub: (label: string | null) => void }

export function Menu(props: {
  /** Accessible name of the menu panel. */
  label: string;
  items: MenuEntry[];
  /** Renders the trigger; spread the given attrs onto the real trigger button. */
  trigger: (attrs: MenuTriggerAttrs) => JSX.Element;
  align?: 'start' | 'center' | 'end';
  width?: 'trigger';
}): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const [sub, setSub] = createSignal<string | null>(null);
  let trigger: HTMLElement | undefined;
  let panel: HTMLDivElement | undefined;
  const show = () => { setSub(null); setOpen(true); itemsOf(panel?.closest('[role="menu"]') ?? null)[0]?.focus(); };
  const close = () => { setOpen(false); trigger?.focus({ preventScroll: true }); };

  const onPanelKeyDown = (event: KeyboardEvent) => {
    const menu = (event.target as HTMLElement).closest('[role="menu"]');
    const all = itemsOf(menu);
    const root = menu?.getRootNode() as Document | ShadowRoot | undefined;
    const at = all.findIndex(item => item === root?.activeElement);
    const go = (index: number) => all[(index + all.length) % all.length]?.focus();
    if (event.key === 'ArrowDown') go(at < 0 ? 0 : at + 1);
    else if (event.key === 'ArrowUp') go(at < 0 ? -1 : at - 1);
    else if (event.key === 'Home') go(0);
    else if (event.key === 'End') go(-1);
    else if (event.key === 'Tab') close();
    else return;
    event.preventDefault();
  };
  const context: RowContext = { close, sub, setSub };

  return (
    <Popover
      open={open()}
      onOpenChange={(next) => (next ? show() : setOpen(false))}
      label={props.label}
      role="menu"
      align={props.align ?? 'end'}
      width={props.width}
      class={SURFACE}
      onPanelKeyDown={onPanelKeyDown}
      trigger={(attrs) => props.trigger({
        ref: (el) => { trigger = el; attrs.ref(el); },
        'aria-haspopup': 'menu',
        get 'aria-expanded'() { return attrs['aria-expanded']; },
        onClick: () => (open() ? setOpen(false) : show()),
        onKeyDown: (event) => { if (!open() && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) { event.preventDefault(); show(); } },
      })}
    >
      <div ref={panel} class="flex flex-col"><Entries entries={props.items} context={context} /></div>
    </Popover>
  );
}

function Entries(props: { entries: MenuEntry[]; context: RowContext }): JSX.Element {
  return <Index each={props.entries}>{(entry) => (
    <Switch fallback={<Row item={entry() as MenuItem} context={props.context} />}>
      <Match when={'separator' in entry()}><div role="separator" class="my-1 h-px bg-edge" /></Match>
      <Match when={'section' in entry() && (entry() as { section: string; items: MenuItem[] })}>{(section) => {
        const id = createUniqueId();
        return <div role="group" aria-labelledby={id} class="mt-1 border-t border-edge pt-1 first:mt-0 first:border-t-0 first:pt-0">
          <div id={id} class="px-2 pt-1.5 pb-1 text-micro uppercase tracking-[0.14em] text-faint">{section().section}</div>
          <Entries entries={section().items} context={props.context} />
        </div>;
      }}</Match>
    </Switch>
  )}</Index>;
}

/** Each flyout owns its sibling selection; hovering a child must not close its parent. */
function FlyoutEntries(props: { entries: MenuEntry[]; close: () => void }): JSX.Element {
  const [sub, setSub] = createSignal<string | null>(null);
  return <Entries entries={props.entries} context={{ close: props.close, sub, setSub }} />;
}

function Row(props: { item: MenuItem; context: RowContext }): JSX.Element {
  let row: HTMLElement | undefined;
  let flyout: HTMLDivElement | undefined;
  const nested = () => !!props.item.items?.length;
  const expanded = () => nested() && props.context.sub() === props.item.label;
  const openSub = (focus: boolean) => {
    props.context.setSub(props.item.label);
    if (focus) itemsOf(flyout ?? null)[0]?.focus();
  };
  const tone = () => (props.item.danger ? 'enabled:hover:text-danger enabled:focus-visible:text-danger hover:text-danger' : 'enabled:hover:text-fg enabled:focus-visible:text-fg hover:text-fg');
  const choose = () => {
    if (nested()) { openSub(true); return; }
    props.context.close();
    props.item.onSelect?.();
  };
  return <div class="relative" onMouseEnter={() => { if (!nested() && props.context.sub()) props.context.setSub(null); else if (nested()) openSub(false); }}>
    <Dynamic
      component={props.item.href !== undefined && !props.item.disabled ? 'a' : 'button'}
      ref={(el: HTMLElement) => { row = el; }}
      type={props.item.href !== undefined && !props.item.disabled ? undefined : 'button'}
      href={props.item.disabled ? undefined : props.item.href}
      target={props.item.href !== undefined ? props.item.target : undefined}
      role={props.item.checked !== undefined ? 'menuitemcheckbox' : 'menuitem'}
      aria-checked={props.item.checked !== undefined ? props.item.checked : undefined}
      aria-haspopup={nested() ? 'menu' : undefined}
      aria-expanded={nested() ? expanded() : undefined}
      tabIndex={-1}
      aria-label={props.item.label}
      disabled={props.item.disabled}
      class={`${ROW} ${tone()} ${expanded() ? 'bg-raised text-fg' : ''}`}
      onClick={choose}
      onKeyDown={(event: KeyboardEvent) => {
        if (nested() && (event.key === 'ArrowRight' || event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); event.stopPropagation(); openSub(true); }
      }}
    >
      <Show when={props.item.checked !== undefined}><span aria-hidden="true" class="inline-flex w-3 shrink-0">{props.item.checked ? <Check size={12} /> : null}</span></Show>
      {props.item.icon?.()} {props.item.text}
      <Show when={nested()}><ChevronRight size={12} aria-hidden="true" class="ml-auto shrink-0" /></Show>
    </Dynamic>
    <Show when={expanded()}>
      <div ref={flyout} role="menu" aria-label={props.item.label}
        onKeyDown={(event) => { if (event.key === 'ArrowLeft') { event.preventDefault(); event.stopPropagation(); props.context.setSub(null); row?.focus(); } }}
        class={`absolute left-full top-0 ml-1 rounded-panel border border-edge bg-surface text-fg shadow-lg ${SURFACE}`}>
        <div class="flex flex-col"><FlyoutEntries entries={props.item.items!} close={props.context.close} /></div>
      </div>
    </Show>
  </div>;
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
