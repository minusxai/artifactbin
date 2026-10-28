/* @jsxImportSource solid-js */
/**
 * A click-toggle popover anchored to its trigger and portalled out of the document flow — the Solid
 * counterpart of a Radix popover. A scrolling toolbar or a clipped rail must not clip the panel (the same
 * reason AnchoredPanel gives for its own portal), so it is placed with the framework-free Radix popper
 * model the islands and solid/ui/Tooltip already use, and portalled to the trusted UI host
 * when the page has one, else <body>.
 *
 * The caller owns `open`; this owns placement and dismissal through the kit's one popup contract
 * (lib/islands/kit/popup-dismiss): an outside pointerdown or Escape reports a close, and opening one
 * closes any other open popup. Opening never steals focus from the trigger (Radix's onOpenAutoFocus prevented) — a
 * field inside the panel that wants focus asks for it itself (the `autofocus` attribute, or a ref).
 * The panel takes the appearance of its trigger (solid/ui/theme), so a popover opened inside a dark editor is dark.
 */
import { createEffect, createSignal, createUniqueId, on, onCleanup, Show, untrack, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import { placePopper, type Align, type Side } from '@/lib/islands/kit/popper';
import { trustedPortalOf } from '@/lib/islands/trusted-portal';
import { popupDismiss } from '@/lib/islands/kit/popup-dismiss';
import { LAYER } from './layers';
import { createAnchoredAppearance } from './theme';

export interface PopoverTriggerAttrs {
  ref: (el: HTMLElement) => void;
  'aria-haspopup': 'true';
  'aria-expanded': boolean;
}

export function Popover(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Renders the trigger; spread the given attrs onto the real trigger element. */
  trigger: (attrs: PopoverTriggerAttrs) => JSX.Element;
  /** Accessible name of the panel (omit it for a panel whose content names itself). */
  label?: string;
  /** The panel's id, when a trigger must point at it (`aria-controls`); one is generated otherwise. */
  id?: string;
  /** `trigger` draws the panel exactly as wide as its trigger. */
  width?: 'trigger';
  side?: Side;
  align?: Align;
  sideOffset?: number;
  /** Extra classes on the panel surface. */
  class?: string;
  /** role="listbox" for a Select's panel, "menu" for a Menu's; omitted (plain group) for a panel of controls. */
  role?: 'listbox' | 'menu';
  onPanelKeyDown?: (event: KeyboardEvent) => void;
  children: JSX.Element;
}): JSX.Element {
  const [anchor, setAnchor] = createSignal<HTMLElement>();
  const [panel, setPanel] = createSignal<HTMLElement>();
  const generated = createUniqueId();
  const announce = popupDismiss(() => props.open, () => props.onOpenChange(false), anchor, panel);
  createEffect(on(() => props.open, (open) => { if (open) announce(); }));
  // The trigger is built ONCE; `aria-expanded` is a getter, so opening updates the attribute in place and
  // never recreates the trigger node (focus, tooltips and a caller's captured element all survive).
  const attrs: PopoverTriggerAttrs = { ref: setAnchor, 'aria-haspopup': 'true', get 'aria-expanded'() { return props.open; } };
  return (
    <>
      {untrack(() => props.trigger(attrs))}
      <Show when={props.open}>
        <Portal mount={trustedPortalOf(document) ?? document.body}>
          <PopoverPanel
            anchor={() => anchor()!}
            ref={setPanel}
            id={props.id ?? generated}
            label={props.label}
            width={props.width}
            side={props.side ?? 'bottom'}
            align={props.align ?? 'start'}
            sideOffset={props.sideOffset ?? 4}
            class={props.class}
            role={props.role}
            onKeyDown={props.onPanelKeyDown}
          >
            {props.children}
          </PopoverPanel>
        </Portal>
      </Show>
    </>
  );
}

function PopoverPanel(p: {
  anchor: () => HTMLElement;
  id: string;
  label?: string;
  width?: 'trigger';
  side: Side;
  align: Align;
  sideOffset: number;
  class?: string;
  role?: 'listbox' | 'menu';
  onKeyDown?: (event: KeyboardEvent) => void;
  ref: (el: HTMLElement) => void;
  children: JSX.Element;
}): JSX.Element {
  let wrapper!: HTMLDivElement;
  const appearance = createAnchoredAppearance(p.anchor);
  createEffect(() => {
    const anchor = p.anchor();
    if (!anchor) return;
    const stop = placePopper(anchor, wrapper, null, {
      side: p.side, align: p.align, sideOffset: p.sideOffset, collisionPadding: 8, arrowWidth: 0, arrowHeight: 0,
      onPlaced: () => {},
    });
    onCleanup(stop);
  });
  return (
    <div data-mx-theme-host="" data-app-appearance={appearance()}>
      <div
        ref={(el) => { wrapper = el; p.ref(el); }}
        data-story-popper-wrapper=""
        style={{ position: 'fixed', left: '0px', top: '0px', transform: 'translate(0, -200%)', 'min-width': 'max-content', 'z-index': String(LAYER.popover) }}
      >
        <div
          id={p.id}
          role={p.role}
          aria-label={p.label || undefined}
          data-story-floating=""
          onKeyDown={p.onKeyDown}
          style={p.width === 'trigger' ? { width: 'var(--radix-popper-anchor-width)' } : undefined}
          class={`rounded-panel border border-edge bg-surface text-fg shadow-lg ${p.class ?? ''}`}
        >
          {p.children}
        </div>
      </div>
    </div>
  );
}
